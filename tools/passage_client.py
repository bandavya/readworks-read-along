"""Signed passage API calls. Requires botocore (installed with boto3 in the pipeline venv)."""
import argparse
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def call(url, region, profile, method, body=None):
    import boto3
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest
    session = boto3.Session(profile_name=profile, region_name=region)
    credentials = session.get_credentials()
    if credentials is None:
        raise RuntimeError("No AWS credentials for this profile.")
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else b""
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    signed = AWSRequest(method=method, url=url, data=payload, headers=headers)
    SigV4Auth(credentials.get_frozen_credentials(), "execute-api", region).add_auth(signed)
    req = Request(url, data=payload if method == "POST" else None, method=method, headers=dict(signed.headers))
    try:
        with urlopen(req, timeout=45) as response:
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="PassageApiUrl stack output ending in /v1/passages")
    parser.add_argument("--region", required=True)
    parser.add_argument("--profile", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    post = sub.add_parser("post")
    post.add_argument("file", help="local product JSON or pointer JSON")
    get = sub.add_parser("get")
    get.add_argument("id")
    args = parser.parse_args()
    url = args.url.rstrip("/")
    if args.command == "post":
        data = json.loads(Path(args.file).read_text(encoding="utf-8"))
        print(json.dumps(call(url, args.region, args.profile, "POST", data), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(call(f"{url}/{args.id}", args.region, args.profile, "GET"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

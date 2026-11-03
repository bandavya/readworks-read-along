"""Browser API (HTTP API Gateway + Lambda).

Returns passage metadata, mock student access settings, job status, and signed
audio references. Section 4.1 (Browser API) and 7.2 (student-specific access).

The audio file is NOT the only access-control layer: the /access endpoint
gates whether the player is shown for a given demo student.
"""
import json
import os
from decimal import Decimal

import boto3


class _DecimalEncoder(json.JSONEncoder):
    """DynamoDB returns numbers as Decimal; render them as int/float."""

    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)

CONTENT_BUCKET = os.environ["CONTENT_BUCKET"]
JOB_TABLE = os.environ["JOB_TABLE"]
STATE_MACHINE_ARN = os.environ.get("STATE_MACHINE_ARN", "")
CDN_DOMAIN = os.environ.get("CDN_DOMAIN", "")

s3 = boto3.client("s3")
ddb = boto3.resource("dynamodb")
sfn = boto3.client("stepfunctions")


def _resp(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, cls=_DecimalEncoder),
    }


def _list_json(prefix):
    out = []
    token = None
    while True:
        kwargs = {"Bucket": CONTENT_BUCKET, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            if obj["Key"].endswith(".json"):
                out.append(obj["Key"])
        if resp.get("IsTruncated"):
            token = resp["NextContinuationToken"]
        else:
            break
    return out


def _get_json(key):
    obj = s3.get_object(Bucket=CONTENT_BUCKET, Key=key)
    return json.loads(obj["Body"].read())


def handle(event, _context):
    route = event.get("routeKey", "")
    params = event.get("pathParameters") or {}
    qs = event.get("queryStringParameters") or {}

    try:
        if route == "GET /passages":
            keys = _list_json("content/")
            items = []
            for k in keys:
                if k.endswith("assignments.json"):
                    continue  # access record, not a passage
                data = _get_json(k)
                if not data.get("passageId"):
                    continue
                items.append({
                    "passageId": data.get("passageId"),
                    "title": data.get("title"),
                    "gradeBand": data.get("gradeBand"),
                    "lexile": data.get("lexile"),
                    "au": data.get("au"),
                })
            return _resp(200, {"passages": items, "cdnDomain": CDN_DOMAIN})

        if route == "GET /passages/{id}":
            pid = params["id"]
            data = _get_json(f"content/{pid}.json")
            data["cdnDomain"] = CDN_DOMAIN
            return _resp(200, data)

        if route == "GET /passages/{id}/access":
            pid = params["id"]
            student = qs.get("student", "")
            access = _resolve_access(pid, student)
            return _resp(200, access)

        if route == "GET /jobs":
            table = ddb.Table(JOB_TABLE)
            scan = table.scan(Limit=100)
            return _resp(200, {"jobs": scan.get("Items", [])})

        if route == "POST /generate":
            body = json.loads(event.get("body") or "{}")
            pid = body["passageId"]
            resp = sfn.start_execution(
                stateMachineArn=STATE_MACHINE_ARN,
                input=json.dumps({"passageId": pid, "key": f"passages/{pid}.json"}),
            )
            return _resp(202, {"executionArn": resp["executionArn"]})

        return _resp(404, {"error": "not found", "route": route})
    except s3.exceptions.NoSuchKey:
        return _resp(404, {"error": "passage not found"})
    except Exception as exc:  # noqa: BLE001
        return _resp(500, {"error": str(exc)})


def _resolve_access(passage_id, student_id):
    """Reads the mock assignment record (section 7.2)."""
    try:
        assignments = _get_json("content/assignments.json")
    except Exception:  # noqa: BLE001
        return {"passageId": passage_id, "student": student_id, "allowed": False, "reason": "no assignments"}

    for a in assignments.get("assignments", []):
        if a.get("passageId") != passage_id:
            continue
        acc = a.get("soundAlongAccess", {})
        allowed = acc.get(student_id, acc.get("default", False))
        return {
            "passageId": passage_id,
            "student": student_id,
            "allowed": bool(allowed),
            "assignmentId": a.get("assignmentId"),
        }
    return {"passageId": passage_id, "student": student_id, "allowed": False, "reason": "no assignment for passage"}

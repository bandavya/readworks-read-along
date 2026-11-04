"""The names list: one data file that says how proper names are HEARD (for the gate) and, once a person has confirmed it,
how they are SAID (for narration). No AWS calls here except through the client you hand to load(), so it tests locally.

Two meanings, kept apart on purpose:
  heard_as       other spellings a speech recognizer is known to use for this name ("Shamel" -> "shamil", "chamel").
                 Tells ONLY the publishing gate that such a spelling is the same name. It says nothing about how the
                 name should be pronounced, and nobody has to have listened to anything for it.
  pronounce_ipa  how the voice must say the name, applied to narration as an SSML <phoneme>. Meant for entries a person has
                 confirmed ("status": "confirmed by <who> on <date>"); it stays null until then.

Where the list comes from: the copy packaged with the Lambda code (lambda/config/names.json), or, if there is one, the object
config/names.json in the content bucket. The bucket copy REPLACES the packaged one (it is the whole list, not an addition), so a
name can be added or removed by uploading a file, without a deploy. An absent, unreadable or malformed bucket file is logged and
the packaged copy is used; a malformed packaged copy gives an empty list. Neither ever stops a passage.
"""
import json
import logging
import os

log = logging.getLogger()

PACKAGED_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config", "names.json")
S3_KEY = "config/names.json"
UNCONFIRMED = "recognition spelling accepted; pronunciation NOT confirmed by a person"


def parse(data, where="names list"):
    """The file's JSON (a list of entries, or {"names": [...]}) -> a list of clean entries. Raises ValueError if the top
    level is not one of those; a single bad entry is skipped (and logged), not fatal."""
    if isinstance(data, dict):
        data = data.get("names")
    if not isinstance(data, list):
        raise ValueError(f'{where}: expected a list of entries or {{"names": [...]}}')
    out = []
    for n, e in enumerate(data):
        try:
            if not isinstance(e, dict):
                raise ValueError("not an object")
            written = e.get("written")
            if not isinstance(written, str) or not written.strip():
                raise ValueError('missing "written"')
            heard = e.get("heard_as") or []
            if not isinstance(heard, list) or not all(isinstance(h, str) and h.strip() for h in heard):
                raise ValueError('"heard_as" must be a list of non-empty strings')
            scope = e.get("scope") or "*"
            ipa = e.get("pronounce_ipa")
            if not isinstance(scope, str) or not (ipa is None or (isinstance(ipa, str) and ipa.strip())):
                raise ValueError('"scope" must be a string and "pronounce_ipa" null or a string')
            out.append({"written": written.strip(), "heard_as": [h.strip() for h in heard], "scope": scope,
                        "pronounce_ipa": ipa.strip() if ipa else None,
                        "status": str(e.get("status") or UNCONFIRMED), "source": str(e.get("source") or "")})
        except ValueError as err:
            log.warning("%s: entry %d skipped (%s)", where, n, err)
    return out


def load_packaged(path=PACKAGED_PATH):
    try:
        with open(path, encoding="utf-8") as f:
            return parse(json.load(f), "packaged names list")
    except Exception as err:  # noqa: BLE001  (absent, unreadable, malformed: never stop a passage)
        log.warning("packaged names list not usable (%s: %s); continuing with no names", type(err).__name__, err)
        return []


def load(s3=None, bucket=None, path=PACKAGED_PATH):
    """The names to use for this run: the bucket's config/names.json if it is there and readable, else the packaged copy."""
    if s3 is not None and bucket:
        try:
            body = s3.get_object(Bucket=bucket, Key=S3_KEY)["Body"].read()
            entries = parse(json.loads(body), f"s3://{bucket}/{S3_KEY}")
            log.info("names list: %d entries from s3://%s/%s", len(entries), bucket, S3_KEY)
            return entries
        except Exception as err:  # noqa: BLE001
            code = getattr(err, "response", {}).get("Error", {}).get("Code", "")
            if code in ("NoSuchKey", "404", "NotFound") or type(err).__name__ == "NoSuchKey":
                log.info("names list: no %s in the bucket; using the packaged copy", S3_KEY)
            else:
                log.warning("names list: %s in the bucket not usable (%s: %s); using the packaged copy",
                            S3_KEY, type(err).__name__, err)
    return load_packaged(path)


def in_scope(entries, scope):
    """Entries that apply to this passage: scope "*" for everyone, or the passage's own id. With no passage id only "*" applies."""
    return [e for e in entries or [] if e.get("scope", "*") == "*" or (scope is not None and e.get("scope") == scope)]


def pronounce_map(entries, scope):
    """{written text: IPA} for in-scope entries that carry a pronunciation (narration only; the gate never reads this)."""
    return {e["written"]: e["pronounce_ipa"] for e in in_scope(entries, scope) if e.get("pronounce_ipa")}


def is_confirmed(entry):
    return str(entry.get("status", "")).lower().startswith("confirmed by")

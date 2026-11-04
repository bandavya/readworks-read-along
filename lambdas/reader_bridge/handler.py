"""Publish validated Polly narration in the static reader's data contract."""
import hashlib
import html
from html.parser import HTMLParser
import json
import os
import random
import re
import time
from datetime import datetime, timezone


class ReaderInputError(ValueError):
    """A passage or speech mark cannot safely be shown by the reader."""


def _norm(value):
    return "".join(ch.lower() for ch in str(value) if ch.isalnum())


def _read(s3, bucket, key):
    with s3.get_object(Bucket=bucket, Key=key)["Body"] as body:
        return body.read()


def _optional_json(s3, bucket, key):
    try:
        return json.loads(_read(s3, bucket, key))
    except s3.exceptions.NoSuchKey:
        return None


def _words(text):
    return list(re.finditer(r"\S+", text))


def _timings(text, marks_body):
    words = _words(text)
    if not words:
        raise ReaderInputError("no reader-ready passage text")
    offsets = []
    for word in words:
        offsets.append((len(text[:word.start()].encode("utf-8")),
                        len(text[:word.end()].encode("utf-8")), word.group()))
    groups = [[] for _ in words]
    last_time = -1
    decoded = marks_body.decode("utf-8")
    marks = json.loads(decoded) if decoded.lstrip().startswith("[") else decoded.splitlines()
    for line in marks:
        if isinstance(line, str) and not line.strip():
            continue
        try:
            mark = line if isinstance(line, dict) else json.loads(line)
        except (TypeError, json.JSONDecodeError) as exc:
            raise ReaderInputError("invalid Polly speech mark JSON") from exc
        if mark.get("type") != "word":
            continue
        start, end, at = mark.get("start"), mark.get("end"), mark.get("time")
        if (not all(isinstance(v, int) and not isinstance(v, bool) for v in (start, end, at))
                or start < 0 or end <= start or at < last_time):
            raise ReaderInputError("invalid Polly word offsets or times")
        last_time = at
        hit = next((i for i, (a, b, _) in enumerate(offsets) if a <= start < end <= b), None)
        if hit is None:
            raise ReaderInputError(f"Polly word mark at byte {start} does not fit one passage word")
        groups[hit].append(mark)
    rows = []
    for i, (_, _, word) in enumerate(offsets):
        marks = groups[i]
        if not _norm(word):
            if marks:
                raise ReaderInputError(f"speech mark on silent word {i}")
            rows.append(None)
            continue
        if not marks:
            raise ReaderInputError(f"missing Polly word mark for passage word {i}: {word!r}")
        # Polly may spell numeric tokens many ways; offsets establish their boundary.
        source = _norm(word)
        spoken = "".join(_norm(m.get("value", "")) for m in marks)
        if not any(ch.isdigit() for ch in word) and source != spoken:
            raise ReaderInputError(f"Polly word {i} differs from reader text: {word!r} / {[m.get('value') for m in marks]!r}")
        begin = marks[0]["time"] / 1000
        following = next((g[0]["time"] / 1000 for g in groups[i + 1:] if g), None)
        # Polly has word start times only. The last end is an explicit 0.4 s estimate.
        end = following if following is not None else marks[-1]["time"] / 1000 + 0.4
        if end <= begin:
            raise ReaderInputError(f"non-increasing word time at passage word {i}")
        rows.append([begin, end])
    return rows


class _Annotator(HTMLParser):
    def __init__(self, words):
        super().__init__(convert_charrefs=True)
        self.words = words
        self.at = 0
        self.out = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        self.out.append(self.get_starttag_text())
        if tag not in ("br", "hr", "img", "input", "meta", "link", "source", "wbr"):
            self.stack.append(tag)

    def handle_endtag(self, tag):
        self.out.append(f"</{tag}>")
        if tag in self.stack:
            while self.stack and self.stack.pop() != tag:
                pass

    def handle_data(self, data):
        for piece in re.split(r"(\s+)", data):
            if not piece:
                continue
            if piece.isspace() or not _norm(piece):
                self.out.append(html.escape(piece, quote=False))
                continue
            if any(tag in ("figure", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6") for tag in self.stack):
                self.out.append(f'<span class="sa-w sa-unread">{html.escape(piece, quote=False)}</span>')
                continue
            if self.at >= len(self.words) or _norm(piece) != _norm(self.words[self.at][1]):
                raise ReaderInputError(f"HTML differs from passage word {self.at}: {piece!r}")
            self.out.append(f'<span class="sa-w" data-i="{self.words[self.at][0]}">{html.escape(piece, quote=False)}</span>')
            self.at += 1


def _html_for(source, text):
    # data-i is a word's place in text.split(), so a lone dash keeps its slot and has no highlight.
    words = [(i, w.group()) for i, w in enumerate(_words(text)) if _norm(w.group())]
    markup = source.get("content")
    if not markup:
        markup = "".join(f"<p>{html.escape(p.strip())}</p>" for p in re.split(r"\n+", text) if p.strip())
    annotator = _Annotator(words)
    annotator.feed(markup)
    annotator.close()
    if annotator.at != len(words):
        raise ReaderInputError(f"HTML maps {annotator.at} of {len(words)} passage words")
    return _link_vocab("".join(annotator.out), _vocab(source))


def _link_vocab(markup, vocab):
    """Tie each plain vocabulary entry to its first use, so the reader can offer its meaning."""
    for sense, entry in vocab.items():
        if f'data-vocab-sense-id="{sense}"' in markup:
            continue
        target = _norm(entry.get("word") or "")
        for match in re.finditer(r'<span class="sa-w" data-i="\d+">([^<]*)</span>', markup):
            before = markup[:match.start()]
            already_linked = before.endswith('">') and "data-vocab-sense-id" in before[before.rfind("<"):]
            if target and _norm(html.unescape(match.group(1))) == target and not already_linked:
                markup = (before + f'<span data-vocab-sense-id="{sense}" data-vocab-occurrence-id="{sense}00">'
                          + match.group(0) + "</span>" + markup[match.end():])
                break
    return markup


class _ExistingMap(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.mapped = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "span" and "sa-w" in attrs.get("class", "").split() and "data-i" in attrs:
            self.current = [attrs["data-i"], ""]

    def handle_data(self, data):
        if self.current is not None:
            self.current[1] += data

    def handle_endtag(self, tag):
        if tag == "span" and self.current is not None:
            self.mapped.append(self.current)
            self.current = None


def _existing_fits(existing, text):
    words = [w.group() for w in _words(text)]
    if existing.get("words") != len(words):
        return False
    parser = _ExistingMap()
    parser.feed(existing.get("html") or "")
    expected = [(str(i), _norm(word)) for i, word in enumerate(words) if _norm(word)]
    return [(i, _norm(word)) for i, word in parser.mapped] == expected


def _vocab(source):
    values = source.get("vocabulary") or source.get("vocab") or []
    if isinstance(values, dict):
        senses = values.get("support", {}).get("senses", {})
        occurrences = values.get("support", {}).get("occurrences", {})
        return {str(k): {"word": v.get("word") or next((o.get("word") for oid, o in occurrences.items()
                                                     if oid[:-2] == str(k) and o.get("word")), None),
                         "definition": html.unescape(v.get("definition") or ""),
                         "example": html.unescape((v.get("example_list") or [""])[0]),
                         "pos": (v.get("part_of_speech") or [None])[0], "spanish": None, "say": None}
                for k, v in senses.items()}
    return {f"v{i}": {"word": v.get("word"), "definition": v.get("definition", ""),
                       "example": v.get("example", ""), "pos": None, "spanish": None, "say": None}
            for i, v in enumerate(values) if isinstance(v, dict) and v.get("word")}


def _record(source, pid, text, html_text):
    title = str(source.get("title") or pid)
    band = str(source.get("gradeBand") or "")
    grades = {16: "K", **{n: str(n - 16) for n in range(17, 29)}}
    grade = band.split("-")[0].strip() if band else grades.get(source.get("canonical_grade"), "")
    lexile = source.get("lexile")
    if lexile is None:
        lexile = (source.get("l") or [None])[0]
    return {"uuid": pid, "title": title, "authors": source.get("a") or [],
            "lang": "EN" if str(source.get("language") or source.get("lang") or "en-US").lower().startswith("en") else str(source.get("language") or source.get("lang")),
            "grade": grade, "lexile": lexile, "wordcount": len(_words(text)),
            "title_words": title.split(), "by_words": [], "words": len(_words(text)),
            "html": html_text, "voices": [], "vocab": _vocab(source), "credit": ""}


def _index_row(record):
    return {k: record[k] for k in ("uuid", "title", "grade", "lexile", "lang", "words")} | {
        "voices": [v["id"] for v in record["voices"]]}


def _write_json(s3, bucket, key, value):
    s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(value, ensure_ascii=False).encode("utf-8"),
                  ContentType="application/json; charset=utf-8", CacheControl="no-cache")


def _mark_failed(table, event, reason):
    table.update_item(Key={"passageId": event["passageId"], "textHash": event["textHash"]},
                      UpdateExpression="SET #s = :s, readerFailureReason = :r, updatedAt = :u",
                      ExpressionAttributeNames={"#s": "status"},
                      ExpressionAttributeValues={":s": "reader_publish_failed", ":r": reason,
                                                 ":u": datetime.now(timezone.utc).isoformat()})


def _add_to_index(s3, bucket, row, pid, settle):
    """Passages seeded together can overwrite each other's list, so write, wait, and confirm."""
    for _ in range(6):
        index = _optional_json(s3, bucket, "data/index.json") or []
        if any(item.get("uuid") == pid for item in index):
            index = [row if item.get("uuid") == pid else item for item in index]
        else:
            index.append(row)
        _write_json(s3, bucket, "data/index.json", index)
        settle()
        if any(item.get("uuid") == pid for item in _optional_json(s3, bucket, "data/index.json") or []):
            return
    raise RuntimeError(f"{pid} did not stay in data/index.json")


def publish(event, s3, table, content_bucket, audio_bucket, frontend_bucket, settle=lambda: time.sleep(2 + random.random() * 3)):
    pid = event["passageId"]
    if not re.fullmatch(r"[A-Za-z0-9-]+", pid):
        raise ReaderInputError("passage ID is unsafe for a reader path")
    source = _optional_json(s3, content_bucket, event.get("sourceKey") or f"passages/{pid}.json")
    if not source:
        raise ReaderInputError("passage source is missing")
    text = source.get("text") or ""
    if not isinstance(text, str) or not text.strip():
        raise ReaderInputError("no reader-ready passage text")
    normalized = re.sub(r"\s+", " ", text).strip()
    marks = _read(s3, audio_bucket, event["pollyMarksKey"])
    rows = _timings(normalized, marks)
    html_text = _html_for(source, text)
    existing = _optional_json(s3, frontend_bucket, f"data/{pid}.json")
    record = _record(source, pid, text, html_text)
    if existing:
        same_words = _existing_fits(existing, text)
        lead_count = len(record["title_words"]) + len(record["by_words"])
        record["voices"] = [v for v in existing.get("voices", []) if same_words
                            and len(v.get("t", [])) == record["words"]
                            and len(v.get("lead", [])) in (0, lead_count)
                            and (existing.get("title") == record["title"] or not any(v.get("lead", [])))]
    if len(rows) != record["words"]:
        raise ReaderInputError("reader word count differs from Polly timing")
    voice_id = "generated"
    current = next((v for v in record["voices"] if v.get("id") == voice_id), None)
    if current and current.get("voiceId") != event["voiceId"]:
        voice_id = "generated-" + re.sub(r"[^a-z0-9]+", "-", event["voiceId"].lower()).strip("-")
    head = s3.head_object(Bucket=audio_bucket, Key=event["audioKey"])
    etag = re.sub(r"[^a-fA-F0-9]", "", head.get("ETag", ""))
    if not etag:
        raise ReaderInputError("audio has no ETag for a stable reader path")
    digest = hashlib.sha256((event["textHash"] + voice_id + etag).encode()).hexdigest()[:20]
    audio_path = f"audio/{pid}/{digest}.mp3"
    voice = {"id": voice_id, "label": f"Generated voice ({event['voiceId']})", "voiceId": event["voiceId"],
             "audio": audio_path, "lead": [None] * (len(record["title_words"]) + len(record["by_words"])),
             "t": rows, "source": f"Polly {event['engine']}, timed by Polly speech marks",
             "review": "needs human check", "text_hash": event["textHash"]}
    record["voices"] = [v for v in record["voices"] if v.get("id") != voice_id] + [voice]
    if not isinstance(_optional_json(s3, frontend_bucket, "data/index.json") or [], list):
        raise ReaderInputError("reader index is not a list")
    # All validation is complete before the first reader write. Publish the index last.
    s3.copy_object(Bucket=frontend_bucket, Key=audio_path,
                   CopySource={"Bucket": audio_bucket, "Key": event["audioKey"]},
                   MetadataDirective="REPLACE", ContentType="audio/mpeg",
                   CacheControl="public, max-age=31536000, immutable")
    _write_json(s3, frontend_bucket, f"data/{pid}.json", record)
    _add_to_index(s3, frontend_bucket, _index_row(record), pid, settle)
    table.update_item(Key={"passageId": pid, "textHash": event["textHash"]},
                      UpdateExpression="SET #s = :s, readerPublishedAt = :u REMOVE readerFailureReason",
                      ExpressionAttributeNames={"#s": "status"},
                      ExpressionAttributeValues={":s": "approved", ":u": datetime.now(timezone.utc).isoformat()})
    return {**event, "readerReady": True, "readerKey": f"data/{pid}.json", "readerAudioKey": audio_path}


def handler(event, _context):
    import boto3
    s3 = boto3.client("s3")
    table = boto3.resource("dynamodb").Table(os.environ["JOB_TABLE"])
    try:
        return publish(event, s3, table, os.environ["CONTENT_BUCKET"],
                       os.environ["AUDIO_BUCKET"], os.environ["FRONTEND_BUCKET"])
    except Exception as exc:
        reason = str(exc)
        _mark_failed(table, event, reason)
        return {**event, "readerReady": False, "readerFailureReason": reason}

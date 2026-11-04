"""Put an approved volunteer reading into the reader's data, keep a record, and be able to take it back out.
Only serve.approve_session calls publish: a reviewer's approval is what lets a reading in.

  python to_reader.py undo <uuid> [--site <public>]     put back whatever the passage had before
  python to_reader.py reapply [--site <public>]         after build_data.py or import_slice.py rewrote the data, add published readings again

A reading goes in only as voice id "human". If the passage already had a human voice (a ReadWorks recording), that entry is saved in the
record and put back by undo; its audio file is never touched. The record is the source of truth: human_recordings/published/<uuid>.json.
"""
import json
import os
import shutil
import sys

import engine

ROOT = os.path.join(engine.EV, "human_recordings", "published")
DEFAULT_SITE = os.path.join(engine.EV, "private", "reader")


def _write_json(path, value, indent=None):
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=indent)
    os.replace(path + ".tmp", path)


def _set_voice(site, uid, voice):
    """Swap the human voice in the passage file and its row in the library list. Returns the entry it replaced."""
    doc_path = os.path.join(site, "data", uid + ".json")
    with open(doc_path, encoding="utf-8") as f:
        doc = json.load(f)
    old = next((v for v in doc["voices"] if v["id"] == "human"), None)
    doc["voices"] = [v for v in doc["voices"] if v["id"] != "human"] + ([voice] if voice else [])
    _write_json(doc_path, doc)
    index_path = os.path.join(site, "data", "index.json")
    with open(index_path, encoding="utf-8") as f:
        index = json.load(f)
    for row in index:
        if row["uuid"] == uid:
            row["voices"] = [v["id"] for v in doc["voices"]]
    _write_json(index_path, index, indent=1)
    return old


def publish(site, uid, audio_src, sha, voice, record, root=ROOT):
    audio_rel = f"audio/{uid}-volunteer-{sha}.mp3"
    shutil.copyfile(audio_src, os.path.join(site, audio_rel))
    voice = dict(voice, audio=audio_rel)
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, uid + ".json")
    last = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            last = json.load(f)
    replaced = _set_voice(site, uid, voice)
    if last and replaced and replaced.get("audio") == last["voice"]["audio"]:   # a second volunteer take: undo returns what was there first
        replaced = last.get("replaced_voice")
    _write_json(path, {**record, "voice": voice, "replaced_voice": replaced}, indent=1)
    return audio_rel


def undo(site, uid, root=ROOT):
    path = os.path.join(root, uid + ".json")
    with open(path, encoding="utf-8") as f:
        rec = json.load(f)
    _set_voice(site, uid, rec.get("replaced_voice"))
    os.replace(path, path + ".undone")
    return rec.get("replaced_voice")


def reapply(site, root=ROOT):
    done = []
    for name in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        if name.endswith(".json"):
            with open(os.path.join(root, name), encoding="utf-8") as f:
                rec = json.load(f)
            _set_voice(site, name[:-5], rec["voice"])
            done.append(name[:-5])
    return done


if __name__ == "__main__":
    args = sys.argv[1:]
    site = args[args.index("--site") + 1] if "--site" in args else DEFAULT_SITE
    if args[:1] == ["undo"]:
        print("put back:", (undo(site, args[1]) or {}).get("label", "no human voice"))
    elif args[:1] == ["reapply"]:
        print("added again:", reapply(site))
    else:
        print(__doc__)

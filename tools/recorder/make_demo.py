"""Create a made-up local passage and reader data for trying the recorder."""
import json
from pathlib import Path

here = Path(__file__).resolve().parent
uid = "11111111-1111-1111-1111-111111111111"
passages = here / "private" / "passages"
reader_data = here / "private" / "reader" / "data"
reader_audio = here / "private" / "reader" / "audio"
for folder in (passages, reader_data, reader_audio):
    folder.mkdir(parents=True, exist_ok=True)
doc = {
    "uuid": uid,
    "title": "The Paper Kite",
    "a": ["A. Example"],
    "lang": "EN",
    "text": "Mira carried a paper kite to the hill. The wind lifted it high. She smiled and walked home.",
    "voices": [],
}
for path, value in (
    (passages / f"{uid}.json", doc),
    (reader_data / f"{uid}.json", doc),
    (reader_data / "index.json", [{"uuid": uid, "title": doc["title"], "grade": 2,
                                  "words": len(doc["text"].split()), "lang": "EN", "voices": []}]),
):
    if not path.exists():
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
print("Made-up passage ready in tools/recorder/private/.")

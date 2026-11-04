# Volunteer recorder

See [the tools index](../README.md). gpt-6-astra's suggestion, unruled by Alex.

Create an invented passage with `python tools/recorder/make_demo.py`. Then run `python tools/recorder/serve.py` and open `http://localhost:8975/` in Chrome or Edge. A reviewer uses `http://localhost:8975/review`. The microphone needs localhost or HTTPS. ffmpeg and ffprobe must be on PATH. Word checking needs a local speech environment: set `SOUND_ALONG_SPEECH_PYTHON` to its Python executable or pass `--speech-python PATH`. The server says plainly if that setting is missing. It can start and save a recording without the checker, but cannot finish the word check.

For real, permitted data, put passage JSON files under `tools/recorder/private/passages/` and reader `data/` and `audio/` under `tools/recorder/private/reader/`, or pass `--passages PATH --site PATH`. Use `--reader URL` for the link back to the running reader; the default is no link. The reader folder must have `data/index.json` and matching passage JSON. A sent reading stays in `tools/recorder/human_recordings/`; only a named reviewer can publish the exact submitted file into the configured reader folder. `python tools/recorder/to_reader.py undo UUID --site PATH` restores the earlier human voice, and `reapply` reinstates the recorded publication after reader data is rebuilt. These runtime folders are ignored by git.

`python -I tools/recorder/tests/test_recorder_local.py` exercises the local gate, edits, cleanup, timing, and publication logic with invented text and synthetic sound. The Amazon listener is off by default and has only a local stand-in test; using it requires explicit `--listener amazon` and AWS settings. No AWS call is needed for this tool or its tests. This local server has no sign-in, so keep it on loopback.

The desktop recognizer, real microphone, and how a joined take sounds need a listening trial. The reviewer name is typed, not authenticated.

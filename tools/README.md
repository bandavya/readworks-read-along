# Standalone tools These tools are local and do not change the team's CDK stack.

- **Holds lab:** [holds-lab/README.md](holds-lab/README.md). Compare hold policies and label uncertain word differences. Run `python tools/holds-lab/serve.py`, then open `http://127.0.0.1:8993/index.html`. The committed example is invented.
- **Volunteer recorder:** [recorder/README.md](recorder/README.md). Record, check, reread, clean, time, and send a reading for a named person to decide. Run `python tools/recorder/make_demo.py`, then `python tools/recorder/serve.py`, and open `http://localhost:8975/`. Chrome or Edge, ffmpeg, and a separately configured speech environment are needed for a full take.

Remove `tools/holds-lab/` or `tools/recorder/` to turn off either tool. Neither is wired into the deployed reader.

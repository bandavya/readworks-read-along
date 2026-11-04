# Holds lab

See [the tools index](../README.md)

From the repo root, run `python tools/holds-lab/serve.py` (or use its absolute path from elsewhere), then open `http://127.0.0.1:8993/index.html`. The committed pages use four made-up takes and need no audio. `python tools/holds-lab/simulate.py --json` prints the modeled outcomes; `python -I tools/holds-lab/test_policy.py` runs the guards.

With permission to use the fuller data, place a compatible `sample.json` at `tools/holds-lab/private/sample.json`. Run `python tools/holds-lab/build_pages.py --private`, then `python tools/holds-lab/serve.py --private --audio-1031 PATH --audio-1103 PATH` with the two local audio folders where present. The private sample, generated pages, and recordings stay outside git. Audio paths work from any launch directory when supplied as absolute paths. The server only serves recordings named in the loaded sample, binds to loopback, and returns 404 if a recording is absent. Exported label files are also ignored.

The two historical guards for gate flags and audio ranges skip plainly when private data is absent. All policy guards and the public page checks still run on the made-up sample.


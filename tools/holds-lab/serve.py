"""Serve the private holds pages and local human audio on loopback only. No AWS/network calls."""
import argparse
import json
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE
SOURCES = {'aligned-1031': None, 'aligned-1103': None}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path.startswith('/audio/'):
            self.send_audio()
        else:
            super().do_GET()

    def send_audio(self):
        match = re.fullmatch(r'/audio/(aligned-1031|aligned-1103)/([0-9a-f-]{36})\.mp3', self.path)
        if not match:
            self.send_error(404)
            return
        source, passage_id = match.groups()
        data = json.loads((ROOT/'sample.json').read_text(encoding='utf-8'))
        if not any(t.get('audio') == self.path for t in data['takes']):
            self.send_error(404)
            return
        path = SOURCES[source]/f'{passage_id}.mp3' if SOURCES[source] else None
        if path is None or not path.is_file():
            self.send_error(404, 'Local audio is missing')
            return
        size = path.stat().st_size
        start, end = 0, size-1
        requested = self.headers.get('Range')
        if requested:
            range_match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
            if not range_match or (not range_match[1] and not range_match[2]):
                self.send_error(416)
                return
            if range_match[1]:
                start = int(range_match[1])
                end = min(int(range_match[2]), end) if range_match[2] else end
            else:
                start = max(0, size-int(range_match[2]))
            if start > end or start >= size:
                self.send_error(416)
                return
        self.send_response(206 if requested else 200)
        self.send_header('Content-Type', 'audio/mpeg')
        self.send_header('Content-Length', str(end-start+1))
        self.send_header('Accept-Ranges', 'bytes')
        if requested:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        with path.open('rb') as stream:
            stream.seek(start)
            remaining = end-start+1
            while remaining:
                block = stream.read(min(65536, remaining))
                if not block:
                    break
                self.wfile.write(block)
                remaining -= len(block)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8993)
    parser.add_argument('--private', action='store_true', help='serve private/build after build_pages.py --private')
    parser.add_argument('--audio-1031', type=Path, help='local audio folder for aligned-1031')
    parser.add_argument('--audio-1103', type=Path, help='local audio folder for aligned-1103')
    args = parser.parse_args()
    ROOT = HERE/'private'/'build' if args.private else HERE
    if not (ROOT/'index.html').is_file(): parser.error('Run build_pages.py first')
    SOURCES['aligned-1031'], SOURCES['aligned-1103'] = args.audio_1031, args.audio_1103
    print(f'Open http://127.0.0.1:{args.port}/index.html (labels: /label.html)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()

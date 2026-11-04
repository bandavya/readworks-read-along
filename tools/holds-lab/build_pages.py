"""Build committed example pages, or a private local view with --private."""
import json
import shutil
import sys
from pathlib import Path
here=Path(__file__).resolve().parent
private='--private' in sys.argv
source=here/'private'/'sample.json' if private else here/'sample.json'
if not source.is_file():
    raise SystemExit(f'Missing {source}; place approved data at private/sample.json')
out=here/'private'/'build' if private else here
out.mkdir(parents=True,exist_ok=True)
payload=json.loads(source.read_text(encoding='utf-8'))
script=json.dumps(payload,ensure_ascii=False).replace('</',r'<\/')
for name in ('index','label'):
    template=(here/f'{name}.template.html').read_text(encoding='utf-8')
    assert template.count('/*DATA*/')==1
    (out/f'{name}.html').write_text(template.replace('/*DATA*/',script),encoding='utf-8')
    print(out/f'{name}.html')
if private:
    shutil.copy2(here/'index.js',out/'index.js')
    shutil.copy2(source,out/'sample.json')

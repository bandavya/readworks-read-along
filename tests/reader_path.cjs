// Offline smoke check of the compiled reader's fetch and timing contract.
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const root = path.resolve(__dirname, '..');
// The bundle's file name and short variable names change with every build.
const assets = path.join(root, 'frontend/assets');
const bundle = fs.readdirSync(assets).filter((name) => name.endsWith('.js'))
  .map((name) => fs.readFileSync(path.join(assets, name), 'utf8')).join('\n');
assert(bundle.includes('data/index.json'));
assert(/data\/\$\{\w+\}\.json/.test(bundle));
assert(/\.t\?\.\[Number\(\w+\.i\)\]/.test(bundle));
assert(/\.lead\?\.\[Number\(\w+\.l\)\]/.test(bundle));
const { index, doc } = JSON.parse(fs.readFileSync(0, 'utf8'));
const files = { 'data/index.json': index, [`data/${doc.uuid}.json`]: doc };
const getJson = async (key) => {
  assert(Object.hasOwn(files, key), `missing reader fetch ${key}`);
  return files[key];
};
(async () => {
  const rows = await getJson('data/index.json');
  const row = rows.find((item) => item.uuid === doc.uuid);
  assert(row && row.voices.includes('generated'));
  const page = await getJson(`data/${row.uuid}.json`);
  const voice = page.voices.find((v) => v.id === 'generated');
  assert(voice.audio.startsWith('audio/'));
  const positions = [...page.html.matchAll(/class="sa-w" data-i="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepStrictEqual(positions, [...Array(page.words).keys()]);
  for (const i of positions) assert(Array.isArray(voice.t[i]) && voice.t[i][1] > voice.t[i][0]);
  process.stdout.write('compiled reader fetch/timing contract OK\n');
})().catch((error) => { console.error(error); process.exitCode = 1; });

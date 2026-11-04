const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { main } = require('../scripts/publish-frontend.js');

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-along-publish-'));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'index.json'), JSON.stringify([{ uuid: 'local', title: 'Local' }]));
  const put = [];
  const s3 = { send: async command => {
    if (command instanceof GetObjectCommand) {
      return { Body: { transformToString: async () => JSON.stringify([
        { uuid: 'generated', title: 'Generated' }, { uuid: 'local', title: 'Newer live' },
      ]) } };
    }
    assert.ok(command instanceof PutObjectCommand);
    put.push(command.input);
  } };
  try {
    await main(dir, s3, 'site');
    assert.deepEqual(JSON.parse(put[0].Body), [
      { uuid: 'local', title: 'Newer live' }, { uuid: 'generated', title: 'Generated' },
    ]);
    const denied = { send: async command => {
      if (command instanceof GetObjectCommand) throw Object.assign(new Error('403'), { name: 'AccessDenied' });
      throw new Error('Index was overwritten after a 403');
    } };
    await assert.rejects(main(dir, denied, 'site'), /403/);
    put.length = 0;
    const fresh = { send: async command => {
      if (command instanceof GetObjectCommand) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      put.push(command.input);
    } };
    await main(dir, fresh, 'site');
    assert.deepEqual(JSON.parse(put[0].Body), [{ uuid: 'local', title: 'Local' }]);
  } finally {
    fs.unlinkSync(path.join(data, 'index.json'));
    fs.rmdirSync(data);
    fs.rmdirSync(dir);
  }
}

run().catch(err => { console.error(err); process.exitCode = 1; });

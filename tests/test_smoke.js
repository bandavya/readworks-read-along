#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../scripts/smoke');

function audio() {
  const frame = Buffer.alloc(417);
  frame.writeUInt32BE(0xfffb9000, 0);
  return Buffer.concat(Array.from({ length: 40 }, () => frame));
}

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: key => headers[key.toLowerCase()] || null },
    json: async () => body,
    arrayBuffer: async () => body,
  };
}

async function scenario(kind) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-along-smoke-'));
  const account = '0'.repeat(12);
  const arn = `arn:aws:states:us-west-2:${account}:stateMachine:Sample`;
  const outputsFile = path.join(temp, 'outputs.json');
  fs.writeFileSync(outputsFile, JSON.stringify({ Sample: {
    ContentBucketName: 'sample-content', StateMachineArn: arn,
    DistributionDomain: 'example.test', ApiUrl: 'https://api.example.test',
  } }));
  let clock = Date.parse('2026-11-04T12:00:00Z');
  let uploads = 0;
  let deletes = 0;
  let calls = 0;
  const logs = [];
  const id = 'smoke-' + 'a'.repeat(32);
  const key = `passages/${id}.json`;
  const executionArn = arn.replace(':stateMachine:', ':execution:') + ':run';
  const bytes = audio();
  const record = { uuid: id, words: 2, voices: [{ id: 'generated', audio: `audio/${id}/sample.mp3`, t: kind === 'times' ? [[0.3, 0.5], [0.2, 0.6]] : [[0, 0.3], [0.3, 0.6]] }] };
  const s3 = { send: async command => {
    calls++;
    if (command.constructor.name === 'PutObjectCommand') { uploads++; assert.equal(command.input.Key, key); }
    if (command.constructor.name === 'DeleteObjectCommand') { deletes++; assert.equal(command.input.Key, key); }
    return {};
  } };
  const sfn = { send: async command => {
    calls++;
    if (command.constructor.name === 'ListExecutionsCommand') return { executions: kind === 'nothing' ? [] : [{ executionArn, startDate: new Date(clock) }] };
    assert.equal(command.constructor.name, 'DescribeExecutionCommand');
    return { executionArn, startDate: new Date(clock), input: JSON.stringify({ passageId: id, key }), status: kind === 'held' ? 'FAILED' : 'SUCCEEDED', cause: 'ReaderPublishFailed', output: JSON.stringify({ engine: 'neural' }) };
  } };
  const fetch = async (url, opts = {}) => {
    calls++;
    if (url.endsWith('/jobs')) return response(200, { jobs: [{ passageId: id, status: 'reader_publish_failed', readerFailureReason: 'speech mark mismatch' }] });
    if (url.endsWith('/data/index.json')) return response(200, [{ uuid: id }]);
    if (url.endsWith(`/data/${id}.json`)) return response(200, record);
    if (url.endsWith('.mp3')) {
      if (kind === 'missing') return response(404, 'missing');
      if (opts.headers?.Range) return response(206, bytes, { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` });
      return response(200, bytes);
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const args = ['--stack', 'Sample', '--outputs', outputsFile, '--passage', path.join(__dirname, '..', 'demo-data', 'passages', 'demo-passage-001.json')];
  if (kind !== 'refusal') args.push('--account', account);
  if (kind === 'clean') args.push('--clean');
  try {
    const promise = run(args, { s3, sfn, fetch, now: () => clock, sleep: async ms => { clock += ms; }, uuid: () => 'a'.repeat(32), log: s => logs.push(s), timing: { startWait: 2, totalWait: 20, poll: 1 } });
    if (kind === 'success' || kind === 'clean') {
      const result = await promise;
      assert.equal(result.id, id);
      assert.equal(uploads, 1);
      assert.equal(deletes, kind === 'clean' ? 1 : 0);
      assert(logs.some(line => line.includes('Estimated Polly cost')));
      assert(logs.some(line => line.includes('byte-range loaded')));
    } else {
      const expected = { nothing: /Nothing started after two uploads/, held: /speech mark mismatch/, missing: /byte-range failed/, times: /out-of-order/, refusal: /Refusing upload/ }[kind];
      await assert.rejects(promise, expected);
      if (kind === 'nothing') assert.equal(uploads, 2);
      if (kind === 'refusal') assert.equal(calls, 0);
    }
    console.log(`PASS ${kind}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

(async () => {
  for (const kind of ['success', 'nothing', 'held', 'missing', 'times', 'refusal', 'clean']) await scenario(kind);
})().catch(error => { console.error(error); process.exitCode = 1; });

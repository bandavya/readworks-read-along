#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { SFNClient, ListExecutionsCommand, DescribeExecutionCommand } = require('@aws-sdk/client-sfn');

const START_WAIT_MS = 3 * 60 * 1000;
const TOTAL_WAIT_MS = 20 * 60 * 1000;
const POLL_MS = 5000;
const PROVISIONAL_PRICES = { standard: 4, neural: 16, generative: 30, 'long-form': 100 };

function options(argv) {
  const result = {};
  const values = new Set(['stack', 'outputs', 'passage', 'region', 'account']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes' || arg === '--clean') result[arg.slice(2)] = true;
    else if (arg.startsWith('--') && values.has(arg.slice(2)) && argv[i + 1] && !argv[i + 1].startsWith('--')) result[arg.slice(2)] = argv[++i];
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (!result.stack || !result.outputs) throw new Error('Usage: node scripts/smoke.js --stack <name> --outputs outputs.json [--passage demo-data/passages/demo-passage-001.json] [--region us-west-2] [--account <account> | --yes] [--clean]');
  return result;
}

function mp3Duration(bytes) {
  const b = Buffer.from(bytes);
  let at = 0;
  if (b.subarray(0, 3).toString() === 'ID3' && b.length >= 10) {
    at = 10 + ((b[6] & 127) << 21) + ((b[7] & 127) << 14) + ((b[8] & 127) << 7) + (b[9] & 127);
  }
  let frames = 0;
  let seconds = 0;
  while (at + 4 <= b.length) {
    const h = b.readUInt32BE(at);
    if (((h >>> 21) & 0x7ff) !== 0x7ff) {
      if (!frames) { at++; continue; }
      break;
    }
    const version = (h >>> 19) & 3;
    const layer = (h >>> 17) & 3;
    const rateIndex = (h >>> 12) & 15;
    const frequencyIndex = (h >>> 10) & 3;
    if (version === 1 || layer !== 1 || !rateIndex || rateIndex === 15 || frequencyIndex === 3) {
      if (!frames) { at++; continue; }
      break;
    }
    const rates = version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 96, 112, 128, 144, 160];
    const frequencies = [44100, 48000, 32000];
    const frequency = frequencies[frequencyIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor((version === 3 ? 144 : 72) * rates[rateIndex] * 1000 / frequency) + ((h >>> 9) & 1);
    if (length < 4 || at + length > b.length) break;
    frames++;
    seconds += samples / frequency;
    at += length;
  }
  if (frames < 2) throw new Error('Cannot measure MP3 audio length');
  return seconds;
}

function checkTimes(record, voice, duration) {
  const rows = voice.t;
  if (!Array.isArray(rows) || rows.length !== record.words || !rows.length) throw new Error(`Voice ${voice.id} has missing word times`);
  let previous = 0;
  let timed = 0;
  for (const [i, row] of rows.entries()) {
    if (row === null) continue;
    if (!Array.isArray(row) || row.length !== 2 || !row.every(v => typeof v === 'number' && Number.isFinite(v)) || row[0] < previous || row[1] <= row[0] || row[1] > duration + 0.05) {
      throw new Error(`Voice ${voice.id} has out-of-order or out-of-audio time at word ${i}`);
    }
    previous = row[1];
    timed++;
  }
  if (!timed) throw new Error(`Voice ${voice.id} has no timed words`);
  return timed;
}

async function run(argv, deps = {}) {
  const opt = options(argv);
  const now = deps.now || Date.now;
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const log = deps.log || console.log;
  const fetcher = deps.fetch || globalThis.fetch;
  const uuid = deps.uuid || randomUUID;
  const timing = { startWait: START_WAIT_MS, totalWait: TOTAL_WAIT_MS, poll: POLL_MS, ...(deps.timing || {}) };
  const outputs = JSON.parse(fs.readFileSync(path.resolve(opt.outputs), 'utf8'))[opt.stack];
  if (!outputs) throw new Error(`Stack ${opt.stack} is absent from ${opt.outputs}`);
  for (const key of ['ContentBucketName', 'StateMachineArn', 'DistributionDomain', 'ApiUrl']) {
    if (!outputs[key]) throw new Error(`Stack output ${key} is missing`);
  }
  const match = /^arn:[^:]+:states:([^:]+):(\d{12}):stateMachine:.+$/.exec(outputs.StateMachineArn);
  if (!match) throw new Error('StateMachineArn cannot establish account and region');
  const [, arnRegion, account] = match;
  const region = opt.region || arnRegion;
  if (region !== arnRegion) throw new Error(`Region ${region} differs from stack region ${arnRegion}`);
  if (opt.account && opt.account !== account) throw new Error(`Account ${opt.account} differs from stack account ${account}`);
  log(`Target account ${account} (from stack outputs), region ${region}`);
  if (!opt.account && !opt.yes) throw new Error('Refusing upload: provide --account <account> or --yes');
  const s3 = deps.s3 || new S3Client({ region });
  const sfn = deps.sfn || new SFNClient({ region });
  const passagePath = path.resolve(opt.passage || 'demo-data/passages/demo-passage-001.json');
  const source = JSON.parse(fs.readFileSync(passagePath, 'utf8'));
  if (typeof source.text !== 'string' || !source.text.trim()) throw new Error('Passage needs nonempty text');
  const id = `smoke-${uuid().replace(/-/g, '')}`;
  const key = `passages/${id}.json`;
  const body = Buffer.from(JSON.stringify({ ...source, passageId: id }));
  const startedAt = now();
  const deadline = startedAt + timing.totalWait;
  let uploaded = false;
  let execution;
  let state;
  const receipt = [];
  const step = (label, at = now()) => { receipt.push(`${new Date(at).toISOString()} ${label}`); log(receipt[receipt.length - 1]); };
  const cdn = `https://${outputs.DistributionDomain}`;
  async function getJson(url) {
    const response = await fetcher(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }
  async function jobReason() {
    try {
      const data = await getJson(`${outputs.ApiUrl.replace(/\/$/, '')}/jobs`);
      const job = data.jobs?.find(item => item.passageId === id);
      return job ? `job table status ${job.status}: ${job.readerFailureReason || job.pollyFailureReason || job.validationProblems?.join(', ') || 'no reason recorded'}` : 'job table has no matching row in its first 100 results';
    } catch (error) { return `job table unavailable through /jobs: ${error.message}`; }
  }
  async function findExecution() {
    let token;
    for (let page = 0; page < 3; page++) {
      const list = await sfn.send(new ListExecutionsCommand({ stateMachineArn: outputs.StateMachineArn, maxResults: 100, ...(token ? { nextToken: token } : {}) }));
      for (const item of list.executions || []) {
        if (item.startDate && new Date(item.startDate).getTime() < startedAt - 30000) continue;
        const detail = await sfn.send(new DescribeExecutionCommand({ executionArn: item.executionArn }));
        let input;
        try { input = JSON.parse(detail.input || '{}'); } catch { continue; }
        if (input.passageId === id && input.key === key) return detail;
      }
      token = list.nextToken;
      if (!token) break;
    }
    return null;
  }
  try {
    await s3.send(new PutObjectCommand({ Bucket: outputs.ContentBucketName, Key: key, Body: body, ContentType: 'application/json' }));
    uploaded = true;
    step(`Uploaded ${key} (${body.length} bytes)`);
    const firstStartDeadline = now() + timing.startWait;
    let retried = false;
    while (now() < deadline) {
      state = await findExecution();
      if (state) { execution = state.executionArn; step(`Execution started ${execution}`, new Date(state.startDate || now()).getTime()); break; }
      if (!retried && now() >= firstStartDeadline) {
        step('No execution yet; S3 event delivery can lag after deploy. Uploading the same passage once more.');
        await s3.send(new PutObjectCommand({ Bucket: outputs.ContentBucketName, Key: key, Body: body, ContentType: 'application/json' }));
        retried = true;
      }
      await sleep(timing.poll);
      if (retried && now() >= firstStartDeadline + timing.startWait) throw new Error('Nothing started after two uploads. S3 event delivery can lag just after deploy; check the notification and try again.');
    }
    if (!execution) throw new Error('Timed out waiting for an execution to start');
    while (state.status === 'RUNNING' && now() < deadline) {
      await sleep(timing.poll);
      state = await sfn.send(new DescribeExecutionCommand({ executionArn: execution }));
    }
    if (state.status === 'RUNNING') throw new Error(`Timed out waiting for ${execution} (${await jobReason()})`);
    step(`Execution ${state.status}`);
    if (state.status !== 'SUCCEEDED') throw new Error(`Execution ${state.status}: ${await jobReason()}; ${state.cause || state.error || 'no Step Functions reason'}`);
    let result = {};
    try { result = JSON.parse(state.output || '{}'); } catch { /* The reader checks below remain authoritative. */ }
    if (result.readerReady === false) throw new Error(`Reader publish held: ${await jobReason()}`);
    const dataDeadline = Math.min(deadline, now() + 60000);
    let index, record, lastError;
    while (now() < dataDeadline) {
      try {
        index = await getJson(`${cdn}/data/index.json`);
        if (!Array.isArray(index) || !index.some(item => item.uuid === id)) throw new Error(`data/index.json does not list ${id}`);
        record = await getJson(`${cdn}/data/${id}.json`);
        if (record.uuid !== id || !Array.isArray(record.voices) || !record.voices.length) throw new Error(`data/${id}.json has no matching voices`);
        break;
      } catch (error) { lastError = error; await sleep(timing.poll); }
    }
    if (!record) throw new Error(`Reader data missing: ${lastError?.message || 'timed out'}. Check that readerBridge=true was deployed.`);
    step(`Reader index and data/${id}.json loaded (${record.voices.length} voice(s))`);
    for (const voice of record.voices) {
      if (!/^audio\/[A-Za-z0-9/_-]+\.mp3$/.test(voice.audio || '') || !voice.audio.startsWith(`audio/${id}/`)) throw new Error(`Voice ${voice.id} has an unsafe or unexpected audio path`);
      const url = `${cdn}/${voice.audio}`;
      const ranged = await fetcher(url, { headers: { Range: 'bytes=0-65535' } });
      if (ranged.status !== 206 || !/^bytes 0-\d+\/\d+$/.test(ranged.headers.get('content-range') || '')) throw new Error(`Voice ${voice.id} audio byte-range failed: HTTP ${ranged.status}`);
      await ranged.arrayBuffer();
      const full = await fetcher(url);
      if (!full.ok) throw new Error(`Voice ${voice.id} audio missing: HTTP ${full.status}`);
      const bytes = Buffer.from(await full.arrayBuffer());
      const duration = mp3Duration(bytes);
      const words = checkTimes(record, voice, duration);
      step(`Voice ${voice.id}: byte-range loaded, ${bytes.length} bytes, ${words} timed words, ${duration.toFixed(2)} s`);
    }
    const characters = Array.from(source.text.replace(/\s+/g, ' ').trim()).length;
    const engine = result.engine || 'neural';
    const rate = PROVISIONAL_PRICES[engine];
    step(`Receipt: ${characters} characters, ${((now() - startedAt) / 1000).toFixed(1)} s elapsed`);
    if (rate) log(`Estimated Polly cost: $${(characters * rate / 1000000).toFixed(6)} for audio at $${rate}/million characters; speech marks may add a second request. Price source: unverified recollection in docs/COST.md; check current AWS pricing.`);
    else log(`Estimated Polly cost unavailable for engine ${engine}; check current AWS pricing.`);
    return { id, key, execution, receipt };
  } finally {
    if (uploaded && opt.clean) {
      await s3.send(new DeleteObjectCommand({ Bucket: outputs.ContentBucketName, Key: key }));
      step(`Cleaned only uploaded object ${key}`);
    }
  }
}

if (require.main === module) run(process.argv.slice(2)).catch(error => { console.error(`Smoke failed: ${error.message}`); process.exitCode = 1; });
module.exports = { run, options, mp3Duration, checkTimes };



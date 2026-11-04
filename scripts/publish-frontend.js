#!/usr/bin/env node
/**
 * Publishes the static Sound Along frontend (the reference Vite/Vue app) to the
 * frontend bucket. Walks the whole tree recursively and sets correct
 * content-types so assets, data JSON, audio, and images serve properly through
 * CloudFront. The app uses relative paths and self-contained data, so no
 * build-time config injection is required.
 *
 * Usage:
 *   node scripts/publish-frontend.js --frontend-bucket <FrontendBucketName> [--region us-west-2]
 */
const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const bucket = arg('frontend-bucket', process.env.FRONTEND_BUCKET);
const region = arg('region', process.env.AWS_REGION || 'us-west-2');

const root = path.join(__dirname, '..', 'frontend');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

// Long cache for hashed assets; short cache for html/data (content changes).
function cacheControl(key) {
  if (key.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  if (key === 'index.html' || key.startsWith('data/')) return 'no-cache';
  return 'public, max-age=300';
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function main(siteRoot = root, s3 = new S3Client({ region }), targetBucket = bucket) {
  if (!targetBucket) throw new Error('Missing --frontend-bucket <FrontendBucketName>.');
  let count = 0;
  let bytes = 0;
  for (const full of walk(siteRoot)) {
    const key = path.relative(siteRoot, full).split(path.sep).join('/');
    const ext = path.extname(full).toLowerCase();
    let body = fs.readFileSync(full);
    if (key === 'data/index.json') {
      let live = [];
      try {
        const response = await s3.send(new GetObjectCommand({ Bucket: targetBucket, Key: key }));
        live = JSON.parse(await response.Body.transformToString());
      } catch (err) {
        if (err.name !== 'NoSuchKey' && err.name !== 'NotFound') throw err;
      }
      const local = JSON.parse(body.toString('utf8'));
      if (!Array.isArray(local) || !Array.isArray(live)) throw new Error('Reader index must be a list.');
      const rows = new Map(local.map(row => [row.uuid, row]));
      for (const row of live) rows.set(row.uuid, row);
      body = Buffer.from(JSON.stringify([...rows.values()]));
    }
    bytes += body.length;
    await s3.send(
      new PutObjectCommand({
        Bucket: targetBucket,
        Key: key,
        Body: body,
        ContentType: CONTENT_TYPES[ext] || 'application/octet-stream',
        CacheControl: cacheControl(key),
      }),
    );
    count += 1;
    if (count % 50 === 0) console.log(`  …${count} objects uploaded`);
  }
  console.log(`\nPublished ${count} objects (${(bytes / 1024 / 1024).toFixed(1)} MB) to s3://${targetBucket}`);
}

if (require.main === module) main().catch((err) => {
  console.error(err);
  process.exit(1);
});
module.exports = { main };

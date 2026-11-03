#!/usr/bin/env node
/**
 * Seeds demo passages + the mock assignment record into the content bucket.
 *
 * Usage:
 *   node scripts/seed.js --bucket <ContentBucketName> [--region us-east-1]
 *
 * Uploading passages/*.json triggers the Step Functions generation workflow
 * via the S3 notification configured in the stack.
 */
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const bucket = arg('bucket', process.env.CONTENT_BUCKET);
const region = arg('region', process.env.AWS_REGION || 'us-east-1');

if (!bucket) {
  console.error('Missing --bucket <ContentBucketName> (or set CONTENT_BUCKET).');
  process.exit(1);
}

const s3 = new S3Client({ region });
const dataDir = path.join(__dirname, '..', 'demo-data');

async function putFile(key, filePath, contentType) {
  const body = fs.readFileSync(filePath);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  console.log(`uploaded s3://${bucket}/${key}`);
}

(async () => {
  // Assignment record first so access checks work immediately.
  await putFile('content/assignments.json', path.join(dataDir, 'assignments.json'), 'application/json');

  const passageDir = path.join(dataDir, 'passages');
  for (const file of fs.readdirSync(passageDir)) {
    if (!file.endsWith('.json')) continue;
    await putFile(`passages/${file}`, path.join(passageDir, file), 'application/json');
  }
  console.log('\nSeed complete. Generation workflows started for each passage.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

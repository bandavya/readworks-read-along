#!/usr/bin/env node
/**
 * Manually starts a generation workflow for one passage (section 4.2 step 2).
 *
 * Usage:
 *   node scripts/generate.js --arn <StateMachineArn> --passage demo-passage-001 [--region us-east-1]
 */
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const arn = arg('arn', process.env.STATE_MACHINE_ARN);
const passageId = arg('passage');
const region = arg('region', process.env.AWS_REGION || 'us-east-1');

if (!arn || !passageId) {
  console.error('Usage: node scripts/generate.js --arn <StateMachineArn> --passage <passageId>');
  process.exit(1);
}

const sfn = new SFNClient({ region });

(async () => {
  const resp = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: arn,
      input: JSON.stringify({ passageId, key: `passages/${passageId}.json` }),
    }),
  );
  console.log('started execution:', resp.executionArn);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

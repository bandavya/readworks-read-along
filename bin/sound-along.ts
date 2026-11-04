#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SoundAlongStack } from '../lib/sound-along-stack';

const app = new cdk.App();

// Environment name drives configuration separation (local | sandbox | prod).
// Per the design, do NOT hard-code production/QA URLs here.
const envName = app.node.tryGetContext('env') ?? process.env.SOUND_ALONG_ENV ?? 'sandbox';

const soundAlongContext = app.node.tryGetContext('soundAlong') ?? {};

new SoundAlongStack(app, `SoundAlong-${envName}`, {
  envName,
  voiceId: soundAlongContext.voiceId ?? 'Joanna',
  engine: soundAlongContext.engine ?? 'neural',
  language: soundAlongContext.language ?? 'en-US',
  passageApi: app.node.tryGetContext('passageApi') === 'true' || app.node.tryGetContext('passageApi') === true,
  apiSourceBucket: app.node.tryGetContext('apiSourceBucket'),
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Sound Along hackathon vertical slice (content, audio, TTS pipeline, frontend).',
});

app.synth();

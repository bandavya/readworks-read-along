#!/usr/bin/env node
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const app = path.resolve(__dirname, '..', 'frontend-src');
const harnesses = [
  'apiclient_harness.mjs', 'crisp_shared_harness.mjs', 'engine_harness.mjs',
  'fixhelp_harness.mjs', 'guide_sharing_harness.mjs', 'holds_panel_harness.mjs',
  'kid_lead_render_harness.mjs', 'kid_units_harness.mjs', 'look_lazy_harness.mjs',
  'reading_head_harness.mjs', 'rehearsal_harness.mjs', 'review_harness.mjs',
  'teacher_preview_harness.mjs', 'word_help_shared_harness.mjs',
  '../src/dataKit/usage.test.mjs',
];
let failed = false;
for (const file of harnesses) {
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, [path.join(app, 'tests', file)], { cwd: app, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    failed = true;
    console.error(`${file} failed: ${result.error?.message || result.status || result.signal}`);
  }
}
process.exitCode = failed ? 1 : 0;

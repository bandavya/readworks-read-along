#!/usr/bin/env node
// Build the Vue shell while preserving the separately managed media in frontend/.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'frontend-src');
const destination = path.join(root, 'frontend');
const assets = path.join(destination, 'assets');
const staging = fs.mkdtempSync(path.join(root, '.frontend-build-'));
let backup;
try {
  const vite = path.join(source, 'node_modules', 'vite', 'bin', 'vite.js');
  const result = spawnSync(process.execPath, [vite, 'build', '--configLoader', 'native', '--outDir', staging], {
    cwd: source,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Vite build failed (${result.status ?? result.signal})`);
  const builtIndex = path.join(staging, 'index.html');
  const builtAssets = path.join(staging, 'assets');
  if (!fs.statSync(builtIndex).isFile() || !fs.statSync(builtAssets).isDirectory()) {
    throw new Error('Vite did not produce index.html and assets/');
  }
  if (fs.existsSync(assets)) {
    const info = fs.lstatSync(assets);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('frontend/assets must be a regular directory');
    backup = fs.mkdtempSync(path.join(root, '.frontend-assets-backup-'));
    fs.renameSync(assets, path.join(backup, 'assets'));
  }
  try {
    fs.renameSync(builtAssets, assets);
    fs.copyFileSync(builtIndex, path.join(destination, 'index.html'));
    fs.copyFileSync(path.join(staging, 'experiments.json'), path.join(destination, 'experiments.json'));
  } catch (error) {
    if (fs.existsSync(assets)) fs.rmSync(assets, { recursive: true });
    if (backup) fs.renameSync(path.join(backup, 'assets'), assets);
    throw error;
  }
  console.log('Built frontend/index.html and frontend/assets/; media directories were left in place.');
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
  if (backup) fs.rmSync(backup, { recursive: true, force: true });
}

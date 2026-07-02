#!/usr/bin/env node
// src/core/init.js — kinetik engine scaffold
// Run once from the project root: node src/core/init.js
//
// Copies scaffold files into the project root if they don't already exist.

const fs   = require('fs');
const path = require('path');

const SCAFFOLD_DIR = path.join(__dirname, 'scaffold');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const SCAFFOLD_FILES = [
  { from: 'electron-main.js',        to: 'electron-main.js' },
  { from: 'preload.js',              to: 'preload.js' },
  { from: 'package.json',            to: 'package.json' },
  { from: 'vite.config.js',          to: 'vite.config.js' },
  { from: 'scripts/run-electron.js',  to: 'scripts/run-electron.js' },
  { from: '.gitignore',              to: '.gitignore' },
  { from: 'src/index.html',          to: 'src/index.html' },
  { from: 'src/main.js',             to: 'src/main.js' },
  { from: 'src/editor.html',         to: 'src/editor.html' },
  { from: 'src/game/editorSetup.js', to: 'src/game/editorSetup.js' },
  { from: 'src/game/bootstrap.js',   to: 'src/game/bootstrap.js' },
  { from: 'src/game/globals.js',     to: 'src/game/globals.js' },
  { from: 'src/game/ground.js',      to: 'src/game/ground.js' },
  { from: 'src/game/player.js',      to: 'src/game/player.js' },
  { from: 'levels/main.json',        to: 'levels/main.json' },
];

const SCAFFOLD_DIRS = [
  'levels',
  'models/editor',
  'models/actors',
  'models/images',
  'textures',
  'sounds',
  'src/game',
];

let created = 0;
let skipped = 0;

for (const { from, to } of SCAFFOLD_FILES) {
  const src  = path.join(SCAFFOLD_DIR, from);
  const dest = path.join(PROJECT_ROOT, to);
  if (fs.existsSync(dest)) {
    console.log(`  skip  ${to}  (already exists)`);
    skipped++;
    continue;
  }
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`  create  ${to}`);
  created++;
}

for (const dir of SCAFFOLD_DIRS) {
  const full = path.join(PROJECT_ROOT, dir);
  if (!fs.existsSync(full)) {
    fs.mkdirSync(full, { recursive: true });
    console.log(`  mkdir   ${dir}/`);
  }
}

console.log(`\nDone — ${created} file(s) created, ${skipped} skipped.`);
if (created > 0) {
  console.log('\nNext steps:');
  console.log('  1. Edit package.json — set name, appId, productName');
  console.log('  2. npm install');
  console.log('  3. npm run editor   (or npm start for game mode)');
}

#!/usr/bin/env node
// Kinetik project initializer.
// When run directly from a checked-out project, copies the scaffold files into
// the current project root. The same function is also exposed through the npm
// bin entry so `npx create-kinetik-app` can reuse it.

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCAFFOLD_DIR = path.join(__dirname, 'scaffold');

const SCAFFOLD_FILES = [
  { from: 'electron-main.js',        to: 'electron-main.js' },
  { from: 'preload.js',              to: 'preload.js' },
  { from: 'package.json',            to: 'package.json' },
  { from: 'vite.config.js',          to: 'vite.config.js' },
  { from: 'scripts/run-electron.js', to: 'scripts/run-electron.js' },
  { from: 'src/index.html',          to: 'src/index.html' },
  { from: 'src/main.js',             to: 'src/main.js' },
  { from: 'src/editor.html',         to: 'src/editor.html' },
  { from: 'src/game/editorSetup.js', to: 'src/game/editorSetup.js' },
  { from: 'src/game/bootstrap.js',   to: 'src/game/bootstrap.js' },
  { from: 'src/game/globals.js',     to: 'src/game/globals.js' },
  { from: 'src/game/ground.js',      to: 'src/game/ground.js' },
  { from: 'src/game/player.js',      to: 'src/game/player.js' },
  { from: 'scripts/scene.js',        to: 'scripts/scene.js' },
  { from: 'scripts/object.js',       to: 'scripts/object.js' },
  { from: 'levels/main.json',        to: 'levels/main.json' },
];

const SCAFFOLD_TEXT_FILES = [
  {
    to: '.gitignore',
    contents: [
      'node_modules/',
      'dist/',
      'dist-electron/',
      'saves/',
      'settings/',
      '.capacitor/',
      'android/',
      'ios/',
      '*.local',
      '',
    ].join('\n'),
  },
];

const SCAFFOLD_DIRS = [
  'levels',
  'scripts',
  'models/editor',
  'models/actors',
  'models/images',
  'textures',
  'sounds',
  'src/game',
];

function resolveDefaultTargetRoot() {
  return path.resolve(__dirname, '..', '..');
}

function resolveSourcePath(scaffoldRoot, from) {
  if (from === 'scripts/scene.js' || from === 'scripts/object.js') {
    return path.join(__dirname, from);
  }
  return path.join(scaffoldRoot, from);
}

export async function initProject(options = {}) {
  const scaffoldRoot = options.scaffoldRoot || DEFAULT_SCAFFOLD_DIR;
  const targetRoot = options.targetRoot || resolveDefaultTargetRoot();
  const engineSpec = options.engineSpec || '^0.1.28';
  const overwrite = !!options.overwrite;

  let created = 0;
  let skipped = 0;

  for (const { from, to } of SCAFFOLD_FILES) {
    const src = resolveSourcePath(scaffoldRoot, from);
    const dest = path.join(targetRoot, to);
    if (!overwrite && fs.existsSync(dest)) {
      console.log(`  skip  ${to}  (already exists)`);
      skipped++;
      continue;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    if (to === 'package.json') {
      const pkg = JSON.parse(fs.readFileSync(dest, 'utf8'));
      const deps = pkg.dependencies || {};
      if (deps['kinetik-engine'] === '__KINETIK_ENGINE_SPEC__') {
        deps['kinetik-engine'] = engineSpec;
        pkg.dependencies = deps;
        fs.writeFileSync(dest, JSON.stringify(pkg, null, 2) + '\n');
      }
    }
    console.log(`  create  ${to}`);
    created++;
  }

  for (const { to, contents } of SCAFFOLD_TEXT_FILES) {
    const dest = path.join(targetRoot, to);
    if (!overwrite && fs.existsSync(dest)) {
      console.log(`  skip  ${to}  (already exists)`);
      skipped++;
      continue;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, contents);
    console.log(`  create  ${to}`);
    created++;
  }

  for (const dir of SCAFFOLD_DIRS) {
    const full = path.join(targetRoot, dir);
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
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  initProject().catch((err) => {
    console.error('[kinetik:init] failed:', err);
    process.exitCode = 1;
  });
}

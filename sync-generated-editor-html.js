#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = __dirname;
const initCwd = path.resolve(process.env.INIT_CWD || process.cwd());

function log(msg) {
  console.log(`[kinetik:sync] ${msg}`);
}

function skip(msg) {
  log(`skip: ${msg}`);
  process.exitCode = 0;
}

if (initCwd === packageRoot) {
  skip('package root install');
} else {
  const source = path.join(packageRoot, 'scaffold', 'src', 'editor.html');
  const target = path.join(initCwd, 'src', 'editor.html');
  const targetDir = path.dirname(target);

  if (!fs.existsSync(source)) {
    skip(`missing source template: ${source}`);
  } else if (!fs.existsSync(path.join(initCwd, 'src'))) {
    skip(`no src/ directory at ${initCwd}`);
  } else {
    const next = fs.readFileSync(source, 'utf8');
    const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (prev !== next) {
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(target, next);
      log(`updated ${path.relative(initCwd, target)}`);
    } else {
      log('already up to date');
    }
  }
}

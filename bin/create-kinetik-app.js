#!/usr/bin/env node

import path from 'path';
import { initProject } from '../init.js';

const args = process.argv.slice(2).filter(Boolean);
let targetArg = null;
let engineSpec = '^0.1.33';

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === 'init') continue;
  if (arg === '--force' || arg === '-f') continue;
  if (arg === '--engine-spec') {
    engineSpec = args[++i] || engineSpec;
    continue;
  }
  if (arg === '--help' || arg === '-h') {
    console.log('Usage: create-kinetik-app [directory]');
    console.log('   or: kinetik init [directory]');
    console.log('Options: --engine-spec <spec>  Override the @kinetik/engine dependency spec');
    process.exit(0);
  }
  if (!targetArg) {
    targetArg = arg;
  }
}

const targetRoot = targetArg ? path.resolve(process.cwd(), targetArg) : process.cwd();
await initProject({ targetRoot, overwrite: false, engineSpec });

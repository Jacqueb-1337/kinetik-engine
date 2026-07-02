#!/usr/bin/env node

const { spawn } = require('child_process');

const electronPath = require('electron');
const args = ['.', ...process.argv.slice(2)];
const env = { ...process.env };

// Some shells set ELECTRON_RUN_AS_NODE, which makes Electron behave like plain
// Node and breaks main-process imports. Strip it so the real Electron binary
// launches the app normally.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, args, {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  windowsHide: false,
});

function exit(code) {
  process.exit(code == null ? 1 : code);
}

child.on('error', err => {
  console.error(err);
  exit(1);
});

child.on('close', code => exit(code));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

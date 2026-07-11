import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../init.js';

const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kinetik-scaffold-'));
try {
  await initProject({ targetRoot, engineSpec: 'file:../kinetik-engine' });
  const editorHtml = path.join(targetRoot, 'src', 'editor.html');
  const editorSetup = path.join(targetRoot, 'src', 'game', 'editorSetup.js');
  assert.ok(fs.existsSync(editorHtml), 'scaffold must include src/editor.html');
  assert.ok(fs.existsSync(editorSetup), 'scaffold must include src/game/editorSetup.js');
  const editorSource = fs.readFileSync(editorHtml, 'utf8');
  assert.match(editorSource, /game\/editorSetup\.js/);
  assert.match(editorSource, /Ctrl\+click multi-select/);
  assert.doesNotMatch(editorSource, /Shift\/Ctrl\+click multi-select/);
  assert.match(editorSource, /data-prim="cone"/, 'scaffold editor must expose the cone primitive');
  assert.match(editorSource, /id="geom-cone-rs"/, 'cone must expose radial side controls');
  assert.match(editorSource, /id="geom-cone-hs"/, 'cone must expose vertical subdivision controls');
  assert.match(editorSource, /id="btn-cut-add"/, 'cut mode must allow primitive cutters');
  assert.match(editorSource, /id="btn-cut-convert"/, 'cut mode must allow converting scene objects');
  assert.match(editorSource, /Red wireframes are subtractive cutters/, 'cut mode must explain its live cutter preview');
  const pkg = JSON.parse(fs.readFileSync(path.join(targetRoot, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts?.editor, 'scaffold package.json must expose npm run editor');
  console.log('Scaffold includes editor HTML, setup module, and editor command');
} finally {
  fs.rmSync(targetRoot, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../editor.js', import.meta.url), 'utf8');
const levelLoaderSource = fs.readFileSync(new URL('../levelLoader.js', import.meta.url), 'utf8');
const desktopActions = [
  'importModel', 'importImageModel', 'importMtl', 'importTexture',
  'importActor', 'importActorAnim', 'importActorModel', 'importSound', 'saveGlb',
];

for (const action of desktopActions) {
  assert.match(source, new RegExp(`invokeElectron\\('${action}'`), `${action} must use the guarded desktop bridge`);
  assert.doesNotMatch(source, new RegExp(`window\\.electron\\.${action}\\s*\\(`), `${action} must not be called directly`);
}
console.log('Editor desktop actions are capability-checked');
assert.match(source, /cone:\s*\(\)\s*=>\s*new THREE\.ConeGeometry/);
assert.match(levelLoaderSource, /cone:\s*\(p = \{\}\)\s*=>\s*new THREE\.ConeGeometry/);
assert.match(levelLoaderSource, /geoFn\(entry\.geomParams \?\? \{\}\)/, 'runtime must honor primitive geometry parameters');
assert.match(source, /function setGeomParam[\s\S]*?pushUndo\(\)/, 'geometry edits must create undo snapshots');
console.log('Cone primitive is available in editor and runtime');

assert.match(source, /function scheduleCsgRebuild\(\)/, 'cutters must trigger live CSG rebuilds');
assert.match(source, /function convertSelectedToCsgCutter\(\)/, 'scene objects must be convertible to cutters');
assert.match(source, /isCsgCutterProxy/, 'editable cutter proxies must be tracked separately');
assert.match(source, /isEditorHelper \|\| obj\.userData\.isCsgCutterProxy/, 'temporary cutters must not be saved as scene objects');
assert.match(source, /function convertSelectedToCsgCutter[\s\S]*?pushUndo\(\)/, 'cutter conversion must create an undo snapshot');
console.log('Live editable CSG cutters are capability-checked');

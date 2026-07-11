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
assert.match(source, /E\.placedGroup\.add\(result\);\s*E\.placedGroup\.remove\(oldResult\);/, 'live CSG replacement must insert the rebuilt target before removing its source');
console.log('Live editable CSG cutters are capability-checked');

assert.match(source, /function updateBatchProps\(objects = E\.selectedObjects\)/, 'multi-selection must switch to batch properties');
assert.match(source, /function bindBatchTransform\(id, kind, axis\)/, 'batch transforms must use dedicated relative bindings');
assert.match(source, /baseline\.values\[index\] \* Math\.max\(0\.001, value\)/, 'batch scale must multiply each original scale');
assert.match(source, /batchTargets\(\)\.forEach\(obj => \{ obj\.userData\.collidable = event\.target\.checked;/, 'batch collision must update every selected object');
assert.match(source, /function pushBatchUndo\(\).*pushUndo\(\)/, 'batch property edits must create undo snapshots');
console.log('Multi-selection batch properties are capability-checked');

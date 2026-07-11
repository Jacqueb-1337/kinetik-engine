import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../editor.js', import.meta.url), 'utf8');
const levelLoaderSource = fs.readFileSync(new URL('../levelLoader.js', import.meta.url), 'utf8');
const preloadSource = fs.readFileSync(new URL('../scaffold/preload.js', import.meta.url), 'utf8');
const electronMainSource = fs.readFileSync(new URL('../scaffold/electron-main.js', import.meta.url), 'utf8');
const desktopActions = [
  'importModel', 'importImageModel', 'importMtl', 'importTexture',
  'importActor', 'importActorAnim', 'importActorModel', 'importSound', 'saveGlb',
  'saveTexture',
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

assert.match(source, /entry\.baseColorOverride = true/, 'explicit model base colors must be serialized');
assert.match(source, /function _applyModelBaseColor\(root, entry\)/, 'editor model loading must restore base colors');
assert.match(source, /material\?\.color && !material\.map/, 'base color must only affect untextured model materials');
assert.match(levelLoaderSource, /function applyModelBaseColor\(root, entry\)/, 'runtime model loading must restore base colors');
assert.match(levelLoaderSource, /entry\.baseColorOverride[\s\S]*?applyModelBaseColor\(root, entry\)/, 'runtime must apply explicit model base-color overrides');
console.log('Untextured model base colors persist through editor and runtime loading');

assert.match(source, /function setupTexturePaintUI\(\)/, 'editor must expose UV texture painting');
assert.match(source, /globalCompositeOperation = erase \? 'destination-out'/, 'paint erasing must remove only the paint layer');
assert.match(source, /obj\.userData\.modelMaps = \{ \.\.\.\(obj\.userData\.modelMaps \|\| \{\}\), \.\.\.refs \}/, 'paint save must update model map entries');
assert.match(source, /existing\.normalMap = refs\.normal[\s\S]*?existing\.bumpMap = refs\.bump/, 'paint save must update primitive map entries');
assert.match(source, /function _buildDrawnCutObject\(entry\)/, 'cut mode must rebuild serialized drawn cutters');
assert.match(source, /function setupCsgDrawUI\(\)/, 'cut mode must expose raycast path drawing');
assert.match(levelLoaderSource, /function buildDrawnCutObject\(entry\)/, 'runtime must rebuild drawn cutters');
assert.match(levelLoaderSource, /function _recipeCutterBrushes\(obj\)/, 'runtime must subtract drawn path segments independently');
assert.match(preloadSource, /saveTexture:.*ipcRenderer\.invoke\('save-texture'/, 'desktop bridge must expose generated texture saving');
assert.match(electronMainSource, /ipcMain\.handle\('save-texture'/, 'Electron must write generated texture PNGs');
console.log('Texture painting and drawn CSG cutters are capability-checked');

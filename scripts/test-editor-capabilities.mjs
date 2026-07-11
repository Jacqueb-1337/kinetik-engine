import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../editor.js', import.meta.url), 'utf8');
const desktopActions = [
  'importModel', 'importImageModel', 'importMtl', 'importTexture',
  'importActor', 'importActorAnim', 'importActorModel', 'importSound', 'saveGlb',
];

for (const action of desktopActions) {
  assert.match(source, new RegExp(`invokeElectron\\('${action}'`), `${action} must use the guarded desktop bridge`);
  assert.doesNotMatch(source, new RegExp(`window\\.electron\\.${action}\\s*\\(`), `${action} must not be called directly`);
}
console.log('Editor desktop actions are capability-checked');

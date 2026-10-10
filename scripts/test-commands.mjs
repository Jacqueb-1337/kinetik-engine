import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CommandError, createKinetikCommands, EntityRegistry, RegistryHub, resolvePosition } from '../commands.js';

const hub = new RegistryHub();
const entities = new EntityRegistry(hub);
const messages = [];
const world = {
  teleport(entity, position, rotation) {
    entity.root.position.copy(position);
    if (rotation.yaw != null) entity.root.rotation.y = THREE.MathUtils.degToRad(rotation.yaw);
    if (rotation.pitch != null) entity.root.rotation.x = THREE.MathUtils.degToRad(rotation.pitch);
  },
  despawn: entity => entities.remove(entity),
  message: entry => messages.push(entry),
};
const commands = createKinetikCommands({ hub, entities, world });
entities.registerType('kinetik:npc', { allowUnknownData: true });
const player = entities.spawn('kinetik:player', { root: new THREE.Object3D(), name: 'Jacqueb' });
player.isPlayer = true;
const source = { entity: player, position: player.root.position, hasPermission: () => true };

await commands.execute('/summon kinetik:npc ~ ~2 ~ {"CustomName":"Mara","Health":50}', source);
const npc = entities.all().find(entity => entity.type === 'kinetik:npc');
assert.equal(npc.name, 'Mara');
assert.equal(npc.root.position.y, 2);
await commands.execute('/tp Jacqueb ~ ~ ~ 90 35', source);
assert.equal(Math.round(THREE.MathUtils.radToDeg(player.root.rotation.y)), 90);
assert.equal(Math.round(THREE.MathUtils.radToDeg(player.root.rotation.x)), 35);
await commands.execute('/tag @e[type=kinetik:npc] add quest', source);
assert.equal(npc.tags.has('quest'), true);
await commands.execute('/data merge entity @e[type=kinetik:npc] {"Mood":"worried"}', source);
assert.equal(npc.data.Mood, 'worried');
await commands.execute('/say hello world', source);
assert.deepEqual(messages[0].message, 'hello world');
assert.ok(commands.suggest('/su', source).some(s => s.text === '/summon'));
const local = resolvePosition(['^0', '^0', '^2'], { position: new THREE.Vector3(), yaw: 0, pitch: 0 });
assert.equal(local.z, -2);
assert.throws(() => resolvePosition(['^0', '~', '^0'], { position: new THREE.Vector3() }), CommandError);
console.log('commands tests passed');

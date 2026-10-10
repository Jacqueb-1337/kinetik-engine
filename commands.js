// Kinetik command runtime.  It deliberately has no UI: games own the command
// bar while this module owns syntax, suggestions, permissions, entities, and
// execution semantics.
import * as THREE from 'three';
import { gameState } from './globals.js';

const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const PATH = /^[a-z0-9_./-]+$/;

export function namespacedId(value, defaultNamespace = 'kinetik') {
  const raw = String(value ?? '').trim().toLowerCase();
  const id = raw.includes(':') ? raw : `${defaultNamespace}:${raw}`;
  if (!ID.test(id)) throw new CommandError(`Invalid namespaced id "${value}". Use namespace:path.`);
  return id;
}

export class CommandError extends Error {
  constructor(message, start = null, end = null) { super(message); this.name = 'CommandError'; this.start = start; this.end = end; }
}

/** A single ownership-aware registry shared by commands, entity types, and mods. */
export class RegistryHub {
  constructor({ defaultNamespace = 'kinetik' } = {}) { this.defaultNamespace = defaultNamespace; this._registries = new Map(); }
  registry(name) {
    if (!this._registries.has(name)) this._registries.set(name, new Map());
    return this._registries.get(name);
  }
  register(kind, id, value, { owner = 'kinetik', replace = false } = {}) {
    const key = namespacedId(id, this.defaultNamespace), map = this.registry(kind);
    if (map.has(key) && !replace) throw new CommandError(`${kind} "${key}" is already registered.`);
    map.set(key, { id: key, value, owner }); return value;
  }
  get(kind, id) { return this.registry(kind).get(namespacedId(id, this.defaultNamespace))?.value; }
  entries(kind) { return [...this.registry(kind).values()].map(r => ({ ...r })); }
  unregisterOwner(owner) { for (const map of this._registries.values()) for (const [id, item] of map) if (item.owner === owner) map.delete(id); }
  createScope(namespace, owner = namespace) {
    const ns = String(namespace).toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(ns)) throw new CommandError('Invalid namespace.');
    return { namespace: ns, owner, id: value => namespacedId(value, ns), register: (kind, id, value, opts = {}) => this.register(kind, namespacedId(id, ns), value, { ...opts, owner }), dispose: () => this.unregisterOwner(owner) };
  }
}

export class EntityRegistry {
  constructor(hub) { this.hub = hub; this.entities = new Map(); this._nextId = 1; }
  registerType(id, definition, options) { return this.hub.register('entityType', id, { create: null, dataSchema: {}, ...definition }, options); }
  type(id) { return this.hub.get('entityType', id); }
  spawn(typeId, { position, rotation, data = {}, root = null, tags = [], name = '', components = {} } = {}) {
    const type = this.type(typeId); if (!type) throw new CommandError(`Unknown entity type "${typeId}".`);
    const entity = { id: `e${this._nextId++}`, type: namespacedId(typeId), root: root || new THREE.Object3D(), data: {}, tags: new Set(tags), components: new Map(), name, alive: true, isPlayer: false };
    if (!root && typeof type.create === 'function') {
      const created = type.create({ entity, registry: this, data, position, rotation });
      if (created?.isObject3D) entity.root = created;
    }
    if (position) entity.root.position.copy(position);
    if (rotation) entity.root.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0, rotation.order || 'YXZ');
    this.applyData(entity, data, { replace: true });
    for (const [componentId, componentData] of Object.entries(components || {})) this.setComponent(entity, componentId, componentData);
    this.entities.set(entity.id, entity); type.onSpawn?.(entity, this); return entity;
  }
  registerExisting(root, { id, type = 'kinetik:level_object', data = {}, tags = [], name, isPlayer = false, components = {} } = {}) {
    const existing = [...this.entities.values()].find(e => e.root === root); if (existing) return existing;
    if (!this.type(type)) this.registerType(type, {});
    const entity = this.spawn(type, { root, data, tags, name: name ?? root.name ?? '', components });
    if (id) { this.entities.delete(entity.id); entity.id = String(id); this.entities.set(entity.id, entity); }
    entity.isPlayer = !!isPlayer; return entity;
  }
  remove(entity, { removeRoot = true } = {}) { const e = typeof entity === 'string' ? this.entities.get(entity) : entity; if (!e) return false; this.type(e.type)?.onDespawn?.(e, this); e.alive = false; this.entities.delete(e.id); if (removeRoot) e.root?.parent?.remove(e.root); return true; }
  setComponent(entity, componentId, value = {}) { const e = typeof entity === 'string' ? this.entities.get(entity) : entity; if (!e) throw new CommandError('Entity does not exist.'); const id = namespacedId(componentId, this.hub.defaultNamespace); const definition = this.hub.get('componentType', id); if (definition?.validate && !definition.validate(value, e)) throw new CommandError(`Invalid ${id} component data.`); e.components.set(id, structuredClone(value)); definition?.onAttach?.(e, e.components.get(id), this); return e.components.get(id); }
  getComponent(entity, componentId) { const e = typeof entity === 'string' ? this.entities.get(entity) : entity; return e?.components.get(namespacedId(componentId, this.hub.defaultNamespace)); }
  removeComponent(entity, componentId) { const e = typeof entity === 'string' ? this.entities.get(entity) : entity; if (!e) return false; const id = namespacedId(componentId, this.hub.defaultNamespace), value = e.components.get(id); this.hub.get('componentType', id)?.onDetach?.(e, value, this); return e.components.delete(id); }
  applyData(entity, patch, { replace = false } = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new CommandError('Entity data must be an object.');
    const type = this.type(entity.type), schema = type?.dataSchema || {};
    for (const key of Object.keys(patch)) if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new CommandError(`Unsafe data key "${key}".`);
    for (const key of Object.keys(patch)) if (Object.keys(schema).length && !Object.hasOwn(schema, key) && !type?.allowUnknownData) throw new CommandError(`"${key}" is not valid data for ${entity.type}.`);
    entity.data = replace ? structuredClone(patch) : { ...entity.data, ...structuredClone(patch) };
    if (typeof entity.data.CustomName === 'string') entity.name = entity.data.CustomName;
    if (Array.isArray(entity.data.Tags)) entity.tags = new Set(entity.data.Tags.map(String));
    return entity;
  }
  all() { return [...this.entities.values()].filter(e => e.alive); }
}

const _defaultRegistryHub = new RegistryHub();
const _defaultEntityRegistry = new EntityRegistry(_defaultRegistryHub);
export function getKinetikRegistryHub() { return _defaultRegistryHub; }
export function getKinetikEntityRegistry() { return _defaultEntityRegistry; }
export function syncEntitiesFromScene(scene = gameState.scene) {
  if (!scene) return _defaultEntityRegistry;
  scene.traverse(obj => {
    if (!obj.userData?.levelObj) return;
    _defaultEntityRegistry.registerExisting(obj, {
      id: obj.userData.entityId || `level:${obj.userData.editorId}`,
      type: obj.userData.entityType || 'kinetik:level_object',
      data: obj.userData.entityData || {}, tags: obj.userData.entityTags || [],
      components: obj.userData.entityComponents || {}, name: obj.name,
    });
  });
  return _defaultEntityRegistry;
}

function splitTopLevel(input, delimiter = ',') {
  const out = []; let start = 0, depth = 0, quote = null, escaped = false;
  for (let i = 0; i < input.length; i++) { const c = input[i]; if (quote) { if (!escaped && c === quote) quote = null; escaped = !escaped && c === '\\'; continue; } if (c === '"' || c === "'") { quote = c; continue; } if ('[{('.includes(c)) depth++; else if (']})'.includes(c)) depth--; else if (c === delimiter && depth === 0) { out.push(input.slice(start, i)); start = i + 1; } }
  out.push(input.slice(start)); return out.filter(Boolean);
}

export function tokenizeCommand(input) {
  const raw = String(input ?? '').trim(), tokens = []; let i = raw.startsWith('/') ? 1 : 0;
  while (i < raw.length) {
    while (/\s/.test(raw[i])) i++; if (i >= raw.length) break;
    const start = i, first = raw[i];
    if (first === '{' || first === '[') { const close = first === '{' ? '}' : ']'; let depth = 0, quote = null, escaped = false; for (; i < raw.length; i++) { const c = raw[i]; if (quote) { if (!escaped && c === quote) quote = null; escaped = !escaped && c === '\\'; continue; } if (c === '"') { quote = c; continue; } if (c === first) depth++; if (c === close && --depth === 0) { i++; break; } } if (depth) throw new CommandError('Unclosed data compound.', start, raw.length); }
    else { while (i < raw.length && !/\s/.test(raw[i])) i++; }
    tokens.push({ value: raw.slice(start, i), start, end: i });
  }
  return tokens;
}

export function parseDataCompound(token) {
  try { const data = JSON.parse(token); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { throw new CommandError('Entity data must be a JSON object, e.g. {"CustomName":"Mara"}.'); }
}

function isPositionStart(value) { return /^(?:[~^](?:[-+]?\d*\.?\d+)?|[-+]?\d*\.?\d+)$/.test(value); }
function coordinate(value) { const m = /^([~^]?)([-+]?(?:\d+(?:\.\d*)?|\.\d+))?$/.exec(value); if (!m) throw new CommandError(`Invalid coordinate "${value}".`); return { mode: m[1] || 'absolute', value: m[2] == null ? 0 : Number(m[2]) }; }
export function resolvePosition(values, source) {
  if (values.length !== 3) throw new CommandError('A position needs exactly three coordinates.');
  const c = values.map(v => coordinate(typeof v === 'string' ? v : v.value)); const local = c.some(v => v.mode === '^');
  if (local && !c.every(v => v.mode === '^')) throw new CommandError('Local (^) coordinates cannot be mixed with absolute or relative coordinates.');
  const origin = source.position?.clone?.() || new THREE.Vector3(source.position?.x || 0, source.position?.y || 0, source.position?.z || 0);
  if (local) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(source.pitch || 0, source.yaw || 0, 0, 'YXZ')); const left = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q), forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q); return origin.addScaledVector(left, c[0].value).addScaledVector(up, c[1].value).addScaledVector(forward, c[2].value); }
  return new THREE.Vector3(...c.map((part, i) => part.mode === '~' ? origin.getComponent(i) + part.value : part.value));
}

function selectorOptions(text) { const options = {}; for (const item of splitTopLevel(text)) { const at = item.indexOf('='); if (at < 1) throw new CommandError(`Invalid selector option "${item}".`); const key = item.slice(0, at).trim(), value = item.slice(at + 1).trim(); (options[key] ||= []).push(value.replace(/^"|"$/g, '')); } return options; }
function distancePass(entity, origin, range) { const d = entity.root.position.distanceTo(origin); const [min, max] = String(range).split('..'); return (!min || d >= Number(min)) && (!max || d <= Number(max)); }
export function selectEntities(value, source, entities) {
  const token = String(value); if (!token.startsWith('@')) { const found = entities.all().filter(e => e.id === token || e.name === token); if (!found.length) throw new CommandError(`No entity named "${token}".`); return found; }
  const match = /^@([spare])(?:\[(.*)\])?$/.exec(token); if (!match) throw new CommandError(`Invalid target selector "${token}".`);
  const base = match[1], opts = selectorOptions(match[2] || ''); let result = entities.all();
  if (base === 's') result = source.entity ? [source.entity] : [];
  else if (base === 'a' || base === 'p' || base === 'r') result = result.filter(e => e.isPlayer);
  const origin = new THREE.Vector3(opts.x?.at(-1) ?? source.position.x, opts.y?.at(-1) ?? source.position.y, opts.z?.at(-1) ?? source.position.z);
  for (const type of opts.type || []) result = result.filter(e => type.startsWith('!') ? e.type !== namespacedId(type.slice(1)) : e.type === namespacedId(type));
  for (const tag of opts.tag || []) result = result.filter(e => tag.startsWith('!') ? !e.tags.has(tag.slice(1)) : e.tags.has(tag));
  for (const name of opts.name || []) result = result.filter(e => name.startsWith('!') ? e.name !== name.slice(1) : e.name === name);
  if (opts.distance?.at(-1)) result = result.filter(e => distancePass(e, origin, opts.distance.at(-1)));
  if (opts.dx || opts.dy || opts.dz) { const dx = Number(opts.dx?.at(-1) ?? 0), dy = Number(opts.dy?.at(-1) ?? 0), dz = Number(opts.dz?.at(-1) ?? 0); result = result.filter(e => { const p = e.root.position; return p.x >= origin.x && p.x <= origin.x + dx && p.y >= origin.y && p.y <= origin.y + dy && p.y >= origin.y && p.z >= origin.z && p.z <= origin.z + dz; }); }
  const sort = opts.sort?.at(-1) || (base === 'p' ? 'nearest' : base === 'r' ? 'random' : 'arbitrary');
  if (sort === 'nearest') result.sort((a, b) => a.root.position.distanceToSquared(origin) - b.root.position.distanceToSquared(origin));
  if (sort === 'furthest') result.sort((a, b) => b.root.position.distanceToSquared(origin) - a.root.position.distanceToSquared(origin));
  if (sort === 'random') result.sort(() => Math.random() - .5);
  const limit = Number(opts.limit?.at(-1) ?? (base === 'p' || base === 'r' || base === 's' ? 1 : Infinity)); return result.slice(0, Math.max(0, limit));
}

export class CommandDispatcher {
  constructor(options = {}) {
    const hub = options.hub || _defaultRegistryHub;
    const entities = options.entities || (hub === _defaultRegistryHub ? _defaultEntityRegistry : new EntityRegistry(hub));
    this.hub = hub; this.entities = entities; this.world = options.world || createDefaultCommandWorld(entities);
  }
  register(id, definition, options = {}) { const command = { aliases: [], permission: 'commands.use', ...definition }; this.hub.register('command', id, command, options); for (const alias of command.aliases || []) { const key = String(alias).toLowerCase(); if (this.hub.registry('commandAlias').has(key)) throw new CommandError(`Command alias "${key}" is already registered.`); this.hub.registry('commandAlias').set(key, { id: key, value: command, owner: options.owner || 'kinetik' }); } return command; }
  commands() { return this.hub.entries('command').map(x => x); }
  async execute(input, source = {}) {
    const tokens = tokenizeCommand(input); if (!tokens.length) return { ok: false, message: '' }; const name = tokens.shift().value.toLowerCase(); const command = this.hub.get('command', name) || this.hub.registry('commandAlias').get(name)?.value; if (!command) throw new CommandError(`Unknown command "${name}".`);
    const context = this.makeContext(source, tokens); if (command.permission && !context.hasPermission(command.permission)) throw new CommandError('You do not have permission to use this command.');
    const result = await command.execute(context); return { ok: true, message: result?.message || '', ...result };
  }
  makeContext(source, tokens) { const entity = source.entity || this.world.getSourceEntity?.(source) || null; const position = source.position?.clone?.() || entity?.root?.position?.clone?.() || new THREE.Vector3(); return { dispatcher: this, world: this.world, entities: this.entities, tokens, source: { ...source, entity, position, yaw: source.yaw ?? entity?.root?.rotation?.y ?? 0, pitch: source.pitch ?? entity?.root?.rotation?.x ?? 0 }, reply: source.reply || (() => {}), hasPermission: source.hasPermission || (() => true), select: token => selectEntities(token, { ...source, entity, position }, this.entities), position: values => resolvePosition(values, { ...source, entity, position }) }; }
  suggest(input, source = {}, cursor = input.length) {
    const before = input.slice(0, cursor), tokens = tokenizeCommand(before); const trailing = /\s$/.test(before); if (!tokens.length || (tokens.length === 1 && !trailing)) { const part = tokens[0]?.value.replace(/^\//, '') || ''; return this.commands().flatMap(({ id, value }) => [id, ...(value.aliases || [])]).filter(x => x.startsWith(part)).map(text => ({ text: `/${text}`, start: 0, end: cursor })); }
    const name = tokens.shift().value.toLowerCase(), command = this.hub.get('command', name) || this.hub.registry('commandAlias').get(name)?.value; if (!command) return []; const prefix = trailing ? '' : tokens.at(-1)?.value || ''; return (command.suggest?.(this.makeContext(source, tokens), prefix) || []).map(text => ({ text, start: cursor - prefix.length, end: cursor }));
  }
}

export function createDefaultCommandWorld(entities) {
  const world = {
    getSourceEntity() { if (!gameState.player) return null; return entities.registerExisting(gameState.player, { id: 'player', type: 'kinetik:player', isPlayer: true, name: gameState.player.name || 'Player' }); },
    syncSceneObjects() { return syncEntitiesFromScene(); },
    teleport(entity, position, { yaw, pitch } = {}) { entity.root.position.copy(position); if (yaw != null) entity.root.rotation.y = THREE.MathUtils.degToRad(yaw); if (pitch != null) entity.root.rotation.x = THREE.MathUtils.degToRad(pitch); },
    despawn: entity => entities.remove(entity), message: () => {},
  }; return world;
}

function suggestEntities(ctx, prefix) { return ['@s', '@p', '@a', '@r', '@e', ...ctx.entities.all().map(e => e.name || e.id)].filter(v => v.startsWith(prefix)); }
export function registerCoreCommands(dispatcher, { namespace = 'kinetik', owner = 'kinetik' } = {}) {
  const id = name => `${namespace}:${name}`;
  if (!dispatcher.entities.type(id('player'))) dispatcher.entities.registerType(id('player'), { allowUnknownData: true }, { owner });
  if (!dispatcher.entities.type(id('level_object'))) dispatcher.entities.registerType(id('level_object'), { allowUnknownData: true }, { owner });
  dispatcher.register(id('help'), { aliases: ['help', '?'], description: 'Lists commands or explains one command.', execute: ctx => { const query = ctx.tokens[0]?.value; const commands = query ? [ctx.dispatcher.hub.get('command', query) || ctx.dispatcher.hub.get('commandAlias', query)].filter(Boolean) : ctx.dispatcher.commands().map(x => x.value); return { message: commands.map(c => `${c.usage || ''} — ${c.description || ''}`).join('\n'), commands }; }, suggest: (ctx, p) => ctx.dispatcher.commands().map(x => x.id).filter(x => x.startsWith(p)) }, { owner });
  dispatcher.register(id('list'), { aliases: ['list'], description: 'Lists currently registered players.', usage: '/list', execute: ctx => { const players = ctx.entities.all().filter(e => e.isPlayer); return { message: `${players.length} player(s): ${players.map(e => e.name || e.id).join(', ')}`, players }; } }, { owner });
  dispatcher.register(id('say'), { aliases: ['say'], description: 'Broadcasts a plain message through the host game.', usage: '/say <message>', execute: ctx => { const message = ctx.tokens.map(t => t.value).join(' '); if (!message) throw new CommandError('Usage: /say <message>'); ctx.world.message?.({ kind: 'say', message, source: ctx.source }); return { message }; } }, { owner });
  dispatcher.register(id('me'), { aliases: ['me'], description: 'Broadcasts an action message through the host game.', usage: '/me <message>', execute: ctx => { const message = ctx.tokens.map(t => t.value).join(' '); if (!message) throw new CommandError('Usage: /me <message>'); ctx.world.message?.({ kind: 'me', message, source: ctx.source }); return { message }; } }, { owner });
  dispatcher.register(id('teleport'), { aliases: ['tp', 'teleport'], description: 'Teleports entities to an entity or position, optionally setting yaw and pitch.', usage: '/tp [targets] <x y z|destination> [yaw pitch]', execute: ctx => { const a = ctx.tokens.map(t => t.value); if (!a.length) throw new CommandError('Usage: /tp [targets] <x y z|destination> [yaw pitch]'); let targets, rest; if (isPositionStart(a[0])) { targets = ctx.source.entity ? [ctx.source.entity] : []; rest = a; } else { const first = ctx.select(a[0]); if (a.length === 1) throw new CommandError('Teleport destination is missing.'); if (isPositionStart(a[1]) || a.length >= 4) { targets = first; rest = a.slice(1); } else { const destination = first; const dest = ctx.select(a[1]); for (const e of destination) ctx.world.teleport(e, dest[0].root.position, { yaw: THREE.MathUtils.radToDeg(dest[0].root.rotation.y), pitch: THREE.MathUtils.radToDeg(dest[0].root.rotation.x) }); return { message: `Teleported ${destination.length} entity(s).` }; } }
      if (rest.length < 3) throw new CommandError('Teleport position needs x y z.'); const position = ctx.position(rest.slice(0, 3)); const rotations = rest.slice(3); if (rotations.length && rotations.length !== 2) throw new CommandError('Teleport rotation needs both yaw and pitch.'); const [yaw, pitch] = rotations.map(Number); if (rotations.length && (!Number.isFinite(yaw) || !Number.isFinite(pitch))) throw new CommandError('Yaw and pitch must be numbers in degrees.'); for (const e of targets) ctx.world.teleport(e, position, { yaw, pitch }); return { message: `Teleported ${targets.length} entity(s) to ${position.x.toFixed(2)} ${position.y.toFixed(2)} ${position.z.toFixed(2)}.` }; }, suggest: suggestEntities }, { owner });
  dispatcher.register(id('summon'), { aliases: ['summon'], description: 'Creates a registered entity type.', usage: '/summon <entityType> [x y z] [data]', execute: ctx => { const a = ctx.tokens.map(t => t.value); if (!a[0]) throw new CommandError('Usage: /summon <entityType> [x y z] [data]'); const type = namespacedId(a.shift(), namespace); let position = ctx.source.position, data = {}; if (a.length && isPositionStart(a[0])) { if (a.length < 3) throw new CommandError('Summon position needs x y z.'); position = ctx.position(a.splice(0, 3)); } if (a.length) { if (a.length !== 1) throw new CommandError('Unexpected summon arguments.'); data = parseDataCompound(a[0]); } const entity = ctx.entities.spawn(type, { position, data }); return { message: `Summoned ${entity.type} (${entity.id}).`, entity }; }, suggest: (ctx, p) => ctx.dispatcher.hub.entries('entityType').map(x => x.id).filter(x => x.startsWith(p)) }, { owner });
  dispatcher.register(id('kill'), { aliases: ['kill'], description: 'Despawns selected entities.', usage: '/kill [targets]', execute: ctx => { const targets = ctx.tokens[0] ? ctx.select(ctx.tokens[0].value) : (ctx.source.entity ? [ctx.source.entity] : []); for (const e of targets) ctx.world.despawn(e); return { message: `Removed ${targets.length} entity(s).` }; }, suggest: suggestEntities }, { owner });
  dispatcher.register(id('tag'), { aliases: ['tag'], description: 'Adds, removes, or lists entity tags.', usage: '/tag <targets> add|remove|list [tag]', execute: ctx => { const [selector, action, tag] = ctx.tokens.map(t => t.value); const targets = ctx.select(selector); if (!['add', 'remove', 'list'].includes(action)) throw new CommandError('Usage: /tag <targets> add|remove|list [tag]'); if (action !== 'list' && !tag) throw new CommandError('A tag is required.'); if (action === 'add') targets.forEach(e => e.tags.add(tag)); if (action === 'remove') targets.forEach(e => e.tags.delete(tag)); return { message: action === 'list' ? [...(targets[0]?.tags || [])].join(', ') : `${action === 'add' ? 'Added' : 'Removed'} tag on ${targets.length} entity(s).` }; }, suggest: (ctx, p) => ctx.tokens.length <= 1 ? suggestEntities(ctx, p) : ['add', 'remove', 'list'].filter(x => x.startsWith(p)) }, { owner });
  dispatcher.register(id('data'), { aliases: ['data'], description: 'Reads, merges, or removes validated entity data.', usage: '/data get|merge|remove entity <target> [dataKey|data]', execute: ctx => { const [action, kind, selector, value] = ctx.tokens.map(t => t.value); if (kind !== 'entity' || !['get', 'merge', 'remove'].includes(action)) throw new CommandError('Usage: /data get|merge|remove entity <target> [dataKey|data]'); const targets = ctx.select(selector); if (action === 'get') return { message: JSON.stringify(targets.map(e => e.data), null, 2), data: targets.map(e => e.data) }; if (action === 'remove') { if (!value || !PATH.test(value)) throw new CommandError('Data remove needs one simple data key.'); targets.forEach(e => { delete e.data[value]; }); return { message: `Removed ${value} from ${targets.length} entity(s).` }; } if (!value) throw new CommandError('Data merge needs a JSON object.'); const data = parseDataCompound(value); targets.forEach(e => ctx.entities.applyData(e, data)); return { message: `Updated ${targets.length} entity(s).` }; }, suggest: (ctx, p) => ctx.tokens.length === 0 ? ['get', 'merge', 'remove'].filter(x => x.startsWith(p)) : ctx.tokens.length === 1 ? ['entity'].filter(x => x.startsWith(p)) : suggestEntities(ctx, p) }, { owner });
  dispatcher.register(id('execute'), { aliases: ['execute'], description: 'Changes command context before running another command.', usage: '/execute as|at|positioned|rotated ... run <command>', execute: async ctx => {
    const args = ctx.tokens.map(token => token.value); let index = 0, contexts = [ctx.source];
    const selectFor = (selector, source) => selectEntities(selector, source, ctx.entities);
    while (index < args.length) {
      const operation = args[index++];
      if (operation === 'run') {
        const command = args.slice(index).join(' '); if (!command) throw new CommandError('Execute requires a command after run.');
        const results = await Promise.all(contexts.map(source => ctx.dispatcher.execute(`/${command.replace(/^\//, '')}`, source)));
        return { message: `Executed command in ${contexts.length} context(s).`, results };
      }
      if (operation === 'as' || operation === 'at') {
        const selector = args[index++]; if (!selector) throw new CommandError(`/execute ${operation} requires a target selector.`);
        contexts = contexts.flatMap(source => selectFor(selector, source).map(entity => operation === 'as'
          ? { ...source, entity, position: entity.root.position.clone(), yaw: entity.root.rotation.y, pitch: entity.root.rotation.x }
          : { ...source, position: entity.root.position.clone(), yaw: entity.root.rotation.y, pitch: entity.root.rotation.x }));
        if (!contexts.length) throw new CommandError('Execute selected no entities.'); continue;
      }
      if (operation === 'positioned') {
        const coords = args.slice(index, index + 3); if (coords.length < 3) throw new CommandError('/execute positioned requires x y z.'); index += 3;
        contexts = contexts.map(source => ({ ...source, position: resolvePosition(coords, source) })); continue;
      }
      if (operation === 'rotated') {
        const yaw = Number(args[index++]), pitch = Number(args[index++]); if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new CommandError('/execute rotated requires yaw pitch in degrees.');
        contexts = contexts.map(source => ({ ...source, yaw: THREE.MathUtils.degToRad(yaw), pitch: THREE.MathUtils.degToRad(pitch) })); continue;
      }
      throw new CommandError(`Unknown execute operation "${operation}". Use as, at, positioned, rotated, or run.`);
    }
    throw new CommandError('Execute requires run <command>.');
  }, suggest: (ctx, prefix) => ['as', 'at', 'positioned', 'rotated', 'run'].filter(value => value.startsWith(prefix)) }, { owner });
  return dispatcher;
}

export function createKinetikCommands(options = {}) { const dispatcher = new CommandDispatcher(options); registerCoreCommands(dispatcher, options); return dispatcher; }

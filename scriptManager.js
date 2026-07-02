import { gameState } from './globals.js';
import { advanceObjectState, fireButtonTrigger, levelVars, onObjectStateAdvanced, setLevelVar } from './stateManager.js';

const _moduleCache = new Map();
const _sceneScripts = [];
const _objectScripts = new Map();

function _normalizeScriptPath(spec) {
  if (!spec) return null;
  const raw = String(spec).trim();
  if (!raw) return null;
  if (/^(?:[a-z]+:|\/|\.{1,2}\/)/i.test(raw)) return raw;
  return `./${raw}`;
}

function _scriptUrl(spec) {
  const normalized = _normalizeScriptPath(spec);
  if (!normalized || typeof window === 'undefined') return null;
  return new URL(normalized, window.location.href).href;
}

async function _loadModule(spec) {
  const url = _scriptUrl(spec);
  if (!url) return null;
  if (_moduleCache.has(url)) return _moduleCache.get(url);
  const mod = await import(url);
  _moduleCache.set(url, mod);
  return mod;
}

function _moduleHooks(mod) {
  if (!mod) return null;
  return mod.default && typeof mod.default === 'object' ? mod.default : mod;
}

function _baseContext() {
  return {
    gameState,
    scene: gameState.scene,
    camera: gameState.camera,
    player: gameState.player,
    levelName: gameState.currentLevel || null,
    levelVars,
    advanceObjectState,
    fireButtonTrigger,
    setLevelVar,
  };
}

function _makeSceneContext(scriptPath, module) {
  return {
    ..._baseContext(),
    scriptPath,
    module,
    object: null,
  };
}

function _makeObjectContext(object, scriptPath, module) {
  return {
    ..._baseContext(),
    scriptPath,
    module,
    object,
    editorId: object?.userData?.editorId ?? null,
    userData: object?.userData ?? null,
  };
}

async function _callHook(mod, hookName, ctx, ...args) {
  const hooks = _moduleHooks(mod);
  const hook = hooks?.[hookName];
  if (typeof hook === 'function') {
    return await hook(ctx, ...args);
  }
}

function _collectObjectScripts() {
  const records = [];
  if (!gameState.scene) return records;
  gameState.scene.traverse(obj => {
    if (!obj?.userData?.levelObj) return;
    const scripts = Array.isArray(obj.userData.scripts) ? obj.userData.scripts : [];
    if (!scripts.length) return;
    records.push({ object: obj, scripts: scripts.filter(Boolean) });
  });
  return records;
}

function _getObjectRecord(object) {
  if (!object?.userData?.editorId) return null;
  return _objectScripts.get(object.userData.editorId) ?? null;
}

function _installStateHook() {
  if (_installStateHook._installed) return;
  onObjectStateAdvanced((editorId, nextIdx, prevIdx) => {
    const record = _objectScripts.get(editorId);
    if (!record) return;
    for (const inst of record.instances) {
      _callHook(inst.module, 'onStateChange', inst.ctx, nextIdx, prevIdx).catch(err => {
        console.warn('[kinetik:scripts] state hook failed:', err);
      });
    }
  });
  _installStateHook._installed = true;
}

export async function clearLevelScripts() {
  for (const record of _sceneScripts) {
    for (const inst of record.instances) {
      try {
        await _callHook(inst.module, 'onUnload', inst.ctx);
      } catch (err) {
        console.warn('[kinetik:scripts] scene unload failed:', err);
      }
    }
  }
  for (const record of _objectScripts.values()) {
    for (const inst of record.instances) {
      try {
        await _callHook(inst.module, 'onUnload', inst.ctx);
      } catch (err) {
        console.warn('[kinetik:scripts] object unload failed:', err);
      }
    }
  }
  _sceneScripts.length = 0;
  _objectScripts.clear();
}

export async function initLevelScripts() {
  if (typeof window === 'undefined') return;
  _installStateHook();
  await clearLevelScripts();

  const scenePaths = Array.isArray(gameState.sceneScripts) ? gameState.sceneScripts.filter(Boolean) : [];
  for (const scriptPath of scenePaths) {
    const module = await _loadModule(scriptPath);
    if (!module) continue;
    const ctx = _makeSceneContext(scriptPath, module);
    const record = { scriptPath, module, instances: [{ module, ctx }] };
    _sceneScripts.push(record);
    await _callHook(module, 'onLoad', ctx);
  }

  for (const { object, scripts } of _collectObjectScripts()) {
    const editorId = object.userData.editorId;
    const record = { object, instances: [] };
    for (const scriptPath of scripts) {
      const module = await _loadModule(scriptPath);
      if (!module) continue;
      const ctx = _makeObjectContext(object, scriptPath, module);
      record.instances.push({ scriptPath, module, ctx });
      await _callHook(module, 'onLoad', ctx);
    }
    if (record.instances.length) {
      _objectScripts.set(editorId, record);
    }
  }
}

export function updateLevelScripts(delta) {
  for (const record of _sceneScripts) {
    for (const inst of record.instances) {
      const hook = _moduleHooks(inst.module)?.onUpdate;
      if (typeof hook === 'function') {
        try {
          const result = hook(inst.ctx, delta);
          if (result?.catch) result.catch(err => console.warn('[kinetik:scripts] scene update failed:', err));
        } catch (err) {
          console.warn('[kinetik:scripts] scene update failed:', err);
        }
      }
    }
  }
  for (const record of _objectScripts.values()) {
    for (const inst of record.instances) {
      const hook = _moduleHooks(inst.module)?.onUpdate;
      if (typeof hook === 'function') {
        try {
          const result = hook(inst.ctx, delta);
          if (result?.catch) result.catch(err => console.warn('[kinetik:scripts] object update failed:', err));
        } catch (err) {
          console.warn('[kinetik:scripts] object update failed:', err);
        }
      }
    }
  }
}

export function refreshObjectScriptRecord(object) {
  const record = _getObjectRecord(object);
  if (!record) return;
  for (const inst of record.instances) {
    inst.ctx.object = object;
    inst.ctx.userData = object.userData;
  }
}

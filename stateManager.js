// stateManager.js — Manages object/light state machines for level interactables
import * as THREE from 'three';
import { gameState } from './globals.js';

// ─── Level variables (set by levelLoader, mutated by custom triggers) ─────────
export const levelVars = {};

export function setLevelVar(name, value) {
  levelVars[name] = value;
}

function _fireActiveVars(obj, newIdx) {
  const states = obj.userData.states;
  if (!states?.length) return;
  states.forEach((s, i) => {
    if (s.activeVar && s.activeVar in levelVars) levelVars[s.activeVar] = i === newIdx;
  });
}

let _audioCtx = null;
function _getAudioCtx() {
  if (!_audioCtx) _audioCtx = new AudioContext();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function _playSound(name, worldPos) {
  if (!name) return;
  let vol = 1, pan = 0;
  if (worldPos && gameState.camera) {
    const camPos = new THREE.Vector3();
    gameState.camera.getWorldPosition(camPos);
    const dist = camPos.distanceTo(worldPos);
    vol = Math.max(0, 1 - dist / 40);
    if (vol <= 0) return;
    const right = new THREE.Vector3();
    gameState.camera.getWorldDirection(new THREE.Vector3());
    right.setFromMatrixColumn(gameState.camera.matrixWorld, 0).normalize();
    const toSound = new THREE.Vector3().subVectors(worldPos, camPos).normalize();
    pan = THREE.MathUtils.clamp(right.dot(toSound), -1, 1);
  }
  const exts = ['ogg', 'mp3', 'wav'];
  const tryNext = i => {
    if (i >= exts.length) return;
    const audio = new Audio(`./sounds/${name}.${exts[i]}`);
    audio.volume = vol;
    audio.onerror = () => tryNext(i + 1);
    audio.play().then(() => {
      try {
        const ctx = _getAudioCtx();
        const src = ctx.createMediaElementSource(audio);
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        src.connect(panner);
        panner.connect(ctx.destination);
      } catch (e) {}
    }).catch(() => {});
  };
  tryNext(0);
}

const _soundSeqState = new WeakMap();
function _getSoundSeq(obj) {
  if (!_soundSeqState.has(obj)) _soundSeqState.set(obj, {});
  return _soundSeqState.get(obj);
}

function _playStateSoundsForEvent(obj, stateIdx, event) {
  const state = obj.userData.states?.[stateIdx];
  if (!state) return;
  const def = event === 'enter' ? state.enterSounds : state.exitSounds;
  if (def?.sounds?.length) {
    const { mode, sounds } = def;
    let name;
    if (mode === 'random') {
      const total = sounds.reduce((s, r) => s + (r.weight ?? 1), 0);
      let r = Math.random() * total;
      for (const s of sounds) { r -= (s.weight ?? 1); if (r <= 0) { name = s.name; break; } }
      if (!name) name = sounds[sounds.length - 1].name;
    } else {
      const seq = _getSoundSeq(obj);
      const key = stateIdx + '_' + event;
      const i = seq[key] ?? 0;
      name = sounds[i % sounds.length].name;
      seq[key] = (i + 1) % sounds.length;
    }
    _playSound(name, _getObjWorldPos(obj));
    return;
  }
  const legacy = event === 'enter' ? state.enterSound : state.exitSound;
  _playSound(legacy, _getObjWorldPos(obj));
}

function _getObjWorldPos(obj) {
  if (!obj?.isObject3D) return null;
  const p = new THREE.Vector3();
  obj.getWorldPosition(p);
  return p;
}

export function fireButtonTrigger(obj, trigger) {
  const states = obj?.userData?.states;
  if (!states?.length) return;
  const state = states[obj.userData.currentState ?? 0];
  if (!state?.buttons?.length) return;
  for (const b of state.buttons) {
    if (b.trigger !== trigger || !b.varName || !(b.varName in levelVars)) continue;
    const cur = parseFloat(levelVars[b.varName]) || 0;
    const val = parseFloat(b.varValue) || 0;
    switch (b.varOp) {
      case 'set': levelVars[b.varName] = val; break;
      case 'add': levelVars[b.varName] = cur + val; break;
      case 'sub': levelVars[b.varName] = cur - val; break;
      case 'mul': levelVars[b.varName] = cur * val; break;
    }
  }
}

// Check all stateful objects for auto-condition transitions
export function checkVarConditions() {
  for (const obj of gameState.statefulObjects) {
    if (!obj.userData.states?.length) continue;
    for (let idx = 0; idx < obj.userData.states.length; idx++) {
      const state = obj.userData.states[idx];
      if (!state.conditionEnabled || !state.condition) continue;
      if (_evalCondition(state.condition) && obj.userData.currentState !== idx) {
        const prevIdx = obj.userData.currentState ?? 0;
        obj.userData.currentState = idx;
        _fireActiveVars(obj, idx);
        _playStateSoundsForEvent(obj, prevIdx, 'exit');
        _playStateSoundsForEvent(obj, idx, 'enter');
        const dur = state.duration ?? 0;
        if (dur <= 0) _applyStateImmediate(obj, state);
        else _startStateAnim(obj, state, dur);
      }
    }
  }
}

function _evalCondition(cond) {
  if (!cond?.var) return false;
  const raw = levelVars[cond.var];
  if (raw === undefined) return false;
  const a = parseFloat(raw), b = parseFloat(cond.value);
  const numeric = !isNaN(a) && !isNaN(b);
  const lv = numeric ? a : String(raw);
  const rv = numeric ? b : String(cond.value);
  switch (cond.op) {
    case 'eq': return lv == rv;
    case 'ne': return lv != rv;
    case 'lt': return lv <  rv;
    case 'le': return lv <= rv;
    case 'gt': return lv >  rv;
    case 'ge': return lv >= rv;
    default:   return false;
  }
}

// Active animations: { obj, fromPos, toPos, fromQ, toQ, fromScale, toScale, fromIntensity, toIntensity, duration, elapsed }
const _anims = [];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Called after level load. For each stateful object, apply its state[0] transform
 * immediately so the game starts with objects in their correct initial positions.
 */
export function initStatefulObjects() {
  for (const obj of gameState.statefulObjects) {
    const states = obj.userData.states;
    if (!states?.length) continue;
    obj.userData.currentState = 0;
    _fireActiveVars(obj, 0);
    _soundSeqState.delete(obj);
    _applyStateImmediate(obj, states[0]);
  }
}

/**
 * Advance an object to its next state, animating the transition.
 * Cycles: 0 → 1 → 2 → … → 0 → …
 */
export function advanceObjectState(obj) {
  const states = obj.userData.states;
  if (!states?.length) return;
  const nextIdx = ((obj.userData.currentState ?? 0) + 1) % states.length;
  const prevIdx = obj.userData.currentState ?? 0;
  obj.userData.currentState = nextIdx;
  _fireActiveVars(obj, nextIdx);
  _playStateSoundsForEvent(obj, prevIdx, 'exit');
  _playStateSoundsForEvent(obj, nextIdx, 'enter');
  const state = states[nextIdx];
  const duration = state.duration ?? 0;
  if (duration <= 0) {
    _applyStateImmediate(obj, state);
  } else {
    _startStateAnim(obj, state, duration);
  }
  // Advance all wired link targets too
  if (obj.userData.linkedObjects?.length) {
    for (const linked of obj.userData.linkedObjects) {
      advanceObjectState(linked);
    }
  }
}

/**
 * Tick all in-progress state animations. Call once per frame with delta time (seconds).
 */
export function updateStateAnimations(delta) {
  for (let i = _anims.length - 1; i >= 0; i--) {
    const a = _anims[i];
    a.elapsed = Math.min(a.elapsed + delta, a.duration);
    const t = _easeInOut(a.elapsed / a.duration);

    if (a.fromPos && a.toPos) a.obj.position.lerpVectors(a.fromPos, a.toPos, t);
    if (a.fromQ   && a.toQ)   a.obj.quaternion.slerpQuaternions(a.fromQ, a.toQ, t);
    if (a.fromScale && a.toScale) a.obj.scale.lerpVectors(a.fromScale, a.toScale, t);
    if (a.toIntensity !== null && a.fromIntensity !== null) {
      const intensity = a.fromIntensity + (a.toIntensity - a.fromIntensity) * t;
      _setIntensity(a.obj, intensity);
    }
    if (a.fromColor && a.toColor) {
      const col = a.fromColor.clone().lerp(a.toColor, t);
      _setLightColor(a.obj, '#' + col.getHexString());
    }
    if (a.fromDistance !== null && a.toDistance !== null) {
      _setDistance(a.obj, a.fromDistance + (a.toDistance - a.fromDistance) * t);
    }
    if (a.fromDecay !== null && a.toDecay !== null) {
      _setDecay(a.obj, a.fromDecay + (a.toDecay - a.fromDecay) * t);
    }
    if (a.fromAngle !== null && a.toAngle !== null) {
      _setAngleRad(a.obj, a.fromAngle + (a.toAngle - a.fromAngle) * t);
    }
    if (a.fromPenumbra !== null && a.toPenumbra !== null) {
      _setPenumbra(a.obj, a.fromPenumbra + (a.toPenumbra - a.fromPenumbra) * t);
    }
    if (a.fromEmissiveIntensity !== null && a.toEmissiveIntensity !== null) {
      const ei = a.fromEmissiveIntensity + (a.toEmissiveIntensity - a.fromEmissiveIntensity) * t;
      a.obj.traverse(c => {
        if (c.isMesh && c.material) {
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { if ('emissiveIntensity' in m) m.emissiveIntensity = ei; });
        }
      });
    }
    if (a.fromEmissiveColor && a.toEmissiveColor) {
      const ec = a.fromEmissiveColor.clone().lerp(a.toEmissiveColor, t);
      a.obj.traverse(c => {
        if (c.isMesh && c.material) {
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { if ('emissive' in m) m.emissive.copy(ec); });
        }
      });
    }
    if (a.fromOpacity !== null && a.toOpacity !== null) {
      const opacity = a.fromOpacity + (a.toOpacity - a.fromOpacity) * t;
      a.obj.traverse(c => {
        if (c.isMesh && c.material) {
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { m.transparent = opacity < 1; m.opacity = opacity; m.needsUpdate = true; });
        }
      });
    }
    if (a.fromMeshColor && a.toMeshColor) {
      const col = a.fromMeshColor.clone().lerp(a.toMeshColor, t);
      a.obj.traverse(c => {
        if (c.isMesh && c.material) {
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { if (m.color) { m.color.copy(col); m.needsUpdate = true; } });
        }
      });
    }

    if (a.elapsed >= a.duration) _anims.splice(i, 1);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Public API for saveManager: restore obj to a specific state index immediately (no animation).
 */
export function applyObjectStateImmediate(obj, stateIdx) {
  const states = obj.userData.states;
  if (!states?.length) return;
  const idx = Math.max(0, Math.min(stateIdx, states.length - 1));
  const prevIdx = obj.userData.currentState ?? 0;
  obj.userData.currentState = idx;
  _fireActiveVars(obj, idx);
  _playStateSoundsForEvent(obj, prevIdx, 'exit');
  _playStateSoundsForEvent(obj, idx, 'enter');
  _applyStateImmediate(obj, states[idx]);
}

function _applyStateImmediate(obj, state) {
  const posOn      = state.posEnabled   !== false;
  const rotOn      = state.rotEnabled   !== false;
  const scaleOn    = state.scaleEnabled !== false;
  const intOn      = state.intensityEnabled  !== false;
  const colOn      = state.lightColorEnabled !== false;
  const distOn     = state.distanceEnabled   !== false;
  const decayOn    = state.decayEnabled      !== false;
  const angleOn    = state.angleEnabled      !== false;
  const penumbraOn = state.penumbraEnabled   !== false;

  if (posOn && state.pos) {
    if (state.posRelative) {
      obj.position.x += state.pos[0];
      obj.position.y += state.pos[1];
      obj.position.z += state.pos[2];
    } else {
      obj.position.set(...state.pos);
    }
  }
  if (rotOn && state.rot) {
    if (state.rotRelative) {
      obj.rotation.x += THREE.MathUtils.degToRad(state.rot[0]);
      obj.rotation.y += THREE.MathUtils.degToRad(state.rot[1]);
      obj.rotation.z += THREE.MathUtils.degToRad(state.rot[2]);
    } else {
      obj.rotation.set(
        THREE.MathUtils.degToRad(state.rot[0]),
        THREE.MathUtils.degToRad(state.rot[1]),
        THREE.MathUtils.degToRad(state.rot[2])
      );
    }
  }
  if (scaleOn && state.scale) {
    const mode = state.scaleMode || 'abs';
    if (mode === 'mul') {
      obj.scale.x *= state.scale[0]; obj.scale.y *= state.scale[1]; obj.scale.z *= state.scale[2];
    } else if (mode === 'add') {
      obj.scale.x += state.scale[0]; obj.scale.y += state.scale[1]; obj.scale.z += state.scale[2];
    } else {
      obj.scale.set(...state.scale);
    }
  }
  if (intOn && state.intensity != null) {
    const val = state.intensityRelative ? (_getIntensity(obj) + state.intensity) : state.intensity;
    _setIntensity(obj, val);
  }
  if (colOn && state.lightColor != null) {
    _setLightColor(obj, state.lightColor);
  }
  if (distOn && state.distance != null) {
    _setDistance(obj, state.distance);
  }
  if (decayOn && state.decay != null) {
    _setDecay(obj, state.decay);
  }
  if (angleOn && state.angle != null) {
    _setAngle(obj, state.angle);
  }
  if (penumbraOn && state.penumbra != null) {
    _setPenumbra(obj, state.penumbra);
  }
  if (state.collidableEnabled && state.collidable != null) {
    obj.userData.collidable = state.collidable;
  }
  if (state.castShadowEnabled && state.castShadow != null) {
    const v = !!state.castShadow;
    obj.castShadow = v;
    obj.traverse(c => {
      if (c.isMesh)  c.castShadow = v;
      if (c.isLight) c.castShadow = v;
    });
  }
  if (state.emissiveEnabled) {
    if (state.emissiveIntensity != null) {
      obj.traverse(c => {
        if (c.isMesh && c.material) {
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { if ('emissiveIntensity' in m) m.emissiveIntensity = state.emissiveIntensity; });
        }
      });
    }
    if (state.emissiveColor != null) {
      obj.traverse(c => {
        if (c.isMesh && c.material) {
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { if ('emissive' in m) m.emissive.set(state.emissiveColor); });
        }
      });
    }
  }
  if (state.opacityEnabled && state.opacity != null) {
    const v = Math.max(0, Math.min(1, state.opacity));
    obj.traverse(c => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { m.transparent = v < 1; m.opacity = v; m.needsUpdate = true; });
      }
    });
  }
  if (state.meshColorEnabled && state.meshColor != null) {
    obj.traverse(c => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { if (m.color) { m.color.set(state.meshColor); m.needsUpdate = true; } });
      }
    });
  }
  obj.updateMatrixWorld(true);
}

function _startStateAnim(obj, state, duration) {
  // Cancel any existing animation on this object
  const existing = _anims.findIndex(a => a.obj === obj);
  if (existing !== -1) _anims.splice(existing, 1);

  const posOn      = state.posEnabled   !== false;
  const rotOn      = state.rotEnabled   !== false;
  const scaleOn    = state.scaleEnabled !== false;
  const intOn      = state.intensityEnabled  !== false;
  const colOn      = state.lightColorEnabled !== false;
  const distOn     = state.distanceEnabled   !== false;
  const decayOn    = state.decayEnabled      !== false;
  const angleOn    = state.angleEnabled      !== false;
  const penumbraOn = state.penumbraEnabled   !== false;

  let fromPos = null, toPos = null;
  if (posOn && state.pos) {
    fromPos = obj.position.clone();
    toPos   = state.posRelative
      ? obj.position.clone().add(new THREE.Vector3(...state.pos))
      : new THREE.Vector3(...state.pos);
  }

  let fromQ = null, toQ = null;
  if (rotOn && state.rot) {
    fromQ = obj.quaternion.clone();
    if (state.rotRelative) {
      const e = obj.rotation;
      toQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        e.x + THREE.MathUtils.degToRad(state.rot[0]),
        e.y + THREE.MathUtils.degToRad(state.rot[1]),
        e.z + THREE.MathUtils.degToRad(state.rot[2])
      ));
    } else {
      toQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(state.rot[0]),
        THREE.MathUtils.degToRad(state.rot[1]),
        THREE.MathUtils.degToRad(state.rot[2])
      ));
    }
  }

  let fromScale = null, toScale = null;
  if (scaleOn && state.scale) {
    fromScale = obj.scale.clone();
    const mode = state.scaleMode || 'abs';
    if (mode === 'mul') {
      toScale = new THREE.Vector3(obj.scale.x * state.scale[0], obj.scale.y * state.scale[1], obj.scale.z * state.scale[2]);
    } else if (mode === 'add') {
      toScale = obj.scale.clone().add(new THREE.Vector3(...state.scale));
    } else {
      toScale = new THREE.Vector3(...state.scale);
    }
  }

  let fromIntensity = null, toIntensity = null;
  if (intOn && state.intensity != null) {
    fromIntensity = _getIntensity(obj);
    toIntensity   = state.intensityRelative ? (fromIntensity + state.intensity) : state.intensity;
  }

  let fromColor = null, toColor = null;
  if (colOn && state.lightColor != null) {
    fromColor = _getLightColor(obj);
    toColor   = new THREE.Color(state.lightColor);
  }

  let fromDistance = null, toDistance = null;
  if (distOn && state.distance != null) {
    fromDistance = _getDistance(obj);
    toDistance   = state.distance;
  }

  let fromDecay = null, toDecay = null;
  if (decayOn && state.decay != null) {
    fromDecay = _getDecay(obj);
    toDecay   = state.decay;
  }

  let fromAngle = null, toAngle = null;
  if (angleOn && state.angle != null) {
    fromAngle = _getAngle(obj);
    toAngle   = THREE.MathUtils.degToRad(state.angle);
  }

  let fromPenumbra = null, toPenumbra = null;
  if (penumbraOn && state.penumbra != null) {
    fromPenumbra = _getPenumbra(obj);
    toPenumbra   = state.penumbra;
  }

  // Boolean fields: apply immediately at animation start
  if (state.collidableEnabled && state.collidable != null) {
    obj.userData.collidable = state.collidable;
  }
  if (state.castShadowEnabled && state.castShadow != null) {
    const v = !!state.castShadow;
    obj.castShadow = v;
    obj.traverse(c => {
      if (c.isMesh)  c.castShadow = v;
      if (c.isLight) c.castShadow = v;
    });
  }

  // Emissive fields — animated on mesh children
  let fromEmissiveIntensity = null, toEmissiveIntensity = null;
  let fromEmissiveColor = null, toEmissiveColor = null;
  if (state.emissiveEnabled) {
    if (state.emissiveIntensity != null) {
      obj.traverse(c => {
        if (fromEmissiveIntensity === null && c.isMesh && c.material) {
          const m = Array.isArray(c.material) ? c.material[0] : c.material;
          if ('emissiveIntensity' in m) fromEmissiveIntensity = m.emissiveIntensity;
        }
      });
      toEmissiveIntensity = state.emissiveIntensity;
    }
    if (state.emissiveColor != null) {
      obj.traverse(c => {
        if (fromEmissiveColor === null && c.isMesh && c.material) {
          const m = Array.isArray(c.material) ? c.material[0] : c.material;
          if ('emissive' in m) fromEmissiveColor = m.emissive.clone();
        }
      });
      toEmissiveColor = new THREE.Color(state.emissiveColor);
    }
  }

  // Opacity field — animated on mesh children
  let fromOpacity = null, toOpacity = null;
  if (state.opacityEnabled && state.opacity != null) {
    obj.traverse(c => {
      if (fromOpacity === null && c.isMesh && c.material) {
        const m = Array.isArray(c.material) ? c.material[0] : c.material;
        if (m) fromOpacity = m.opacity ?? 1;
      }
    });
    toOpacity = Math.max(0, Math.min(1, state.opacity));
  }

  // Mesh color field — animated on mesh children
  let fromMeshColor = null, toMeshColor = null;
  if (state.meshColorEnabled && state.meshColor != null) {
    obj.traverse(c => {
      if (fromMeshColor === null && c.isMesh && c.material) {
        const m = Array.isArray(c.material) ? c.material[0] : c.material;
        if (m?.color) fromMeshColor = m.color.clone();
      }
    });
    toMeshColor = new THREE.Color(state.meshColor);
  }

  _anims.push({
    obj, fromPos, toPos, fromQ, toQ, fromScale, toScale,
    fromIntensity, toIntensity, fromColor, toColor,
    fromDistance, toDistance, fromDecay, toDecay,
    fromAngle, toAngle, fromPenumbra, toPenumbra,
    fromEmissiveIntensity, toEmissiveIntensity,
    fromEmissiveColor, toEmissiveColor,
    fromOpacity, toOpacity,
    fromMeshColor, toMeshColor,
    duration, elapsed: 0,
  });
}

function _setIntensity(obj, value) {
  if (obj.isLight) {
    obj.intensity = value;
  } else {
    obj.traverse(c => { if (c.isLight) c.intensity = value; });
    obj.userData.intensity = value;
  }
}

function _getIntensity(obj) {
  if (obj.isLight) return obj.intensity;
  let result = obj.userData.intensity ?? 1;
  obj.traverse(c => { if (c.isLight) { result = c.intensity; } });
  return result;
}

function _setLightColor(obj, hexStr) {
  const col = new THREE.Color(hexStr);
  if (obj.isLight) {
    obj.color.copy(col);
  } else {
    obj.traverse(c => { if (c.isLight) c.color.copy(col); });
  }
  obj.userData.lightColor = hexStr;
}

function _getLightColor(obj) {
  if (obj.isLight) return obj.color.clone();
  let col = new THREE.Color(obj.userData.lightColor || '#ffffff');
  obj.traverse(c => { if (c.isLight) col = c.color.clone(); });
  return col;
}

function _setDistance(obj, val) {
  if (obj.isLight) { if ('distance' in obj) obj.distance = val; }
  else { obj.traverse(c => { if (c.isLight && 'distance' in c) c.distance = val; }); }
  obj.userData.distance = val;
}

function _getDistance(obj) {
  if (obj.isLight && 'distance' in obj) return obj.distance;
  let d = obj.userData.distance ?? 10;
  obj.traverse(c => { if (c.isLight && 'distance' in c) d = c.distance; });
  return d;
}

function _setDecay(obj, val) {
  if (obj.isLight) { if ('decay' in obj) obj.decay = val; }
  else { obj.traverse(c => { if (c.isLight && 'decay' in c) c.decay = val; }); }
  obj.userData.decay = val;
}

function _getDecay(obj) {
  if (obj.isLight && 'decay' in obj) return obj.decay;
  let d = obj.userData.decay ?? 2;
  obj.traverse(c => { if (c.isLight && 'decay' in c) d = c.decay; });
  return d;
}

function _setAngle(obj, deg) {
  const rad = THREE.MathUtils.degToRad(deg);
  if (obj.isSpotLight) { obj.angle = rad; }
  else { obj.traverse(c => { if (c.isSpotLight) c.angle = rad; }); }
  obj.userData.angle = deg;
}

function _setAngleRad(obj, rad) {
  if (obj.isSpotLight) { obj.angle = rad; }
  else { obj.traverse(c => { if (c.isSpotLight) c.angle = rad; }); }
  obj.userData.angle = THREE.MathUtils.radToDeg(rad);
}

function _getAngle(obj) {
  if (obj.isSpotLight) return obj.angle;
  let a = THREE.MathUtils.degToRad(obj.userData.angle ?? 30);
  obj.traverse(c => { if (c.isSpotLight) a = c.angle; });
  return a;
}

function _setPenumbra(obj, val) {
  if (obj.isSpotLight) { obj.penumbra = val; }
  else { obj.traverse(c => { if (c.isSpotLight) c.penumbra = val; }); }
  obj.userData.penumbra = val;
}

function _getPenumbra(obj) {
  if (obj.isSpotLight) return obj.penumbra;
  let p = obj.userData.penumbra ?? 0.15;
  obj.traverse(c => { if (c.isSpotLight) p = c.penumbra; });
  return p;
}

function _easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

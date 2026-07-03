import * as THREE from 'three';
import { gameState } from './globals.js';
import { onObjectStateAdvanced } from './stateManager.js';

const DEFAULT_OBJECTIVE = 'Explore the area.';

let _catalog = {};
let _defaultScene = null;
let _defaultObjective = DEFAULT_OBJECTIVE;
let _poiMeshes = new Map();
let _consumedPois = new Set();
let _dialogueSeen = new Set();
let _currentScene = null;
let _objectiveText = DEFAULT_OBJECTIVE;
let _objectiveSubtitle = '';
let _dialogueText = '';
let _dialogueSpeaker = '';
let _dialogueLog = [];
let _warble = 0;
let _hookRegistered = false;
let _namedBindings = [];

function _flags() {
  const flags = gameState.flags || {};
  return flags.story ?? (flags.story = {});
}

function _ensureHud() {
  let el = document.getElementById('story-objective');
  if (!el) {
    const hud = document.querySelector('.hud') || document.body;
    el = document.createElement('div');
    el.id = 'story-objective';
    el.innerHTML = '<div class="story-objective-label">OBJECTIVE</div><div class="story-objective-text"></div><div class="story-objective-subtitle"></div>';
    hud.appendChild(el);
  }
  return el;
}

function _setObjective(text, subtitle = '') {
  _objectiveText = text || _defaultObjective;
  _objectiveSubtitle = subtitle || '';
  const el = _ensureHud();
  const textEl = el.querySelector('.story-objective-text');
  const subEl = el.querySelector('.story-objective-subtitle');
  if (textEl) textEl.textContent = _objectiveText;
  if (subEl) {
    subEl.textContent = _objectiveSubtitle;
    subEl.style.display = _objectiveSubtitle ? '' : 'none';
  }
}

function _ensureDialogueHud() {
  let el = document.getElementById('story-dialogue');
  if (!el) {
    const hud = document.querySelector('.hud') || document.body;
    el = document.createElement('div');
    el.id = 'story-dialogue';
    el.innerHTML = '<div class="story-dialogue-speaker"></div><div class="story-dialogue-text"></div><div class="story-dialogue-log"></div>';
    hud.appendChild(el);
    const style = document.createElement('style');
    style.textContent = `
      #story-dialogue {
        position: fixed;
        right: 1rem;
        bottom: 4.25rem;
        width: min(26rem, calc(100vw - 2rem));
        z-index: 1200;
        color: #dfffe8;
        font-family: 'Courier New', monospace;
        text-shadow: 0 0 6px rgba(0, 0, 0, 0.7);
        pointer-events: none;
      }
      #story-dialogue .story-dialogue-text {
        padding: 0.6rem 0.75rem;
        background: rgba(0, 0, 0, 0.62);
        border: 1px solid rgba(120, 255, 160, 0.22);
        box-shadow: 0 0 18px rgba(0, 0, 0, 0.35);
        white-space: pre-wrap;
        margin-bottom: 0.45rem;
      }
      #story-dialogue .story-dialogue-speaker {
        display: inline-block;
        margin-bottom: 0.25rem;
        padding: 0.18rem 0.5rem;
        background: rgba(120, 255, 160, 0.12);
        border: 1px solid rgba(120, 255, 160, 0.22);
        color: #aaffc0;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        font-size: 0.72em;
      }
      #story-dialogue .story-dialogue-log {
        max-height: 9rem;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        opacity: 0.82;
      }
      #story-dialogue .story-dialogue-log-line {
        padding: 0.3rem 0.5rem;
        background: rgba(0, 0, 0, 0.45);
        border-left: 2px solid rgba(120, 255, 160, 0.2);
        white-space: pre-wrap;
        font-size: 0.86em;
      }
    `;
    document.head.appendChild(style);
  }
  return el;
}

function _renderDialogueLog() {
  const el = _ensureDialogueHud();
  const logEl = el.querySelector('.story-dialogue-log');
  if (!logEl) return;
  logEl.innerHTML = '';
  const lines = _dialogueLog.slice(-4);
  for (const line of lines) {
    const item = document.createElement('div');
    item.className = 'story-dialogue-log-line';
    item.textContent = line;
    logEl.appendChild(item);
  }
}

function _setDialogue(text = '', speaker = '') {
  _dialogueText = text || '';
  _dialogueSpeaker = speaker || '';
  if (_dialogueText) {
    _dialogueLog.push(_dialogueText);
    if (_dialogueLog.length > 12) _dialogueLog.splice(0, _dialogueLog.length - 12);
  }
  const el = _ensureDialogueHud();
  const speakerEl = el.querySelector('.story-dialogue-speaker');
  const textEl = el.querySelector('.story-dialogue-text');
  if (speakerEl) {
    speakerEl.textContent = _dialogueSpeaker;
    speakerEl.style.display = _dialogueSpeaker ? '' : 'none';
  }
  if (textEl) textEl.textContent = _dialogueText;
  _renderDialogueLog();
  el.style.display = _dialogueText ? '' : 'none';
}

function _applyIntensity(value) {
  _warble = Math.max(0, Math.min(1, value ?? 0));
  globalThis.__kinetikGameHooks?.setWarbleIntensity?.(_warble);
}

function _sceneDef(sceneId) {
  return _catalog?.[sceneId] || null;
}

function _applyScene(sceneId) {
  _currentScene = sceneId;
  const scene = _sceneDef(sceneId);
  if (!scene) return;
  _setObjective(scene.objective || _defaultObjective, scene.title || '');
  _applyIntensity(scene.intensity ?? 0);
  const flags = _flags();
  flags.scene = sceneId;
  flags.objective = scene.objective || _defaultObjective;
  flags.intensity = _warble;
}

function _meta(obj) {
  return obj?.userData?.storyPoi || obj?.userData?.storyBeat || null;
}

function _shouldShowPoi(obj) {
  const meta = _meta(obj);
  if (!meta) return false;
  if (meta.hidden) return false;
  if (meta.requiresFlags?.length) {
    const flags = _flags();
    for (const req of meta.requiresFlags) if (!flags[req]) return false;
  }
  if (meta.unlockFlags?.length) {
    const flags = _flags();
    if (!meta.unlockFlags.some(k => flags[k])) return false;
  }
  const id = String(meta.id || obj.userData.editorId || '');
  if (meta.oneShot && _consumedPois.has(id)) return false;
  return true;
}

function _poiMat() {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false });
}

function _marker() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), _poiMat());
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshBasicMaterial({
    color: 0xbfd7ff, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false
  }));
  g.add(core, glow);
  g.userData._core = core;
  g.userData._glow = glow;
  g.renderOrder = 999;
  return g;
}

function _syncPois() {
  for (const obj of gameState.statefulObjects || []) {
    const ok = _shouldShowPoi(obj);
    let marker = _poiMeshes.get(obj);
    if (ok && !marker) {
      marker = _marker();
      marker.position.set(0, 0.95, 0);
      obj.add(marker);
      _poiMeshes.set(obj, marker);
    } else if (!ok && marker) {
      marker.removeFromParent();
      _poiMeshes.delete(obj);
    }
    marker = _poiMeshes.get(obj);
    if (!marker) continue;
    const t = performance.now() * 0.004 + (obj.userData.editorId || 0);
    const pulse = 1 + Math.sin(t) * 0.14;
    marker.scale.setScalar(Math.max(0.7, (obj.userData.storyPoi?.markerScale ?? 1) * pulse));
    const alpha = 0.6 + Math.max(0, Math.sin(t * 1.7)) * 0.3;
    if (marker.userData._core?.material) marker.userData._core.material.opacity = alpha;
    if (marker.userData._glow?.material) marker.userData._glow.material.opacity = alpha * 0.28;
  }
}

function _trigger(meta, obj) {
  if (!meta) return;
  const flags = _flags();
  const nodeId = meta.dialogueId || meta.storyId || meta.id || String(obj?.userData?.editorId ?? '');
  if (nodeId) _dialogueSeen.add(nodeId);
  if (meta.dialogue) _setDialogue(meta.dialogue);
  if (meta.speaker) _setDialogue(meta.dialogue, meta.speaker);
  if (meta.clueId) {
    const flags = _flags();
    const clueSet = flags.clues ?? (flags.clues = {});
    clueSet[meta.clueId] = true;
    clueSet._count = Object.keys(clueSet).filter(k => !k.startsWith('_') && clueSet[k]).length;
  }
  if (meta.scene) _applyScene(meta.scene);
  if (meta.objective) _setObjective(meta.objective, meta.title || meta.scene || '');
  if (meta.intensity != null) _applyIntensity(meta.intensity);
  if (meta.setFlags) for (const [k, v] of Object.entries(meta.setFlags)) flags[k] = v;
  if (meta.unlockFlags?.length) for (const k of meta.unlockFlags) flags[k] = true;
  if (meta.oneShot && meta.id != null) _consumedPois.add(String(meta.id));
  if (meta.storyAction && _sceneDef(meta.storyAction)) _applyScene(meta.storyAction);
  if (meta.nextScene && _sceneDef(meta.nextScene)) _applyScene(meta.nextScene);
  if (getStoryClueCount() >= 3) flags.enough_clues_found = true;
}

function _applyState(obj) {
  const meta = obj?.userData?.storyPoi;
  if (!meta) return;
  if ((obj.userData.currentState ?? 0) === 1) {
    _trigger(meta, obj);
    if (meta.oneShot) {
      obj.userData.noSelfInteract = true;
      obj.userData.stateInteractive = false;
    }
  }
}

export function configureStorySystem({ catalog = {}, defaultScene = null, defaultObjective = DEFAULT_OBJECTIVE } = {}) {
  _catalog = catalog || {};
  _defaultScene = defaultScene;
  _defaultObjective = defaultObjective || DEFAULT_OBJECTIVE;
}

export function bindStoryObjectByName(name, meta = {}) {
  if (!name) return;
  _namedBindings.push({ name: String(name).toLowerCase(), meta: { ...meta } });
}

export function clearStoryBindings() {
  _namedBindings = [];
}

function _matchName(obj, name) {
  const target = String(name).toLowerCase();
  const objName = String(obj?.name || '').toLowerCase();
  const objLabel = String(obj?.userData?.label || '').toLowerCase();
  if (objName === target || objLabel === target) return true;
  const baseTarget = target.endsWith('_poi') ? target.slice(0, -4) : target;
  return objName === baseTarget || objLabel === baseTarget;
}

function _applyNamedBindings() {
  if (!gameState.scene) return;
  for (const bind of _namedBindings) {
    let target = null;
    let fallback = null;
    gameState.scene.traverse(obj => {
      const objName = String(obj?.name || '').toLowerCase();
      const objLabel = String(obj?.userData?.label || '').toLowerCase();
      const exact = objName === bind.name || objLabel === bind.name;
      const fuzzy = !exact && _matchName(obj, bind.name);
      if (!target && exact) target = obj;
      else if (!fallback && fuzzy) fallback = obj;
    });
    // Bind by editor-assigned `name` or `label`; this keeps gameplay logic
    // out of the editor and lets projects opt in by naming an object.
    if (target || fallback) registerStoryObject(target || fallback, { ...bind.meta, id: bind.meta.id || bind.name });
  }
}

export function initStorySystem() {
  if (!_hookRegistered) {
    _hookRegistered = true;
    onObjectStateAdvanced((editorId, stateIdx) => {
      const obj = (gameState.statefulObjects || []).find(o => String(o.userData.editorId) === String(editorId));
      if (!obj) return;
      obj.userData.currentState = stateIdx;
      _applyState(obj);
      if (obj.userData.storyBeat?.scene && stateIdx === 1) _applyScene(obj.userData.storyBeat.scene);
    });
  }
  _ensureHud();
  _ensureDialogueHud();
  _setObjective(_defaultObjective);
  _setDialogue('');
  _renderDialogueLog();
  if (_defaultScene) _applyScene(_defaultScene);
  _applyNamedBindings();
}

export function registerStoryObject(obj, meta = {}) {
  if (!obj) return;
  obj.userData.storyPoi = meta;
  if (!obj.userData.states?.length) {
    obj.userData.states = [
      { interactLabel: meta.label || '[RIGHT CLICK] Inspect', interactiveEnabled: true, interactive: true },
      { interactLabel: meta.label || '[RIGHT CLICK] Inspect', interactiveEnabled: true, interactive: true },
    ];
    obj.userData.currentState = 0;
  }
  if (meta.scene && !_sceneDef(meta.scene)) {
    // no-op, game repo can define the catalog
  }
  _applyState(obj);
}

export function setStoryScene(sceneId) { _applyScene(sceneId); }
export function getStoryScene() { return _currentScene; }
export function setStoryObjective(text, subtitle = '') { _setObjective(text, subtitle); _flags().objective = text; }
export function setStoryDialogue(text = '', speaker = '') { _setDialogue(text, speaker); }
export function setStoryIntensity(value) { _applyIntensity(value); }
export function getStoryIntensity() { return _warble; }
export function getStoryDialogueLog() { return [..._dialogueLog]; }
export function getStoryClueCount() { return _flags().clues?._count ?? 0; }
export function setStoryClueFlag(id, value = true) {
  if (!id) return;
  const flags = _flags();
  const clueSet = flags.clues ?? (flags.clues = {});
  clueSet[id] = !!value;
  clueSet._count = Object.keys(clueSet).filter(k => !k.startsWith('_') && clueSet[k]).length;
}
export function consumeStoryPoi(id) { if (id != null) { _consumedPois.add(String(id)); _syncPois(); } }
export function advanceStoryFromInteract(obj) { if (!obj?.userData?.storyPoi) return false; _trigger(obj.userData.storyPoi, obj); if (obj.userData.storyPoi.oneShot) consumeStoryPoi(obj.userData.storyPoi.id); return true; }

export function getStorySaveData() {
  return {
    currentScene: _currentScene,
    objectiveText: _objectiveText,
    objectiveSubtitle: _objectiveSubtitle,
    dialogueText: _dialogueText,
    dialogueSpeaker: _dialogueSpeaker,
    dialogueLog: [..._dialogueLog],
    intensity: _warble,
    consumedPois: [..._consumedPois],
    dialogueSeen: [..._dialogueSeen],
    flags: { ...(gameState.flags?.story || {}) },
  };
}

export function restoreStorySaveData(data) {
  if (!data) return;
  _currentScene = data.currentScene ?? _currentScene;
  _consumedPois = new Set((data.consumedPois || []).map(String));
  _dialogueSeen = new Set((data.dialogueSeen || []).map(String));
  _objectiveText = data.objectiveText || _objectiveText;
  _objectiveSubtitle = data.objectiveSubtitle || '';
  _dialogueSpeaker = data.dialogueSpeaker || '';
  _dialogueLog = [...(data.dialogueLog || [])];
  _ensureHud();
  _ensureDialogueHud();
  _setObjective(_objectiveText, _objectiveSubtitle);
  _setDialogue(data.dialogueText || '', _dialogueSpeaker);
  _renderDialogueLog();
  _applyIntensity(data.intensity ?? _warble);
  if (!gameState.flags) gameState.flags = {};
  gameState.flags.story = { ...(data.flags || {}) };
  _syncPois();
}

export function refreshStorySystem() { _syncPois(); }
export function updateStorySystem() { _syncPois(); }
export function rebindStoryObjects() { _applyNamedBindings(); }

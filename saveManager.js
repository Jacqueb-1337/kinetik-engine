// saveManager.js — Triggered save-state system
//
// Design goals:
//  - Saves are NEVER player-initiated; they happen at specific game-defined moments
//    (save-trigger volumes, mission completion, cutscenes, etc.)
//  - The core snapshot is versioned and extensible via registerSaveExtension()
//  - Future minigame progress (separate player/health/position) is added by calling
//    registerSaveExtension('arcade', { capture, restore }) from that minigame's module
//  - triggerSave() and loadSave() are the two public entry points for gameplay code
//  - checkSaveTriggers(delta) is called each frame from main.js to handle zone triggers

import * as THREE from 'three';
import { gameState } from './globals.js';
import { applyObjectStateImmediate, levelVars, setLevelVar } from './stateManager.js';

const SAVE_VERSION = 1;
const TRIGGER_RADIUS = 1.5;   // metres — how close before a zone trigger fires

// ─── Extension registry ───────────────────────────────────────────────────────
// Lets other modules (future minigames, etc.) register extra save/restore slices.
//
// Usage:
//   import { registerSaveExtension } from './saveManager.js';
//   registerSaveExtension('arcade', {
//     capture: ()      => ({ score: arcadeState.score, level: arcadeState.level }),
//     restore: (data)  => { arcadeState.score = data.score; arcadeState.level = data.level; },
//   });

const _extensions = new Map();

export function registerSaveExtension(key, { capture, restore }) {
  _extensions.set(key, { capture, restore });
}

// ─── Core save / load ─────────────────────────────────────────────────────────

/**
 * Trigger a save. Call this from gameplay code — mission complete, cutscene end, etc.
 * @param {string} slotKey  Save slot name (default: 'autosave')
 * @returns {Promise<boolean>} true on success
 */
export async function triggerSave(slotKey = 'autosave') {
  const snapshot = _buildSnapshot(slotKey);
  const ok = await _writeSave(slotKey, snapshot);
  if (ok) console.log(`[saveManager] Saved to slot "${slotKey}"`);
  return ok;
}

/**
 * Load a save slot back into the running game.
 * NOTE: does NOT reload the level — call loadLevel() separately if the level differs.
 * @param {string} slotKey
 * @returns {Promise<boolean>} true if a save was found and applied
 */
export async function loadSave(slotKey = 'autosave') {
  const data = await _readSave(slotKey);
  if (!data) return false;
  _applySnapshot(data);
  console.log(`[saveManager] Restored from slot "${slotKey}" (saved ${new Date(data.timestamp).toLocaleString()})`);
  return true;
}

/**
 * Returns the raw save data for a slot, or null if it doesn't exist.
 */
export async function readSave(slotKey = 'autosave') {
  return _readSave(slotKey);
}

export async function hasSave(slotKey = 'autosave') {
  return (await _readSave(slotKey)) !== null;
}

export async function deleteSave(slotKey = 'autosave') {
  if (!window.electron) return false;
  try { await window.electron.deleteSave(slotKey); return true; } catch { return false; }
}

export async function listSaves() {
  if (!window.electron) return [];
  try { return await window.electron.listSaves(); } catch { return []; }
}

// ─── Frame tick — save-trigger zone detection ─────────────────────────────────

/**
 * Call once per frame from main.js animate loop.
 * Checks player proximity to all loaded save-trigger volumes and fires saves.
 */
export function checkSaveTriggers() {
  if (!gameState.player || !gameState.saveTriggers?.length) return;
  const playerPos = gameState.player.position;

  for (const trigger of gameState.saveTriggers) {
    if (trigger.userData._triggered && trigger.userData.onceOnly !== false) continue;

    const pos = trigger.userData._worldPos;
    const halfW = trigger.userData._halfW;
    const halfH = trigger.userData._halfH;
    const halfD = trigger.userData._halfD;

    // AABB test (trigger box in world space — no rotation support for simplicity)
    const dx = Math.abs(playerPos.x - pos.x);
    const dy = Math.abs(playerPos.y + 1 - pos.y);   // +1 = approx player center
    const dz = Math.abs(playerPos.z - pos.z);

    if (dx <= halfW && dy <= halfH && dz <= halfD) {
      trigger.userData._triggered = true;
      const slot = trigger.userData.saveSlot || 'autosave';
      triggerSave(slot);
    }
  }
}

/**
 * Call once per frame from main.js animate loop.
 * Checks player overlap with all custom-trigger volumes and mutates level variables.
 * Re-entry is edge-triggered (won't re-fire until player leaves and re-enters).
 */
export function checkCustomTriggers() {
  if (!gameState.player || !gameState.customTriggers?.length) return;
  const p = gameState.player.position;

  for (const t of gameState.customTriggers) {
    const { triggerVar, triggerVarOp, triggerVarValue, _worldPos: pos, _halfW, _halfH, _halfD } = t.userData;
    if (!triggerVar) continue;

    const inside = Math.abs(p.x - pos.x) <= _halfW
                && Math.abs(p.y + 1 - pos.y) <= _halfH
                && Math.abs(p.z - pos.z) <= _halfD;

    if (!inside)  { t.userData._inside = false; continue; }
    if (t.userData._inside) continue;   // already inside — don't re-fire
    t.userData._inside = true;

    const cur = levelVars[triggerVar];
    if (triggerVarOp === 'toggle') {
      setLevelVar(triggerVar, !(cur === true || cur === 'true' || cur === 1 || cur === '1'));
    } else if (triggerVarOp === 'add') {
      setLevelVar(triggerVar, (parseFloat(cur) || 0) + (parseFloat(triggerVarValue) || 1));
    } else {
      // 'set' — store as the appropriate runtime type
      setLevelVar(triggerVar, triggerVarValue);
    }
  }
}

// ─── Snapshot build / apply ───────────────────────────────────────────────────

function _buildSnapshot(slotKey) {
  const p = gameState.player?.position;
  const snapshot = {
    version:   SAVE_VERSION,
    timestamp: Date.now(),
    slotKey,
    level:     gameState.currentLevel || 'main',
    player: {
      pos:         p ? [p.x, p.y, p.z] : [0, 2, 0],
      rotation:    gameState.playerRotation   ?? 0,
      cameraAngle: gameState.cameraAngle      ?? 0,
      cameraPitch: gameState.cameraPitch      ?? 0,
    },
    stats: {
      score: gameState.score ?? 0,
      lives: gameState.lives ?? 3,
    },
    objectStates: _captureObjectStates(),
    flags:        { ...(gameState.flags || {}) },
    extensions:   {},
  };

  for (const [key, { capture }] of _extensions) {
    try { snapshot.extensions[key] = capture(); }
    catch (e) { console.warn(`[saveManager] Extension "${key}" capture failed:`, e); }
  }

  return snapshot;
}

function _applySnapshot(data) {
  if (data.version !== SAVE_VERSION) {
    console.warn('[saveManager] Save version mismatch — attempting compatibility restore');
  }

  // Player transform
  if (data.player) {
    const { pos, rotation, cameraAngle, cameraPitch } = data.player;
    if (gameState.player && pos) gameState.player.position.set(...pos);
    if (rotation    !== undefined) gameState.playerRotation = rotation;
    if (cameraAngle !== undefined) gameState.cameraAngle    = cameraAngle;
    if (cameraPitch !== undefined) gameState.cameraPitch    = cameraPitch;
    gameState.velocityY = 0;  // always clear velocity on restore
  }

  // Stats
  if (data.stats) {
    if (data.stats.score !== undefined) gameState.score = data.stats.score;
    if (data.stats.lives !== undefined) gameState.lives = data.stats.lives;
  }

  // Object states (restore each stateful object to its saved state index)
  if (data.objectStates) _restoreObjectStates(data.objectStates);

  // Flags
  if (data.flags) gameState.flags = { ...data.flags };

  // Extensions
  if (data.extensions) {
    for (const [key, { restore }] of _extensions) {
      if (data.extensions[key] !== undefined) {
        try { restore(data.extensions[key]); }
        catch (e) { console.warn(`[saveManager] Extension "${key}" restore failed:`, e); }
      }
    }
  }
}

// ─── Object state helpers ─────────────────────────────────────────────────────

function _captureObjectStates() {
  const result = {};
  for (const obj of (gameState.statefulObjects || [])) {
    const id = obj.userData.editorId;
    if (id !== undefined) result[id] = obj.userData.currentState ?? 0;
  }
  return result;
}

function _restoreObjectStates(objectStates) {
  for (const obj of (gameState.statefulObjects || [])) {
    const id = obj.userData.editorId;
    const idx = objectStates[id];
    if (id !== undefined && idx !== undefined) {
      obj.userData.currentState = idx;
      applyObjectStateImmediate(obj, idx);
    }
  }
}

// ─── Persistence (Electron IPC / localStorage fallback) ──────────────────────

async function _writeSave(slotKey, data) {
  if (window.electron?.writeSave) {
    try { await window.electron.writeSave(slotKey, data); return true; } catch { return false; }
  }
  // Fallback for non-Electron (browser dev mode)
  try {
    localStorage.setItem('save:' + slotKey, JSON.stringify(data));
    return true;
  } catch { return false; }
}

async function _readSave(slotKey) {
  if (window.electron?.readSave) {
    try { return await window.electron.readSave(slotKey); } catch { return null; }
  }
  try {
    const raw = localStorage.getItem('save:' + slotKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

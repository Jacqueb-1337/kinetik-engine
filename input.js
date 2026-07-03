// input.js - Input handling for keys
import * as THREE from 'three';
import { gameState } from './globals.js';
import { platformConfig } from './platform.js';
import { exportScene } from './scene.js';

let _pauseToggle = () => {};
export function setPauseToggleCallback(fn) { _pauseToggle = fn; }

// Debug and freecam state
let debugOverlayVisible = false;
let freecamActive = false;
let savedCameraState = null;
let debugOverlayElement = null;
let debugOverlayInterval = null;
let debugOverlayLastText = '';
let _gamepadCursorEl = null;
let _gamepadCursorVisible = false;
let _gamepadCursorX = 0;
let _gamepadCursorY = 0;
let _gamepadClickLatched = false;

function _ensureGamepadCursor() {
  if (_gamepadCursorEl) return;
  _gamepadCursorEl = document.createElement('div');
  _gamepadCursorEl.id = 'gamepad-cursor';
  _gamepadCursorEl.style.cssText = [
    'position:fixed',
    'width:18px',
    'height:18px',
    'margin-left:-9px',
    'margin-top:-9px',
    'border:2px solid rgba(255,255,255,0.95)',
    'border-radius:50%',
    'box-shadow:0 0 12px rgba(255,255,255,0.45)',
    'pointer-events:none',
    'z-index:5000',
    'display:none',
    'background:rgba(255,255,255,0.15)',
  ].join(';');
  document.body.appendChild(_gamepadCursorEl);
}

function _getGamepadCursorTarget() {
  const el = document.elementFromPoint(_gamepadCursorX, _gamepadCursorY);
  if (!el) return null;
  return el.closest?.('button, [role="button"], input, select, textarea, a, .clickable, [data-clickable="true"]') || el;
}

export function updateGamepadCursor() {
  const pads = navigator.getGamepads?.() || [];
  const pad = pads.find(Boolean);
  if (!pad) {
    if (_gamepadCursorEl) _gamepadCursorEl.style.display = 'none';
    _gamepadCursorVisible = false;
    gameState.gamepadCursorActive = false;
    return;
  }

  _ensureGamepadCursor();
  const lx = pad.axes?.[0] ?? 0;
  const ly = pad.axes?.[1] ?? 0;
  const rx = pad.axes?.[2] ?? 0;
  const ry = pad.axes?.[3] ?? 0;
  const dpadLeft = !!pad.buttons?.[14]?.pressed;
  const dpadRight = !!pad.buttons?.[15]?.pressed;
  const dpadUp = !!pad.buttons?.[12]?.pressed;
  const dpadDown = !!pad.buttons?.[13]?.pressed;
  const moveX = dpadLeft ? -1 : dpadRight ? 1 : lx;
  const moveY = dpadUp ? -1 : dpadDown ? 1 : ly;
  const aimX = Math.abs(rx) > 0.12 ? rx : moveX;
  const aimY = Math.abs(ry) > 0.12 ? ry : moveY;
  const activeMove = Math.hypot(moveX, moveY) > 0.12 || Math.hypot(aimX, aimY) > 0.12;

  if (activeMove || _gamepadCursorVisible) {
    _gamepadCursorVisible = true;
    gameState.gamepadCursorActive = true;
    if (!_gamepadCursorX) _gamepadCursorX = window.innerWidth / 2;
    if (!_gamepadCursorY) _gamepadCursorY = window.innerHeight / 2;
    _gamepadCursorX = Math.max(0, Math.min(window.innerWidth, _gamepadCursorX + (aimX || moveX) * 18));
    _gamepadCursorY = Math.max(0, Math.min(window.innerHeight, _gamepadCursorY + (aimY || moveY) * 18));

    const target = _getGamepadCursorTarget();
    if (target?.getBoundingClientRect) {
      const rect = target.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = cx - _gamepadCursorX;
      const dy = cy - _gamepadCursorY;
      const dist = Math.hypot(dx, dy);
      if (dist < 120) {
        const pull = (120 - dist) / 120 * 0.22;
        _gamepadCursorX += dx * pull;
        _gamepadCursorY += dy * pull;
      }
    }

    _gamepadCursorEl.style.left = `${_gamepadCursorX}px`;
    _gamepadCursorEl.style.top = `${_gamepadCursorY}px`;
    _gamepadCursorEl.style.display = 'block';

    const hoverTarget = _getGamepadCursorTarget();
    hoverTarget?.dispatchEvent?.(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: _gamepadCursorX,
      clientY: _gamepadCursorY,
    }));

    const clickPressed = !!pad.buttons?.[0]?.pressed || !!pad.buttons?.[2]?.pressed;
    if (clickPressed && !_gamepadClickLatched && hoverTarget) {
      hoverTarget.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: _gamepadCursorX,
        clientY: _gamepadCursorY,
      }));
      hoverTarget.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: _gamepadCursorX,
        clientY: _gamepadCursorY,
      }));
      hoverTarget.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: _gamepadCursorX,
        clientY: _gamepadCursorY,
      }));
      _gamepadClickLatched = true;
    } else if (!clickPressed) {
      _gamepadClickLatched = false;
    }
  } else if (_gamepadCursorEl) {
    _gamepadCursorEl.style.display = 'none';
    _gamepadCursorVisible = false;
    gameState.gamepadCursorActive = false;
  }
}

export function initInput() {
  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;

    gameState.keys[e.code] = true;
    
    // Handle Escape key to toggle pause menu (Keyboard Lock API captures it)
    if (e.code === 'Escape') {
      e.preventDefault();
      _pauseToggle();
      return;
    }

    // Handle F3 key to toggle debug overlay (Shift+F3 = pathfinding debug only)
    if (e.code === 'F3') {
      e.preventDefault();
      if (e.shiftKey) {
        togglePathDebug();
      } else {
        toggleDebugOverlay();
      }
    }
    
    // Handle F5 key to cycle camera mode
    if (e.code === 'F5') {
      e.preventDefault();
      toggleCameraMode();
    }
    
    // Handle F9 key to export scene
    if (e.code === 'F9') {
      e.preventDefault();
      exportScene();
      console.log('Exporting scene...');
    }
    
    // Handle C key to toggle freecam
    if (e.code === 'KeyC' && !isTyping) {
      e.preventDefault();
      toggleFreecam();
    }
    
    // // Handle C key to toggle screen calibration mode
    // if (e.code === 'KeyC' && gameState.isPaused) {
    //   gameState.isCalibrating = !gameState.isCalibrating;
    //   if (gameState.isCalibrating) {
    //     gameState.calibrationCorner1 = null;
    //     gameState.calibrationCorner2 = null;
    //     console.log('CALIBRATION MODE: Click first corner of TV screen');
    //   } else {
    //     console.log('Calibration mode off');
    //   }
    // }
    
  });
  document.addEventListener('keyup', (e) => { gameState.keys[e.code] = false; });
}

function toggleDebugOverlay() {
  debugOverlayVisible = !debugOverlayVisible;
  
  // Toggle debug mode for hitboxes and helpers
  gameState.debugMode = debugOverlayVisible;
  gameState.debugFogWireframe = debugOverlayVisible;
  
  // Toggle all debug helpers
  if (gameState.hitboxHelper) {
    gameState.hitboxHelper.visible = gameState.debugMode;
  }
  if (gameState.hitboxes && gameState.hitboxes.length > 0) {
    gameState.hitboxes.forEach(hitbox => {
      hitbox.visible = gameState.debugMode;
    });
  }
  if (gameState.directionalLightHelper) {
    gameState.directionalLightHelper.visible = gameState.debugMode;
  }
  if (gameState.shadowCameraHelper) {
    gameState.shadowCameraHelper.visible = gameState.debugMode;
  }
  
  if (debugOverlayVisible && !debugOverlayElement) {
    debugOverlayElement = document.createElement('div');
    debugOverlayElement.id = 'debug-overlay';
    debugOverlayElement.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      font-family: monospace;
      font-size: 14px;
      padding: 10px;
      border-radius: 5px;
      z-index: 2000;
      pointer-events: none;
      white-space: pre;
      contain: layout style paint;
    `;
    document.body.appendChild(debugOverlayElement);
    updateDebugInfo();
    debugOverlayInterval = setInterval(updateDebugInfo, 200);
  } else if (!debugOverlayVisible && debugOverlayElement) {
    if (debugOverlayInterval) {
      clearInterval(debugOverlayInterval);
      debugOverlayInterval = null;
    }
    debugOverlayLastText = '';
    debugOverlayElement.remove();
    debugOverlayElement = null;
  }
}

function updateDebugInfo() {
  if (!debugOverlayVisible || !debugOverlayElement || !gameState.camera) return;

  const cam = gameState.camera;
  const pos = cam.position;
  const rot = cam.rotation;
  const fps = gameState.stats ? gameState.stats.fps : 0;
  const nextText =
    `FPS: ${fps}\n` +
    `Pos: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}\n` +
    `Rot: ${(rot.x * 180 / Math.PI).toFixed(1)}°, ${(rot.y * 180 / Math.PI).toFixed(1)}°\n` +
    `Freecam: ${freecamActive ? 'ON' : 'OFF'}\n` +
    `Platform: ${platformConfig.platform} (${platformConfig.isMobile ? 'mobile' : 'desktop'})`;

  if (nextText !== debugOverlayLastText) {
    debugOverlayElement.textContent = nextText;
    debugOverlayLastText = nextText;
  }
}

function toggleFreecam() {
  freecamActive = !freecamActive;
  
  if (freecamActive) {
    // Don't save camera state anymore - we'll move the camera freely
  } else {
  }
}

function toggleCameraMode() {
  gameState.cameraMode = (gameState.cameraMode + 1) % 3;
  const isThirdPerson = gameState.cameraMode !== 0;
  if (isThirdPerson) {
    gameState.camera.layers.enable(1);
  } else {
    gameState.camera.layers.disable(1);
  }
  if (gameState.player) {
    gameState.player.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.transparent = !isThirdPerson;
        child.material.opacity = isThirdPerson ? 1 : 0;
        child.material.needsUpdate = true;
      }
    });
  }
}

export function updateFreecam(delta) {
  if (!freecamActive) return;
  
  const speed = 10;
  const moveSpeed = speed * delta;
  
  // Get camera forward/right vectors
  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyQuaternion(gameState.camera.quaternion);
  forward.y = 0; // Keep movement horizontal for WASD
  forward.normalize();
  
  const right = new THREE.Vector3(1, 0, 0);
  right.applyQuaternion(gameState.camera.quaternion);
  right.y = 0;
  right.normalize();
  
  const up = new THREE.Vector3(0, 1, 0);
  
  // WASD movement
  if (gameState.keys['KeyW']) {
    gameState.camera.position.addScaledVector(forward, moveSpeed);
  }
  if (gameState.keys['KeyS']) {
    gameState.camera.position.addScaledVector(forward, -moveSpeed);
  }
  if (gameState.keys['KeyA']) {
    gameState.camera.position.addScaledVector(right, -moveSpeed);
  }
  if (gameState.keys['KeyD']) {
    gameState.camera.position.addScaledVector(right, moveSpeed);
  }
  
  // Vertical movement - Space up, Shift down
  if (gameState.keys['Space']) {
    gameState.camera.position.addScaledVector(up, moveSpeed);
  }
  if (gameState.keys['ShiftLeft']) {
    gameState.camera.position.addScaledVector(up, -moveSpeed);
  }
}

export function isFreecamActive() {
  return freecamActive;
}

// Export functions for mobile controls to use
export { toggleDebugOverlay, toggleFreecam, toggleCameraMode };

function togglePathDebug() {
  gameState.pathDebugMode = !gameState.pathDebugMode;
  if (!gameState.pathDebugMode && gameState.pathDebugVisualizers) {
    for (const obj of gameState.pathDebugVisualizers) {
      gameState.scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
    gameState.pathDebugVisualizers = [];
  }
}

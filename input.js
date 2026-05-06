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

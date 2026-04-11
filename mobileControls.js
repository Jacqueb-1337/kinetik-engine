// mobileControls.js - On-screen touch controls for mobile platforms
import * as THREE from 'three';
import { gameState } from './globals.js';
import { platformConfig } from './platform.js';
import { toggleDebugOverlay, toggleFreecam, toggleCameraMode } from './input.js';
import { readSetting, writeSetting } from './settings.js';

let _pauseToggle = () => {};
export function setPauseToggleCallback(fn) { _pauseToggle = fn; }

const HUD_SETTINGS_KEY = 'hud_config';

function _migrateLayout(layout) {
  for (const k of Object.keys(layout)) {
    if (layout[k].opacity === undefined) layout[k].opacity = 1.0;
  }
  return layout;
}

function _initHudConfigDefaults() {
  if (!gameState.hudConfig) {
    gameState.hudConfig = { autoRunLock: true, layout: getDefaultLayout() };
  }
}

export async function loadHudConfig() {
  try {
    const stored = await readSetting(HUD_SETTINGS_KEY);
    if (stored) {
      gameState.hudConfig = stored;
      if (!gameState.hudConfig.layout) gameState.hudConfig.layout = getDefaultLayout();
      _migrateLayout(gameState.hudConfig.layout);
      applyLayout();
      return;
    }
  } catch (e) {
    console.warn('[mobileControls] loadHudConfig failed:', e);
  }
  gameState.hudConfig = { autoRunLock: true, layout: getDefaultLayout() };
}

function getDefaultLayout() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return {
    sprint:   { x: W - 110, y: H - 190, size: 70, opacity: 1.0 },
    jump:     { x: W - 110, y: H - 280, size: 70, opacity: 1.0 },
    interact: { x: W - 110, y: H - 370, size: 70, opacity: 1.0 },
    pause:    { x: W - 70,  y: 20,      size: 50, opacity: 1.0 },
  };
}

function saveHudConfig() {
  writeSetting(HUD_SETTINGS_KEY, gameState.hudConfig).catch(e => {
    console.warn('[mobileControls] saveHudConfig failed:', e);
  });
}

function applyLayout() {
  const layout = gameState.hudConfig.layout;
  for (const [key, cfg] of Object.entries(layout)) {
    const el = touchState[key + 'Button'];
    if (!el) continue;
    el.style.left = cfg.x + 'px';
    el.style.top = cfg.y + 'px';
    el.style.width = cfg.size + 'px';
    el.style.height = cfg.size + 'px';
    el.style.right = '';
    el.style.bottom = '';
    el.style.opacity = (cfg.opacity ?? 1.0).toString();
  }
}

const touchState = {
  joystickActive: false,
  joystickOrigin: { x: 0, y: 0 },
  joystickCurrent: { x: 0, y: 0 },
  joystickTouchId: null,
  
  sprintLocked: false,
  autoRunActive: false,
  
  // Camera rotation
  cameraTouchId: null,
  lastCameraX: 0,
  lastCameraY: 0,
  
  // Joystick configuration
  joystickMaxRadius: 55,    // Walk zone radius
  joystickDeadzone: 10,     // Center deadzone
  autoRunOvershoot: 45,      // Pixels above joystick top edge to arm run-lock
  
  // Visual elements
  joystickBase: null,
  joystickThumb: null,
  sprintButton: null,
  jumpButton: null,
  interactButton: null,
  pauseButton: null,
  f3Button: null,
  f5Button: null,
  camButton: null,
  
  // Freecam state
  freecamActive: false,
  savedCameraState: null,
  
  // Touch tracking
  activeTouches: new Map()
};

export function initMobileControls() {
  if (!platformConfig.needsOnScreenControls) {
    console.log('Skipping mobile controls - not a mobile platform');
    return;
  }
  
  console.log('Initializing mobile on-screen controls');
  
  _initHudConfigDefaults();
  createControlElements();
  setupTouchHandlers();
}

function createControlElements() {
  const container = document.createElement('div');
  container.id = 'mobile-controls';
  container.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1000;
  `;
  document.body.appendChild(container);

  const joystickBase = document.createElement('div');
  joystickBase.id = 'joystick-base';
  joystickBase.style.cssText = `
    position: absolute;
    width: ${touchState.joystickMaxRadius * 2}px;
    height: ${touchState.joystickMaxRadius * 2}px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    background: rgba(20,20,20,0.35);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.4);
    pointer-events: none;
    display: none;
    transform: translate(-50%, -50%);
  `;
  container.appendChild(joystickBase);
  touchState.joystickBase = joystickBase;

  const joystickThumb = document.createElement('div');
  joystickThumb.id = 'joystick-thumb';
  joystickThumb.style.cssText = `
    position: absolute;
    width: 44px;
    height: 44px;
    background: radial-gradient(circle, rgba(80,80,80,0.9) 40%, rgba(30,30,30,0.95) 100%);
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.5);
    pointer-events: none;
    display: none;
    transform: translate(-50%, -50%);
    transition: background 0.08s;
  `;
  container.appendChild(joystickThumb);
  touchState.joystickThumb = joystickThumb;

  const L = gameState.hudConfig.layout;

  function makeHudButton(id, key, extraCss, innerHTML) {
    const btn = document.createElement('div');
    btn.id = id;
    btn.style.cssText = `
      position: absolute;
      left: ${L[key].x}px;
      top: ${L[key].y}px;
      width: ${L[key].size}px;
      height: ${L[key].size}px;
      opacity: ${L[key].opacity ?? 1};
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      user-select: none;
      ${extraCss}
    `;
    btn.innerHTML = innerHTML;
    container.appendChild(btn);
    touchState[key + 'Button'] = btn;
    return btn;
  }

  const btnBase = `
    border-radius: 50%;
    background: radial-gradient(circle, rgba(40,40,40,0.85) 60%, rgba(20,20,20,0.95) 100%);
    border: 1px solid rgba(200,200,200,0.3);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08);
    transition: border 0.08s, box-shadow 0.08s, background 0.08s;
  `;

  const svgRun = `<img src="./textures/run.png" style="width:55%;height:55%;object-fit:contain;pointer-events:none;">`;

  const svgJump = `<svg viewBox="0 0 32 32" width="52%" height="52%" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 26V8" stroke="rgba(255,255,255,0.9)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M8 16l8-10 8 10" stroke="rgba(255,255,255,0.9)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>
  <span style="color:rgba(255,255,255,0.6);font-size:9px;font-family:sans-serif;letter-spacing:0.5px;margin-top:1px;">JUMP</span>`;

  const svgInteract = `<img src="./textures/interact.png" style="width:55%;height:55%;object-fit:contain;pointer-events:none;">`;

  makeHudButton('sprint-button', 'sprint', btnBase, svgRun);

  makeHudButton('pause-button', 'pause', `
    border-radius: 10px;
    background: radial-gradient(circle, rgba(40,40,40,0.85) 60%, rgba(20,20,20,0.95) 100%);
    border: 1px solid rgba(200,200,200,0.3);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08);
  `, `<svg viewBox="0 0 24 24" width="44%" height="44%" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="4" width="4" height="16" rx="1" fill="rgba(255,255,255,0.85)"/>
    <rect x="15" y="4" width="4" height="16" rx="1" fill="rgba(255,255,255,0.85)"/>
  </svg>`);

  makeHudButton('jump-button', 'jump', btnBase, svgJump);

  makeHudButton('interact-button', 'interact', btnBase + `transition: border 0.15s, box-shadow 0.15s, background 0.15s;`, svgInteract);

  function makeDebugButton(id, right, top, bg, label) {
    const btn = document.createElement('div');
    btn.id = id;
    btn.style.cssText = `
      position: absolute;
      top: ${top}px;
      right: ${right}px;
      width: 44px;
      height: 44px;
      background: rgba(20, 20, 20, 0.75);
      border: 2px solid rgba(200, 200, 200, 0.3);
      border-radius: 8px;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-family: sans-serif;
      color: rgba(255,255,255,0.7);
      font-weight: bold;
      user-select: none;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.4);
    `;
    btn.innerHTML = label;
    container.appendChild(btn);
    return btn;
  }

  touchState.f3Button  = makeDebugButton('f3-button',  80,  20, 'rgba(80, 80, 200, 0.6)',  'F3');
  touchState.camButton = makeDebugButton('cam-button', 140, 20, 'rgba(100, 200, 100, 0.6)', 'CAM');
  touchState.f5Button  = makeDebugButton('f5-button',  200, 20, 'rgba(200, 80, 80, 0.6)',   'F5');
}

function setupTouchHandlers() {
  const canvas = gameState.renderer.domElement;
  
  // Touch start
  canvas.addEventListener('touchstart', (e) => {
    if (hudEditorActive || gameState.isPaused) { e.preventDefault(); return; }
    
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const x = touch.clientX;
      const y = touch.clientY;
      
      // Check if touching sprint button
      const sprintRect = touchState.sprintButton.getBoundingClientRect();
      const touchingSprint = (
        x >= sprintRect.left && x <= sprintRect.right &&
        y >= sprintRect.top && y <= sprintRect.bottom
      );
      
      if (touchingSprint) {
        handleSprintButtonTouch(touch.identifier);
        continue;
      }
      
      // Left half of screen = joystick
      if (x < window.innerWidth / 2 && !touchState.joystickActive) {
        startJoystick(touch.identifier, x, y);
      }
      // Right half of screen = camera rotation
      else if (x >= window.innerWidth / 2 && !touchState.cameraTouchId) {
        startCameraRotation(touch.identifier, x, y);
      }
    }
    
    e.preventDefault();
  }, { passive: false });
  
  // Touch move
  canvas.addEventListener('touchmove', (e) => {
    if (hudEditorActive || gameState.isPaused) { e.preventDefault(); return; }
    
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      
      if (touch.identifier === touchState.joystickTouchId) {
        updateJoystick(touch.clientX, touch.clientY);
      } else if (touch.identifier === touchState.cameraTouchId) {
        updateCameraRotation(touch.clientX, touch.clientY);
      }
    }
    
    e.preventDefault();
  }, { passive: false });
  
  // Touch end
  canvas.addEventListener('touchend', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      
      if (touch.identifier === touchState.joystickTouchId) {
        endJoystick(touch.clientX, touch.clientY);
      } else if (touch.identifier === touchState.cameraTouchId) {
        endCameraRotation();
      }
    }
  });
  
  // Sprint button specific handlers
  touchState.sprintButton.addEventListener('touchstart', (e) => {
    if (gameState.isPaused || hudEditorActive) return;
    e.preventDefault();
    e.stopPropagation();
    handleSprintButtonTouch(e.touches[0].identifier);
  });
  
  // Pause button handler
  touchState.pauseButton.addEventListener('touchstart', (e) => {
    if (hudEditorActive) return;
    e.preventDefault();
    e.stopPropagation();
    _pauseToggle();
  });
  
  // F3 debug button handler
  touchState.f3Button.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDebugOverlay();
  });
  
  // Camera toggle button handler
  touchState.camButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFreecam();
  });
  
  // F5 camera mode toggle button handler
  touchState.f5Button.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCameraMode();
  });

  touchState.jumpButton.addEventListener('touchstart', (e) => {
    if (gameState.isPaused || hudEditorActive) return;
    e.preventDefault();
    e.stopPropagation();
    gameState.keys['Space'] = true;
  });
  touchState.jumpButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    gameState.keys['Space'] = false;
  });

  touchState.interactButton.addEventListener('touchstart', (e) => {
    if (gameState.isPaused || hudEditorActive) return;
    e.preventDefault();
    e.stopPropagation();
    gameState.mobileInteractPending = true;
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: false, button: 2 }));
  });
}

function startJoystick(touchId, x, y) {
  if (touchState.autoRunActive) {
    deactivateAutoRun();
    touchState.joystickActive = true;
    touchState.joystickTouchId = touchId;
    touchState.joystickOrigin = { x, y };
    touchState.joystickCurrent = { x, y };
    touchState.joystickBase.style.left = x + 'px';
    touchState.joystickBase.style.top = y + 'px';
    touchState.joystickBase.style.display = 'block';
    touchState.joystickThumb.style.left = x + 'px';
    touchState.joystickThumb.style.top = y + 'px';
    touchState.joystickThumb.style.display = 'block';
    return;
  }
  touchState.joystickActive = true;
  touchState.joystickTouchId = touchId;
  touchState.joystickOrigin = { x, y };
  touchState.joystickCurrent = { x, y };
  
  // Show joystick at touch position
  touchState.joystickBase.style.left = x + 'px';
  touchState.joystickBase.style.top = y + 'px';
  touchState.joystickBase.style.display = 'block';
  
  touchState.joystickThumb.style.left = x + 'px';
  touchState.joystickThumb.style.top = y + 'px';
  touchState.joystickThumb.style.display = 'block';
}

function updateJoystick(x, y) {
  const dx = x - touchState.joystickOrigin.x;
  const dy = y - touchState.joystickOrigin.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  
  touchState.joystickCurrent = { x, y };

  // If auto-run active and moved back into walk zone, deactivate
  if (touchState.autoRunActive && distance < touchState.joystickMaxRadius * 0.8) {
    deactivateAutoRun();
  }

  // Clamp thumb to max radius (unless auto-run)
  let thumbX = x;
  let thumbY = y;

  if (!touchState.autoRunActive && distance > touchState.joystickMaxRadius) {
    thumbX = touchState.joystickOrigin.x + Math.cos(angle) * touchState.joystickMaxRadius;
    thumbY = touchState.joystickOrigin.y + Math.sin(angle) * touchState.joystickMaxRadius;
  }

  // Update visual thumb position
  touchState.joystickThumb.style.left = thumbX + 'px';
  touchState.joystickThumb.style.top = thumbY + 'px';

  // Run-zone indicator: finger is above the top edge of the base circle
  const runArmed = !touchState.autoRunActive
    && gameState.hudConfig?.autoRunLock !== false
    && (touchState.joystickOrigin.y - y) > (touchState.joystickMaxRadius + touchState.autoRunOvershoot);

  // Update thumb color based on state
  if (touchState.autoRunActive || touchState.sprintLocked) {
    touchState.joystickThumb.style.background = 'rgba(255, 100, 100, 0.7)';
  } else if (runArmed) {
    touchState.joystickThumb.style.background = 'rgba(255, 160, 40, 0.85)';
  } else {
    touchState.joystickThumb.style.background = 'rgba(255, 255, 255, 0.5)';
  }
  
  // Convert to game input
  updateGameInput(dx, dy, distance);
}

function endJoystick(x, y) {
  const dx = x - touchState.joystickOrigin.x;
  const dy = y - touchState.joystickOrigin.y;

  // Lock run if finger released above the top edge by the overshoot threshold
  const runArmed = !touchState.autoRunActive
    && gameState.hudConfig?.autoRunLock !== false
    && (touchState.joystickOrigin.y - y) > (touchState.joystickMaxRadius + touchState.autoRunOvershoot);

  if (runArmed) {
    activateAutoRun();
    touchState.joystickTouchId = null;
    touchState.joystickActive = false;
    return;
  }
  
  // Normal release - deactivate everything if not auto-running
  if (!touchState.autoRunActive) {
    touchState.joystickActive = false;
    touchState.joystickTouchId = null;
    touchState.joystickBase.style.display = 'none';
    touchState.joystickThumb.style.display = 'none';
    touchState.sprintLocked = false;
    updateSprintButtonVisual();
    
    // Clear movement input
    gameState.keys['KeyW'] = false;
    gameState.keys['KeyA'] = false;
    gameState.keys['KeyS'] = false;
    gameState.keys['KeyD'] = false;
    gameState.keys['ShiftLeft'] = false;
  } else {
    // Auto-run is active, joystick released but stays locked
    touchState.joystickTouchId = null;
  }
}

function handleSprintButtonTouch(touchId) {
  if (touchState.autoRunActive) {
    // Deactivate auto-run
    deactivateAutoRun();
  } else {
    // Toggle sprint lock
    touchState.sprintLocked = !touchState.sprintLocked;
    updateSprintButtonVisual();
  }
}

function activateAutoRun() {
  touchState.autoRunActive = true;
  touchState.sprintLocked = true;
  
  // Lock joystick thumb in forward position
  const thumbY = touchState.joystickOrigin.y - touchState.joystickMaxRadius;
  touchState.joystickThumb.style.top = thumbY + 'px';
  touchState.joystickThumb.style.left = touchState.joystickOrigin.x + 'px';
  touchState.joystickThumb.style.background = 'rgba(255, 100, 100, 0.7)';
  
  updateSprintButtonVisual();
  
  // Set forward sprint input
  gameState.keys['KeyW'] = true;
  gameState.keys['ShiftLeft'] = true;
  gameState.keys['KeyA'] = false;
  gameState.keys['KeyS'] = false;
  gameState.keys['KeyD'] = false;
  
  console.log('Auto-run activated');
}

function deactivateAutoRun() {
  touchState.autoRunActive = false;
  touchState.sprintLocked = false;
  
  // If joystick not being touched, hide it
  if (touchState.joystickTouchId === null) {
    touchState.joystickActive = false;
    touchState.joystickBase.style.display = 'none';
    touchState.joystickThumb.style.display = 'none';
    
    gameState.keys['KeyW'] = false;
    gameState.keys['KeyA'] = false;
    gameState.keys['KeyS'] = false;
    gameState.keys['KeyD'] = false;
    gameState.keys['ShiftLeft'] = false;
  }
  
  updateSprintButtonVisual();
  console.log('Auto-run deactivated');
}

function updateSprintButtonVisual() {
  if (touchState.sprintLocked || touchState.autoRunActive) {
    touchState.sprintButton.style.background = 'rgba(255, 50, 50, 0.8)';
    touchState.sprintButton.style.borderColor = 'rgba(255, 50, 50, 1)';
    touchState.sprintButton.style.transform = 'scale(1.1)';
  } else {
    touchState.sprintButton.style.background = 'rgba(255, 100, 100, 0.4)';
    touchState.sprintButton.style.borderColor = 'rgba(255, 100, 100, 0.8)';
    touchState.sprintButton.style.transform = 'scale(1.0)';
  }
}

function updateGameInput(dx, dy, distance) {
  // Disable player movement when freecam is active
  if (touchState.freecamActive) {
    gameState.keys['KeyW'] = false;
    gameState.keys['KeyA'] = false;
    gameState.keys['KeyS'] = false;
    gameState.keys['KeyD'] = false;
    gameState.keys['ShiftLeft'] = false;
    return;
  }
  
  // Convert joystick to WASD
  const normalizedX = dx / touchState.joystickMaxRadius;
  const normalizedY = dy / touchState.joystickMaxRadius;
  
  // Deadzone
  if (distance < touchState.joystickDeadzone) {
    gameState.keys['KeyW'] = false;
    gameState.keys['KeyA'] = false;
    gameState.keys['KeyS'] = false;
    gameState.keys['KeyD'] = false;
    return;
  }
  
  // Map to WASD (Y negative = forward/W, X negative = left/A)
  gameState.keys['KeyW'] = normalizedY < -0.3;
  gameState.keys['KeyS'] = normalizedY > 0.3;
  gameState.keys['KeyA'] = normalizedX < -0.3;
  gameState.keys['KeyD'] = normalizedX > 0.3;
  
  // Sprint only when explicitly locked
  gameState.keys['ShiftLeft'] = touchState.sprintLocked;
}

function startCameraRotation(touchId, x, y) {
  touchState.cameraTouchId = touchId;
  touchState.lastCameraX = x;
  touchState.lastCameraY = y;
}

function updateCameraRotation(x, y) {
  const deltaX = x - touchState.lastCameraX;
  const deltaY = y - touchState.lastCameraY;
  
  const sensitivity = gameState.mouseSensitivity || 1.0;
  gameState.cameraAngle -= deltaX * 0.003 * sensitivity;
  
  // Invert vertical controls in front-facing third person
  const pitchMultiplier = gameState.cameraMode === 2 ? 1 : -1;
  gameState.cameraPitch += deltaY * 0.003 * pitchMultiplier * sensitivity;
  gameState.cameraPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, gameState.cameraPitch));
  
  touchState.lastCameraX = x;
  touchState.lastCameraY = y;
}

function endCameraRotation() {
  touchState.cameraTouchId = null;
}

export function updateMobileControls() {
  if (!platformConfig.needsOnScreenControls) return;
  
  if (touchState.autoRunActive) {
    gameState.keys['KeyW'] = true;
    gameState.keys['ShiftLeft'] = true;
  }

  if (touchState.interactButton) {
    const svgs = touchState.interactButton.querySelectorAll('svg *');
    const label = touchState.interactButton.querySelector('span');
    const userOpacity = gameState.hudConfig?.layout?.interact?.opacity ?? 1.0;
    const lit = !!(gameState.interactTarget || hudEditorActive);
    touchState.interactButton.style.opacity = lit ? userOpacity.toString() : (userOpacity * 0.35).toString();
    if (lit) {
      touchState.interactButton.style.border = '1px solid rgba(255,220,80,0.8)';
      touchState.interactButton.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 8px rgba(255,220,80,0.4)';
      svgs.forEach(el => { el.setAttribute('stroke', 'rgba(255,220,80,1)'); });
      if (label) label.style.color = 'rgba(255,220,80,0.9)';
    } else {
      touchState.interactButton.style.border = '1px solid rgba(200,200,200,0.3)';
      touchState.interactButton.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)';
      svgs.forEach(el => { el.setAttribute('stroke', 'rgba(255,255,255,0.45)'); });
      if (label) label.style.color = 'rgba(255,255,255,0.25)';
    }
  }
}

// Export touch state for debugging
export { touchState };

// Note: isFreecamActive is now imported from input.js
export function isFreecamActive() {
  return false;
}

let hudEditorActive = false;
let editorTouchId = null;
let editorTarget = null;
let editorOverlay = null;
let editorSelectedKey = null;
let editorOpacityPanel = null;

export function startHudEditor() {
  hudEditorActive = true;
  gameState.hudEditorActive = true;

  for (const key of ['sprint', 'jump', 'interact', 'pause']) {
    const el = touchState[key + 'Button'];
    if (!el) continue;
    el.style.outline = '2px dashed rgba(255,255,255,0.7)';
    const handle = document.createElement('div');
    handle.className = 'hud-resize-handle';
    handle.style.cssText = `
      position: absolute;
      bottom: 2px;
      right: 2px;
      width: 18px;
      height: 18px;
      background: rgba(255,255,255,0.85);
      border-radius: 3px;
      pointer-events: none;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #333;
    `;
    handle.innerHTML = '\u21d8';
    el.appendChild(handle);
  }

  if (touchState.interactButton) {
    const _svgs = touchState.interactButton.querySelectorAll('svg *');
    const _lbl = touchState.interactButton.querySelector('span');
    const _op = gameState.hudConfig?.layout?.interact?.opacity ?? 1.0;
    touchState.interactButton.style.opacity = _op.toString();
    touchState.interactButton.style.border = '1px solid rgba(255,220,80,0.8)';
    touchState.interactButton.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 8px rgba(255,220,80,0.4)';
    _svgs.forEach(e => { e.setAttribute('stroke', 'rgba(255,220,80,1)'); });
    if (_lbl) _lbl.style.color = 'rgba(255,220,80,0.9)';
  }

  editorOverlay = document.createElement('div');
  editorOverlay.id = 'hud-editor-overlay';
  editorOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    pointer-events: none;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
    gap: 8px;
  `;

  const label = document.createElement('div');
  label.textContent = 'HUD EDITOR \u2014 drag to move, drag corner to resize';
  label.style.cssText = `
    color: white;
    font-size: 13px;
    background: rgba(0,0,0,0.65);
    padding: 5px 12px;
    border-radius: 6px;
    pointer-events: none;
    text-align: center;
  `;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = `display: flex; gap: 14px; pointer-events: auto;`;

  function makeEditorBtn(text, bg, fn) {
    const b = document.createElement('div');
    b.textContent = text;
    b.style.cssText = `
      padding: 10px 26px;
      font-size: 17px;
      font-weight: bold;
      background: ${bg};
      color: white;
      border: 2px solid rgba(255,255,255,0.8);
      border-radius: 8px;
      user-select: none;
    `;
    b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    return b;
  }

  btnRow.appendChild(makeEditorBtn('Reset', 'rgba(180,60,60,0.9)', () => {
    hideOpacityPanel();
    gameState.hudConfig.layout = getDefaultLayout();
    applyLayout();
    saveHudConfig();
  }));
  btnRow.appendChild(makeEditorBtn('Done', 'rgba(60,180,60,0.9)', stopHudEditor));

  editorOverlay.appendChild(label);
  editorOverlay.appendChild(btnRow);
  document.body.appendChild(editorOverlay);

  document.addEventListener('touchstart', editorTouchStart, { passive: false });
  document.addEventListener('touchmove',  editorTouchMove,  { passive: false });
  document.addEventListener('touchend',   editorTouchEnd);
}

function stopHudEditor() {
  hideOpacityPanel();
  hudEditorActive = false;
  gameState.hudEditorActive = false;

  for (const key of ['sprint', 'jump', 'interact', 'pause']) {
    const el = touchState[key + 'Button'];
    if (!el) continue;
    el.style.outline = '';
    el.querySelectorAll('.hud-resize-handle').forEach(h => h.remove());
  }

  if (editorOverlay) { editorOverlay.remove(); editorOverlay = null; }
  saveHudConfig();

  if (touchState.interactButton) {
    const _svgs = touchState.interactButton.querySelectorAll('svg *');
    const _lbl = touchState.interactButton.querySelector('span');
    const _op = gameState.hudConfig?.layout?.interact?.opacity ?? 1.0;
    const _lit = !!gameState.interactTarget;
    touchState.interactButton.style.opacity = _lit ? _op.toString() : (_op * 0.35).toString();
    touchState.interactButton.style.border = _lit ? '1px solid rgba(255,220,80,0.8)' : '1px solid rgba(200,200,200,0.3)';
    _svgs.forEach(e => { e.setAttribute('stroke', _lit ? 'rgba(255,220,80,1)' : 'rgba(255,255,255,0.45)'); });
    if (_lbl) _lbl.style.color = _lit ? 'rgba(255,220,80,0.9)' : 'rgba(255,255,255,0.25)';
  }

  document.removeEventListener('touchstart', editorTouchStart);
  document.removeEventListener('touchmove',  editorTouchMove);
  document.removeEventListener('touchend',   editorTouchEnd);
}

function editorTouchStart(e) {
  if (editorTarget) return;
  const touch = e.changedTouches[0];
  const x = touch.clientX, y = touch.clientY;
  if (editorOpacityPanel) {
    const r = editorOpacityPanel.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return;
  }
  for (const key of ['sprint', 'jump', 'interact', 'pause']) {
    const el = touchState[key + 'Button'];
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      e.preventDefault();
      e.stopPropagation();
      editorTouchId = touch.identifier;
      const isResize = (x > rect.right - 22 && y > rect.bottom - 22);
      editorTarget = {
        key, el,
        startX: x, startY: y,
        startBtnX: gameState.hudConfig.layout[key].x,
        startBtnY: gameState.hudConfig.layout[key].y,
        startSize: gameState.hudConfig.layout[key].size,
        resizing: isResize
      };
      return;
    }
  }
  if (editorOpacityPanel) hideOpacityPanel();
}

function editorTouchMove(e) {
  if (!editorTarget) return;
  e.preventDefault();
  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    if (touch.identifier !== editorTouchId) continue;
    const dx = touch.clientX - editorTarget.startX;
    const dy = touch.clientY - editorTarget.startY;
    const cfg = gameState.hudConfig.layout[editorTarget.key];
    if (editorTarget.resizing) {
      cfg.size = Math.max(44, editorTarget.startSize + Math.max(dx, dy));
      editorTarget.el.style.width  = cfg.size + 'px';
      editorTarget.el.style.height = cfg.size + 'px';
    } else {
      cfg.x = editorTarget.startBtnX + dx;
      cfg.y = editorTarget.startBtnY + dy;
      editorTarget.el.style.left = cfg.x + 'px';
      editorTarget.el.style.top  = cfg.y + 'px';
    }
    break;
  }
}

function editorTouchEnd(e) {
  if (editorTarget) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== editorTouchId) continue;
      const dx = Math.abs(t.clientX - editorTarget.startX);
      const dy = Math.abs(t.clientY - editorTarget.startY);
      if (dx < 10 && dy < 10 && !editorTarget.resizing) selectButton(editorTarget.key);
      break;
    }
  }
  editorTarget = null;
  editorTouchId = null;
}

function selectButton(key) {
  if (editorSelectedKey === key) {
    hideOpacityPanel();
  } else {
    showOpacityPanel(key);
  }
}

function hideOpacityPanel() {
  if (editorOpacityPanel) { editorOpacityPanel.remove(); editorOpacityPanel = null; }
  if (editorSelectedKey) {
    const el = touchState[editorSelectedKey + 'Button'];
    if (el) el.style.outline = '2px dashed rgba(255,255,255,0.7)';
    editorSelectedKey = null;
  }
}

function showOpacityPanel(key) {
  hideOpacityPanel();
  editorSelectedKey = key;
  const el = touchState[key + 'Button'];
  if (el) el.style.outline = '2px dashed rgba(255,220,80,0.9)';
  const cfg = gameState.hudConfig.layout[key];

  const panel = document.createElement('div');
  panel.id = 'hud-opacity-panel';
  panel.style.cssText = `
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(10,10,10,0.88);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 10px;
    padding: 12px 24px;
    z-index: 2100;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    min-width: 280px;
  `;

  const title = document.createElement('div');
  title.textContent = key.toUpperCase() + ' OPACITY';
  title.style.cssText = `color: rgba(255,220,80,0.9); font-size: 11px; font-family: sans-serif; font-weight: bold; letter-spacing: 1.5px;`;

  const sliderRow = document.createElement('div');
  sliderRow.style.cssText = `display: flex; align-items: center; gap: 12px; width: 100%;`;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '15';
  slider.max = '100';
  slider.value = Math.round((cfg.opacity ?? 1.0) * 100);
  slider.style.cssText = `flex: 1; accent-color: rgba(255,220,80,1); height: 20px; cursor: pointer;`;

  const pct = document.createElement('span');
  pct.textContent = slider.value + '%';
  pct.style.cssText = `color: white; font-size: 14px; font-family: sans-serif; min-width: 40px; text-align: right;`;

  slider.addEventListener('input', () => {
    const val = parseInt(slider.value) / 100;
    cfg.opacity = val;
    pct.textContent = slider.value + '%';
    if (el) el.style.opacity = val.toString();
  });

  sliderRow.appendChild(slider);
  sliderRow.appendChild(pct);
  panel.appendChild(title);
  panel.appendChild(sliderRow);
  document.body.appendChild(panel);
  editorOpacityPanel = panel;
}

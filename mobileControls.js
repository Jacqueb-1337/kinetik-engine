// mobileControls.js - On-screen touch controls for mobile platforms
import * as THREE from 'three';
import { gameState } from './globals.js';
import { platformConfig } from './platform.js';
import { toggleDebugOverlay, toggleFreecam, toggleCameraMode } from './input.js';
import { readSetting, writeSetting } from './settings.js';

const gameHooks = globalThis.__kinetikGameHooks ?? (globalThis.__kinetikGameHooks = {});
const getZombiesHudEditorElements = () => gameHooks.getZombiesHudEditorElements?.() ?? [];
const applyZombiesHudLayout = (layout) => { gameHooks.applyZombiesHudLayout?.(layout); };
const mobileFireDown = () => { gameHooks.mobileFireDown?.(); };
const mobileFireUp = () => { gameHooks.mobileFireUp?.(); };
const mobileReload = () => { gameHooks.mobileReload?.(); };
const mobileSwitchWeapon = () => { gameHooks.mobileSwitchWeapon?.(); };

let _pauseToggle = () => {};
export function setPauseToggleCallback(fn) { _pauseToggle = fn; }

const HUD_SETTINGS_KEY = 'hud_config';
const CORE_HUD_KEYS = ['fire', 'reload', 'swap', 'sprint', 'jump', 'interact', 'pause', 'f3', 'cam', 'f5'];

function _ensureZombiesLayoutDefaults(layout) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (!layout['zom-hp-wrap'])    layout['zom-hp-wrap'] = { x: 24, y: Math.max(20, H - 92), size: 70, opacity: 1.0 };
  if (!layout['zom-round'])      layout['zom-round'] = { x: Math.max(20, (W * 0.5) - 140), y: 18, size: 120, opacity: 1.0 };
  if (!layout['zom-count'])      layout['zom-count'] = { x: Math.max(20, W - 220), y: 18, size: 120, opacity: 1.0 };
  if (!layout['zom-points'])     layout['zom-points'] = { x: 24, y: Math.max(20, H - 76), size: 90, opacity: 1.0 };
  if (!layout['zom-perks'])      layout['zom-perks'] = { x: Math.max(20, W - 80), y: Math.max(20, H - 130), size: 60, opacity: 1.0 };
  if (!layout['zom-pap'])        layout['zom-pap'] = { x: Math.max(20, W - 160), y: Math.max(20, H - 190), size: 70, opacity: 1.0 };
  if (!layout['zom-timer-wrap']) layout['zom-timer-wrap'] = { x: Math.max(20, (W * 0.5) - 160), y: Math.max(20, H - 8), size: 180, opacity: 1.0 };
  if (!layout['zom-slots'])      layout['zom-slots'] = { x: Math.max(20, W - 160), y: Math.max(20, H - 340), size: 90, opacity: 1.0 };
  if (!layout['zom-ammo'])       layout['zom-ammo'] = { x: Math.max(20, W - 170), y: Math.max(20, H - 250), size: 90, opacity: 1.0 };
}

function _migrateLayout(layout) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (!layout.fire)   layout.fire   = { x: W - 210, y: H - 280, size: 70, opacity: 1.0 };
  if (!layout.reload) layout.reload = { x: W - 210, y: H - 190, size: 70, opacity: 1.0 };
  if (!layout.swap)   layout.swap   = { x: W - 210, y: H - 370, size: 70, opacity: 1.0 };
  if (!layout.f3)  layout.f3  = { x: 20,  y: 20, size: 44, opacity: 1.0 };
  if (!layout.cam) layout.cam = { x: 74,  y: 20, size: 44, opacity: 1.0 };
  if (!layout.f5)  layout.f5  = { x: 128, y: 20, size: 44, opacity: 1.0 };
  _ensureZombiesLayoutDefaults(layout);
  for (const k of Object.keys(layout)) {
    if (layout[k].opacity === undefined) layout[k].opacity = 1.0;
  }
  return layout;
}

function _initHudConfigDefaults() {
  if (!gameState.hudConfig) {
    const layout = getDefaultLayout();
    _migrateLayout(layout);
    gameState.hudConfig = { autoRunLock: true, layout };
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
  const layout = getDefaultLayout();
  _migrateLayout(layout);
  gameState.hudConfig = { autoRunLock: true, layout };
}

function getDefaultLayout() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return {
    fire:     { x: W - 210, y: H - 280, size: 70, opacity: 1.0 },
    reload:   { x: W - 210, y: H - 190, size: 70, opacity: 1.0 },
    swap:     { x: W - 210, y: H - 370, size: 70, opacity: 1.0 },
    sprint:   { x: W - 110, y: H - 190, size: 70, opacity: 1.0 },
    jump:     { x: W - 110, y: H - 280, size: 70, opacity: 1.0 },
    interact: { x: W - 110, y: H - 370, size: 70, opacity: 1.0 },
    pause:    { x: W - 70,  y: 20,      size: 50, opacity: 1.0 },
    f3:       { x: 20,      y: 20,      size: 44, opacity: 1.0 },
    cam:      { x: 74,      y: 20,      size: 44, opacity: 1.0 },
    f5:       { x: 128,     y: 20,      size: 44, opacity: 1.0 },
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
  applyZombiesHudLayout(layout);
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
  fireButton: null,
  reloadButton: null,
  swapButton: null,
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

  const svgFire = `<svg viewBox="0 0 24 24" width="55%" height="55%" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 18L18 6" stroke="rgba(255,255,255,0.92)" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M11 6H18V13" stroke="rgba(255,255,255,0.92)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  const svgReload = `<svg viewBox="0 0 24 24" width="55%" height="55%" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="rgba(255,255,255,0.92)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M20 4v4h-4" stroke="rgba(255,255,255,0.92)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  const svgSwap = `<svg viewBox="0 0 24 24" width="55%" height="55%" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 8h13" stroke="rgba(255,255,255,0.92)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M14 5l3 3-3 3" stroke="rgba(255,255,255,0.92)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M20 16H7" stroke="rgba(255,255,255,0.92)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M10 13l-3 3 3 3" stroke="rgba(255,255,255,0.92)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  const svgJump = `<svg viewBox="0 0 32 32" width="52%" height="52%" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 26V8" stroke="rgba(255,255,255,0.9)" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M8 16l8-10 8 10" stroke="rgba(255,255,255,0.9)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>
  <span style="color:rgba(255,255,255,0.6);font-size:9px;font-family:sans-serif;letter-spacing:0.5px;margin-top:1px;">JUMP</span>`;

  const svgInteract = `<img src="./textures/interact.png" style="width:55%;height:55%;object-fit:contain;pointer-events:none;">`;

  makeHudButton('fire-button', 'fire', btnBase, svgFire);
  makeHudButton('reload-button', 'reload', btnBase, svgReload);
  makeHudButton('swap-button', 'swap', btnBase, svgSwap);

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

  function makeDebugButton(id, key, label) {
    const cfg = L[key];
    const btn = document.createElement('div');
    btn.id = id;
    btn.style.cssText = `
      position: absolute;
      top: ${cfg.y}px;
      left: ${cfg.x}px;
      width: ${cfg.size}px;
      height: ${cfg.size}px;
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
      opacity: ${cfg.opacity ?? 1};
    `;
    btn.innerHTML = label;
    container.appendChild(btn);
    touchState[key + 'Button'] = btn;
    return btn;
  }

  touchState.f3Button  = makeDebugButton('f3-button',  'f3',  'F3');
  touchState.camButton = makeDebugButton('cam-button', 'cam', 'CAM');
  touchState.f5Button  = makeDebugButton('f5-button',  'f5',  'F5');
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
    if (hudEditorActive) return;
    e.preventDefault();
    e.stopPropagation();
    toggleDebugOverlay();
  });
  
  // Camera toggle button handler
  touchState.camButton.addEventListener('touchstart', (e) => {
    if (hudEditorActive) return;
    e.preventDefault();
    e.stopPropagation();
    toggleFreecam();
  });
  
  // F5 camera mode toggle button handler
  touchState.f5Button.addEventListener('touchstart', (e) => {
    if (hudEditorActive) return;
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

  touchState.fireButton.addEventListener('touchstart', (e) => {
    if (gameState.isPaused || hudEditorActive) return;
    e.preventDefault();
    e.stopPropagation();
    mobileFireDown();
  }, { passive: false });
  touchState.fireButton.addEventListener('touchend', (e) => {
    if (hudEditorActive) return;
    e.preventDefault();
    e.stopPropagation();
    mobileFireUp();
  }, { passive: false });
  touchState.fireButton.addEventListener('touchcancel', () => { mobileFireUp(); }, { passive: true });

  touchState.reloadButton.addEventListener('touchstart', (e) => {
    if (gameState.isPaused || hudEditorActive) return;
    e.preventDefault();
    e.stopPropagation();
    mobileReload();
  }, { passive: false });

  touchState.swapButton.addEventListener('touchstart', (e) => {
    if (gameState.isPaused || hudEditorActive) return;
    e.preventDefault();
    e.stopPropagation();
    mobileSwitchWeapon();
  }, { passive: false });
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

let _pcEditorActive = false;
let _pcEditorDrag = null;
let _pcEditorOverlay = null;
let _pcEditorSelectedKey = null;
let _pcEditorOpacityPanel = null;

function _getEditorElementByKey(key) {
  return touchState[key + 'Button'] || document.getElementById(key);
}

function _getEditorTargets() {
  return [
    ...CORE_HUD_KEYS.map(key => ({ key, el: touchState[key + 'Button'], resizable: true })),
    ...getZombiesHudEditorElements(),
  ].filter(t => !!t.el);
}

function _ensureTargetLayoutEntry(key, el) {
  if (!gameState.hudConfig?.layout) return;
  if (gameState.hudConfig.layout[key]) return;
  const rect = el.getBoundingClientRect();
  gameState.hudConfig.layout[key] = {
    x: rect.left,
    y: rect.top,
    size: Math.max(rect.width, rect.height),
    opacity: parseFloat(el.style.opacity || '1') || 1,
  };
}

export function setZombiesControlsVisible(visible) {
  if (touchState.fireButton) touchState.fireButton.style.display = visible ? 'flex' : 'none';
  if (touchState.reloadButton) touchState.reloadButton.style.display = visible ? 'flex' : 'none';
  if (touchState.swapButton) touchState.swapButton.style.display = visible ? 'flex' : 'none';
}

export function startHudEditor() {
  hudEditorActive = true;
  gameState.hudEditorActive = true;

  for (const key of CORE_HUD_KEYS) {
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

  for (const { key, el } of getZombiesHudEditorElements()) {
    _ensureTargetLayoutEntry(key, el);
    el.style.outline = '2px dashed rgba(255,255,255,0.7)';
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
    _migrateLayout(gameState.hudConfig.layout);
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

  for (const key of CORE_HUD_KEYS) {
    const el = touchState[key + 'Button'];
    if (!el) continue;
    el.style.outline = '';
    el.querySelectorAll('.hud-resize-handle').forEach(h => h.remove());
  }

  for (const { el } of getZombiesHudEditorElements()) {
    if (!el) continue;
    el.style.outline = '';
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
  for (const target of _getEditorTargets()) {
    const { key, el, resizable = false } = target;
    const rect = el.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      e.preventDefault();
      e.stopPropagation();
      editorTouchId = touch.identifier;
      const isResize = resizable && (x > rect.right - 22 && y > rect.bottom - 22);
      _ensureTargetLayoutEntry(key, el);
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
      editorTarget.el.style.right = '';
      editorTarget.el.style.bottom = '';
      if (editorTarget.key === 'zom-round' || editorTarget.key === 'zom-timer-wrap') {
        editorTarget.el.style.transform = 'none';
      }
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
    const el = _getEditorElementByKey(editorSelectedKey);
    if (el) el.style.outline = '2px dashed rgba(255,255,255,0.7)';
    editorSelectedKey = null;
  }
}

function showOpacityPanel(key) {
  hideOpacityPanel();
  editorSelectedKey = key;
  const el = _getEditorElementByKey(key);
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

export function startPcHudEditor(onDone) {
  if (_pcEditorActive) return;
  _pcEditorActive = true;
  hudEditorActive = true;
  gameState.hudEditorActive = true;
  _initHudConfigDefaults();
  const targets = getZombiesHudEditorElements();
  for (const { key, el } of targets) {
    _ensureTargetLayoutEntry(key, el);
    el.style.outline = '2px dashed rgba(255,255,255,0.7)';
    const handle = document.createElement('div');
    handle.className = 'hud-resize-handle';
    handle.style.cssText = [
      'position:absolute;bottom:2px;right:2px;width:14px;height:14px',
      'background:rgba(255,255,255,0.85);border-radius:3px;pointer-events:none',
      'font-size:9px;display:flex;align-items:center;justify-content:center;color:#333',
    ].join(';');
    handle.textContent = '\u21d8';
    el.appendChild(handle);
  }

  _pcEditorOverlay = document.createElement('div');
  _pcEditorOverlay.id = 'hud-editor-overlay';
  _pcEditorOverlay.style.cssText = [
    'position:fixed;top:0;left:0;right:0;pointer-events:none',
    'z-index:2000;display:flex;flex-direction:column;align-items:center;padding:16px;gap:8px',
  ].join(';');

  const label = document.createElement('div');
  label.textContent = 'HUD EDITOR \u2014 drag to move, drag corner to resize, click to adjust opacity';
  label.style.cssText = [
    'color:white;font-size:13px;background:rgba(0,0,0,0.65)',
    'padding:5px 12px;border-radius:6px;pointer-events:none;text-align:center',
  ].join(';');

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:14px;pointer-events:auto;';

  function _makeBtn(text, bg, fn) {
    const b = document.createElement('div');
    b.textContent = text;
    b.style.cssText = [
      `padding:8px 24px;font-size:16px;font-weight:bold;background:${bg}`,
      'color:white;border:2px solid rgba(255,255,255,0.8);border-radius:8px',
      'user-select:none;cursor:pointer',
    ].join(';');
    b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); fn(); });
    return b;
  }

  btnRow.appendChild(_makeBtn('Reset', 'rgba(180,60,60,0.9)', () => {
    _pcHideOpacityPanel();
    const layout = gameState.hudConfig.layout;
    for (const { key, el } of getZombiesHudEditorElements()) {
      delete layout[key];
      el.style.transform = '';
      el.style.transformOrigin = '';
    }
    _ensureZombiesLayoutDefaults(layout);
    applyZombiesHudLayout(layout);
    saveHudConfig();
  }));
  btnRow.appendChild(_makeBtn('Done', 'rgba(60,180,60,0.9)', () => {
    _stopPcHudEditor();
    if (onDone) onDone();
  }));

  _pcEditorOverlay.appendChild(label);
  _pcEditorOverlay.appendChild(btnRow);
  document.body.appendChild(_pcEditorOverlay);

  document.addEventListener('mousedown', _pcEditorMouseDown, true);
  document.addEventListener('mousemove', _pcEditorMouseMove, true);
  document.addEventListener('mouseup', _pcEditorMouseUp, true);
}

function _stopPcHudEditor() {
  _pcHideOpacityPanel();
  _pcEditorActive = false;
  hudEditorActive = false;
  gameState.hudEditorActive = false;
  for (const { el } of getZombiesHudEditorElements()) {
    if (!el) continue;
    el.style.outline = '';
    el.querySelectorAll('.hud-resize-handle').forEach(h => h.remove());
  }
  if (_pcEditorOverlay) { _pcEditorOverlay.remove(); _pcEditorOverlay = null; }
  saveHudConfig();
  document.removeEventListener('mousedown', _pcEditorMouseDown, true);
  document.removeEventListener('mousemove', _pcEditorMouseMove, true);
  document.removeEventListener('mouseup', _pcEditorMouseUp, true);
}

function _pcHideOpacityPanel() {
  if (_pcEditorOpacityPanel) { _pcEditorOpacityPanel.remove(); _pcEditorOpacityPanel = null; }
  if (_pcEditorSelectedKey) {
    const el = document.getElementById(_pcEditorSelectedKey);
    if (el) el.style.outline = '2px dashed rgba(255,255,255,0.7)';
    _pcEditorSelectedKey = null;
  }
}

function _pcShowOpacityPanel(key) {
  _pcHideOpacityPanel();
  _pcEditorSelectedKey = key;
  const el = document.getElementById(key);
  if (el) el.style.outline = '2px dashed rgba(255,220,80,0.9)';
  const cfg = gameState.hudConfig?.layout?.[key];
  if (!cfg) return;

  const panel = document.createElement('div');
  panel.id = 'hud-opacity-panel';
  panel.style.cssText = [
    'position:fixed;top:80px;left:50%;transform:translateX(-50%)',
    'background:rgba(10,10,10,0.88);border:1px solid rgba(255,255,255,0.18)',
    'border-radius:10px;padding:12px 24px;z-index:2100;pointer-events:auto',
    'display:flex;flex-direction:column;align-items:center;gap:8px;min-width:280px',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = key.replace('zom-', '').toUpperCase() + ' OPACITY';
  title.style.cssText = 'color:rgba(255,220,80,0.9);font-size:11px;font-family:sans-serif;font-weight:bold;letter-spacing:1.5px;';

  const sliderRow = document.createElement('div');
  sliderRow.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '15';
  slider.max = '100';
  slider.value = Math.round((cfg.opacity ?? 1.0) * 100);
  slider.style.cssText = 'flex:1;accent-color:rgba(255,220,80,1);height:20px;cursor:pointer;';

  const pct = document.createElement('span');
  pct.textContent = slider.value + '%';
  pct.style.cssText = 'color:white;font-size:14px;font-family:sans-serif;min-width:40px;text-align:right;';

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
  _pcEditorOpacityPanel = panel;
}

function _pcEditorMouseDown(e) {
  if (e.button !== 0) return;
  if (_pcEditorDrag) return;
  const x = e.clientX, y = e.clientY;
  if (_pcEditorOpacityPanel) {
    const r = _pcEditorOpacityPanel.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return;
    _pcHideOpacityPanel();
    return;
  }
  for (const { key, el } of getZombiesHudEditorElements()) {
    const rect = el.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      e.preventDefault();
      e.stopPropagation();
      _ensureTargetLayoutEntry(key, el);
      const isResize = (x > rect.right - 22 && y > rect.bottom - 22);
      _pcEditorDrag = {
        key, el,
        startX: x, startY: y,
        startBtnX: gameState.hudConfig.layout[key].x,
        startBtnY: gameState.hudConfig.layout[key].y,
        startScale: gameState.hudConfig.layout[key].scale ?? 1.0,
        moved: false,
        resizing: isResize,
      };
      return;
    }
  }
  if (_pcEditorOverlay) {
    const r = _pcEditorOverlay.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return;
  }
}

function _pcEditorMouseMove(e) {
  if (!_pcEditorDrag) return;
  e.preventDefault();
  const dx = e.clientX - _pcEditorDrag.startX;
  const dy = e.clientY - _pcEditorDrag.startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _pcEditorDrag.moved = true;
  const cfg = gameState.hudConfig.layout[_pcEditorDrag.key];
  if (_pcEditorDrag.resizing) {
    const newScale = Math.max(0.3, Math.min(4.0, _pcEditorDrag.startScale + (dx + dy) / 200));
    cfg.scale = newScale;
    _pcEditorDrag.el.style.transform = `scale(${newScale})`;
    _pcEditorDrag.el.style.transformOrigin = 'top left';
  } else {
    cfg.x = _pcEditorDrag.startBtnX + dx;
    cfg.y = _pcEditorDrag.startBtnY + dy;
    _pcEditorDrag.el.style.left = cfg.x + 'px';
    _pcEditorDrag.el.style.top = cfg.y + 'px';
    _pcEditorDrag.el.style.right = '';
    _pcEditorDrag.el.style.bottom = '';
    if (_pcEditorDrag.key === 'zom-round' || _pcEditorDrag.key === 'zom-timer-wrap') {
      const existingScale = cfg.scale;
      _pcEditorDrag.el.style.transform = existingScale !== undefined ? `scale(${existingScale})` : 'none';
      _pcEditorDrag.el.style.transformOrigin = 'top left';
    }
  }
}

function _pcEditorMouseUp(e) {
  if (!_pcEditorDrag) return;
  if (!_pcEditorDrag.moved && !_pcEditorDrag.resizing) {
    const key = _pcEditorDrag.key;
    if (_pcEditorSelectedKey === key) {
      _pcHideOpacityPanel();
    } else {
      _pcShowOpacityPanel(key);
    }
  }
  saveHudConfig();
  _pcEditorDrag = null;
}

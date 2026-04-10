// mobileControls.js - On-screen touch controls for mobile platforms
import * as THREE from 'three';
import { gameState } from './globals.js';
import { platformConfig } from './platform.js';
import { toggleDebugOverlay, toggleFreecam, toggleCameraMode } from './input.js';

let _pauseToggle = () => {};
export function setPauseToggleCallback(fn) { _pauseToggle = fn; }

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
  joystickMaxRadius: 80,    // Walk zone radius
  joystickDeadzone: 10,     // Center deadzone
  autoRunDistance: 120,     // Distance to trigger auto-run
  autoRunAngleTolerance: 25, // Degrees from forward to consider "straight"
  
  // Visual elements
  joystickBase: null,
  joystickThumb: null,
  sprintButton: null,
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
  
  createControlElements();
  setupTouchHandlers();
}

function createControlElements() {
  // Container for all mobile controls
  const controlsContainer = document.createElement('div');
  controlsContainer.id = 'mobile-controls';
  controlsContainer.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1000;
  `;
  document.body.appendChild(controlsContainer);
  
  // Joystick base (invisible initially, appears on touch)
  const joystickBase = document.createElement('div');
  joystickBase.id = 'joystick-base';
  joystickBase.style.cssText = `
    position: absolute;
    width: ${touchState.joystickMaxRadius * 2}px;
    height: ${touchState.joystickMaxRadius * 2}px;
    border: 3px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    pointer-events: none;
    display: none;
    transform: translate(-50%, -50%);
  `;
  controlsContainer.appendChild(joystickBase);
  touchState.joystickBase = joystickBase;
  
  // Joystick thumb
  const joystickThumb = document.createElement('div');
  joystickThumb.id = 'joystick-thumb';
  joystickThumb.style.cssText = `
    position: absolute;
    width: 60px;
    height: 60px;
    background: rgba(255, 255, 255, 0.5);
    border: 3px solid rgba(255, 255, 255, 0.8);
    border-radius: 50%;
    pointer-events: none;
    display: none;
    transform: translate(-50%, -50%);
    transition: background 0.1s;
  `;
  controlsContainer.appendChild(joystickThumb);
  touchState.joystickThumb = joystickThumb;
  
  // Sprint button (always visible on right side)
  const sprintButton = document.createElement('div');
  sprintButton.id = 'sprint-button';
  sprintButton.style.cssText = `
    position: absolute;
    bottom: 120px;
    right: 40px;
    width: 70px;
    height: 70px;
    background: rgba(255, 100, 100, 0.4);
    border: 3px solid rgba(255, 100, 100, 0.8);
    border-radius: 50%;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    color: white;
    font-weight: bold;
    user-select: none;
    transition: all 0.1s;
  `;
  sprintButton.innerHTML = '▶▶';
  controlsContainer.appendChild(sprintButton);
  touchState.sprintButton = sprintButton;
  
  // Pause button (top right)
  const pauseButton = document.createElement('div');
  pauseButton.id = 'pause-button';
  pauseButton.style.cssText = `
    position: absolute;
    top: 20px;
    right: 20px;
    width: 50px;
    height: 50px;
    background: rgba(80, 80, 80, 0.6);
    border: 3px solid rgba(255, 255, 255, 0.8);
    border-radius: 8px;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    color: white;
    font-weight: bold;
    user-select: none;
  `;
  pauseButton.innerHTML = '❚❚';
  controlsContainer.appendChild(pauseButton);
  touchState.pauseButton = pauseButton;
  
  // F3 debug button (beside pause)
  const f3Button = document.createElement('div');
  f3Button.id = 'f3-button';
  f3Button.style.cssText = `
    position: absolute;
    top: 20px;
    right: 80px;
    width: 50px;
    height: 50px;
    background: rgba(80, 80, 200, 0.6);
    border: 3px solid rgba(255, 255, 255, 0.8);
    border-radius: 8px;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    color: white;
    font-weight: bold;
    user-select: none;
  `;
  f3Button.innerHTML = 'F3';
  controlsContainer.appendChild(f3Button);
  touchState.f3Button = f3Button;
  
  // Camera toggle button (beside F3)
  const camButton = document.createElement('div');
  camButton.id = 'cam-button';
  camButton.style.cssText = `
    position: absolute;
    top: 20px;
    right: 140px;
    width: 50px;
    height: 50px;
    background: rgba(100, 200, 100, 0.6);
    border: 3px solid rgba(255, 255, 255, 0.8);
    border-radius: 8px;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: white;
    font-weight: bold;
    user-select: none;
  `;
  camButton.innerHTML = '📷';
  controlsContainer.appendChild(camButton);
  touchState.camButton = camButton;
  
  // F5 reload button (left of camera button)
  const f5Button = document.createElement('div');
  f5Button.id = 'f5-button';
  f5Button.style.cssText = `
    position: absolute;
    top: 20px;
    right: 200px;
    width: 50px;
    height: 50px;
    background: rgba(200, 80, 80, 0.6);
    border: 3px solid rgba(255, 255, 255, 0.8);
    border-radius: 8px;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    color: white;
    font-weight: bold;
    user-select: none;
  `;
  f5Button.innerHTML = 'F5';
  controlsContainer.appendChild(f5Button);
  touchState.f5Button = f5Button;
}

function setupTouchHandlers() {
  const canvas = gameState.renderer.domElement;
  
  // Touch start
  canvas.addEventListener('touchstart', (e) => {
    if (gameState.isPaused) return;
    
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
    if (gameState.isPaused) return;
    
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
    if (gameState.isPaused) return;
    e.preventDefault();
    e.stopPropagation();
    handleSprintButtonTouch(e.touches[0].identifier);
  });
  
  // Pause button handler
  touchState.pauseButton.addEventListener('touchstart', (e) => {
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
}

function startJoystick(touchId, x, y) {
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
  
  // Check for auto-run trigger
  if (distance > touchState.autoRunDistance && !touchState.autoRunActive) {
    // Check if moving roughly forward (upward on screen = forward in game)
    const degrees = (angle * 180 / Math.PI + 360) % 360; // Convert to 0-360, 0=right
    const forwardDeg = 270; // Up on screen (270 degrees = straight up, negative Y)
    const angleDiff = Math.abs(((degrees - forwardDeg + 180) % 360) - 180);
    
    if (angleDiff < touchState.autoRunAngleTolerance) {
      activateAutoRun();
      return;
    }
  }
  
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
  
  // Update thumb color based on state
  if (touchState.autoRunActive || touchState.sprintLocked) {
    touchState.joystickThumb.style.background = 'rgba(255, 100, 100, 0.7)';
  } else if (distance > touchState.joystickMaxRadius * 0.7) {
    touchState.joystickThumb.style.background = 'rgba(255, 200, 100, 0.6)';
  } else {
    touchState.joystickThumb.style.background = 'rgba(255, 255, 255, 0.5)';
  }
  
  // Convert to game input
  updateGameInput(dx, dy, distance);
}

function endJoystick(x, y) {
  const dx = x - touchState.joystickOrigin.x;
  const dy = y - touchState.joystickOrigin.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  
  // Check for auto-run on release if moving straight forward outside walk zone
  if (distance > touchState.joystickMaxRadius && !touchState.autoRunActive) {
    const degrees = (angle * 180 / Math.PI + 360) % 360;
    const forwardDeg = 270; // Up on screen (270 degrees = straight up, negative Y)
    const angleDiff = Math.abs(((degrees - forwardDeg + 180) % 360) - 180);
    
    if (angleDiff < touchState.autoRunAngleTolerance) {
      activateAutoRun();
      return; // Keep joystick active
    }
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
  
  // Sprint if locked or distance is high
  gameState.keys['ShiftLeft'] = touchState.sprintLocked || distance > touchState.joystickMaxRadius * 0.85;
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
  
  // Auto-run continuous update
  if (touchState.autoRunActive) {
    gameState.keys['KeyW'] = true;
    gameState.keys['ShiftLeft'] = true;
  }
}

// Export touch state for debugging
export { touchState };

// Note: isFreecamActive is now imported from input.js
export function isFreecamActive() {
  // For backwards compatibility, check input.js freecam state
  return false; // The actual state is in input.js
}

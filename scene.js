// scene.js - Scene, camera, renderer, and lighting setup
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { gameState, cameraDistance, platformConfig } from './globals.js';
import { isFreecamActive as isFreecamActiveMobile } from './mobileControls.js';
import { isFreecamActive as isFreecamActiveDesktop } from './input.js';
import { advanceObjectState, fireButtonTrigger } from './stateManager.js';

let _knobSaveHook = null;
export function setKnobSaveHook(fn) { _knobSaveHook = fn; }
let _channelChangeHook = null;
export function setChannelChangeHook(fn) { _channelChangeHook = fn; }

let _volNotch = -1;
function _playVolClick(value) {
  const n = Math.floor(Math.random() * 6) + 1;
  const a = new Audio(`./sounds/vol${n}.wav`);
  a.volume = Math.max(0.01, value) * 0.3;
  a.play().catch(() => {});
}
function _updateVolNotch(value) {
  const notch = Math.round(value * 30);
  if (notch !== _volNotch) {
    _volNotch = notch;
    _playVolClick(value);
  }
}

// Split a combined mesh into its disconnected vertex islands (e.g. two knobs sharing one mesh)
export function splitMeshIntoIslands(mesh) {
  const geometry = mesh.geometry;
  const posAttr = geometry.attributes.position;
  const indexAttr = geometry.index;
  const vertCount = posAttr.count;

  // Union-Find
  const parent = new Int32Array(vertCount);
  for (let i = 0; i < vertCount; i++) parent[i] = i;
  function find(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

  const idxArr = indexAttr ? indexAttr.array : null;
  const faceCount = idxArr ? idxArr.length / 3 : vertCount / 3;
  for (let f = 0; f < faceCount; f++) {
    const a = idxArr ? idxArr[f * 3] : f * 3;
    const b = idxArr ? idxArr[f * 3 + 1] : f * 3 + 1;
    const c = idxArr ? idxArr[f * 3 + 2] : f * 3 + 2;
    union(a, b); union(b, c);
  }

  // Group faces by island root
  const islandFaces = new Map();
  for (let f = 0; f < faceCount; f++) {
    const a = idxArr ? idxArr[f * 3] : f * 3;
    const root = find(a);
    if (!islandFaces.has(root)) islandFaces.set(root, []);
    islandFaces.get(root).push(f);
  }

  const hasNormals = !!geometry.attributes.normal;
  const hasUV = !!geometry.attributes.uv;
  const result = [];

  for (const [, faces] of islandFaces) {
    const vertMap = new Map();
    const newIndices = [];
    for (const f of faces) {
      for (let v = 0; v < 3; v++) {
        const oldIdx = idxArr ? idxArr[f * 3 + v] : f * 3 + v;
        if (!vertMap.has(oldIdx)) vertMap.set(oldIdx, vertMap.size);
        newIndices.push(vertMap.get(oldIdx));
      }
    }
    const newVertCount = vertMap.size;
    const newPos = new Float32Array(newVertCount * 3);
    const newNormals = hasNormals ? new Float32Array(newVertCount * 3) : null;
    const newUVs = hasUV ? new Float32Array(newVertCount * 2) : null;
    for (const [oldIdx, newIdx] of vertMap) {
      newPos[newIdx * 3]     = posAttr.getX(oldIdx);
      newPos[newIdx * 3 + 1] = posAttr.getY(oldIdx);
      newPos[newIdx * 3 + 2] = posAttr.getZ(oldIdx);
      if (hasNormals) {
        const n = geometry.attributes.normal;
        newNormals[newIdx * 3]     = n.getX(oldIdx);
        newNormals[newIdx * 3 + 1] = n.getY(oldIdx);
        newNormals[newIdx * 3 + 2] = n.getZ(oldIdx);
      }
      if (hasUV) {
        const uv = geometry.attributes.uv;
        newUVs[newIdx * 2]     = uv.getX(oldIdx);
        newUVs[newIdx * 2 + 1] = uv.getY(oldIdx);
      }
    }
    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
    if (hasNormals) newGeo.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3));
    if (hasUV) newGeo.setAttribute('uv', new THREE.BufferAttribute(newUVs, 2));
    newGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
    newGeo.computeBoundingBox();
    const centerY = (newGeo.boundingBox.min.y + newGeo.boundingBox.max.y) / 2;
    const sz = new THREE.Vector3();
    newGeo.boundingBox.getSize(sz);
    const volume = sz.x * sz.y * sz.z;
    result.push({ geometry: newGeo, centerY, volume });
  }
  return result;
}

export function initScene() {
  gameState.scene = new THREE.Scene();
  gameState.scene.background = new THREE.Color(0x000000);
  
  // Much lighter fog on mobile to prevent blackout
  const fogDensity = 0.1;
  gameState.scene.fog = new THREE.FogExp2(0x000000, fogDensity);
  
  gameState.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  gameState.camera.position.set(0, 5, 10);
  gameState.camera.lookAt(0, 1, 0);

  gameState.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  gameState.renderer.sortObjects = true;
  gameState.renderer.outputColorSpace = THREE.SRGBColorSpace;
  const { w: rw, h: rh } = platformConfig.getRendererSize(window.innerWidth, window.innerHeight);
  gameState.renderer.setSize(rw, rh);
  gameState.renderer.domElement.style.width  = '100vw';
  gameState.renderer.domElement.style.height = '100vh';
  gameState.renderer.domElement.style.imageRendering = 'pixelated';
  gameState.renderer.shadowMap.enabled = true;
  gameState.renderer.shadowMap.type = THREE.PCFShadowMap;
  gameState.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  gameState.renderer.toneMappingExposure = 1.4;  // Gamma setting
  document.body.appendChild(gameState.renderer.domElement);

  // Initialize ambient brightness if not set
  if (!gameState.ambientBrightness) gameState.ambientBrightness = 0.05;
  gameState.ambientLight = new THREE.AmbientLight(0xffffff, gameState.ambientBrightness);
  gameState.scene.add(gameState.ambientLight);

  // Weak head-mounted light for local illumination
  // gameState.headLight = new THREE.PointLight(0xcccccc, 0.06, 40);
  // gameState.headLight.castShadow = false;  // No shadow casting
  // gameState.headLight.layers.set(0);  // Only affects layer 0 (ground/scene), not player (layer 1)
  // gameState.scene.add(gameState.headLight);

  // Only add game controls in game mode, not editor mode
  const isEditorMode = window.location.pathname.includes('editor');
  
  if (!isEditorMode) {
    document.addEventListener('click', async () => {
      if (!gameState.isPaused && !gameState.mainMenuActive) {
        document.body.requestPointerLock().catch?.(() => {});
        if (!document.fullscreenElement) {
          try {
            await document.documentElement.requestFullscreen();
          } catch (e) {
            console.log('Fullscreen not available:', e);
          }
        }
        if (navigator.keyboard && navigator.keyboard.lock) {
          try {
            await navigator.keyboard.lock(['Escape']);
            gameState.keyboardLocked = true;
          } catch (e) {
            console.log('Keyboard lock not available:', e);
          }
        }
      }
    });
    document.addEventListener('pointerlockchange', () => {
      gameState.isPointerLocked = (document.pointerLockElement === document.body);
    });
    
    document.addEventListener('mousemove', (event) => {
      if (gameState.isPointerLocked) {
        const sensitivity = gameState.mouseSensitivity || 1.0;
        gameState.cameraAngle -= event.movementX * 0.002 * sensitivity;
        // Invert vertical controls in front-facing third person
        const pitchMultiplier = gameState.cameraMode === 2 ? 1 : -1;
        gameState.cameraPitch += event.movementY * 0.002 * pitchMultiplier * sensitivity;
        gameState.cameraPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, gameState.cameraPitch));
      }
    });

    // Track mouse position for knob hover detection during scroll
    let _mouseClientX = 0, _mouseClientY = 0;
    document.addEventListener('mousemove', (ev) => { _mouseClientX = ev.clientX; _mouseClientY = ev.clientY; }, { passive: true });

    // Scroll wheel — knob interaction takes priority, then interactObj buttons, then third-person zoom
    document.addEventListener('wheel', (event) => {
      const _knobScrollRaycaster = (() => {
        if (!gameState.isPaused) return null;
        const rect = gameState.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((_mouseClientX - rect.left) / rect.width)  *  2 - 1,
         -((_mouseClientY - rect.top)  / rect.height) *  2 + 1
        );
        const r = new THREE.Raycaster();
        r.setFromCamera(mouse, gameState.camera);
        return r;
      })();
      const knobHovered = _knobScrollRaycaster && gameState.tvKnobMesh
        ? _knobScrollRaycaster.intersectObjects(gameState.tvKnobHitMeshes?.length ? gameState.tvKnobHitMeshes : [gameState.tvKnobMesh], true).length > 0
        : false;
      const chKnobHovered = _knobScrollRaycaster && gameState.tvChannelKnobMesh
        ? _knobScrollRaycaster.intersectObjects(gameState.tvChannelKnobHitMeshes?.length ? gameState.tvChannelKnobHitMeshes : [gameState.tvChannelKnobMesh], true).length > 0
        : false;
      if ((gameState.tvKnobInteractable || knobHovered) && gameState.tvKnobMesh) {
        event.preventDefault();
        const step = THREE.MathUtils.degToRad(3);
        const direction = event.deltaY > 0 ? 1 : -1;
        const min = Math.min(gameState.tvKnobRotationMin, gameState.tvKnobRotationMax);
        const max = Math.max(gameState.tvKnobRotationMin, gameState.tvKnobRotationMax);
        const newX = THREE.MathUtils.clamp(gameState.tvKnobMesh.rotation.x + direction * step, min, max);
        gameState.tvKnobMesh.rotation.x = newX;
        gameState.tvKnobValue = (newX - gameState.tvKnobRotationMin) / (gameState.tvKnobRotationMax - gameState.tvKnobRotationMin);
        gameState.masterVolume = gameState.tvKnobValue;
        _updateVolNotch(gameState.tvKnobValue);
        if (_knobSaveHook) _knobSaveHook();
      } else if (chKnobHovered && gameState.tvChannelKnobMesh) {
        event.preventDefault();
        const direction = event.deltaY > 0 ? 1 : -1;
        const newNotch = THREE.MathUtils.clamp((gameState.tvChannelKnobValue ?? 0) + direction, 0, 4);
        if (newNotch !== gameState.tvChannelKnobValue) {
          gameState.tvChannelKnobValue = newNotch;
          const chMin = gameState.tvChannelKnobRotationMin;
          const chStep = (gameState.tvChannelKnobRotationMax - chMin) / 4;
          gameState.tvChannelKnobMesh.rotation.x = chMin + newNotch * chStep;
          if (_knobSaveHook) _knobSaveHook();
          if (_channelChangeHook) _channelChangeHook(newNotch);
        }
      } else if (!gameState.isPaused && gameState.interactObj) {
        const _st = gameState.interactObj.userData.states?.[gameState.interactObj.userData.currentState ?? 0];
        if (_st?.buttons?.length) {
          event.preventDefault();
          fireButtonTrigger(gameState.interactObj, event.deltaY > 0 ? 'scrolldown' : 'scrollup');
        }
      } else if (gameState.cameraMode === 1 || gameState.cameraMode === 2) {
        event.preventDefault();
        const zoomSpeed = 0.1;
        const direction = event.deltaY > 0 ? -1 : 1;
        gameState.cameraDistanceThirdPerson = Math.max(2, Math.min(15, gameState.cameraDistanceThirdPerson + direction * zoomSpeed));
      }
    }, { passive: false });

    // Knob drag in pause menu — tangential mouse motion relative to knob screen-center
    const _knobRaycaster = new THREE.Raycaster();
    let _knobDragging = null, _knobCX = 0, _knobCY = 0, _knobMouseX = 0, _knobMouseY = 0;
    let _chKnobRawX = 0;
    gameState.renderer.domElement.addEventListener('mousedown', (e) => {
      if (!gameState.isPaused) return;
      const rect = gameState.renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  *  2 - 1,
       -((e.clientY - rect.top)  / rect.height) *  2 + 1
      );
      _knobRaycaster.setFromCamera(mouse, gameState.camera);
      if (gameState.tvKnobMesh && _knobRaycaster.intersectObjects(gameState.tvKnobHitMeshes?.length ? gameState.tvKnobHitMeshes : [gameState.tvKnobMesh], true).length > 0) {
        const knobWorld = new THREE.Vector3();
        gameState.tvKnobMesh.getWorldPosition(knobWorld);
        const proj = knobWorld.clone().project(gameState.camera);
        _knobCX = (proj.x  + 1) / 2 * rect.width  + rect.left;
        _knobCY = (-proj.y + 1) / 2 * rect.height + rect.top;
        _knobMouseX = e.clientX; _knobMouseY = e.clientY;
        _knobDragging = 'vol';
        e.stopPropagation();
      } else if (gameState.tvChannelKnobMesh && _knobRaycaster.intersectObjects(gameState.tvChannelKnobHitMeshes?.length ? gameState.tvChannelKnobHitMeshes : [gameState.tvChannelKnobMesh], true).length > 0) {
        const chWorld = new THREE.Vector3();
        gameState.tvChannelKnobMesh.getWorldPosition(chWorld);
        const proj = chWorld.clone().project(gameState.camera);
        _knobCX = (proj.x  + 1) / 2 * rect.width  + rect.left;
        _knobCY = (-proj.y + 1) / 2 * rect.height + rect.top;
        _knobMouseX = e.clientX; _knobMouseY = e.clientY;
        _chKnobRawX = gameState.tvChannelKnobMesh.rotation.x;
        _knobDragging = 'ch';
        e.stopPropagation();
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!_knobDragging) return;
      const rx = _knobMouseX - _knobCX, ry = _knobMouseY - _knobCY;
      const len = Math.sqrt(rx * rx + ry * ry) || 1;
      const tx = ry / len, ty = -rx / len;
      const dx = e.clientX - _knobMouseX, dy = e.clientY - _knobMouseY;
      _knobMouseX = e.clientX; _knobMouseY = e.clientY;
      const tangential = dx * tx + dy * ty;
      if (_knobDragging === 'vol' && gameState.tvKnobMesh) {
        const min = Math.min(gameState.tvKnobRotationMin, gameState.tvKnobRotationMax);
        const max = Math.max(gameState.tvKnobRotationMin, gameState.tvKnobRotationMax);
        const newX = THREE.MathUtils.clamp(gameState.tvKnobMesh.rotation.x - tangential * 0.025, min, max);
        gameState.tvKnobMesh.rotation.x = newX;
        gameState.tvKnobValue = (newX - gameState.tvKnobRotationMin) / (gameState.tvKnobRotationMax - gameState.tvKnobRotationMin);
        gameState.masterVolume = gameState.tvKnobValue;
        _updateVolNotch(gameState.tvKnobValue);
        if (_knobSaveHook) _knobSaveHook();
      } else if (_knobDragging === 'ch' && gameState.tvChannelKnobMesh) {
        const chMin = gameState.tvChannelKnobRotationMin;
        const chMax = gameState.tvChannelKnobRotationMax;
        _chKnobRawX = THREE.MathUtils.clamp(_chKnobRawX - tangential * 0.025, chMin, chMax);
        const chStep = (chMax - chMin) / 4;
        const newNotch = THREE.MathUtils.clamp(Math.round((_chKnobRawX - chMin) / chStep), 0, 4);
        if (newNotch !== gameState.tvChannelKnobValue) {
          gameState.tvChannelKnobValue = newNotch;
          gameState.tvChannelKnobMesh.rotation.x = chMin + newNotch * chStep;
          if (_knobSaveHook) _knobSaveHook();
          if (_channelChangeHook) _channelChangeHook(newNotch);
        }
      }
    });
    document.addEventListener('mouseup', () => { _knobDragging = null; });

    // Right-click = interact with highlighted object
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return; // right button only
      if (gameState.isPaused) return;
      if (!gameState.isPointerLocked && !gameState.mobileInteractPending) return;
      gameState.mobileInteractPending = false;
      // Hardcoded pullstring interact — COMMENTED OUT: use editor-placed state objects instead
      // if (gameState.interactTarget === 'pullstring' && gameState.pullStringTab) { ... }
      if (gameState.interactTarget === 'state-obj' && gameState.interactObj) {
        advanceObjectState(gameState.interactObj);
        // Refresh tooltip text to reflect next state
        const obj    = gameState.interactObj;
        const nextIdx = (obj.userData.currentState + 1) % obj.userData.states.length;
        const label   = obj.userData.states[nextIdx]?.interactLabel || '[RIGHT CLICK] Interact';
        const el = document.getElementById('interact-tooltip');
        if (el) el.textContent = label;
      }
    });
    // Prevent context menu appearing on right-click in game
    document.addEventListener('contextmenu', (e) => {
      if (gameState.isPointerLocked) e.preventDefault();
    });
    // ---- end knob drag ----
  }

  window.addEventListener('resize', onResize);
}

// TV model loading is game-specific — call this from your game module (e.g. game/sinisterLoop.js).
// Example stub kept here as documentation:
export function onResize() {
  gameState.camera.aspect = window.innerWidth / window.innerHeight;
  gameState.camera.updateProjectionMatrix();
  const { w: rw, h: rh } = platformConfig.getRendererSize(window.innerWidth, window.innerHeight);
  gameState.renderer.setSize(rw, rh, false);
  
  // Update UI camera aspect ratio
  if (gameState.uiCamera) {
    const aspect = window.innerWidth / window.innerHeight;
    gameState.uiCamera.left = -aspect;
    gameState.uiCamera.right = aspect;
    gameState.uiCamera.top = 1;
    gameState.uiCamera.bottom = -1;
    gameState.uiCamera.updateProjectionMatrix();
  }
}

export function updateCamera() {
  // Skip normal camera updates when paused
  if (gameState.isPaused) return;
  
  // Skip if freecam is active (check both mobile and desktop)
  const freecamActive = (typeof isFreecamActiveMobile === 'function' && isFreecamActiveMobile()) ||
                        (typeof isFreecamActiveDesktop === 'function' && isFreecamActiveDesktop());
  if (freecamActive) return;
  
  // Get head position from head bone (dynamically tracks animations)
  const headPos = new THREE.Vector3();
  
  if (gameState.player) {
    let headBone = null;
    gameState.player.traverse((child) => {
      if (child.isBone && (child.name.includes('Head') || child.name.includes('head'))) {
        if (!child.name.includes('Top_End')) { // Skip end bones
          headBone = child;
        }
      }
    });
    
    if (headBone) {
      // Get head bone world position (follows animation)
      headBone.getWorldPosition(headPos);
    } else {
      // Fallback to player position + fixed height
      headPos.copy(gameState.player.position);
      headPos.y += 1.7;
    }
  }
  
  if (gameState.cameraMode === 0) {
    // First-person: camera at head position, with zoom distance and collision detection
    // Apply smooth damping to reduce jitter from running animation
    if (!gameState.smoothedCameraPos) {
      gameState.smoothedCameraPos = headPos.clone();
    }
    
    // Smoothly interpolate camera position — tight on XZ, light damping on Y
    const dampingFactor = 0.25;
    gameState.smoothedCameraPos.x += (headPos.x - gameState.smoothedCameraPos.x) * dampingFactor;
    gameState.smoothedCameraPos.z += (headPos.z - gameState.smoothedCameraPos.z) * dampingFactor;
    gameState.smoothedCameraPos.y += (headPos.y - gameState.smoothedCameraPos.y) * 0.35;
    
    // Calculate intended camera position (head + backward offset)
    const intendedCameraPos = gameState.smoothedCameraPos.clone();
    const forwardDir = new THREE.Vector3(0, 0, -1);
    forwardDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), gameState.cameraAngle);
    forwardDir.applyAxisAngle(new THREE.Vector3(1, 0, 0), gameState.cameraPitch);
    intendedCameraPos.addScaledVector(forwardDir, -gameState.cameraDistance);
    
    // Use a separate raycaster for camera collision to avoid interfering with physics
    const cameraRaycaster = new THREE.Raycaster();
    const rayDir = new THREE.Vector3().subVectors(intendedCameraPos, gameState.smoothedCameraPos).normalize();
    const rayLength = gameState.smoothedCameraPos.distanceTo(intendedCameraPos);
    cameraRaycaster.set(gameState.smoothedCameraPos, rayDir);
    cameraRaycaster.far = rayLength;
    
    // Check collisions with mesh objects only (exclude player, lights, helpers, debug objects)
    const meshes = gameState.scene.children.filter(obj => 
      obj.isMesh && 
      obj !== gameState.player && 
      !obj.userData.isHelper &&
      !obj.userData.isDebug
    );
    const intersects = cameraRaycaster.intersectObjects(meshes, true);
    
    // Use collision-adjusted position if hit, otherwise use intended position
    if (intersects.length > 0) {
      // If there's a collision, keep camera at head position (don't move backward through walls)
      gameState.camera.position.copy(gameState.smoothedCameraPos);
    } else {
      gameState.camera.position.copy(intendedCameraPos);
    }
    
    gameState.camera.rotation.order = 'YXZ';
    gameState.camera.rotation.y = gameState.cameraAngle;
    gameState.camera.rotation.x = gameState.cameraPitch;
  } else if (gameState.cameraMode === 1) {
    // Third-person behind: orbit around head from behind (inverted vertical)
    const targetDist = gameState.cameraDistanceThirdPerson;
    const dirX = Math.sin(gameState.cameraAngle);
    const dirZ = Math.cos(gameState.cameraAngle);
    const dirY = -Math.sin(gameState.cameraPitch);
    
    // Raycast from head to intended camera position for collision detection
    const rayDir = new THREE.Vector3(dirX, dirY, dirZ).normalize();
    gameState.raycaster.set(headPos, rayDir);
    gameState.raycaster.far = targetDist;
    
    // Check collisions with mesh objects only (exclude player, lights, helpers, debug objects)
    const meshes = gameState.scene.children.filter(obj => 
      obj.isMesh && 
      obj !== gameState.player && 
      !obj.userData.isHelper &&
      !obj.userData.isDebug
    );
    const intersects = gameState.raycaster.intersectObjects(meshes, true);
    
    // Use collision distance if hit, otherwise use target distance
    const collisionDist = intersects.length > 0 ? Math.max(0.3, intersects[0].distance - 0.2) : targetDist;
    
    // Smoothly interpolate actual distance
    if (!gameState.actualCameraDistance) gameState.actualCameraDistance = targetDist;
    const lerpSpeed = 0.15;
    gameState.actualCameraDistance += (collisionDist - gameState.actualCameraDistance) * lerpSpeed;
    
    const dist = gameState.actualCameraDistance;
    const cameraX = headPos.x + dist * dirX;
    const cameraZ = headPos.z + dist * dirZ;
    const cameraY = headPos.y + dist * dirY;
    gameState.camera.position.set(cameraX, cameraY, cameraZ);
    gameState.camera.lookAt(headPos);
  } else if (gameState.cameraMode === 2) {
    // Third-person front: inverted position (camera in front of player)
    const targetDist = gameState.cameraDistanceThirdPerson;
    const dirX = -Math.sin(gameState.cameraAngle);
    const dirZ = -Math.cos(gameState.cameraAngle);
    const dirY = Math.sin(gameState.cameraPitch);
    
    // Raycast from head to intended camera position for collision detection
    const rayDir = new THREE.Vector3(dirX, dirY, dirZ).normalize();
    gameState.raycaster.set(headPos, rayDir);
    gameState.raycaster.far = targetDist;
    
    // Check collisions with mesh objects only (exclude player, lights, helpers, debug objects)
    const meshes = gameState.scene.children.filter(obj => 
      obj.isMesh && 
      obj !== gameState.player && 
      !obj.userData.isHelper &&
      !obj.userData.isDebug
    );
    const intersects = gameState.raycaster.intersectObjects(meshes, true);
    
    // Use collision distance if hit, otherwise use target distance
    const collisionDist = intersects.length > 0 ? Math.max(0.3, intersects[0].distance - 0.2) : targetDist;
    
    // Smoothly interpolate actual distance
    if (!gameState.actualCameraDistance) gameState.actualCameraDistance = targetDist;
    const lerpSpeed = 0.15;
    gameState.actualCameraDistance += (collisionDist - gameState.actualCameraDistance) * lerpSpeed;
    
    const dist = gameState.actualCameraDistance;
    const cameraX = headPos.x + dist * dirX;
    const cameraZ = headPos.z + dist * dirZ;
    const cameraY = headPos.y + dist * dirY;
    gameState.camera.position.set(cameraX, cameraY, cameraZ);
    gameState.camera.lookAt(headPos);
  }

  // Update head-mounted light position to follow camera
  // (disabled - using adaptive gamma instead)
  // if (gameState.headLight) {
  //   const lookDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), gameState.cameraAngle);
  //   lookDir.applyAxisAngle(new THREE.Vector3(1, 0, 0), gameState.cameraPitch);
  //   gameState.headLight.position.copy(gameState.camera.position).addScaledVector(lookDir, -0.5);
  // }
}

// Export the entire scene as GLTF for artists to paint textures
export function exportScene() {
  const exporter = new GLTFExporter();
  
  console.log('Exporting scene...');
  
  // Temporarily hide any light cone helpers before export
  const hiddenCones = [];
  gameState.scene.traverse(obj => {
    if (obj.userData.lightCone) {
      obj.userData.lightCone.visible = false;
      hiddenCones.push(obj.userData.lightCone);
    }
  });

  exporter.parse(
    gameState.scene,
    function (result) {
      hiddenCones.forEach(c => { c.visible = true; });
      
      const output = JSON.stringify(result, null, 2);
      const blob = new Blob([output], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'scene-export.gltf';
      link.click();
      console.log('Scene exported as GLTF');
    },
    function (error) {
      hiddenCones.forEach(c => { c.visible = true; });
      console.error('Error exporting scene:', error);
    },
    {
      binary: false, // Export as .gltf (text) instead of .glb (binary) for easier debugging
      embedImages: true // Embed textures in the file
    }
  );
}
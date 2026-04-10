// scene.js - Scene, camera, renderer, and lighting setup
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { gameState, cameraDistance, platformConfig } from './globals.js';
import { isFreecamActive as isFreecamActiveMobile } from './mobileControls.js';
import { isFreecamActive as isFreecamActiveDesktop } from './input.js';
import { advanceObjectState } from './stateManager.js';

// Split a combined mesh into its disconnected vertex islands (e.g. two knobs sharing one mesh)
function splitMeshIntoIslands(mesh) {
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
  const fogDensity = platformConfig.isMobile ? 0.02 : 0.1;
  gameState.scene.fog = new THREE.FogExp2(0x000000, fogDensity);
  
  gameState.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  gameState.camera.position.set(0, 5, 10);
  gameState.camera.lookAt(0, 1, 0);

  gameState.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  gameState.renderer.sortObjects = true;
  gameState.renderer.setSize(window.innerWidth, window.innerHeight);
  gameState.renderer.shadowMap.enabled = true;
  gameState.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    // Scroll wheel — third-person zoom
    document.addEventListener('wheel', (event) => {
      if (gameState.cameraMode === 1 || gameState.cameraMode === 2) {
        event.preventDefault();
        const zoomSpeed = 0.1;
        const direction = event.deltaY > 0 ? -1 : 1;
        gameState.cameraDistanceThirdPerson = Math.max(2, Math.min(15, gameState.cameraDistanceThirdPerson + direction * zoomSpeed));
      }
    }, { passive: false });

    // Right-click = interact with highlighted object
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return; // right button only
      if (gameState.isPaused || !gameState.isPointerLocked) return;
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
  gameState.renderer.setSize(window.innerWidth, window.innerHeight);
  
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
    
    // Smoothly interpolate camera position (higher value = less damping)
    const dampingFactor = 0.25;
    gameState.smoothedCameraPos.lerp(headPos, dampingFactor);
    
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
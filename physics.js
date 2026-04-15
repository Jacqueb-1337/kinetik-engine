// physics.js - Movement, collision, and game update logic
import * as THREE from 'three';
import { gameState, GRAVITY, MOVE_SPEED, JUMP_SPEED, INTERACT_RANGE } from './globals.js';
import { isFreecamActive } from './input.js';

let _interactHook = null;
let _tooltipHook = null;
export function setInteractHook(fn) { _interactHook = fn; }
export function setTooltipHook(fn) { _tooltipHook = fn; }

function _keyDisplay(code) {
  if (!code) return '?';
  if (code === 'MouseLeft') return 'LMB';
  if (code === 'MouseRight') return 'RMB';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'SPACE';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'SHIFT';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'CTRL';
  if (code === 'AltLeft' || code === 'AltRight') return 'ALT';
  return code;
}

function _escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _buildTooltipLines(obj) {
  const lines = [];
  if (!obj.userData.noSelfInteract && obj.userData.states?.length) {
    const nextIdx = ((obj.userData.currentState ?? 0) + 1) % obj.userData.states.length;
    lines.push(obj.userData.states[nextIdx]?.interactLabel || '[RIGHT CLICK] Interact');
  }
  for (const kl of (obj.userData.keyedLinks ?? [])) {
    const tgt = kl.obj;
    const keyDisp = _keyDisplay(kl.key);
    if (kl.label) {
      lines.push(kl.label);
    } else if (tgt.userData.states?.length) {
      const ni = ((tgt.userData.currentState ?? 0) + 1) % tgt.userData.states.length;
      lines.push(tgt.userData.states[ni]?.interactLabel || `[${keyDisp}] Interact`);
    } else {
      lines.push(`[${keyDisp}] Interact`);
    }
  }
  return lines;
}

function _renderInteractTooltip(el, obj) {
  const lines = _buildTooltipLines(obj);
  el.innerHTML = lines.map(l => `<div>${_escHtml(l)}</div>`).join('');
  el.classList.toggle('visible', lines.length > 0);
}

export function refreshInteractTooltip() {
  const obj = gameState.interactObj;
  const el = document.getElementById('interact-tooltip');
  if (!el || !obj) return;
  _renderInteractTooltip(el, obj);
}

function getPlayerBoundingBox() {
  if (!gameState.player) return new THREE.Box3();
  const box = new THREE.Box3();
  
  let hasBones = false;
  gameState.player.traverse((child) => {
    if (child.isBone) {
      const worldPos = new THREE.Vector3();
      child.getWorldPosition(worldPos);
      box.expandByPoint(worldPos);
      hasBones = true;
    }
  });
  
  // Fallback to mesh bounding box if no bones found
  if (!hasBones) {
    gameState.player.updateWorldMatrix(true, true);
    gameState.player.traverse((child) => {
      if (child.isMesh) {
        if (!child.geometry.boundingBox) {
          child.geometry.computeBoundingBox();
        }
        const childBox = child.geometry.boundingBox.clone();
        childBox.applyMatrix4(child.matrixWorld);
        box.union(childBox);
      }
    });
  }
  
  return box;
}

function getPlayerCylinder() {
  const box = getPlayerBoundingBox();
  const modelHeight = box.max.y - box.min.y;
  const heightScale = gameState.hitboxHeightScale || 1;
  const overrideHeight = gameState.hitboxHeightOverride;
  const height = overrideHeight || (modelHeight * heightScale);
  const radius = gameState.hitboxRadiusOverride || Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  const offset = gameState.hitboxOffset || new THREE.Vector3();
  
  // Center horizontally on player position (not bone center)
  const centerX = gameState.player.position.x + offset.x;
  const centerZ = gameState.player.position.z + offset.z;
  const centerY = box.min.y + height / 2 + offset.y;
  
  return {
    center: new THREE.Vector3(centerX, centerY, centerZ),
    radius,
    halfHeight: height / 2,
    height
  };
}

// Calculate bounding box for any object dynamically
function getObjectBoundingBox(object) {
  const box = new THREE.Box3();
  object.updateWorldMatrix(true, true);
  object.traverse((child) => {
    if (child.isMesh) {
      if (!child.geometry.boundingBox) {
        child.geometry.computeBoundingBox();
      }
      const childBox = child.geometry.boundingBox.clone();
      childBox.applyMatrix4(child.matrixWorld);
      box.union(childBox);
    }
  });
  return box;
}

// Get collision box for any object (AABB - axis-aligned bounding box)
function getObjectCollisionBox(object) {
  const box = getObjectBoundingBox(object);
  return {
    center: box.getCenter(new THREE.Vector3()),
    halfSize: box.getSize(new THREE.Vector3()).multiplyScalar(0.5),
    min: box.min,
    max: box.max
  };
}

// Create invisible collision hitbox for an object based on its mesh dimensions
export function createCollisionHitbox(object) {
  const collisionBox = getObjectCollisionBox(object);
  const size = collisionBox.halfSize.multiplyScalar(2);
  
  const hitboxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const hitboxMat = new THREE.MeshBasicMaterial({ 
    visible: true,
    wireframe: true,
    color: 0x00ff00,
    transparent: true,
    opacity: 0.5
  });
  const hitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
  hitboxMesh.position.copy(collisionBox.center);
  hitboxMesh.userData.collidable = true;
  hitboxMesh.userData.isHitbox = true;
  hitboxMesh.userData.isDebug = true;  // Mark as debug object for camera collision exclusion
  hitboxMesh.visible = false; // Hidden by default, shown in dev mode
  
  return hitboxMesh;
}

function mergeBufferGeometries(geometries) {
  const positions = [];
  const normals = [];
  const uvs = [];

  geometries.forEach((geometry) => {
    const geom = geometry.index ? geometry.toNonIndexed() : geometry;
    const positionAttr = geom.attributes.position;
    const normalAttr = geom.attributes.normal;
    const uvAttr = geom.attributes.uv;
    positions.push(...positionAttr.array);
    normals.push(...normalAttr.array);
    if (uvAttr) {
      uvs.push(...uvAttr.array);
    }
  });

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (uvs.length) {
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  return merged;
}

function createHitboxHelperMesh() {
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.35 });
  const group = new THREE.Group();
  group.visible = false; // Hidden by default, toggle with F3
  group.userData.isDebug = true;  // Mark as debug object for camera collision exclusion
  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1, true), material);
  const topSphere = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), material);
  const bottomSphere = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), material);
  group.add(cylinder, topSphere, bottomSphere);
  group._cylinder = cylinder;
  group._topSphere = topSphere;
  group._bottomSphere = bottomSphere;
  return group;
}

// Blend between idle, walk, run, and jump animations
let debugFrameCount = 0;
let wasInAir = false;
export function updateWalkingAnimation(isMoving, moveSpeed, delta, gameState) {
  debugFrameCount++;
  
  if (!gameState.animationMixer || !gameState.idleAction || !gameState.walkAction) {
    if (debugFrameCount === 1) console.log('Animation mixer not ready');
    return;
  }
  
  // Determine if player is in air and sprinting
  const isInAir = gameState.velocityY !== 0 || gameState.isJumpWindup;
  const isSprinting = gameState.keys['ShiftLeft'] || gameState.keys['ShiftRight'];
  
  // Blend jump weight
  const targetJumpWeight = isInAir ? 1.0 : 0.0;
  gameState.jumpWeight += (targetJumpWeight - gameState.jumpWeight) * Math.min(1, delta * 3);
  
  // Determine movement direction for animation selection
  let moveForward = 0, moveRight = 0;
  if (gameState.keys['KeyW'] || gameState.keys['ArrowUp']) moveForward = 1;
  if (gameState.keys['KeyS'] || gameState.keys['ArrowDown']) moveForward = -1;
  if (gameState.keys['KeyA'] || gameState.keys['ArrowLeft']) moveRight = -1;
  if (gameState.keys['KeyD'] || gameState.keys['ArrowRight']) moveRight = 1;
  
  const isMovingForward = moveForward === 1 && moveRight === 0;
  const isMovingBackward = moveForward === -1 && moveRight === 0;
  const isMovingLeft = moveRight === -1;
  const isMovingRight = moveRight === 1;
  
  // Blend walk/run/strafe based on movement direction and sprint
  const targetRunWeight = (isMovingForward && isSprinting) ? 1.0 : 0.0;
  const targetWalkWeight = (isMovingForward && !isSprinting) ? 1.0 : 0.0;
  const targetBackwardWalkWeight = (isMovingBackward && !isSprinting) ? 1.0 : 0.0;
  const targetBackwardRunWeight = (isMovingBackward && isSprinting) ? 1.0 : 0.0;
  const targetLeftStrafeWeight = (isMovingLeft && !isSprinting) ? 1.0 : 0.0;
  const targetLeftStrafeRunWeight = (isMovingLeft && isSprinting) ? 1.0 : 0.0;
  const targetRightStrafeWeight = (isMovingRight && !isSprinting) ? 1.0 : 0.0;
  const targetRightStrafeRunWeight = (isMovingRight && isSprinting) ? 1.0 : 0.0;
  
  gameState.runWeight += (targetRunWeight - gameState.runWeight) * Math.min(1, delta * 3);
  gameState.walkWeight += (targetWalkWeight - gameState.walkWeight) * Math.min(1, delta * 3);
  gameState.backwardWalkWeight += (targetBackwardWalkWeight - gameState.backwardWalkWeight) * Math.min(1, delta * 3);
  gameState.backwardRunWeight += (targetBackwardRunWeight - gameState.backwardRunWeight) * Math.min(1, delta * 3);
  gameState.leftStrafeWalkWeight += (targetLeftStrafeWeight - gameState.leftStrafeWalkWeight) * Math.min(1, delta * 3);
  gameState.leftStrafeRunWeight += (targetLeftStrafeRunWeight - gameState.leftStrafeRunWeight) * Math.min(1, delta * 3);
  gameState.rightStrafeWalkWeight += (targetRightStrafeWeight - gameState.rightStrafeWalkWeight) * Math.min(1, delta * 3);
  gameState.rightStrafeRunWeight += (targetRightStrafeRunWeight - gameState.rightStrafeRunWeight) * Math.min(1, delta * 3);
  
  // Scale idle/walk/run/strafe by the remaining weight after jump
  const remainingWeight = 1.0 - gameState.jumpWeight;
  const totalGroundWeight = gameState.walkWeight + gameState.runWeight + gameState.leftStrafeWalkWeight + gameState.rightStrafeWalkWeight + gameState.backwardWalkWeight + gameState.backwardRunWeight + gameState.leftStrafeRunWeight + gameState.rightStrafeRunWeight;
  gameState.idleWeight = (1.0 - totalGroundWeight) * remainingWeight;
  const scaledWalkWeight = gameState.walkWeight * remainingWeight;
  const scaledRunWeight = gameState.runWeight * remainingWeight;
  const scaledBackwardWalkWeight = gameState.backwardWalkWeight * remainingWeight;
  const scaledBackwardRunWeight = gameState.backwardRunWeight * remainingWeight;
  const scaledLeftStrafeWeight = gameState.leftStrafeWalkWeight * remainingWeight;
  const scaledLeftStrafeRunWeight = gameState.leftStrafeRunWeight * remainingWeight;
  const scaledRightStrafeWeight = gameState.rightStrafeWalkWeight * remainingWeight;
  const scaledRightStrafeRunWeight = gameState.rightStrafeRunWeight * remainingWeight;
  
  // Set blend weights (always sum to 1.0)
  gameState.idleAction.setEffectiveWeight(gameState.idleWeight);
  gameState.walkAction.setEffectiveWeight(scaledWalkWeight);
  if (gameState.runAction) gameState.runAction.setEffectiveWeight(scaledRunWeight);
  if (gameState.backwardWalkAction) gameState.backwardWalkAction.setEffectiveWeight(scaledBackwardWalkWeight);
  if (gameState.backwardRunAction) gameState.backwardRunAction.setEffectiveWeight(scaledBackwardRunWeight);
  if (gameState.leftStrafeWalkAction) gameState.leftStrafeWalkAction.setEffectiveWeight(scaledLeftStrafeWeight);
  if (gameState.leftStrafeRunAction) gameState.leftStrafeRunAction.setEffectiveWeight(scaledLeftStrafeRunWeight);
  if (gameState.rightStrafeWalkAction) gameState.rightStrafeWalkAction.setEffectiveWeight(scaledRightStrafeWeight);
  if (gameState.rightStrafeRunAction) gameState.rightStrafeRunAction.setEffectiveWeight(scaledRightStrafeRunWeight);
  if (gameState.jumpAction) gameState.jumpAction.setEffectiveWeight(gameState.jumpWeight);
  
  if (debugFrameCount <= 3) {
    console.log(`Frame ${debugFrameCount}: idle=${gameState.idleWeight.toFixed(2)}, walk=${scaledWalkWeight.toFixed(2)}, run=${scaledRunWeight.toFixed(2)}, leftStrafe=${scaledLeftStrafeWeight.toFixed(2)}, rightStrafe=${scaledRightStrafeWeight.toFixed(2)}, jump=${(gameState.jumpWeight || 0).toFixed(2)}`);
  }
}

function updateHitboxHelper(capsule) {
  if (!gameState.hitboxHelper) {
    gameState.hitboxHelper = createHitboxHelperMesh();
    gameState.scene.add(gameState.hitboxHelper);
  }
  const helper = gameState.hitboxHelper;
  const bodyLength = Math.max(capsule.height - capsule.radius * 2, 0);
  helper.position.copy(capsule.center);
  helper._cylinder.scale.set(capsule.radius, bodyLength || 0.01, capsule.radius);
  helper._cylinder.position.set(0, 0, 0);
  helper._topSphere.scale.set(capsule.radius, capsule.radius, capsule.radius);
  helper._topSphere.position.set(0, bodyLength / 2, 0);
  helper._bottomSphere.scale.set(capsule.radius, capsule.radius, capsule.radius);
  helper._bottomSphere.position.set(0, -bodyLength / 2, 0);
}



export function update(delta) {
  // Skip player movement when freecam is active
  if (isFreecamActive()) {
    return;
  }
  
  // Horizontal movement relative to camera
  const forwardX = -Math.sin(gameState.cameraAngle);
  const forwardZ = -Math.cos(gameState.cameraAngle);
  const rightX = Math.cos(gameState.cameraAngle);
  const rightZ = -Math.sin(gameState.cameraAngle);

  let moveX = 0;
  let moveZ = 0;
  if (gameState.keys['KeyW'] || gameState.keys['ArrowUp']) { moveX += forwardX; moveZ += forwardZ; }
  if (gameState.keys['KeyS'] || gameState.keys['ArrowDown']) { moveX -= forwardX; moveZ -= forwardZ; }
  if (gameState.keys['KeyA'] || gameState.keys['ArrowLeft']) { moveX -= rightX; moveZ -= rightZ; }
  if (gameState.keys['KeyD'] || gameState.keys['ArrowRight']) { moveX += rightX; moveZ += rightZ; }

  // Check if player is moving
  const isMoving = Math.abs(moveX) > 0.01 || Math.abs(moveZ) > 0.01;
  const moveSpeed = Math.sqrt(moveX * moveX + moveZ * moveZ); // Calculate movement magnitude
  const isSprinting = gameState.keys['ShiftLeft'] || gameState.keys['ShiftRight'];
  
  // Update walking animation
  updateWalkingAnimation(isMoving, moveSpeed, delta, gameState);

  // Smooth speed ramping (acceleration/deceleration)
  const targetSpeedMultiplier = !isMoving ? 0 : (isSprinting ? 2.0 : 1.0);
  const acceleration = 8.0; // How fast to ramp up/down
  gameState.currentSpeed += (targetSpeedMultiplier - gameState.currentSpeed) * Math.min(1, delta * acceleration);
  
  // Apply movement with smoothed speed
  const playerCapsule = getPlayerCylinder();
  const moveAmount = MOVE_SPEED * delta * gameState.currentSpeed;

  // Build collider list once per frame, pre-filtered by proximity
  const _px = gameState.player.position.x, _pz = gameState.player.position.z;
  const CULL_DIST = 8;
  const checkObjects = gameState.scene.children.filter(obj => {
    const isWall = (obj.geometry instanceof THREE.BoxGeometry || obj.geometry instanceof THREE.PlaneGeometry) &&
      obj !== gameState.ground &&
      obj !== gameState.player;
    const isCollidable = obj.userData?.collidable || gameState.collidableObjects?.includes(obj);
    if (!isWall && !isCollidable) return false;
    const dx = obj.position.x - _px, dz = obj.position.z - _pz;
    return (dx*dx + dz*dz) < CULL_DIST * CULL_DIST;
  });

  // Three ray heights covering the full player capsule: ankle, centre, head.
  // This ensures objects at any vertical position (floor-level cubes, waist-high
  // barriers, head-level beams, etc.) are detected regardless of where they sit.
  const playerBottom = playerCapsule.center.y - playerCapsule.halfHeight;
  const playerTop    = playerCapsule.center.y + playerCapsule.halfHeight;
  const rayHeights   = [playerBottom + 0.1, playerCapsule.center.y, playerTop - 0.1];
  const clearanceMargin = 0.3;

  function checkBlocked(dir3) {
    for (const ry of rayHeights) {
      gameState.raycaster.set(
        new THREE.Vector3(playerCapsule.center.x, ry, playerCapsule.center.z),
        dir3
      );
      const hits = gameState.raycaster.intersectObjects(checkObjects, true);
      if (hits.length > 0 && hits[0].distance <= playerCapsule.radius) {
        const obsBox = new THREE.Box3().setFromObject(hits[0].object);
        if (playerBottom < obsBox.max.y - clearanceMargin && playerTop > obsBox.min.y) {
          return true;
        }
      }
    }
    return false;
  }

  // Check X movement
  const dirX = Math.sign(moveX);
  if (dirX !== 0) {
    if (!checkBlocked(new THREE.Vector3(dirX, 0, 0))) {
      gameState.player.position.x += moveX * moveAmount;
    }
  }
  
  // Check Z movement
  const dirZ = Math.sign(moveZ);
  if (dirZ !== 0) {
    if (!checkBlocked(new THREE.Vector3(0, 0, dirZ))) {
      gameState.player.position.z += moveZ * moveAmount;
    }
  }

  // Rotate player smoothly to match camera angle (add Math.PI to face away)
  const targetRotation = gameState.cameraAngle + Math.PI;
  gameState.playerRotation = THREE.MathUtils.lerp(gameState.playerRotation, targetRotation, 0.2);
  gameState.player.rotation.y = gameState.playerRotation;

  // Jumping with animation windup
  const JUMP_WINDUP_FRAME = 13;
  const ANIMATION_FPS = 24; // Mixamo animation FPS
  const JUMP_WINDUP_TIME = JUMP_WINDUP_FRAME / ANIMATION_FPS; // ~0.542 seconds
  
  if (gameState.keys['Space'] && gameState.canJump && !gameState.isJumpWindup) {
    // Start jump windup - animation plays but no velocity yet
    gameState.isJumpWindup = true;
    gameState.canJump = false;
    if (gameState.jumpAction) {
      gameState.jumpAction.time = 0;  // Reset animation to start
      gameState.jumpAction.paused = false;
      gameState.jumpAction.timeScale = 2.5;  // Play windup fast
    }
    console.log('Jump windup started, animation reset to 0, target time:', JUMP_WINDUP_TIME);
  }
  
  // Check if windup animation has reached frame 13
  if (gameState.isJumpWindup) {
    if (!gameState.jumpAction) {
      console.warn('Jump action not loaded yet');
    } else {
      const currentTime = gameState.jumpAction.time;
      
      if (currentTime >= JUMP_WINDUP_TIME) {
        // Apply jump velocity
        gameState.velocityY = JUMP_SPEED;
        gameState.isJumpWindup = false;
        gameState.jumpAction.timeScale = 1;  // Rest of jump at normal speed
        console.log('VELOCITY APPLIED! Jumping now at frame', (currentTime * ANIMATION_FPS).toFixed(1));
      }
    }
  }

  // Apply gravity
  gameState.velocityY += GRAVITY * delta;
  gameState.player.position.y += gameState.velocityY * delta;

  const playerCylinder = getPlayerCylinder();

  // Ground collision using raycasting
  const rayOrigin = playerCylinder.center.clone();
  gameState.raycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));

  // All collidable objects — no proximity cull here since it's a single vertical ray
  const standableObjects = gameState.scene.children.filter(obj => {
    const isCollidable = obj.userData?.collidable || gameState.collidableObjects?.includes(obj);
    return isCollidable && obj !== gameState.player;
  });
  let intersects = standableObjects.length > 0
    ? gameState.raycaster.intersectObjects(standableObjects, true)
    : [];
  
  // Sort by distance and get closest intersection
  if (intersects.length > 0) {
    intersects.sort((a, b) => a.distance - b.distance);
    const closestIntersect = intersects[0];
    const centerOffset = playerCylinder.center.y - gameState.player.position.y;
    const desiredPlayerY = closestIntersect.point.y + playerCylinder.halfHeight - centerOffset;
    const penetration = desiredPlayerY - gameState.player.position.y;
    if (penetration >= -0.2 && gameState.velocityY <= 0) {
      gameState.player.position.y = desiredPlayerY;
      gameState.velocityY = 0;
      gameState.canJump = true;
    } else {
      gameState.canJump = false;
    }
  } else {
    gameState.canJump = false;
  }

  // Ceiling collision — cast upward from capsule center to prevent passing through geometry above
  if (gameState.velocityY > 0) {
    const ceilOrigin = playerCylinder.center.clone();
    gameState.raycaster.set(ceilOrigin, new THREE.Vector3(0, 1, 0));
    let ceilHits = [];
    if (standableObjects.length > 0) ceilHits = gameState.raycaster.intersectObjects(standableObjects, true);
    if (ceilHits.length > 0) {
      ceilHits.sort((a, b) => a.distance - b.distance);
      const hit = ceilHits[0];
      if (hit.distance <= playerCylinder.halfHeight + 0.15) {
        const centerOffset = playerCylinder.center.y - gameState.player.position.y;
        gameState.player.position.y = hit.point.y - playerCylinder.halfHeight - centerOffset;
        gameState.velocityY = 0;
      }
    }
  }

  // Update hitbox helper
  updateHitboxHelper(playerCylinder);

  // Interaction target detection — right-click is handled in scene.js
  // Detect what the player is looking at for tooltip
  let newTarget = null;
  if (_interactHook) { const extra = _interactHook(); if (extra && !newTarget) newTarget = extra; }

  // Check for state-interactable level objects (placed via editor with states defined)
  if (!newTarget && gameState.statefulObjects?.length && gameState.camera) {
    const camPos = gameState.camera.position;
    const rayDir = gameState.camera.getWorldDirection(new THREE.Vector3());
    gameState.raycaster.set(camPos, rayDir);
    gameState.raycaster.far = INTERACT_RANGE;
    const hits = gameState.raycaster.intersectObjects(gameState.statefulObjects, true);
    gameState.raycaster.far = Infinity;
    if (hits.length) {
      // Walk up to find the root stateful object
      let root = hits[0].object;
      while (root.parent && !root.userData.states) root = root.parent;
      const canSelf = root.userData.states?.length && !root.userData.noSelfInteract;
      const hasKeyedLinks = root.userData.keyedLinks?.length > 0;
      if (canSelf || hasKeyedLinks) {
        newTarget = 'state-obj';
        gameState.interactObj = root;
      }
    }
    if (newTarget !== 'state-obj') gameState.interactObj = null;
  }

  // Update tooltip
  if (newTarget !== gameState.interactTarget) {
    gameState.interactTarget = newTarget;
    const el = document.getElementById('interact-tooltip');
    if (el) {
      if (newTarget === 'state-obj') {
        _renderInteractTooltip(el, gameState.interactObj);
      } else if (_tooltipHook && _tooltipHook(newTarget, el)) {
        // handled by game
      } else {
        el.classList.remove('visible');
      }
    }
  }
}

export function resetGame() {
  if (gameState.resetCooldown) return;
  gameState.resetCooldown = true;
  setTimeout(() => gameState.resetCooldown = false, 500);

  // Reset player
  if (gameState.playerSpawnObj) {
    const p = gameState.playerSpawnObj.position;
    gameState.player.position.set(p.x, p.y, p.z);
  } else if (gameState.playerSpawn) {
    const sp = gameState.playerSpawn;
    gameState.player.position.set(sp.x, sp.y, sp.z);
  } else {
    gameState.player.position.set(0, 2, 0);
  }
  gameState.velocityY = 0;
  gameState.canJump = false;

  // Reset score
  gameState.score = 0;
  document.getElementById('score').textContent = 'Score: 0';

  // Reset lives
  gameState.lives = 3;
  gameState.lastLifeScore = 0;
  document.getElementById('lives').textContent = 'Lives: 3';



  // Clear keys
  for (let key in gameState.keys) {
    gameState.keys[key] = false;
  }

  // Reset camera angles
  gameState.cameraAngle = 0;
  gameState.cameraPitch = 0;
  gameState.playerRotation = 0;
}

export function setHitboxHeightScale(scale) {
  gameState.hitboxHeightScale = scale;
}
// globals.js - Shared variables for the game
import * as THREE from 'three';
import { platformConfig } from './platform.js';

export { platformConfig };

export const gameState = {
  scene: null,
  camera: null,
  renderer: null,
  player: null,
  ground: null,
  velocityY: 0,
  canJump: false,
  isJumpWindup: false,
  jumpWindupStartTime: 0,
  resetCooldown: false,
  currentSpeed: 0,
  cameraAngle: 0,
  cameraPitch: 0,
  isPointerLocked: false,
  playerRotation: 0,
  cameraMode: 0,  // 0 = first person, 1 = third person behind, 2 = third person front
  cameraDistance: 0.5,  // Distance from character in first person (0.1 to 3)
  cameraDistanceThirdPerson: 5,  // Distance for third person modes
  actualCameraDistance: 5,  // Actual distance after collision detection
  smoothedCameraPos: null,  // Smoothed position for first-person camera damping
  debugMode: false,
  debugFogWireframe: false,  // Toggle fog visualization
  fogWireframe: null,  // Fog boundary wireframe mesh
  hitboxHelper: null,
  hitboxOverride: null,
  hitboxOffset: new THREE.Vector3(0, 0.0, 0),
  hitboxRadiusOverride: 0.4,
  hitboxHeightOverride: null,
  hitboxHeightScale: 1,
  keys: {},
  raycaster: new THREE.Raycaster(),
  clock: new THREE.Clock(),
  ambientLight: null,
  ambientBrightness: 0.01,
  collidableObjects: [],  // All objects with collision enabled
  statefulObjects: [],   // Level objects with userData.states — checked for interaction
  saveTriggers: [],      // Level save-trigger volumes — checked each frame by saveManager
  currentLevel: 'main',  // Name of the currently loaded level
  flags: {},             // Arbitrary boolean/value flags for mission/story state
  hitboxes: [],  // All collision hitboxes for dev mode visualization
  animationMixer: null,
  walkAction: null,
  idleAction: null,
  jumpAction: null,
  runAction: null,
  leftStrafeWalkAction: null,
  rightStrafeWalkAction: null,
  backwardWalkAction: null,
  backwardRunAction: null,
  leftStrafeRunAction: null,
  rightStrafeRunAction: null,
  idleWeight: 0,
  walkWeight: 0,
  jumpWeight: 0,
  runWeight: 0,
  leftStrafeWalkWeight: 0,
  rightStrafeWalkWeight: 0,
  backwardWalkWeight: 0,
  backwardRunWeight: 0,
  leftStrafeRunWeight: 0,
  rightStrafeRunWeight: 0,
  currentAnimation: null,
  interactTarget: null,
  interactObj: null,
};

export const GRAVITY = -30;
export const MOVE_SPEED = 5;
export const JUMP_SPEED = 10;
export const cameraDistance = 10;
export const INTERACT_RANGE = 6;  // Max distance (metres) for all interactable objects
import { gameState } from '../core/globals.js';

export function initGameGlobals() {
  gameState.mainMenuActive = false;
  gameState.isPaused = false;
  gameState.isPauseAnimating = false;
  gameState.currentLevel = 'main';
  gameState.fov = 60;
  gameState.userGamma = 1.0;
  gameState.ambientBrightness = 0.22;
  gameState.cameraMode = 0;
  gameState.cameraDistance = 0.5;
  gameState.cameraDistanceThirdPerson = 5;
}

initGameGlobals();

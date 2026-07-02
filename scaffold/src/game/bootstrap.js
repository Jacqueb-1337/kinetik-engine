import { initScene, updateCamera } from '../core/scene.js';
import { initInput, updateFreecam } from '../core/input.js';
import { update } from '../core/physics.js';
import { loadLevel } from '../core/levelLoader.js';
import { gameState } from '../core/globals.js';
import { initGameGlobals } from './globals.js';
import { createGround } from './ground.js';
import { createPlayer } from './player.js';

function positionPlayerFromSpawn() {
  if (!gameState.player) return;
  if (gameState.playerSpawnObj?.position) {
    const p = gameState.playerSpawnObj.position;
    gameState.player.position.set(p.x, p.y, p.z);
    return;
  }
  if (gameState.playerSpawn) {
    const sp = gameState.playerSpawn;
    gameState.player.position.set(sp.x, sp.y, sp.z);
    return;
  }
  gameState.player.position.set(0, 0, 0);
}

export async function startGame() {
  initGameGlobals();
  window.gameState = gameState;

  initScene();
  initInput();

  createGround();

  try {
    await loadLevel('main');
  } catch (err) {
    console.warn('[bootstrap] main level could not be loaded, booting blank scene instead:', err);
  }

  await createPlayer();
  positionPlayerFromSpawn();

  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(0.05, gameState.clock.getDelta());
    update(delta);
    updateCamera();
    updateFreecam(delta);
    if (gameState.animationMixer) {
      gameState.animationMixer.update(delta);
    }
    gameState.renderer.render(gameState.scene, gameState.camera);
  }

  animate();
}

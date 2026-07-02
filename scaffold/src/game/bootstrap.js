import { initScene, updateCamera } from '@kinetik/engine/scene.js';
import { initInput, updateFreecam } from '@kinetik/engine/input.js';
import { update } from '@kinetik/engine/physics.js';
import { loadLevel } from '@kinetik/engine/levelLoader.js';
import { gameState } from '@kinetik/engine/globals.js';
import { initGameGlobals } from '@kinetik/engine/game/globals.js';
import { createGround } from '@kinetik/engine/game/ground.js';
import { createPlayer } from '@kinetik/engine/game/player.js';

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

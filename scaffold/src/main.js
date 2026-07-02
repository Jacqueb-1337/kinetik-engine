import { initScene } from './core/scene.js';
import { gameState } from './core/globals.js';

initScene();

function animate() {
  requestAnimationFrame(animate);
  gameState.renderer.render(gameState.scene, gameState.camera);
}

animate();

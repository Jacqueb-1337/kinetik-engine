import { startGame } from './game/bootstrap.js';

startGame().catch((err) => {
  console.error('[kinetik] failed to start game bootstrap:', err);
});

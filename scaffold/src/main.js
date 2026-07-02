import { startGame } from 'kinetik-engine/game/bootstrap.js';

startGame().catch((err) => {
  console.error('[kinetik] failed to start game bootstrap:', err);
});

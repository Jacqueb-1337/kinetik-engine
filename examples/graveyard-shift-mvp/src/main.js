import { startGraveyardShift } from './game/graveyardShift.js';

startGraveyardShift().catch((error) => {
  console.error('[graveyard-shift] failed to start:', error);
  const fatal = document.getElementById('fatal-error');
  if (fatal) {
    fatal.textContent = `Failed to start: ${error.message}`;
    fatal.classList.add('visible');
  }
});

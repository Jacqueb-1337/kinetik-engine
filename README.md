# Kinetik Engine

A lightweight 3D game engine built on [Three.js](https://threejs.org/) for desktop (Electron) and mobile (Capacitor/Android). Provides a scene graph, physics, input, level loading, a built-in visual editor, save management, and spatial audio out of the box.

---

## Core Modules

| Module | Purpose |
|---|---|
| `globals.js` | Shared `gameState` object and engine constants |
| `scene.js` | Renderer, camera, lighting, resize, TV knob interaction |
| `physics.js` | Player collision, movement, gravity, interact/tooltip hooks |
| `input.js` | Keyboard/mouse input, freecam, pause toggle hook |
| `mobileControls.js` | Touch joystick and mobile freecam |
| `levelLoader.js` | Loads `.json` level files, spawns meshes, CSG, image models |
| `stateManager.js` | Stateful object system, enter/exit sounds, level vars |
| `saveManager.js` | Cross-platform save slots (Capacitor Preferences / localStorage) |
| `editor.js` | Full visual level editor (launch with `--editor` flag) |
| `settings.js` | Persistent player settings |

---

## Quick Start — New Game Project

1. **Create a folder and add Kinetik as a submodule**
   ```bash
   mkdir my-game && cd my-game && git init
   git submodule add https://github.com/Jacqueb-1337/kinetik-engine.git src/core
   ```

2. **Run the scaffold script** — copies `electron-main.js`, `preload.js`, `package.json`, `vite.config.js`, `.gitignore`, and all required asset directories into the project root:
   ```bash
   node src/core/init.js
   ```

3. **Set your game name** — open the generated `package.json` and update `name`, `build.appId`, and `build.productName`.

4. **Install dependencies**:
   ```bash
   npm install
   ```

5. **Create your entry point** (`src/main.js`):
   ```js
   import { gameState } from './core/globals.js';
   import { initScene, updateCamera } from './core/scene.js';
   import { initInput } from './core/input.js';
   import { loadLevel } from './core/levelLoader.js';
   import { update as physicsUpdate } from './core/physics.js';
   import { updateStateAnimations } from './core/stateManager.js';

   await initScene();
   initInput();
   await loadLevel('main');

   function loop(delta) {
     physicsUpdate(delta);
     updateCamera();
     updateStateAnimations(delta);
     gameState.renderer.render(gameState.scene, gameState.camera);
   }
   ```

6. **Create `levels/main.json`** — start with an empty level:
   ```json
   { "objects": [], "playerStart": { "x": 0, "y": 1, "z": 0 } }
   ```

7. **Run**:
   ```bash
   npm start          # Electron desktop (game)
   npm run editor     # Electron desktop (visual editor)
   ```

---

## Visual Editor

Launch with the `--editor` flag:

```bash
npm run editor     # equivalent to: electron . --editor
```

The editor opens `initEditor()` from `editor.js` instead of the game loop. From there you can:

- Place, move, rotate, and scale meshes
- Paint CSG cuts and boolean geometry
- Add stateful objects with enter/exit sounds and animations
- Set level variables and trigger conditions
- Place player spawn, save triggers, and interact zones
- Export the scene back to `levels/<name>.json`

To open the editor in a new project, follow the Quick Start above and use `npm run editor`.

---

## Spatial Audio

```js
import { playSound } from './core/stateManager.js';

// Play a sound at a world position — handles distance falloff,
// stereo panning, masterVolume, and ogg/mp3/wav format fallback.
playSound('explosion', new THREE.Vector3(4, 0, -10));
```

Drop audio files in `sounds/` as `<name>.ogg`, `<name>.mp3`, or `<name>.wav` — the engine tries each in that order.

---

## Save System

```js
import { triggerSave, loadSave, registerSaveExtension } from './core/saveManager.js';

// Register custom data to save/restore
registerSaveExtension('myGame', {
  capture: () => ({ score, inventory }),
  restore: (data) => { score = data.score; inventory = data.inventory; }
});

await triggerSave('slot1');
await loadSave('slot1');
```

Works on desktop (Electron file system) and mobile (Capacitor Preferences) automatically.

---

## Stateful Objects

Objects in level JSON can have a `states` array. Each state has enter/exit sounds, animations, and variable conditions. Advance state at runtime:

```js
import { advanceObjectState, fireButtonTrigger, setLevelVar } from './core/stateManager.js';

advanceObjectState(myMesh);           // cycle to next state
fireButtonTrigger(myMesh, 'press');   // fire a named trigger
setLevelVar('door_open', true);       // set a level variable
```

---

## Platform

Kinetik targets:
- **Desktop** — Electron (Windows / Mac / Linux)
- **Mobile** — Capacitor (Android), with touch joystick via `mobileControls.js`
- **Browser** — Vite dev server for rapid iteration

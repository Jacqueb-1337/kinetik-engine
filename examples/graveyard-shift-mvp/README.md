# Graveyard Shift MVP

A low-poly, cartoony vertical slice built with the published `kinetik-engine` npm package.

## Play

```bash
npm install
npm run dev
```

For Electron on a normal local machine:

```bash
npm start
```

## Included mechanics

- Living third-person movement and shovel combat
- Death changes the player into a free-flying ghost
- Reclaim your own corpse for a permanent revival
- Possess another corpse for 24 seconds of direct living combat
- Sneak behind living NPCs and possess them
- Apply competing movement and attack inputs while the host AI continues acting
- Telekinetically drag, aim, and throw physical props
- Heavy props such as the piano deal more impact damage but move slowly
- Lethal spike trap for forced-possession kills
- Hostile AI ghost that throws props at living characters
- Lantern counterplay that scatters exposed ghosts

## Controls

Living: WASD, mouse, left click, F lantern, K test death, R reset.

Ghost: WASD, Space and Ctrl for height, hold E to possess, right click to grab or release props, left click to throw.

Living possession: WASD adds movement against the host AI, left click forces an attack, Q inverts the host's instincts, E exits.

## Scope

This build is a single-player mechanics sandbox. The systems are structured around actors and bodies so networking can replace the NPC controllers later without changing the core living, ghost, corpse, possession, and telekinesis states.

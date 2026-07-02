import * as THREE from 'three';
import { gameState } from 'kinetik-engine/globals.js';

function buildStarterAvatar() {
  const group = new THREE.Group();
  group.name = 'starter-player';
  group.position.set(0, 0, 0);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xbfc7d9, roughness: 0.75, metalness: 0 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x4f8cff, roughness: 0.45, metalness: 0 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 1, metalness: 0 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.92, 4, 10), bodyMat);
  torso.position.set(0, 0.96, 0);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 12), accentMat);
  head.position.set(0, 1.62, 0);

  const boots = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.5), bootMat);
  boots.position.set(0, 0.06, 0.02);

  group.add(torso, head, boots);

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.layers.set(1);
    }
  });

  group.layers.set(1);
  return group;
}

export async function createPlayer() {
  const player = buildStarterAvatar();
  gameState.scene.add(player);
  gameState.player = player;
  return player;
}

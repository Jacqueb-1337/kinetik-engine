import * as THREE from 'three';
import { gameState } from 'kinetik-engine/globals.js';

function addWall(room, size, position, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 })
  );
  mesh.position.copy(position);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.collidable = true;
  room.add(mesh);
  gameState.collidableObjects.push(mesh);
  return mesh;
}

export function createGround() {
  const room = new THREE.Group();
  room.name = 'starter-room';

  if (!Array.isArray(gameState.collidableObjects)) {
    gameState.collidableObjects = [];
  }

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(24, 0.2, 24),
    new THREE.MeshStandardMaterial({ color: 0x161b25, roughness: 1, metalness: 0 })
  );
  floor.position.set(0, -0.1, 0);
  floor.receiveShadow = true;
  floor.userData.collidable = true;
  room.add(floor);
  gameState.collidableObjects.push(floor);
  gameState.ground = floor;

  addWall(room, new THREE.Vector3(24, 6, 0.2), new THREE.Vector3(0, 3, -12), 0x2a3140);
  addWall(room, new THREE.Vector3(24, 6, 0.2), new THREE.Vector3(0, 3, 12), 0x2a3140);
  addWall(room, new THREE.Vector3(0.2, 6, 24), new THREE.Vector3(-12, 3, 0), 0x242a36);
  addWall(room, new THREE.Vector3(0.2, 6, 24), new THREE.Vector3(12, 3, 0), 0x242a36);

  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(24, 0.2, 24),
    new THREE.MeshStandardMaterial({ color: 0x0f1320, roughness: 1, metalness: 0 })
  );
  ceiling.position.set(0, 6.1, 0);
  ceiling.userData.collidable = true;
  room.add(ceiling);
  gameState.collidableObjects.push(ceiling);

  const light = new THREE.DirectionalLight(0xffffff, 0.65);
  light.position.set(4, 8, 3);
  room.add(light);

  const fill = new THREE.PointLight(0x88aaff, 0.7, 40);
  fill.position.set(0, 4.5, 0);
  room.add(fill);

  gameState.scene.add(room);
  return room;
}

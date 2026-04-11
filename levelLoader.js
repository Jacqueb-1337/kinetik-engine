// levelLoader.js — Spawns objects from a level JSON file into the game scene.
// Called from main.js after initScene(). Works only inside Electron (window.electron IPC).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { gameState } from './globals.js';
import { initStatefulObjects, levelVars } from './stateManager.js';

const RAD = Math.PI / 180;

let _gltfLoader = null;
function getGLTFLoader() {
  if (!_gltfLoader) _gltfLoader = new GLTFLoader();
  return _gltfLoader;
}

let _fbxLoader = null;
function getFBXLoader() {
  if (!_fbxLoader) _fbxLoader = new FBXLoader();
  return _fbxLoader;
}

let _texLoader = null;
function getTexLoader() {
  if (!_texLoader) _texLoader = new THREE.TextureLoader();
  return _texLoader;
}

// ── faceTextures support ────────────────────────────────────────────────────
const WRAP_MAP = {
  repeat: THREE.RepeatWrapping,
  clamp:  THREE.ClampToEdgeWrapping,
  mirror: THREE.MirroredRepeatWrapping,
};

// Build a MeshStandardMaterial from a faceTextures config object (mirrors editor's makeFaceTexMat)
function buildFaceTexMat(baseColor, cfg, side = THREE.FrontSide) {
  if (!cfg?.name) return new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, side });
  const wrapMode = WRAP_MAP[cfg.wrap] ?? THREE.RepeatWrapping;
  const tex = getTexLoader().load(
    `./textures/${cfg.name}.png`,
    undefined,
    undefined,
    () => getTexLoader().load(`./textures/${cfg.name}.jpg`, t => {
      t.wrapS = t.wrapT = wrapMode;
      t.repeat.set(cfg.rx ?? 1, cfg.ry ?? 1);
      t.offset.set(cfg.ox ?? 0, cfg.oy ?? 0);
      t.needsUpdate = true;
    })
  );
  tex.wrapS = tex.wrapT = wrapMode;
  tex.repeat.set(cfg.rx ?? 1, cfg.ry ?? 1);
  tex.offset.set(cfg.ox ?? 0, cfg.oy ?? 0);
  return new THREE.MeshStandardMaterial({ map: tex, color: baseColor, roughness: 0.9, side });
}

// Apply faceTextures data to a mesh's material (multi-material for box per-face, single otherwise)
function applyFaceTextures(mesh, faceTextures, baseColor = '#aaaacc') {
  if (!faceTextures) return;
  const isBox = mesh.geometry instanceof THREE.BoxGeometry;
  const hasPerFace = isBox && Object.keys(faceTextures).some(k => k !== 'all' && /^\d$/.test(k));
  const side = isBox ? THREE.FrontSide : THREE.DoubleSide;

  if (hasPerFace) {
    mesh.material = Array.from({ length: 6 }, (_, i) => {
      const cfg = faceTextures[String(i)] ?? faceTextures['all'] ?? null;
      return buildFaceTexMat(baseColor, cfg, side);
    });
  } else {
    mesh.material = buildFaceTexMat(baseColor, faceTextures['all'] ?? null, side);
  }
}

// Primitive geometry factories matching the editor
const PRIM_GEO = {
  box:      () => new THREE.BoxGeometry(1, 1, 1),
  sphere:   () => new THREE.SphereGeometry(0.5, 16, 12),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  plane:    () => new THREE.PlaneGeometry(1, 1),
};

function applyTransform(obj, entry) {
  obj.position.set(entry.pos[0], entry.pos[1], entry.pos[2]);
  obj.rotation.set(entry.rot[0] * RAD, entry.rot[1] * RAD, entry.rot[2] * RAD);
  obj.scale.set(entry.size[0], entry.size[1], entry.size[2]);
}

function spawnPrim(entry) {
  const geoFn = PRIM_GEO[entry.type];
  if (!geoFn) return null;

  const baseColor = entry.color ?? '#aaaacc';
  const isBox = entry.type === 'box';
  const side  = isBox ? THREE.FrontSide : THREE.DoubleSide;
  let mat;

  if (entry.faceTextures) {
    // New per-face texture system from editor
    const hasPerFace = isBox && Object.keys(entry.faceTextures).some(k => k !== 'all' && /^\d$/.test(k));
    if (hasPerFace) {
      mat = Array.from({ length: 6 }, (_, i) => {
        const cfg = entry.faceTextures[String(i)] ?? entry.faceTextures['all'] ?? null;
        return buildFaceTexMat(baseColor, cfg, side);
      });
    } else {
      mat = buildFaceTexMat(baseColor, entry.faceTextures['all'] ?? null, side);
    }
  } else if (entry.texture) {
    // Legacy single-texture format
    const tex = getTexLoader().load(`./textures/${entry.texture}.png`);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (entry.textureRepeat) tex.repeat.set(entry.textureRepeat[0], entry.textureRepeat[1]);
    mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side });
  } else {
    mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, side });
  }

  const mesh = new THREE.Mesh(geoFn(), mat);
  mesh.castShadow    = entry.castShadow !== false;
  mesh.receiveShadow = true;
  applyTransform(mesh, entry);
  if (entry.opacity !== undefined) {
    const mats = Array.isArray(mat) ? mat : [mat];
    mats.forEach(m => { m.transparent = true; m.opacity = entry.opacity; });
  }
  if (entry.emissiveIntensity > 0) {
    const mats = Array.isArray(mat) ? mat : [mat];
    const col = new THREE.Color(entry.emissiveColor ?? '#ffffff');
    mats.forEach(m => { if ('emissive' in m) { m.emissive.copy(col); m.emissiveIntensity = entry.emissiveIntensity; } });
  }
  mesh.userData.collidable  = entry.collidable !== false;
  mesh.userData.levelObj    = true;
  mesh.userData.editorId    = entry.id;
  if (entry.isMainFloor)   { mesh.userData.isMainFloor = true; gameState.ground = mesh; }
  if (entry.isAdjFloor)    { mesh.userData.isAdjFloor  = true; gameState.adjacentFloor = mesh; }
  if (entry.states?.length)    { mesh.userData.states = entry.states; mesh.userData.currentState = 0; }
  if (entry.noSelfInteract)      mesh.userData.noSelfInteract = true;
  return mesh;
}

function spawnLight(entry) {
  const col = new THREE.Color(entry.lightColor || '#ffffff');
  let light;

  if (entry.type === 'point-light') {
    light = new THREE.PointLight(col, entry.intensity ?? 1, entry.distance ?? 10, entry.decay ?? 2);

  } else if (entry.type === 'spot-light') {
    light = new THREE.SpotLight(col, entry.intensity ?? 1, entry.distance ?? 20,
      (entry.angle ?? 30) * (Math.PI / 180), entry.penumbra ?? 0.15, entry.decay ?? 2);
    // Target goes 1 unit in the light's local -Y, mirroring the editor setup
    const target = new THREE.Object3D();
    target.position.set(0, -1, 0);
    light.add(target);
    light.target = target;

  } else if (entry.type === 'dir-light') {
    light = new THREE.DirectionalLight(col, entry.intensity ?? 1);
  } else {
    return null;
  }

  applyTransform(light, entry);
  light.castShadow = entry.castShadow !== false;
  if (light.castShadow) {
    const isPoint = entry.type === 'point-light';
    light.shadow.mapSize.set(isPoint ? 2048 : 1024, isPoint ? 2048 : 1024);
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far  = isPoint
      ? (entry.distance > 0 ? entry.distance : 500)
      : 50;
    if (isPoint) light.shadow.normalBias = 0.05;
  }
  light.userData.levelObj  = true;
  light.userData.editorId  = entry.id;
  if (entry.states?.length)   { light.userData.states = entry.states; light.userData.currentState = 0; }
  if (entry.noSelfInteract)     light.userData.noSelfInteract = true;
  return light;
}

function spawnModel(entry) {
  return new Promise(resolve => {
    const ext = (entry.modelPath || '').split('.').pop().toLowerCase();
    const isFbx = ext === 'fbx';
    const loader = isFbx ? getFBXLoader() : getGLTFLoader();
    loader.load(entry.modelPath, result => {
      const root = isFbx ? result : result.scene;
      root.traverse(c => {
        if (c.isMesh) {
          c.castShadow    = entry.castShadow !== false;
          c.receiveShadow = true;
          c.userData.collidable = entry.collidable !== false;
          c.userData.levelObj   = true;
        }
      });
      applyTransform(root, entry);
      root.userData.collidable = entry.collidable !== false;
      root.userData.levelObj   = true;
      root.userData.editorId   = entry.id;
      if (entry.emissiveIntensity > 0) {
        const col = new THREE.Color(entry.emissiveColor ?? '#ffffff');
        root.traverse(c => {
          if (c.isMesh && c.material) {
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            mats.forEach(m => { if ('emissive' in m) { m.emissive.copy(col); m.emissiveIntensity = entry.emissiveIntensity; } });
          }
        });
      }
      if (entry.states?.length)   { root.userData.states = entry.states; root.userData.currentState = 0; }
      if (entry.noSelfInteract)     root.userData.noSelfInteract = true;
      if (entry.meshOverrides) {
        root.userData.meshOverrides = entry.meshOverrides;
        root.traverse(c => {
          if (!c.isMesh) return;
          const key = c.name || c.uuid;
          const ovr = entry.meshOverrides[key];
          if (!ovr) return;
          if (ovr.visible === false) c.visible = false;
          if (ovr.texture) {
            const name = ovr.texture;
            const applyTex = tex => {
              tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
              const mats = Array.isArray(c.material) ? c.material : [c.material];
              mats.forEach(m => { if (m) { m.map = tex; m.needsUpdate = true; } });
            };
            getTexLoader().load(`./textures/${name}.png`, applyTex, undefined, () => {
              getTexLoader().load(`./textures/${name}.jpg`, applyTex);
            });
          }
        });
      }
      resolve(root);
    }, undefined, err => {
      console.warn('[levelLoader] Failed to load model:', entry.modelPath, err);
      resolve(null);
    });
  });
}

// Rebuild a CSG-subtracted mesh from its stored recipe at runtime.
// Falls back to spawning the base primitive/model if CSG isn't available.
async function spawnCsgResult(entry) {
  // Try to do the actual CSG subtraction at runtime
  try {
    const { Evaluator, Brush, SUBTRACTION } = await import('three-bvh-csg');
    const evaluator = new Evaluator();
    const recipe = entry.csgRecipe;

    const baseObj = await _buildRecipeObj(recipe.base);
    if (!baseObj) throw new Error('base mesh failed');

    let brushA = _objToBrush(baseObj, Brush);
    brushA.updateMatrixWorld(true);

    for (const cutEntry of (recipe.cutters || [])) {
      const cutObj = await _buildRecipeObj(cutEntry);
      if (!cutObj) continue;
      const brushB = _objToBrush(cutObj, Brush);
      brushB.updateMatrixWorld(true);
      brushA = evaluator.evaluate(brushA, brushB, SUBTRACTION);
      brushA.updateMatrixWorld(true);
    }

    const result = brushA;
    result.position.setScalar(0);
    result.rotation.set(0, 0, 0);
    result.scale.setScalar(1);
    result.castShadow    = entry.castShadow !== false;
    result.receiveShadow = true;
    result.userData.collidable = entry.collidable !== false;
    result.userData.levelObj   = true;
    result.userData.editorId   = entry.id;
    if (entry.emissiveIntensity > 0) {
      const col = new THREE.Color(entry.emissiveColor ?? '#ffffff');
      const mats = Array.isArray(result.material) ? result.material : [result.material];
      mats.forEach(m => { if (m && 'emissive' in m) { m.emissive.copy(col); m.emissiveIntensity = entry.emissiveIntensity; } });
    }
    if (entry.states?.length)  { result.userData.states = entry.states; result.userData.currentState = 0; }
    if (entry.noSelfInteract)    result.userData.noSelfInteract = true;
    // Apply texture if saved from editor
    if (entry.faceTextures) applyFaceTextures(result, entry.faceTextures, entry.color ?? '#aaaacc');
    return result;

  } catch (err) {
    console.warn('[levelLoader] CSG runtime failed, falling back to base shape:', err);
    // Graceful fallback: spawn the base geometry without the cut
    if (entry.csgRecipe?.base) {
      return _buildRecipeObj(entry.csgRecipe.base);
    }
    return null;
  }
}

async function _buildRecipeObj(e) {
  if (e.type === 'model' && e.modelPath) return spawnModel(e);
  const mesh = spawnPrim(e);
  if (mesh) mesh.updateMatrixWorld(true);
  return mesh;
}

function _objToBrush(obj, Brush) {
  obj.updateMatrixWorld(true);
  const meshes = [];
  if (obj.isMesh) meshes.push(obj);
  else obj.traverse(c => { if (c.isMesh) meshes.push(c); });
  if (!meshes.length) return new Brush(new THREE.BoxGeometry(1, 1, 1));

  // Merge to world space (position + normal + uv)
  const posA = [], norA = [], uvA = [], idxA = [];
  let offset = 0;
  meshes.forEach(m => {
    m.updateMatrixWorld(true);
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, idx = g.index;
    posA.push(pos.array);
    if (nor) norA.push(nor.array);
    if (uv)  uvA.push(uv.array);
    if (idx) {
      const shifted = new Uint32Array(idx.array.length);
      for (let i = 0; i < idx.array.length; i++) shifted[i] = idx.array[i] + offset;
      idxA.push(shifted);
    } else {
      const tri = new Uint32Array(pos.count);
      for (let i = 0; i < pos.count; i++) tri[i] = i + offset;
      idxA.push(tri);
    }
    offset += pos.count;
  });

  const totalV = posA.reduce((s, a) => s + a.length / 3, 0);
  const totalI = idxA.reduce((s, a) => s + a.length, 0);
  const positions = new Float32Array(totalV * 3);
  const normals   = norA.length === meshes.length ? new Float32Array(totalV * 3) : null;
  const uvs       = uvA.length  === meshes.length ? new Float32Array(totalV * 2) : null;
  const indices   = new Uint32Array(totalI);
  let pO = 0, nO = 0, uO = 0, iO = 0;
  posA.forEach((pa, i) => {
    positions.set(pa, pO); pO += pa.length;
    if (normals && norA[i]) { normals.set(norA[i], nO); nO += norA[i].length; }
    if (uvs     && uvA[i])  { uvs.set(uvA[i],     uO); uO += uvA[i].length;  }
  });
  idxA.forEach(ia => { indices.set(ia, iO); iO += ia.length; });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (uvs)     geo.setAttribute('uv',     new THREE.BufferAttribute(uvs,     2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  const mat = meshes[0].material ?? new THREE.MeshStandardMaterial();
  const brush = new Brush(geo, Array.isArray(mat) ? mat[0] : mat);
  brush.updateMatrixWorld(true);
  return brush;
}

/**
 * Load a level by name and spawn all its objects into gameState.scene.
 * @param {string} name  Level name (no .json extension) — defaults to 'main'
 */
export async function loadLevel(name = 'main') {
  if (!window.electron && !window.Capacitor) {
    console.log('[levelLoader] Not in Electron — skipping level load');
    return;
  }

  gameState.currentLevel = name;
  gameState.saveTriggers    = [];  // clear triggers from previous level
  gameState.customTriggers  = [];

  let data = null;
  try {
    if (window.electron) {
      data = await window.electron.readLevel(name);
    } else {
      const res = await fetch(`./levels/${name}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    }
  } catch (err) {
    console.log(`[levelLoader] Level "${name}" not found or unreadable:`, err.message);
    return;
  }

  if (!data?.objects?.length) {
    console.log(`[levelLoader] Level "${name}" has no objects`);
    return;
  }

  const spawned = [];
  for (const entry of data.objects) {
    let obj = null;
    try {
      if (entry.type === 'save-trigger') {
        // Save triggers are not rendered — store their data for frame checking
        const [px, py, pz] = entry.pos || [0, 0, 0];
        const [sx, sy, sz] = entry.scale || [1, 1, 1];
        gameState.saveTriggers.push({
          userData: {
            saveSlot:   entry.saveSlot  || 'autosave',
            onceOnly:   entry.onceOnly  !== false,
            _triggered: false,
            _worldPos:  { x: px, y: py, z: pz },
            _halfW:     Math.abs(sx) / 2,
            _halfH:     Math.abs(sy) / 2,
            _halfD:     Math.abs(sz) / 2,
          }
        });
        continue;
      } else if (entry.type === 'custom-trigger') {
        // Custom triggers are not rendered — store for frame checking
        const [px, py, pz] = entry.pos   || [0, 0, 0];
        const [sx, sy, sz] = entry.scale || [1, 1, 1];
        gameState.customTriggers.push({
          userData: {
            triggerVar:      entry.triggerVar      || '',
            triggerVarOp:    entry.triggerVarOp    || 'set',
            triggerVarValue: entry.triggerVarValue ?? 'true',
            _inside:   false,
            _worldPos: { x: px, y: py, z: pz },
            _halfW:    Math.abs(sx) / 2,
            _halfH:    Math.abs(sy) / 2,
            _halfD:    Math.abs(sz) / 2,
          }
        });
        continue;
      } else if (entry.type === 'csg-result') {
        obj = await spawnCsgResult(entry);
      } else if (entry.type === 'model') {
        obj = await spawnModel(entry);
      } else if (entry.type === 'point-light' || entry.type === 'spot-light' || entry.type === 'dir-light') {
        obj = spawnLight(entry);
      } else {
        obj = spawnPrim(entry);
      }
    } catch (err) {
      console.warn('[levelLoader] Failed to spawn entry:', entry, err);
    }
    if (obj) {
      obj.name = entry.label || (entry.type + '_' + entry.id);
      gameState.scene.add(obj);
      spawned.push(obj);
    }
  }

  // Initialize level variables from JSON (initial values)
  // Clear existing vars then apply from data; game uses stateManager.levelVars at runtime
  for (const k of Object.keys(levelVars)) delete levelVars[k];
  if (data.vars) {
    for (const [k, vdef] of Object.entries(data.vars)) {
      levelVars[k] = vdef.initial ?? (vdef.type === 'bool' ? false : vdef.type === 'number' ? 0 : '');
    }
  }

  console.log(`[levelLoader] Spawned ${spawned.length} of ${data.objects.length} objects from level "${name}"`);

  // Build statefulObjects list and apply initial state transforms
  gameState.statefulObjects = spawned.filter(o => o.userData.states?.length);

  // Resolve object links: entry.links = [editorId, ...] → obj.userData.linkedObjects = [obj, ...]
  // Build id→object map from spawned objects (excludes non-spawned types like save-trigger)
  const idMap = new Map(spawned.map(o => [o.userData.editorId, o]));
  for (const entry of data.objects) {
    if (!entry?.links?.length) continue;
    const obj = idMap.get(entry.id);
    if (!obj) continue;
    obj.userData.linkedObjects = entry.links.map(id => idMap.get(id)).filter(Boolean);
  }

  initStatefulObjects();

  // Brief on-screen confirmation so the user can tell the level loaded
  const toast = document.getElementById('level-toast');
  if (toast) {
    toast.textContent = `Level "${name}" — ${spawned.length} object(s) loaded`;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3500);
  }
}

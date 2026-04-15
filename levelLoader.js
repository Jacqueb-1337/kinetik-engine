// levelLoader.js — Spawns objects from a level JSON file into the game scene.
// Called from main.js after initScene(). Works only inside Electron (window.electron IPC).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { gameState } from './globals.js';
import { initStatefulObjects, levelVars, setTextureFn } from './stateManager.js';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const RAD = Math.PI / 180;

function _flipGeometryNormals(geo) {
  const normals = geo.getAttribute('normal');
  if (normals) {
    for (let i = 0; i < normals.count; i++) {
      normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
    }
    normals.needsUpdate = true;
  }
  const index = geo.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
  }
}

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

  const applyUV = t => {
    t.wrapS = t.wrapT = wrapMode;
    t.repeat.set(cfg.rx ?? 1, cfg.ry ?? 1);
    t.offset.set(cfg.ox ?? 0, cfg.oy ?? 0);
    t.needsUpdate = true;
  };

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side });

  const applyDiffuse = t => {
    t.colorSpace = THREE.SRGBColorSpace;
    applyUV(t);
    mat.map = t;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
  };
  getTexLoader().load(`./textures/${cfg.name}.png`, applyDiffuse, undefined,
    () => getTexLoader().load(`./textures/${cfg.name}.jpg`, applyDiffuse)
  );

  if (cfg.normalMap) {
    const nTex = getTexLoader().load(
      `./textures/${cfg.normalMap}.png`, undefined, undefined,
      () => getTexLoader().load(`./textures/${cfg.normalMap}.jpg`, t => { applyUV(t); mat.normalMap = t; mat.needsUpdate = true; })
    );
    applyUV(nTex);
    mat.normalMap = nTex;
  }

  if (cfg.roughnessMap) {
    const rTex = getTexLoader().load(
      `./textures/${cfg.roughnessMap}.png`, undefined, undefined,
      () => getTexLoader().load(`./textures/${cfg.roughnessMap}.jpg`, t => { applyUV(t); mat.roughnessMap = t; mat.roughness = 1.0; mat.needsUpdate = true; })
    );
    applyUV(rTex);
    mat.roughnessMap = rTex;
    mat.roughness = 1.0;
  }

  if (cfg.bumpMap) {
    const bScale = cfg.bumpScale ?? 1.0;
    const bTex = getTexLoader().load(
      `./textures/${cfg.bumpMap}.png`, undefined, undefined,
      () => getTexLoader().load(`./textures/${cfg.bumpMap}.jpg`, t => { applyUV(t); mat.bumpMap = t; mat.bumpScale = bScale; mat.needsUpdate = true; })
    );
    applyUV(bTex);
    mat.bumpMap = bTex;
    mat.bumpScale = bScale;
  }

  return mat;
}

// Apply faceTextures data to a mesh's material + face overlay children
function applyFaceTextures(mesh, faceTextures, baseColor = '#aaaacc') {
  if (!faceTextures) return;
  const isBox = mesh.geometry instanceof THREE.BoxGeometry;
  const hasBoxPerFace = isBox && Object.keys(faceTextures).some(k => k !== 'all' && /^\d$/.test(k));
  const hasFaceMode   = Object.keys(faceTextures).some(k => k.startsWith('f_'));
  const side = isBox ? THREE.FrontSide : THREE.DoubleSide;

  // Base material
  if (hasBoxPerFace) {
    mesh.material = Array.from({ length: 6 }, (_, i) => {
      const cfg = faceTextures[String(i)] ?? faceTextures['all'] ?? null;
      return buildFaceTexMat(baseColor, cfg, side);
    });
  } else {
    mesh.material = buildFaceTexMat(baseColor, faceTextures['all'] ?? null, side);
  }

  // Face mode overlays: one child mesh per f_... key that has a texture
  if (hasFaceMode && mesh.geometry) {
    const groups = _computeFaceGroupsRuntime(mesh);
    const geo     = mesh.geometry;
    const posAttr = geo.attributes.position;
    const uvAttr  = geo.attributes.uv;
    const normAttr = geo.attributes.normal;
    const idxArr  = geo.index ? geo.index.array : null;
    const vi = (ti, c) => idxArr ? idxArr[ti * 3 + c] : ti * 3 + c;

    for (const [key, cfg] of Object.entries(faceTextures)) {
      if (!key.startsWith('f_') || !cfg?.name) continue;
      const group = groups.find(g => g.key === key);
      if (!group) continue;

      const positions = [], uvCoords = [], normals = [];
      for (const ti of group.tris) {
        for (let c = 0; c < 3; c++) {
          const i = vi(ti, c);
          positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          if (uvAttr)   uvCoords.push(uvAttr.getX(i), uvAttr.getY(i));
          if (normAttr) normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
        }
      }

      const overlayGeo = new THREE.BufferGeometry();
      overlayGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      if (uvCoords.length) overlayGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvCoords, 2));
      if (normals.length)  overlayGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      else                 overlayGeo.computeVertexNormals();

      const mat = buildFaceTexMat(baseColor, cfg, THREE.DoubleSide);
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits  = -1;

      const overlayMesh = new THREE.Mesh(overlayGeo, mat);
      overlayMesh.renderOrder = 1;
      overlayMesh.castShadow    = mesh.castShadow;
      overlayMesh.receiveShadow = mesh.receiveShadow;
      mesh.add(overlayMesh);
    }
  }
}

// Minimal face group computation for runtime (mirrors editor's computeFaceGroups)
function _computeFaceGroupsRuntime(mesh) {
  const geo = mesh.geometry;
  if (!geo?.attributes?.position) return [];
  const pos    = geo.attributes.position;
  const idxArr = geo.index ? geo.index.array : null;
  const triCount = idxArr ? idxArr.length / 3 : pos.count / 3;
  const vi = (ti, c) => idxArr ? idxArr[ti * 3 + c] : ti * 3 + c;
  const _v = i => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  const vKey = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;

  const triNormals = [], triAreas = [];
  for (let t = 0; t < triCount; t++) {
    const a = _v(vi(t,0)), b = _v(vi(t,1)), c = _v(vi(t,2));
    const cross = b.clone().sub(a).cross(c.clone().sub(a));
    triAreas.push(cross.length() / 2);
    triNormals.push(cross.normalize());
  }

  const edgeMap = new Map();
  for (let t = 0; t < triCount; t++) {
    const vs = [vKey(pos.getX(vi(t,0)),pos.getY(vi(t,0)),pos.getZ(vi(t,0))),
                vKey(pos.getX(vi(t,1)),pos.getY(vi(t,1)),pos.getZ(vi(t,1))),
                vKey(pos.getX(vi(t,2)),pos.getY(vi(t,2)),pos.getZ(vi(t,2)))];
    for (let e = 0; e < 3; e++) {
      const ek = vs[e] < vs[(e+1)%3] ? `${vs[e]}|${vs[(e+1)%3]}` : `${vs[(e+1)%3]}|${vs[e]}`;
      if (!edgeMap.has(ek)) edgeMap.set(ek, []);
      edgeMap.get(ek).push(t);
    }
  }

  const visited = new Uint8Array(triCount);
  const groups  = [];
  for (let start = 0; start < triCount; start++) {
    if (visited[start]) continue;
    const N = triNormals[start];
    const group = [], queue = [start];
    visited[start] = 1;
    while (queue.length) {
      const t = queue.shift();
      group.push(t);
      const vs = [vKey(pos.getX(vi(t,0)),pos.getY(vi(t,0)),pos.getZ(vi(t,0))),
                  vKey(pos.getX(vi(t,1)),pos.getY(vi(t,1)),pos.getZ(vi(t,1))),
                  vKey(pos.getX(vi(t,2)),pos.getY(vi(t,2)),pos.getZ(vi(t,2)))];
      for (let e = 0; e < 3; e++) {
        const ek = vs[e] < vs[(e+1)%3] ? `${vs[e]}|${vs[(e+1)%3]}` : `${vs[(e+1)%3]}|${vs[e]}`;
        for (const n of (edgeMap.get(ek) || []))
          if (!visited[n] && triNormals[n].dot(N) > 0.9998) { visited[n] = 1; queue.push(n); }
      }
    }
    let area = 0;
    const centroid = new THREE.Vector3();
    for (const t of group) {
      area += triAreas[t];
      centroid.addScaledVector(new THREE.Vector3(
        (pos.getX(vi(t,0))+pos.getX(vi(t,1))+pos.getX(vi(t,2)))/3,
        (pos.getY(vi(t,0))+pos.getY(vi(t,1))+pos.getY(vi(t,2)))/3,
        (pos.getZ(vi(t,0))+pos.getZ(vi(t,1))+pos.getZ(vi(t,2)))/3), triAreas[t]);
    }
    if (area > 0) centroid.divideScalar(area);
    const key = `f_${N.x.toFixed(2)}_${N.y.toFixed(2)}_${N.z.toFixed(2)}_${centroid.x.toFixed(2)}_${centroid.y.toFixed(2)}_${centroid.z.toFixed(2)}`;
    groups.push({ tris: group, key });
  }
  return groups;
}

setTextureFn((obj, texOverrides) => {
  const apply = mesh => {
    if (!mesh.userData.faceTextures) mesh.userData.faceTextures = {};
    for (const [k, v] of Object.entries(texOverrides)) {
      if (!v?.name) delete mesh.userData.faceTextures[k];
      else mesh.userData.faceTextures[k] = v;
    }
    applyFaceTextures(mesh, mesh.userData.faceTextures, mesh.userData._baseColor ?? '#aaaacc');
  };
  if (obj.isMesh) apply(obj);
  else obj.traverse(c => { if (c.isMesh) apply(c); });
});

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
  obj.userData._restPos   = obj.position.clone();
  obj.userData._restRot   = [entry.rot[0], entry.rot[1], entry.rot[2]];
  obj.userData._restScale = obj.scale.clone();
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
  if (entry.pivotOffset)         mesh.userData.pivotOffset = entry.pivotOffset;
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
  if (entry.pivotOffset)        light.userData.pivotOffset = entry.pivotOffset;
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
          if (c.geometry) c.geometry.computeBoundsTree();
          const mats = Array.isArray(c.material) ? c.material : (c.material ? [c.material] : []);
          mats.forEach(m => { m.side = THREE.DoubleSide; m.needsUpdate = true; });
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
      if (entry.pivotOffset)        root.userData.pivotOffset = entry.pivotOffset;
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
              tex.colorSpace = THREE.SRGBColorSpace;
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
      if (entry.masterTexture) {
        const col = new THREE.Color(entry.color ?? '#aaaacc');
        const roughness = entry.roughness ?? 1;
        const metalness = entry.metalness ?? 0;
        const name = entry.masterTexture;
        const applyMaster = tex => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          root.traverse(c => {
            if (!c.isMesh) return;
            c.material = new THREE.MeshStandardMaterial({ color: col, map: tex, roughness, metalness });
          });
        };
        getTexLoader().load(`./textures/${name}.png`, applyMaster, undefined, () => {
          getTexLoader().load(`./textures/${name}.jpg`, applyMaster);
        });
      } else if (entry.roughness !== undefined || entry.metalness !== undefined) {
        root.traverse(c => {
          if (!c.isMesh || !c.material) return;
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach((m, i) => {
            if (!m.isMeshStandardMaterial) {
              const nm = new THREE.MeshStandardMaterial({ color: m.color, map: m.map, roughness: entry.roughness ?? 1, metalness: entry.metalness ?? 0 });
              if (Array.isArray(c.material)) c.material[i] = nm; else c.material = nm;
            } else {
              if (entry.roughness !== undefined) { m.roughness = entry.roughness; m.needsUpdate = true; }
              if (entry.metalness !== undefined) { m.metalness = entry.metalness; m.needsUpdate = true; }
            }
          });
        });
      }
      if (entry.doubleSide) {
        root.traverse(c => {
          if (c.isMesh && c.material) {
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            mats.forEach(m => { m.side = THREE.DoubleSide; m.needsUpdate = true; });
          }
        });
      }
      if (entry.invertNormals) {
        root.traverse(c => { if (c.isMesh && c.geometry) _flipGeometryNormals(c.geometry); });
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
    result.geometry.computeBoundingBox();
    const _csgCenter = new THREE.Vector3();
    result.geometry.boundingBox.getCenter(_csgCenter);
    result.geometry.translate(-_csgCenter.x, -_csgCenter.y, -_csgCenter.z);
    result.geometry.computeBoundsTree();
    if (entry.pos && (entry.pos[0] !== 0 || entry.pos[1] !== 0 || entry.pos[2] !== 0)) {
      result.position.set(entry.pos[0], entry.pos[1], entry.pos[2]);
    } else {
      result.position.copy(_csgCenter);
    }
    if (entry.rot && (entry.rot[0] !== 0 || entry.rot[1] !== 0 || entry.rot[2] !== 0)) {
      result.rotation.set(entry.rot[0]*RAD, entry.rot[1]*RAD, entry.rot[2]*RAD);
    } else {
      result.rotation.set(0, 0, 0);
    }
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
    if (entry.faceTextures) applyFaceTextures(result, entry.faceTextures, entry.color ?? entry.csgRecipe?.base?.color ?? '#aaaacc');
    else {
      const colorToApply = entry.color ?? entry.csgRecipe?.base?.color;
      if (colorToApply) {
        const col = new THREE.Color(colorToApply);
        const mats = Array.isArray(result.material) ? result.material : [result.material];
        mats.forEach(m => {
          if (m?.color) m.color.set(col);
          if (entry.roughness !== undefined && 'roughness' in m) m.roughness = entry.roughness;
          if (entry.metalness !== undefined && 'metalness' in m) m.metalness = entry.metalness;
        });
      }
    }
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

function spawnMergedModel(entry) {
  const root = new THREE.Group();
  (entry.mergedMeshes || []).forEach(md => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(md.positions, 3));
    if (md.normals) geo.setAttribute('normal', new THREE.Float32BufferAttribute(md.normals, 3));
    if (md.uvs)     geo.setAttribute('uv',     new THREE.Float32BufferAttribute(md.uvs, 2));
    if (md.indices) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(md.indices), 1));
    const mat = new THREE.MeshStandardMaterial({ color: entry.color ?? '#aaaacc', roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = md.name;
    mesh.castShadow = entry.castShadow !== false;
    mesh.receiveShadow = true;
    root.add(mesh);
  });
  root.position.set(...entry.pos);
  root.rotation.set(entry.rot[0] * (Math.PI / 180), entry.rot[1] * (Math.PI / 180), entry.rot[2] * (Math.PI / 180));
  root.scale.set(...entry.size);
  root.castShadow    = entry.castShadow !== false;
  root.receiveShadow = true;
  root.userData.collidable = entry.collidable !== false;
  root.userData.levelObj   = true;
  root.userData.editorId   = entry.id;
  if (entry.states?.length)  { root.userData.states = entry.states; root.userData.currentState = 0; }
  if (entry.noSelfInteract)    root.userData.noSelfInteract = true;
  if (entry.pivotOffset)       root.userData.pivotOffset = entry.pivotOffset;
  if (entry.meshOverrides) {
    root.traverse(c => {
      if (!c.isMesh) return;
      const ovr = entry.meshOverrides[c.name];
      if (!ovr) return;
      if (ovr.visible === false) c.visible = false;
      if (ovr.texture) {
        const name = ovr.texture;
        const applyTex = tex => {
          tex.colorSpace = THREE.SRGBColorSpace;
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
  if (entry.doubleSide) {
    root.traverse(c => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { m.side = THREE.DoubleSide; m.needsUpdate = true; });
      }
    });
  }
  if (entry.invertNormals) {
    root.traverse(c => { if (c.isMesh && c.geometry) _flipGeometryNormals(c.geometry); });
  }
  return root;
}

function spawnImageModel(entry) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const exts = ['png', 'jpg', 'jpeg', 'webp'];
    const hasExt = /\.[^./\\]+$/.test(entry.imagePath || '');
    let extIdx = 0;
    const base = entry.imagePath || '';
    const tryNext = () => {
      if (hasExt) { img.src = './' + base; return; }
      if (extIdx >= exts.length) { resolve(null); return; }
      img.src = './' + base + '.' + exts[extIdx++];
    };
    img.onerror = () => { if (hasExt) resolve(null); else tryNext(); };
    img.onload = () => {
      const W = img.naturalWidth || 1;
      const H = img.naturalHeight || 1;
      const aspect = H / W;
      const COLS = Math.min(W, 256);
      const ROWS = Math.max(1, Math.round(COLS * aspect));
      const canvas = document.createElement('canvas');
      canvas.width = COLS; canvas.height = ROWS;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, COLS, ROWS);
      const d = ctx.getImageData(0, 0, COLS, ROWS).data;
      const getA = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS) ? 0 : d[(r * COLS + c) * 4 + 3];
      const THR = 127;
      const D = 0.1;
      const verts = [], norms = [];
      const ecrss = (a1, x1, y1, a2, x2, y2) => {
        const t = (a1 === a2) ? 0.5 : Math.max(0, Math.min(1, (THR - a1) / (a2 - a1)));
        return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
      };
      const p3 = (px, py) => [(px + 0.5) / COLS - 0.5, aspect * (0.5 - (py + 0.5) / ROWS)];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const aTL = getA(c,r), aTR = getA(c+1,r), aBL = getA(c,r+1), aBR = getA(c+1,r+1);
          const abv = a => a >= THR;
          const idx = (abv(aTL)?8:0)|(abv(aTR)?4:0)|(abv(aBR)?2:0)|(abv(aBL)?1:0);
          if (idx === 0 || idx === 15) continue;
          const tp = () => ecrss(aTL,c,r,   aTR,c+1,r);
          const rt = () => ecrss(aTR,c+1,r, aBR,c+1,r+1);
          const bt = () => ecrss(aBL,c,r+1, aBR,c+1,r+1);
          const lt = () => ecrss(aTL,c,r,   aBL,c,r+1);
          let segs;
          switch (idx) {
            case 1:  segs = [[lt(),bt()]]; break;
            case 2:  segs = [[bt(),rt()]]; break;
            case 3:  segs = [[lt(),rt()]]; break;
            case 4:  segs = [[rt(),tp()]]; break;
            case 5:  segs = [[rt(),bt()],[lt(),tp()]]; break;
            case 6:  segs = [[bt(),tp()]]; break;
            case 7:  segs = [[lt(),tp()]]; break;
            case 8:  segs = [[tp(),lt()]]; break;
            case 9:  segs = [[tp(),bt()]]; break;
            case 10: segs = [[tp(),rt()],[bt(),lt()]]; break;
            case 11: segs = [[tp(),rt()]]; break;
            case 12: segs = [[rt(),lt()]]; break;
            case 13: segs = [[rt(),bt()]]; break;
            case 14: segs = [[bt(),lt()]]; break;
            default: segs = [];
          }
          for (const [[x1,y1],[x2,y2]] of segs) {
            const [ax,ay] = p3(x1,y1), [bx,by] = p3(x2,y2);
            const dx = bx-ax, dy = by-ay, len = Math.sqrt(dx*dx+dy*dy)||1;
            const nx = dy/len, ny = -dx/len;
            const OV = 0.005;
            verts.push(ax,ay,OV, bx,by,OV, bx,by,-D, ax,ay,OV, bx,by,-D, ax,ay,-D);
            for (let i = 0; i < 6; i++) norms.push(nx, ny, 0);
          }
        }
      }
      let sr = 0, sg = 0, sb = 0, sn = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 10) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; sn++; }
      }
      const autoColor = sn ? '#' + [sr,sg,sb].map(c => Math.round(c/sn).toString(16).padStart(2,'0')).join('') : '#888888';
      const sideColor = entry.wallColor || autoColor;
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const faceMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 1, metalness: 0, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
      const sideMat  = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 1, metalness: 0, side: THREE.DoubleSide });
      const frontMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, aspect), faceMat);
      const backFaceMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 1, metalness: 0, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
      const backMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, aspect), backFaceMat);
      backMesh.position.z = -D;
      const sideGeo = new THREE.BufferGeometry();
      sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      sideGeo.setAttribute('normal',   new THREE.Float32BufferAttribute(norms, 3));
      const sideMesh = new THREE.Mesh(sideGeo, sideMat);
      const castShadow = entry.castShadow !== false;
      [frontMesh, backMesh, sideMesh].forEach(m => { m.castShadow = castShadow; m.receiveShadow = true; });
      frontMesh.userData.collidable = entry.collidable !== false;
      sideMesh.userData.collidable  = entry.collidable !== false;
      if (frontMesh.geometry) frontMesh.geometry.computeBoundsTree?.();
      if (verts.length)        sideMesh.geometry.computeBoundsTree?.();
      const group = new THREE.Group();
      group.add(frontMesh, backMesh, sideMesh);
      group.position.set(...entry.pos);
      group.rotation.set(entry.rot[0] * RAD, entry.rot[1] * RAD, entry.rot[2] * RAD);
      group.scale.set(...entry.size);
      group.userData.levelObj   = true;
      group.userData.editorId   = entry.id;
      group.userData.collidable = entry.collidable !== false;
      if (entry.states?.length) { group.userData.states = entry.states; group.userData.currentState = 0; }
    resolve(group);
    };
    tryNext();
  });
}

async function _buildRecipeObj(e) {
  if (e.type === 'csg-result') {
    if (e.csgRecipe) return spawnCsgResult(e);
    return null;
  }
  if (e.type === 'merged-model') {
    const m = spawnMergedModel(e);
    if (m) m.updateMatrixWorld(true);
    return m;
  }
  if (e.type === 'image-model' && e.imagePath) return spawnImageModel(e);
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

    // Negative determinant = odd number of negative scales → winding flipped, fix it
    if (m.matrixWorld.determinant() < 0) {
      const idx = g.index;
      if (idx) {
        for (let i = 0; i < idx.array.length; i += 3) {
          const tmp = idx.array[i + 1]; idx.array[i + 1] = idx.array[i + 2]; idx.array[i + 2] = tmp;
        }
      } else {
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i += 3) {
          for (let c = 0; c < 3; c++) {
            const tmp = pos.getComponent(i + 1, c);
            pos.setComponent(i + 1, c, pos.getComponent(i + 2, c));
            pos.setComponent(i + 2, c, tmp);
          }
        }
      }
      g.computeVertexNormals();
    }

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
            presenceVar:     entry.presenceVar     || '',
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
      } else if (entry.type === 'merged-model') {
        obj = spawnMergedModel(entry);
      } else if (entry.type === 'image-model') {
        obj = await spawnImageModel(entry);
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

  // Resolve object links into linkedObjects (keyless, auto-fired) and keyedLinks (per-key)
  const idMap = new Map(spawned.map(o => [o.userData.editorId, o]));
  for (const entry of data.objects) {
    if (!entry?.links?.length) continue;
    const obj = idMap.get(entry.id);
    if (!obj) continue;
    const normalized = entry.links.map(l => typeof l === 'number' ? { id: l } : l);
    obj.userData.linkedObjects = normalized.filter(l => !l.key).map(l => idMap.get(l.id)).filter(Boolean);
    const keyed = normalized.filter(l => !!l.key).map(l => {
      const target = idMap.get(l.id);
      return target ? { obj: target, key: l.key, label: l.label } : null;
    }).filter(Boolean);
    if (keyed.length) obj.userData.keyedLinks = keyed;
  }

  // Build statefulObjects after resolving links so objects with only keyedLinks are included
  gameState.statefulObjects = spawned.filter(o => o.userData.states?.length || o.userData.keyedLinks?.length);

  initStatefulObjects();

  // Brief on-screen confirmation so the user can tell the level loaded
  const toast = document.getElementById('level-toast');
  if (toast) {
    toast.textContent = `Level "${name}" — ${spawned.length} object(s) loaded`;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3500);
  }
}

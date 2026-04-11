// editor.js - Sinister Level Editor
// Runs inside Electron via editor.html (importmap â†’ node_modules/three)
import * as THREE from 'three';
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
import { GLTFLoader }        from 'three/examples/jsm/loaders/GLTFLoader';
import { FBXLoader }         from 'three/examples/jsm/loaders/FBXLoader';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry';

let _highlightedMesh = null;
let _highlightSavedEmissive = null;
let _highlightedRow = null;

function _setMeshHighlight(mesh, row) {
  if (_highlightedMesh && _highlightSavedEmissive) {
    const mats = Array.isArray(_highlightedMesh.material) ? _highlightedMesh.material : [_highlightedMesh.material];
    mats.forEach((m, i) => { if (m.emissive && _highlightSavedEmissive[i]) m.emissive.copy(_highlightSavedEmissive[i]); });
  }
  if (_highlightedRow) _highlightedRow.style.background = '#0d0d20';
  _highlightedMesh = null;
  _highlightSavedEmissive = null;
  _highlightedRow = null;
  if (!mesh) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  _highlightSavedEmissive = mats.map(m => m.emissive ? m.emissive.clone() : null);
  mats.forEach(m => { if (m.emissive) m.emissive.set(0x004488); });
  _highlightedMesh = mesh;
  _highlightedRow = row;
  if (row) row.style.background = '#1a2a4a';
}

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const ASSET_ROOT = '../';


// â”€â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const E = {
  scene:     null,
  camera:    null,
  renderer:  null,
  orbit:     null,
  transform: null,

  // Current level
  levelName:   null,          // null until a level is opened/created
  isDirty:     false,

  // Object tracking
  placedGroup:   null,        // Group containing only user-placed objects
  gridHelper:    null,
  colHelpers:    [],           // BoxHelper list for collision wireframes

  selected:      null,        // currently selected placed object (null if ref/none)
  placingType:   null,        // 'box'|'sphere'|'cylinder'|'plane'|'model:<path>' while placing
  ghostMesh:     null,        // semi-transparent placement preview
  floorPlane:    null,        // invisible raycasting floor

  importedModels: [],         // [{name, path}]
  importedActors: [],         // [{name, path}]
  availableTextures: [],      // ['floor', 'wall', 'ceiling', ...]
  texCache:       new Map(),  // texName -> THREE.Texture (editor-side cache)
  groups:         {},         // { gid: { name, ids: Set } }
  groupCollapsed: {},         // { gid: bool } — true = collapsed in panel
  levelVars:      {},         // { "lv_name": { type: "number"|"bool"|"string", initial: value } }
  nextId:         1,
  undoStack:      [],
  redoStack:      [],

  // toolbar toggles
  showGrid:       true,
  showColliders:  false,
  previewLighting: false,   // when true, simulate game lighting instead of editor lighting

  // camera WASD pan
  keys:          {},
  panSpeed:      15,           // units/sec
  lastTime:      0,

  // dragging state
  wasDragging:   false,

  // group transform pivot
  groupPivot:         null,
  groupPivotMembers:  [],
  activeGroupGid:     null,  // gid of current group being transformed

  // CSG cut mode
  cutMode:       false,
  cutSource:     null,   // the cutter mesh (selected when Cut was initiated)
  csgEvaluator:  null,   // lazy-created Evaluator instance

  // Link pick mode
  linkMode:      false,
  linkSource:    null,   // the object whose links we're adding to

  // Pivot pick mode
  pivotMode:     false,
  pivotSource:   null,   // the object whose pivot we're setting

  // Per-face texture selection
  selectedFace:      null,   // null = 'all', 0-5 = specific box face
  facePickMode:      false,
  faceHighlightMesh: null,   // THREE.Mesh child of selected object
  uvEditorImage:     null,   // Image loaded for UV canvas preview

  _stateDragSrc: undefined,  // index of state item being dragged for reorder
};

// â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function init() {
  // Scene
  E.scene = new THREE.Scene();
  E.scene.background = new THREE.Color(0x12121e);

  // Camera - start above and looking at origin (matches game room)
  E.camera = new THREE.PerspectiveCamera(60, viewportAspect(), 0.1, 500);
  E.camera.position.set(10, 18, 22);
  E.camera.lookAt(0, 3, 0);

  // Renderer
  const viewport = document.getElementById('viewport');
  E.renderer = new THREE.WebGLRenderer({ antialias: true });
  E.renderer.setPixelRatio(devicePixelRatio);
  E.renderer.shadowMap.enabled = true;
  E.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  resizeRenderer();
  viewport.appendChild(E.renderer.domElement);

  // Orbit controls - right-drag to orbit, middle to zoom
  E.orbit = new OrbitControls(E.camera, E.renderer.domElement);
  E.orbit.enableDamping   = true;
  E.orbit.dampingFactor   = 0.08;
  E.orbit.mouseButtons    = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  E.orbit.target.set(0, 3, 0);
  E.orbit.update();

  // Transform controls
  E.transform = new TransformControls(E.camera, E.renderer.domElement);
  E.transform.setMode('translate');
  E.transform.setTranslationSnap(null); // free by default; Ctrl = grid snap
  E.transform.setRotationSnap(THREE.MathUtils.degToRad(5));
  E.scene.add(E.transform);
  E.transform.addEventListener('change', () => {
    // If rotating around a custom pivot, keep pivot point fixed in world space.
    // NOTE: updateMatrixWorld must be called first — TC fires 'change' before updating matrixWorld.
    if (E._pivotDragStart && E.selected?.userData.pivotOffset && E.transform.mode === 'rotate') {
      const obj = E.selected;
      obj.updateMatrixWorld(true);   // force-flush the new quaternion/position into matrixWorld
      const localOffset = new THREE.Vector3().fromArray(obj.userData.pivotOffset);
      const currentPivotWorld = localOffset.clone().applyMatrix4(obj.matrixWorld);
      const diff = E._pivotDragStart.clone().sub(currentPivotWorld);
      obj.position.add(diff);
      obj.updateMatrixWorld(true);
    }
    // Alt held during translate drag → snap selected face to nearest primitive face
    if (E.transform.mode === 'translate' && (E.groupPivot || E.selected) &&
        (E.keys['AltLeft'] || E.keys['AltRight'])) {
      snapToNearestFace(E.groupPivot || E.selected);
    }
    syncPropsFromSelected();
    E.renderer.render(E.scene, E.camera);
  });
  E.transform.addEventListener('dragging-changed', e => {
    E.orbit.enabled = !e.value;
    if (e.value) {
      // Drag started — push undo before transform happens, then record pivot
      if (E.selected || E.groupPivot) pushUndo();
      if (E.selected?.userData.pivotOffset && E.transform.mode === 'rotate') {
        const obj = E.selected;
        const localOffset = new THREE.Vector3().fromArray(obj.userData.pivotOffset);
        E._pivotDragStart = localOffset.clone().applyMatrix4(obj.matrixWorld);
      } else {
        E._pivotDragStart = null;
      }
    } else {
      E._pivotDragStart = null;
      if (E.groupPivot) {
        // Re-enter group mode so user can keep dragging without re-pressing G.
        // Finalize to flush world positions, then immediately re-create the pivot.
        const regid = E.activeGroupGid;
        finalizeGroupTransform();
        if (regid && E.groups[regid]) beginGroupTransform(regid);
      }
      E.wasDragging = true;
      markDirty();
      syncPropsFromSelected();
      setTimeout(() => { E.wasDragging = false; }, 80);
    }
  });

  // Groups
  E.placedGroup = new THREE.Group();
  E.placedGroup.name = '__placed__';
  E.scene.add(E.placedGroup);

  // Grid
  E.gridHelper = new THREE.GridHelper(60, 60, 0x333360, 0x222240);
  E.scene.add(E.gridHelper);

  // Player origin marker — shows where the actor spawns (0, 0, 0)
  const originDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xe94560, toneMapped: false, depthTest: false })
  );
  originDot.name = '__playerOrigin__';
  originDot.renderOrder = 999;
  E.scene.add(originDot);
  // Cross lines so it's visible from far away
  const crossMat = new THREE.LineBasicMaterial({ color: 0xe94560, opacity: 0.7, transparent: true, depthTest: false });
  const crossGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.6,0,0), new THREE.Vector3(0.6,0,0),
    new THREE.Vector3(0,0,-0.6), new THREE.Vector3(0,0,0.6),
  ]);
  const originCross = new THREE.LineSegments(crossGeo, crossMat);
  originCross.name = '__playerOriginCross__';
  originCross.renderOrder = 999;
  E.scene.add(originCross);

  // Editor-only ambient + directional (always bright for editing)
  const editorAmbient = new THREE.AmbientLight(0xffffff, 0.7);
  editorAmbient.name = '__editorAmbient__';
  E.scene.add(editorAmbient);
  const editorSun = new THREE.DirectionalLight(0xffffff, 0.9);
  editorSun.position.set(8, 20, 12);
  editorSun.name = '__editorSun__';
  E.scene.add(editorSun);

  // Game-preview ambient (very dim — matches scene.js ambientBrightness 0.05)
  const previewAmbient = new THREE.AmbientLight(0xffffff, 0.05);
  previewAmbient.name = '__previewAmbient__';
  previewAmbient.visible = false;
  E.scene.add(previewAmbient);

  // Invisible floor for ghost placement raycasting
  E.floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
  );
  E.floorPlane.rotation.x = -Math.PI / 2;
  E.floorPlane.name = '__floor__';
  E.scene.add(E.floorPlane);

  // List imported models from electron
  await refreshModelList();
  await refreshActorList();

  // Wire up UI
  setupUI();
  setupKeys();
  setupMouse();

  // Disable props until a level is open
  updateProps(null);

  // Open level picker immediately
  openLevelModal();

  setStatus('Ready - create or open a level to start building');
  animate();
}

// â”€â”€â”€ Viewport helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function viewportAspect() {
  const vp = document.getElementById('viewport');
  return vp ? vp.clientWidth / Math.max(1, vp.clientHeight) : innerWidth / innerHeight;
}

function resizeRenderer() {
  const vp = document.getElementById('viewport');
  const w = vp.clientWidth, h = vp.clientHeight;
  E.renderer.setSize(w, h);
  E.camera.aspect = w / Math.max(1, h);
  E.camera.updateProjectionMatrix();
}

// â”€â”€â”€ Reference scene (read-only hardcoded room visuals) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _removedSinisterReferenceScene() {
  const tl = new THREE.TextureLoader();
  function loadTex(url, rep) {
    const t = tl.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep, rep);
    return t;
  }
  const floorTex = loadTex('textures/floor.png',   8);
  const wallTex  = loadTex('textures/wall.png',     8);
  const ceilTex  = loadTex('textures/ceiling.png',  8);

  function mat(map) { return new THREE.MeshStandardMaterial({ map, side: THREE.FrontSide }); }
  function addRef(geo, material, px=0, py=0, pz=0, rx=0, ry=0, rz=0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(px, py, pz);
    m.rotation.set(rx, ry, rz);
    m.receiveShadow = m.castShadow = true;
    m.userData.isRef = true;
    E.refGroup.add(m);
    return m;
  }

  // Floors
  addRef(new THREE.PlaneGeometry(24,24), mat(floorTex),  0, 0,  0, -Math.PI/2);
  addRef(new THREE.PlaneGeometry(24,24), mat(floorTex), 24, 0,  0, -Math.PI/2);
  // Ceilings
  addRef(new THREE.PlaneGeometry(24,24), mat(ceilTex),  0, 6,  0,  Math.PI/2);
  addRef(new THREE.PlaneGeometry(24,24), mat(ceilTex), 24, 6,  0,  Math.PI/2);
  // Main room walls — thickness 0.4 to match ground.js (wallThickness=0.4, wallExtension=0.5)
  addRef(new THREE.BoxGeometry(24.5,6,0.4), mat(wallTex),  0, 3, -12); // front
  addRef(new THREE.BoxGeometry(24.5,6,0.4), mat(wallTex),  0, 3,  12); // back
  addRef(new THREE.BoxGeometry(0.4,6,24.5), mat(wallTex), -12, 3,   0); // left
  // Right wall split around door opening (doorWidth=3.5, doorHeight=4.5, doorOffset=-0.5)
  // Matches ground.js sections exactly:
  //   top:   BoxGeometry(0.4, 1.5, 24.5) at [12, 5.25, 0]
  //   left:  BoxGeometry(0.4, 4.5, 10.25) at [12, 2.25, -7.125]  (leftSectionZ = -12 + 9.75/2 = -7.125)
  //   right: BoxGeometry(0.4, 4.5, 11.25) at [12, 2.25,  6.625]  (rightSectionZ = 1.25 + 10.75/2 = 6.625)
  addRef(new THREE.BoxGeometry(0.4,1.5,24.5), mat(wallTex),  12, 5.25,     0);
  addRef(new THREE.BoxGeometry(0.4,4.5,10.25), mat(wallTex), 12, 2.25, -7.125);
  addRef(new THREE.BoxGeometry(0.4,4.5,11.25), mat(wallTex), 12, 2.25,  6.625);
  // Adjacent room walls
  addRef(new THREE.BoxGeometry(24.5,6,0.4), mat(wallTex), 24, 3, -12);
  addRef(new THREE.BoxGeometry(24.5,6,0.4), mat(wallTex), 24, 3,  12);
  addRef(new THREE.BoxGeometry(0.4,6,24.5), mat(wallTex), 36, 3,   0);

  // Desk
  const gltfLoader = new GLTFLoader();
  gltfLoader.load(ASSET_ROOT + 'low_poly_desk.glb', gltf => {
    const desk = gltf.scene;
    desk.position.set(0, 0, -8);
    desk.scale.setScalar(2.5);
    desk.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; c.userData.isRef = true; } });
    E.refGroup.add(desk);
  });

  // TV
  gltfLoader.load(ASSET_ROOT + 'tv1.glb', gltf => {
    const tv = gltf.scene;
    tv.position.set(0, 2.7, -8);
    tv.scale.setScalar(0.8);
    tv.rotation.y = Math.PI / 2;
    tv.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; c.userData.isRef = true; } });
    E.refGroup.add(tv);
  });

  // Hardcoded bulb light — mirrors ground.js: PointLight(0xc9a876, 1.2, 200, 1) at (0, 5.6, 0)
  const refBulb = new THREE.PointLight(0xc9a876, 1.2, 200, 1);
  refBulb.position.set(0, 5.6, 0);
  refBulb.castShadow = true;
  refBulb.shadow.mapSize.set(2048, 2048);
  refBulb.shadow.radius = 4;
  refBulb.name = '__refBulb__';
  E.refGroup.add(refBulb);

  // Bulb fixture visuals — matches ground.js bulbGroup at position (0, wallHeight=6, 0)
  const refBulbGroup = new THREE.Group();
  refBulbGroup.position.set(0, 6, 0);
  refBulbGroup.userData.isRef = true;
  E.refGroup.add(refBulbGroup);
  function refMesh(geo, color) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
    m.userData.isRef = true;
    return m;
  }
  // Base plate
  const refBase = refMesh(new THREE.CylinderGeometry(0.4, 0.35, 0.1, 32), 0x2a2a2a);
  refBulbGroup.add(refBase);
  // Chain
  const refChain = refMesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 4), 0x333333);
  refChain.position.y = -0.95;
  refBulbGroup.add(refChain);
  // Pull tab
  const refTab = refMesh(new THREE.SphereGeometry(0.08, 8, 8), 0x555555);
  refTab.position.set(0.2, -1.85, 0);
  refBulbGroup.add(refTab);
  // Bulb sphere
  const refBulbMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xc9a876, emissive: 0xc9a876, emissiveIntensity: 0.5 })
  );
  refBulbMesh.position.y = -0.40;
  refBulbMesh.userData.isRef = true;
  refBulbGroup.add(refBulbMesh);
  // Socket
  const refSocket = refMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.15, 8), 0x444444);
  refSocket.position.y = -0.175;
  refBulbGroup.add(refSocket);

  // TV frame spotlight — fixed position from pauseMenu.js: SpotLight at (-0.14, 2.75, -8.17)
  // pointing toward (0.16, 3.05, 1.82), intensity=3.4, distance=10, angle=1.17 rad (~67°)
  {
    const tvFCol = new THREE.Color(0xffffff);
    const tvFMat = new THREE.LineBasicMaterial({ color: tvFCol, opacity: 0.45, transparent: true });
    const tvFGroup = new THREE.Group();
    tvFGroup.name = '__refTVFrameLight__';
    tvFGroup.userData.isRef = true;
    tvFGroup.position.set(-0.14, 2.75, -8.17);
    E.refGroup.add(tvFGroup);
    // Origin dot
    const tvFDot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshBasicMaterial({ color: tvFCol, toneMapped: false }));
    tvFGroup.add(tvFDot);
    // Direction line toward target (0.16, 3.05, 1.82)
    const tvFDir = new THREE.Vector3(0.16 - (-0.14), 3.05 - 2.75, 1.82 - (-8.17)).normalize();
    const tvFDist = 10;
    const tvFAngleDeg = THREE.MathUtils.radToDeg(1.17);
    const tvFRad = Math.tan(THREE.MathUtils.degToRad(Math.min(tvFAngleDeg, 89))) * tvFDist;
    // Cone along direction
    const perpA = new THREE.Vector3(1, 0, 0);
    const perpB = new THREE.Vector3().crossVectors(tvFDir, perpA).normalize();
    perpA.crossVectors(perpB, tvFDir).normalize();
    const N = 24;
    const rimPts = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      rimPts.push(new THREE.Vector3()
        .addScaledVector(perpA, Math.cos(a) * tvFRad)
        .addScaledVector(perpB, Math.sin(a) * tvFRad)
        .addScaledVector(tvFDir, tvFDist));
    }
    tvFGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts), tvFMat));
    [0, Math.PI/2, Math.PI, 3*Math.PI/2].forEach(a => {
      const tip = rimPts[Math.round((a / (Math.PI*2)) * N)];
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), tip.clone()]);
      tvFGroup.add(new THREE.Line(geo, tvFMat));
    });
  }

  // Range wire for the hardcoded bulb — PointLight at (0,5.6,0), distance=200
  // Added to refGroup at the light's world position so it moves with Ref toggle
  const bulbWireCol = new THREE.Color(0xc9a876);
  const bulbWireMat = new THREE.LineBasicMaterial({ color: bulbWireCol, opacity: 0.35, transparent: true });
  const bulbDist = 200;
  const refRangeGroup = new THREE.Group();
  refRangeGroup.name = '__refBulbRange__';
  refRangeGroup.userData.isRef = true;
  refRangeGroup.position.set(0, 5.6, 0);
  function makeRefCircle(r, axis) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      if      (axis === 'y') pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      else if (axis === 'x') pts.push(new THREE.Vector3(0, Math.cos(a) * r, Math.sin(a) * r));
      else                   pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), bulbWireMat);
  }
  refRangeGroup.add(makeRefCircle(bulbDist, 'y'));
  refRangeGroup.add(makeRefCircle(bulbDist, 'x'));
  refRangeGroup.add(makeRefCircle(bulbDist, 'z'));
  E.refGroup.add(refRangeGroup);
}

// â”€â”€â”€ Level save / load â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function levelToJSON() {
  const objects = [];
  E.placedGroup.children.forEach(obj => {
    if (obj.userData.isEditorHelper) return;
    // CSG result: store the recipe, not pos/rot/size (result lives at world origin)
    if (obj.userData.primType === 'csg-result') {
      const csgEntry = {
        id:         obj.userData.editorId,
        label:      obj.userData.label || '',
        type:       'csg-result',
        collidable: obj.userData.collidable !== false,
        castShadow: obj.castShadow !== false,
        pos:        [0, 0, 0],
        rot:        [0, 0, 0],
        size:       [1, 1, 1],
        csgRecipe:  obj.userData.csgRecipe,
      };
      if (obj.userData.faceTextures) csgEntry.faceTextures = obj.userData.faceTextures;
      objects.push(csgEntry);
      return;
    }
    if (obj.userData.primType === 'merged-model') {
      const mergedEntry = {
        id:           obj.userData.editorId,
        label:        obj.userData.label || '',
        type:         'merged-model',
        collidable:   obj.userData.collidable !== false,
        castShadow:   obj.castShadow !== false,
        pos:          [+obj.position.x.toFixed(4), +obj.position.y.toFixed(4), +obj.position.z.toFixed(4)],
        rot:          [+(obj.rotation.x*DEG).toFixed(2), +(obj.rotation.y*DEG).toFixed(2), +(obj.rotation.z*DEG).toFixed(2)],
        size:         [+obj.scale.x.toFixed(4), +obj.scale.y.toFixed(4), +obj.scale.z.toFixed(4)],
        mergedMeshes: _serializeMergedMeshes(obj),
      };
      if (obj.userData.meshOverrides) mergedEntry.meshOverrides = obj.userData.meshOverrides;
      if (obj.userData.states?.length) mergedEntry.states = obj.userData.states;
      if (obj.userData.links?.length)  mergedEntry.links  = obj.userData.links;
      if (obj.userData.noSelfInteract) mergedEntry.noSelfInteract = true;
      objects.push(mergedEntry);
      return;
    }
    const entry = {
      id:         obj.userData.editorId,
      label:      obj.userData.label || '',
      type:       obj.userData.primType || 'model',
      collidable: obj.userData.collidable !== false,
      castShadow: isLightType(obj.userData.primType) ? obj.userData.castShadow !== false : obj.castShadow !== false,
      pos:        [+obj.position.x.toFixed(4), +obj.position.y.toFixed(4), +obj.position.z.toFixed(4)],
      rot:        [+(obj.rotation.x*DEG).toFixed(2), +(obj.rotation.y*DEG).toFixed(2), +(obj.rotation.z*DEG).toFixed(2)],
      size:       [+obj.scale.x.toFixed(4), +obj.scale.y.toFixed(4), +obj.scale.z.toFixed(4)],
      color:      obj.material?.color ? '#' + obj.material.color.getHexString() : '#aaaacc',
    };
    if (obj.userData.emissiveIntensity > 0) {
      entry.emissiveIntensity = obj.userData.emissiveIntensity;
      entry.emissiveColor     = obj.userData.emissiveColor ?? '#ffffff';
    }
    const _opacity = getMeshOpacity(obj);
    if (_opacity < 1) entry.opacity = +_opacity.toFixed(3);
    if (obj.userData.primType === 'model') entry.modelPath = obj.userData.modelPath;
    if (obj.userData.primType === 'actor-spawn') {
      entry.actorModel      = obj.userData.actorModel;
      entry.spawnRadius     = obj.userData.spawnRadius ?? 0;
      entry.persistent      = obj.userData.persistent !== false;
      entry.singleInstance  = obj.userData.singleInstance === true;
      if (obj.userData.meshOverrides && Object.keys(obj.userData.meshOverrides).length)
        entry.meshOverrides = obj.userData.meshOverrides;
      if (obj.userData.animations?.length)
        entry.animations = obj.userData.animations;
    }
    if (obj.userData.faceTextures)   entry.faceTextures   = obj.userData.faceTextures;
    if (obj.userData.meshOverrides)  entry.meshOverrides  = obj.userData.meshOverrides;
    if (obj.userData.masterTexture)  entry.masterTexture  = obj.userData.masterTexture;
    if (obj.userData.roughness !== undefined) entry.roughness = obj.userData.roughness;
    if (obj.userData.metalness !== undefined) entry.metalness = obj.userData.metalness;
    if (obj.userData.geomParams)    entry.geomParams    = obj.userData.geomParams;
    if (obj.userData.isMainFloor)   entry.isMainFloor   = true;
    if (obj.userData.isAdjFloor)    entry.isAdjFloor    = true;
    // Light-specific fields
    if (isLightType(obj.userData.primType)) {
      entry.lightColor = obj.userData.lightColor || '#ffffff';
      entry.intensity  = obj.userData.intensity  ?? 1;
      entry.distance   = obj.userData.distance   ?? 0;
      entry.decay      = obj.userData.decay      ?? 2;
      if (obj.userData.primType === 'spot-light') {
        entry.angle    = obj.userData.angle    ?? 30;
        entry.penumbra = obj.userData.penumbra ?? 0.15;
      }
    }
    if (obj.userData.states?.length)   entry.states         = obj.userData.states;
    if (obj.userData.links?.length)      entry.links          = obj.userData.links;
    if (obj.userData.pivotOffset)        entry.pivotOffset    = obj.userData.pivotOffset;
    if (obj.userData.noSelfInteract)     entry.noSelfInteract = true;
    // Trigger-specific fields
    if (isTriggerType(obj.userData.primType)) {
      if (obj.userData.primType === 'custom-trigger') {
        entry.triggerVar      = obj.userData.triggerVar      || '';
        entry.triggerVarOp    = obj.userData.triggerVarOp    || 'set';
        entry.triggerVarValue = obj.userData.triggerVarValue ?? 'true';
      } else {
        entry.saveSlot = obj.userData.saveSlot || 'autosave';
        entry.onceOnly = obj.userData.onceOnly !== false;
      }
      entry.scale = entry.size;
    }
    objects.push(entry);
  });

  const groups = {};
  for (const [gid, g] of Object.entries(E.groups)) {
    groups[gid] = { name: g.name, ids: [...g.ids] };
  }
  return { levelName: E.levelName, nextId: E.nextId, objects, groups, vars: E.levelVars };
}

async function saveLevel() {
  if (!E.levelName) { setStatus('No level open'); return; }
  if (!window.electron) { setStatus('Not running in Electron - cannot save to disk'); return; }
  const data = levelToJSON();
  try {
    await window.electron.saveLevel(E.levelName, data);
    E.isDirty = false;
    refreshLevelNameDisplay();
    setStatus(`Saved "${E.levelName}" - ${data.objects.length} object(s)`);
  } catch (err) {
    setStatus('Save failed: ' + err.message);
  }
}

async function loadLevel(name) {
  clearPlaced();
  E.undoStack = [];
  E.redoStack = [];
  E.levelName = name;

  let data = null;
  if (window.electron) {
    try { data = await window.electron.readLevel(name); } catch { /* new */ }
  }

  E.nextId = data?.nextId || 1;
  E.groups = {};
  E.groupCollapsed = {};
  if (data?.groups) {
    for (const [gid, g] of Object.entries(data.groups)) {
      E.groups[gid] = { name: g.name, ids: new Set(g.ids) };
    }
  }
  E.levelVars = data?.vars ? { ...data.vars } : {};
  renderVarsPanel();

  if (data?.objects?.length) {
    const gltfLoader = new GLTFLoader();
    const fbxLoader  = new FBXLoader();
    const promises = data.objects.map(entry => {
      if (entry.type === 'csg-result')    return spawnCsgResult(entry, gltfLoader, fbxLoader).catch(err => console.warn('CSG spawn failed:', err));
      if (entry.type === 'model')          return loadModelIntoPlaced(entry, gltfLoader, fbxLoader);
      if (entry.type === 'merged-model')   return Promise.resolve(spawnMergedModel(entry));
      return Promise.resolve(spawnPrimFromEntry(entry));
    });
    await Promise.allSettled(promises);
  }

  E.isDirty = false;
  refreshLevelNameDisplay();
  updateSceneList();
  updateGroupsPanel();

  const objCount = data?.objects?.length ?? 0;
  setStatus(objCount ? `Loaded "${name}" - ${objCount} object(s)` : `New level "${name}" - add objects to get started`);
}

function clearPlaced() {
  E.transform.detach();
  E.selected = null;
  while (E.placedGroup.children.length) E.placedGroup.remove(E.placedGroup.children[0]);
  E.colHelpers.forEach(h => E.scene.remove(h));
  E.colHelpers = [];
  E.groups = {};
  E.groupCollapsed = {};
  E.levelVars = {};
  updateSceneList();
  updateGroupsPanel();
  renderVarsPanel();
  updateProps(null);
}

async function loadModelIntoPlaced(entry, gltfLoader, fbxLoader) {
  return new Promise(resolve => {
    const ext = (entry.modelPath || '').split('.').pop().toLowerCase();
    const loader = ext === 'fbx' ? fbxLoader : gltfLoader;
    loader.load(ASSET_ROOT + entry.modelPath, result => {
      const root = result.scene || result;
      root.castShadow = entry.castShadow !== false;
      root.traverse(c => { if (c.isMesh) { c.castShadow = entry.castShadow !== false; c.receiveShadow = true; } });
      applyEntryTransform(root, entry);
      root.userData.primType   = 'model';
      root.userData.modelPath  = entry.modelPath;
      root.userData.editorId   = entry.id;
      root.userData.label      = entry.label || '';
      root.userData.collidable = entry.collidable !== false;
      root.name = entry.label || ('Model_' + entry.id);
      if (entry.states?.length) { root.userData.states = entry.states; root.userData.currentState = 0; }
      if (entry.links?.length)  root.userData.links  = entry.links;
      if (entry.noSelfInteract) root.userData.noSelfInteract = true;
      if (entry.emissiveIntensity > 0) {
        root.userData.emissiveIntensity = entry.emissiveIntensity;
        root.userData.emissiveColor     = entry.emissiveColor ?? '#ffffff';
        const col = new THREE.Color(entry.emissiveColor ?? '#ffffff');
        root.traverse(c => {
          if (c.isMesh && c.material) {
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            mats.forEach(m => { if ('emissive' in m) { m.emissive.copy(col); m.emissiveIntensity = entry.emissiveIntensity; } });
          }
        });
      }
      if (entry.meshOverrides) {
        root.userData.meshOverrides = entry.meshOverrides;
        root.traverse(c => {
          if (!c.isMesh) return;
          const key = c.name || c.uuid;
          const ovr = entry.meshOverrides[key];
          if (!ovr) return;
          if (ovr.visible === false) c.visible = false;
          if (ovr.texture) _applyMeshEditorTexture(c, ovr.texture);
        });
      }
      if (entry.masterTexture) {
        root.userData.masterTexture = entry.masterTexture;
        root.userData.roughness = entry.roughness;
        root.userData.metalness = entry.metalness;
        const col = new THREE.Color(entry.color ?? '#aaaacc');
        const roughness = entry.roughness ?? 1;
        const metalness = entry.metalness ?? 0;
        const loader = new THREE.TextureLoader();
        const tryUrl = url => new Promise(res => loader.load(ASSET_ROOT + 'textures/' + url, res, undefined, () => res(null)));
        (async () => {
          let tex = await tryUrl(entry.masterTexture + '.png');
          if (!tex) tex = await tryUrl(entry.masterTexture + '.jpg');
          if (!tex) return;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          root.traverse(c => {
            if (!c.isMesh) return;
            c.material = new THREE.MeshStandardMaterial({ color: col, map: tex, roughness, metalness });
          });
        })();
      } else if (entry.roughness !== undefined || entry.metalness !== undefined) {
        root.userData.roughness = entry.roughness;
        root.userData.metalness = entry.metalness;
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
      E.placedGroup.add(root);
      resolve();
    }, undefined, () => resolve());
  });
}

function applyEntryTransform(obj, entry) {
  obj.position.set(...entry.pos);
  obj.rotation.set(entry.rot[0]*RAD, entry.rot[1]*RAD, entry.rot[2]*RAD);
  obj.scale.set(...entry.size);
}

// â”€â”€â”€ Primitives â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PRIM_GEOS = {
  box:      () => new THREE.BoxGeometry(1,1,1),
  sphere:   () => new THREE.SphereGeometry(0.5, 16, 12),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  plane:    () => new THREE.PlaneGeometry(1,1),
  // save-trigger and custom-trigger use a box geometry but are rendered as a wireframe-only volume
  'save-trigger':   () => new THREE.BoxGeometry(2, 2, 2),
  'custom-trigger': () => new THREE.BoxGeometry(2, 2, 2),
};

function isLightType(t) {
  return t === 'point-light' || t === 'spot-light' || t === 'dir-light';
}

function isTriggerType(t) {
  return t === 'save-trigger' || t === 'custom-trigger';
}

const LIGHT_DEFAULTS = {
  'point-light': { intensity: 1.0, distance: 10, decay: 2 },
  'spot-light':  { intensity: 1.0, distance: 20, decay: 2, angle: 30, penumbra: 0.15 },
  'dir-light':   { intensity: 1.0 },
};

// ─── Geometry param system ─────────────────────────────────────────────────────
// Default params per primitive type (used when geomParams is absent)
const GEOM_DEFAULTS = {
  box:      { bevel: 0, bevelSegs: 2, wSegs: 1, hSegs: 1, dSegs: 1 },
  sphere:   { wSegs: 16, hSegs: 12, phi: 360, theta: 180 },
  cylinder: { radSegs: 16, hSegs: 1, radTop: 1, open: false },
  plane:    { wSegs: 1, hSegs: 1 },
};

// Build the correct BufferGeometry from a primitive type + params
function buildGeometry(type, p = {}) {
  const d = GEOM_DEFAULTS[type] ?? {};
  if (type === 'box') {
    const bevel = p.bevel ?? d.bevel;
    if (bevel > 0.001) {
      return new RoundedBoxGeometry(1, 1, 1, p.bevelSegs ?? d.bevelSegs, bevel);
    }
    return new THREE.BoxGeometry(1, 1, 1, p.wSegs ?? d.wSegs, p.hSegs ?? d.hSegs, p.dSegs ?? d.dSegs);
  }
  if (type === 'sphere') {
    const phiLen   = ((p.phi   ?? d.phi)   * Math.PI) / 180;
    const thetaLen = ((p.theta ?? d.theta) * Math.PI) / 180;
    return new THREE.SphereGeometry(0.5, p.wSegs ?? d.wSegs, p.hSegs ?? d.hSegs,
      0, phiLen, 0, thetaLen);
  }
  if (type === 'cylinder') {
    const radTop = (p.radTop ?? d.radTop) * 0.5; // user sets 0–1, geo uses 0–0.5
    return new THREE.CylinderGeometry(radTop, 0.5, 1,
      p.radSegs ?? d.radSegs, p.hSegs ?? d.hSegs, p.open ?? d.open);
  }
  if (type === 'plane') {
    return new THREE.PlaneGeometry(1, 1, p.wSegs ?? d.wSegs, p.hSegs ?? d.hSegs);
  }
  // Triggers / unsupported — return as-is
  return PRIM_GEOS[type]?.() ?? new THREE.BoxGeometry(1, 1, 1);
}

// Swap geometry on an existing mesh (preserves material, position, scale etc.)
function rebuildGeometry(mesh, silent = false) {
  const type = mesh.userData.primType;
  if (!GEOM_DEFAULTS[type]) return; // only primitive types that have geom params
  const p = mesh.userData.geomParams ?? {};
  const oldGeo = mesh.geometry;
  mesh.geometry = buildGeometry(type, p);
  oldGeo.dispose();
  if (!silent) markDirty();
}

// Populate geom panel inputs from current object's geomParams
function refreshGeomPanel(obj) {
  if (!obj) return;
  const type = obj.userData.primType;
  const p = obj.userData.geomParams ?? {};
  const d = GEOM_DEFAULTS[type] ?? {};
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };

  // Hide all sub-sections, show the right one
  ['box','sphere','cylinder','plane'].forEach(t => {
    const el = document.getElementById('geom-' + t);
    if (el) el.style.display = (t === type) ? '' : 'none';
  });

  if (type === 'box') {
    set('geom-bevel',      p.bevel     ?? d.bevel);
    set('geom-bevel-segs', p.bevelSegs ?? d.bevelSegs);
    set('geom-box-ws',     p.wSegs     ?? d.wSegs);
    set('geom-box-hs',     p.hSegs     ?? d.hSegs);
    set('geom-box-ds',     p.dSegs     ?? d.dSegs);
  } else if (type === 'sphere') {
    set('geom-sph-ws',    p.wSegs ?? d.wSegs);
    set('geom-sph-hs',    p.hSegs ?? d.hSegs);
    set('geom-sph-phi',   p.phi   ?? d.phi);
    set('geom-sph-theta', p.theta ?? d.theta);
  } else if (type === 'cylinder') {
    set('geom-cyl-rs', p.radSegs ?? d.radSegs);
    set('geom-cyl-hs', p.hSegs   ?? d.hSegs);
    set('geom-cyl-rt', p.radTop  ?? d.radTop);
    setChk('geom-cyl-open', p.open ?? d.open);
  } else if (type === 'plane') {
    set('geom-plane-ws', p.wSegs ?? d.wSegs);
    set('geom-plane-hs', p.hSegs ?? d.hSegs);
  }
}

// Create a light group: actual THREE.Light + a small visual mesh, grouped together.
// The group is what gets added to E.placedGroup and attached to TransformControls.
function updateLightRangeHelper(group) {
  if (!group?.userData?.isLightGroup) return;
  // Remove old helper group
  const old = group.getObjectByName('__rangeWire__');
  if (old) { old.traverse(c => c.geometry?.dispose()); group.remove(old); }

  const type = group.userData.primType;
  const dist  = group.userData.distance ?? 10;
  const angle = group.userData.angle ?? 30;
  const col   = new THREE.Color(group.userData.lightColor || '#ffffff');
  const mat   = new THREE.LineBasicMaterial({ color: col, opacity: 0.55, transparent: true });

  const container = new THREE.Group();
  container.name = '__rangeWire__';
  container.userData.isEditorHelper = true;

  // Origin dot — always shown for every light type
  const dotMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), dotMat);
  dot.userData.isEditorHelper = true;
  container.add(dot);

  if (type === 'dir-light') {
    // Directional: small arrow pointing -Y to show direction
    const arrowPts = [new THREE.Vector3(0,0,0), new THREE.Vector3(0,-1.5,0)];
    container.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arrowPts), mat));
    container.visible = !E.previewLighting;
    group.add(container);
    return;
  }

  function makeCircle(radius, axis) {
    const pts = [];
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      if      (axis === 'y') pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      else if (axis === 'x') pts.push(new THREE.Vector3(0, Math.cos(a) * radius, Math.sin(a) * radius));
      else                   pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
    }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  }

  if (type === 'point-light') {
    // Three orthogonal great circles showing the range sphere
    container.add(makeCircle(dist, 'y'));
    container.add(makeCircle(dist, 'x'));
    container.add(makeCircle(dist, 'z'));
  } else { // spot-light
    const rad = Math.tan(THREE.MathUtils.degToRad(Math.min(angle, 89))) * dist;
    // Base circle at -dist on Y (light points down by default)
    const baseCircle = makeCircle(rad, 'y');
    baseCircle.position.y = -dist;
    container.add(baseCircle);
    // 4 edge lines from apex (origin) to base rim
    [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].forEach(a => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(Math.cos(a) * rad, -dist, Math.sin(a) * rad),
      ]);
      container.add(new THREE.Line(geo, mat));
    });
  }

  container.visible = !E.previewLighting;
  group.add(container);
}

function makeLightGroup(type, params = {}) {
  const def = LIGHT_DEFAULTS[type] || {};
  const p   = { ...def, ...params };
  const col = new THREE.Color(p.lightColor || '#ffffff');

  let light;
  let helperMesh;

  if (type === 'point-light') {
    light = new THREE.PointLight(col, p.intensity ?? 1, p.distance ?? 10, p.decay ?? 2);
    helperMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 6),
      new THREE.MeshBasicMaterial({ color: col, toneMapped: false })
    );
    helperMesh.name = '__lightHelper__';
    // Small rays cross
    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.25,0,0), new THREE.Vector3(0.25,0,0),
      new THREE.Vector3(0,-0.25,0), new THREE.Vector3(0,0.25,0),
      new THREE.Vector3(0,0,-0.25), new THREE.Vector3(0,0,0.25),
    ]);
    const rayLines = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ color: col, toneMapped: false }));
    helperMesh.add(rayLines);

  } else if (type === 'spot-light') {
    light = new THREE.SpotLight(col, p.intensity ?? 1, p.distance ?? 20,
      THREE.MathUtils.degToRad(p.angle ?? 30), p.penumbra ?? 0.15, p.decay ?? 2);
    // Cone pointing in -Y (default down)
    helperMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.35, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: col, toneMapped: false, wireframe: true })
    );
    helperMesh.name = '__lightHelper__';
    helperMesh.rotation.x = Math.PI; // point cone downward along local -Y
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 5),
      new THREE.MeshBasicMaterial({ color: col, toneMapped: false })
    );
    helperMesh.add(dot);

  } else { // dir-light
    light = new THREE.DirectionalLight(col, p.intensity ?? 1);
    // Flat disc + arrow
    helperMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.04, 12),
      new THREE.MeshBasicMaterial({ color: col, toneMapped: false })
    );
    helperMesh.name = '__lightHelper__';
    const arrowGeo = new THREE.ConeGeometry(0.07, 0.28, 8);
    const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    arrow.position.set(0, -0.2, 0);
    arrow.rotation.x = Math.PI;
    helperMesh.add(arrow);
  }

  light.name = '__light__';
  light.castShadow = p.castShadow !== false;

  const group = new THREE.Group();
  group.add(light);
  group.add(helperMesh);
  // SpotLight needs its target in the scene hierarchy; parent it to the group
  // at local (0,-1,0) so it always aims downward relative to the group's rotation.
  if (type === 'spot-light') {
    light.target.position.set(0, -1, 0);
    group.add(light.target);
  }

  group.userData.primType      = type;
  group.userData.lightColor    = p.lightColor || '#ffffff';
  group.userData.intensity     = p.intensity  ?? 1;
  group.userData.distance      = p.distance   ?? (type === 'dir-light' ? 0 : 10);
  group.userData.decay         = p.decay      ?? 2;
  group.userData.angle         = p.angle      ?? 30;       // spot only
  group.userData.penumbra      = p.penumbra   ?? 0.15;     // spot only
  group.userData.castShadow    = p.castShadow !== false;
  group.userData.isLightGroup  = true;
  group.userData.collidable    = false;

  updateLightRangeHelper(group);
  return group;
}

function makePrimMesh(type, color = 0xaaaacc) {
  const geo = PRIM_GEOS[type]?.();
  if (!geo) return null;
  const isTrigger = isTriggerType(type);
  const trigColor = type === 'custom-trigger' ? 0xffaa44 : 0x44ffcc;
  const mat = isTrigger
    ? new THREE.MeshBasicMaterial({ color: trigColor, wireframe: true, opacity: 0.6, transparent: true })
    : new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  if (!isTrigger) { mesh.castShadow = mesh.receiveShadow = true; }
  return mesh;
}

// --- Per-face texture system ─────────────────────────────────────────────────
// Box geometry face indices: 0=+X(right), 1=-X(left), 2=+Y(top), 3=-Y(bottom), 4=+Z(front), 5=-Z(back)
const BOX_FACE_NAMES = ['Right (+X)', 'Left (-X)', 'Top (+Y)', 'Bottom (-Y)', 'Front (+Z)', 'Back (-Z)'];

// Build a texture config object (stored in userData.faceTextures[key])
function makeFaceTexConfig(name, rx = 1, ry = 1, ox = 0, oy = 0, wrap = 'repeat', tilingMode = 'repeat', worldScale = 1) {
  return { name, rx, ry, ox, oy, wrap, tilingMode, worldScale };
}

// Create a MeshStandardMaterial from a faceTexConfig and a base color
function makeFaceTexMat(hexColor, config) {
  const mat = new THREE.MeshStandardMaterial({ color: hexColor ?? 0xaaaacc, roughness: 0.8, metalness: 0.0 });
  if (config?.name) {
    const loader = new THREE.TextureLoader();
    const applyTex = tex => {
      const wrapMap = { clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping };
      tex.wrapS = tex.wrapT = wrapMap[config.wrap] ?? THREE.RepeatWrapping;
      tex.repeat.set(config.rx ?? 1, config.ry ?? 1);
      tex.offset.set(config.ox ?? 0, config.oy ?? 0);
      tex.needsUpdate = true;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    };
    // Try .png first, fall back to .jpg
    loader.load(`${ASSET_ROOT}textures/${config.name}.png`, applyTex, undefined,
      () => loader.load(`${ASSET_ROOT}textures/${config.name}.jpg`, applyTex)
    );
  }
  return mat;
}

// Get effective config for a face key ('all' or '0'-'5'), with 'all' as fallback
function getFaceConfig(mesh, faceKey) {
  const ft = mesh.userData.faceTextures;
  if (!ft) return null;
  return ft[String(faceKey)] ?? ft['all'] ?? null;
}

// Set or clear the config for a face key, then rebuild materials
function setFaceConfig(mesh, faceKey, config) {
  if (!mesh.userData.faceTextures) mesh.userData.faceTextures = {};
  const key = String(faceKey);
  if (config === null || config === undefined) {
    delete mesh.userData.faceTextures[key];
  } else {
    mesh.userData.faceTextures[key] = config;
  }
  applyFaceTextures(mesh);
  markDirty();
}

function getMeshOpacity(obj) {
  if (obj.userData._opacity !== undefined) return obj.userData._opacity;
  if (!obj.material) return 1;
  const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  return m?.opacity ?? 1;
}
function setMeshOpacity(obj, v) {
  if (!obj.material) return;
  obj.userData._opacity = v;
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  mats.forEach(m => { m.transparent = v < 1; m.opacity = v; m.needsUpdate = true; });
}
function syncOpacityWireframe(obj) {
  const existing = obj.children?.find(c => c.userData.isOpacityWire);
  if (existing) { obj.remove(existing); existing.geometry?.dispose(); existing.material?.dispose(); }
  if (getMeshOpacity(obj) < 0.5 && obj.geometry) {
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(obj.geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.6, transparent: true })
    );
    wire.userData.isOpacityWire = true;
    wire.userData.isEditorHelper = true;
    obj.add(wire);
  }
}

// Apply userData.faceTextures to mesh.material (multi-material for boxes with per-face overrides)
function applyFaceTextures(mesh) {
  const ft = mesh.userData.faceTextures;
  if (!ft) return;
  const baseColor = mesh.userData._baseColor ?? '#aaaacc';
  const isBox = mesh.userData.primType === 'box';
  const hasPerFace = isBox && Object.keys(ft).some(k => k !== 'all' && /^\d$/.test(k));

  // Dispose old materials
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(m => m.dispose());
  } else if (mesh.material) {
    mesh.material.dispose();
  }

  if (hasPerFace) {
    // Multi-material array for box (6 faces)
    mesh.material = Array.from({ length: 6 }, (_, i) => {
      const cfg = ft[String(i)] ?? ft['all'] ?? null;
      return makeFaceTexMat(baseColor, cfg);
    });
  } else {
    mesh.material = makeFaceTexMat(baseColor, ft['all'] ?? null);
  }
  mesh.material.needsUpdate = true; // may be array; Three.js handles it
  if (mesh.userData._opacity !== undefined && mesh.userData._opacity < 1) {
    const v = mesh.userData._opacity;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => { m.transparent = true; m.opacity = v; m.needsUpdate = true; });
  }
}

// Compute repeat values for world-based tiling on a box face
function computeWorldRepeat(mesh, faceKey, unitsPerTile) {
  if (!unitsPerTile || unitsPerTile <= 0) return [1, 1];
  const s = mesh.scale;
  const fi = parseInt(faceKey);
  let w, h;
  if      (fi === 0 || fi === 1) { w = s.z; h = s.y; }
  else if (fi === 2 || fi === 3) { w = s.x; h = s.z; }
  else if (fi === 4 || fi === 5) { w = s.x; h = s.y; }
  else { w = s.x; h = s.z; } // 'all' — use X/Z as fallback
  return [Math.max(0.01, w / unitsPerTile), Math.max(0.01, h / unitsPerTile)];
}

// --- Face highlight ───────────────────────────────────────────────────────────
function updateFaceHighlight(mesh, faceIdx) {
  // remove old
  if (E.faceHighlightMesh) {
    if (E.faceHighlightMesh.parent) E.faceHighlightMesh.parent.remove(E.faceHighlightMesh);
    E.faceHighlightMesh = null;
  }
  if (faceIdx === null || faceIdx === undefined || !mesh) return;
  if (mesh.userData.primType !== 'box') return;

  // Local positions/rotations for each box face (unit box geometry spans -0.5 to 0.5)
  const faceParams = [
    { px: 0.501, py: 0, pz: 0, rx: 0, ry: Math.PI / 2, rz: 0 },   // 0: +X right
    { px: -0.501, py: 0, pz: 0, rx: 0, ry: -Math.PI / 2, rz: 0 },  // 1: -X left
    { px: 0, py: 0.501, pz: 0, rx: -Math.PI / 2, ry: 0, rz: 0 },   // 2: +Y top
    { px: 0, py: -0.501, pz: 0, rx: Math.PI / 2, ry: 0, rz: 0 },   // 3: -Y bottom
    { px: 0, py: 0, pz: 0.501, rx: 0, ry: 0, rz: 0 },               // 4: +Z front
    { px: 0, py: 0, pz: -0.501, rx: 0, ry: Math.PI, rz: 0 },        // 5: -Z back
  ];
  const fp = faceParams[faceIdx];
  if (!fp) return;

  const mat = new THREE.MeshBasicMaterial({
    color: 0x4499ff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plane.position.set(fp.px, fp.py, fp.pz);
  plane.rotation.set(fp.rx, fp.ry, fp.rz);
  plane.renderOrder = 5;
  plane.userData.isEditorHelper = true;
  mesh.add(plane);
  E.faceHighlightMesh = plane;
}

function spawnPrimFromEntry(entry) {
  if (entry.type === 'actor-spawn') {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 6),
      new THREE.MeshStandardMaterial({ color: 0x44aaff, opacity: 0.7, transparent: true })
    );
    applyEntryTransform(mesh, entry);
    mesh.userData = {
      primType:       'actor-spawn',
      actorModel:     entry.actorModel || '',
      editorId:       entry.id,
      label:          entry.label || '',
      collidable:     false,
      spawnRadius:    entry.spawnRadius ?? 0,
      persistent:     entry.persistent !== false,
      singleInstance: entry.singleInstance === true,
      meshOverrides:  entry.meshOverrides ? { ...entry.meshOverrides } : {},
      animations:     entry.animations ? [...entry.animations] : [],
    };
    mesh.name = entry.label || ('ActorSpawn_' + entry.id);
    if (entry.states?.length) { mesh.userData.states = entry.states; mesh.userData.currentState = 0; }
    if (entry.links?.length)  mesh.userData.links = entry.links;
    E.placedGroup.add(mesh);
    return mesh;
  }
  if (isLightType(entry.type)) {
    const group = makeLightGroup(entry.type, {
      lightColor: entry.lightColor || '#ffffff',
      intensity:  entry.intensity  ?? 1,
      distance:   entry.distance   ?? 10,
      decay:      entry.decay      ?? 2,
      angle:      entry.angle      ?? 30,
      penumbra:   entry.penumbra   ?? 0.15,
      castShadow: entry.castShadow !== false,
    });
    applyEntryTransform(group, entry);
    group.userData.editorId = entry.id;
    group.userData.label    = entry.label || '';
    group.name = entry.label || (entry.type + '_' + entry.id);
    if (entry.states?.length) { group.userData.states = entry.states; group.userData.currentState = 0; }
    if (entry.links?.length)  group.userData.links        = entry.links;
    if (entry.noSelfInteract) group.userData.noSelfInteract = true;
    E.placedGroup.add(group);
    return group;
  }

  const mesh = makePrimMesh(entry.type, entry.color);
  if (!mesh) return null;
  applyEntryTransform(mesh, entry);
  mesh.castShadow      = entry.castShadow !== false;
  mesh.userData.primType   = entry.type;
  mesh.userData.editorId   = entry.id;
  mesh.userData.label      = entry.label || '';
  mesh.userData.collidable = entry.collidable !== false;
  mesh.userData._baseColor = entry.color ?? '#aaaacc';
  if (entry.isMainFloor)   mesh.userData.isMainFloor   = true;
  if (entry.isAdjFloor)    mesh.userData.isAdjFloor    = true;
  if (entry.states?.length) { mesh.userData.states = entry.states; mesh.userData.currentState = 0; }
  if (entry.links?.length)  mesh.userData.links  = entry.links;
  if (entry.pivotOffset)    mesh.userData.pivotOffset = entry.pivotOffset;
  if (entry.noSelfInteract) mesh.userData.noSelfInteract = true;
  if (entry.opacity !== undefined) {
    mesh.userData._opacity = entry.opacity;
  }
  if (entry.emissiveIntensity > 0 && mesh.material) {
    mesh.userData.emissiveIntensity = entry.emissiveIntensity;
    mesh.userData.emissiveColor     = entry.emissiveColor ?? '#ffffff';
    const col = new THREE.Color(entry.emissiveColor ?? '#ffffff');
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => { if ('emissive' in m) { m.emissive.copy(col); m.emissiveIntensity = entry.emissiveIntensity; } });
  }
  // Geometry params (bevel, segments, etc.) — rebuild geometry if non-default
  if (entry.geomParams) {
    mesh.userData.geomParams = entry.geomParams;
    rebuildGeometry(mesh, true); // silent — don't mark dirty on load
  }
  // New per-face texture system
  if (entry.faceTextures) {
    mesh.userData.faceTextures = entry.faceTextures;
    applyFaceTextures(mesh);
  } else if (entry.texture) {
    // Backward compat: convert old single-texture format to new
    const [rx, ry] = entry.textureRepeat || [1, 1];
    mesh.userData.faceTextures = { all: makeFaceTexConfig(entry.texture, rx, ry) };
    applyFaceTextures(mesh);
  }
  if (mesh.userData._opacity !== undefined) {
    setMeshOpacity(mesh, mesh.userData._opacity);
    syncOpacityWireframe(mesh);
  }
  if (isTriggerType(entry.type)) {
    if (entry.type === 'custom-trigger') {
      mesh.userData.triggerVar      = entry.triggerVar      || '';
      mesh.userData.triggerVarOp    = entry.triggerVarOp    || 'set';
      mesh.userData.triggerVarValue = entry.triggerVarValue ?? 'true';
    } else {
      mesh.userData.saveSlot    = entry.saveSlot || 'autosave';
      mesh.userData.onceOnly    = entry.onceOnly !== false;
    }
    mesh.userData.collidable = false;
  }
  mesh.name = entry.label || (entry.type + '_' + entry.id);
  E.placedGroup.add(mesh);
  return mesh;
}

// â”€â”€â”€ Placement ghost â†’ commit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function beginPlace(typeStr) {
  cancelPlace();
  E.placingType = typeStr;
  updatePlacingHint(true);

  const isModel   = typeStr.startsWith('model:');
  const isActor   = typeStr.startsWith('actor:');
  const isLight   = isLightType(typeStr);
  const isTrigger = isTriggerType(typeStr);
  let ghostGeo;
  if (isLight) {
    ghostGeo = new THREE.SphereGeometry(0.18, 8, 6);
  } else if (isActor) {
    ghostGeo = new THREE.SphereGeometry(0.3, 8, 6);
  } else {
    ghostGeo = isModel ? new THREE.BoxGeometry(1,1,1) : (PRIM_GEOS[typeStr]?.() ?? new THREE.BoxGeometry(1,1,1));
  }
  const trigGhostColor = E.placingType === 'custom-trigger' ? 0xffaa44 : 0x44ffcc;
  const ghostColor = isLight ? 0xffee44 : (isTrigger ? trigGhostColor : (isActor ? 0x44aaff : 0xe94560));
  E.ghostMesh = new THREE.Mesh(ghostGeo,
    new THREE.MeshStandardMaterial({ color: ghostColor, opacity: 0.45, transparent: true, depthWrite: false })
  );
  E.ghostMesh.name = '__ghost__';
  E.ghostMesh.userData.isEditorHelper = true;
  E.scene.add(E.ghostMesh);
}

function cancelPlace() {
  if (E.ghostMesh) { E.scene.remove(E.ghostMesh); E.ghostMesh = null; }
  E.placingType = null;
  updatePlacingHint(false);
  document.querySelectorAll('.prim-btn, .model-item, .actor-item').forEach(b => b.classList.remove('active'));
}

function commitPlace(worldPos) {
  if (!E.placingType || !E.levelName) return;
  const id = E.nextId++;

  if (E.placingType.startsWith('model:')) {
    const modelPath = E.placingType.slice(6);
    const ext = modelPath.split('.').pop().toLowerCase();
    const loader = ext === 'fbx' ? new FBXLoader() : new GLTFLoader();
    loader.load(ASSET_ROOT + modelPath, result => {
      const root = result.scene || result;
      root.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } });
      root.position.copy(worldPos);
      root.userData = { primType: 'model', modelPath, editorId: id, label: '', collidable: true };
      root.name = 'Model_' + id;
      pushUndo();
      E.placedGroup.add(root);
      selectObj(root); updateSceneList(); markDirty();
    });
  } else if (isLightType(E.placingType)) {
    const group = makeLightGroup(E.placingType);
    group.position.copy(worldPos);
    group.position.y = 3; // place lights high by default
    group.userData.editorId = id;
    group.userData.label    = '';
    group.name = E.placingType + '_' + id;
    pushUndo();
    E.placedGroup.add(group);
    selectObj(group); updateSceneList(); markDirty();
  } else if (isTriggerType(E.placingType)) {
    const mesh = makePrimMesh(E.placingType);
    mesh.position.copy(worldPos);
    const isCustom = E.placingType === 'custom-trigger';
    mesh.userData = {
      primType:  E.placingType,
      editorId:  id,
      label:     '',
      collidable: false,
      ...(isCustom
        ? { triggerVar: '' }
        : { saveSlot: 'autosave', onceOnly: true }),
    };
    mesh.name = E.placingType + '_' + id;
    pushUndo();
    E.placedGroup.add(mesh);
    selectObj(mesh); updateSceneList(); markDirty();
  } else if (E.placingType.startsWith('actor:')) {
    const actorPath = E.placingType.slice(6);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 6),
      new THREE.MeshStandardMaterial({ color: 0x44aaff, opacity: 0.7, transparent: true })
    );
    mesh.position.copy(worldPos);
    mesh.userData = {
      primType:       'actor-spawn',
      actorModel:     actorPath,
      editorId:       id,
      label:          '',
      collidable:     false,
      spawnRadius:    0,
      persistent:     true,
      singleInstance: false,
      meshOverrides:  {},
      animations:     [],
    };
    mesh.name = 'ActorSpawn_' + id;
    pushUndo();
    E.placedGroup.add(mesh);
    selectObj(mesh); updateSceneList(); markDirty();
  } else {

// â”€â”€â”€ Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function selectObj(obj) {
  // If group transform is active, finalize it first so the object being
  // selected is back in E.placedGroup with correct world-space coordinates.
  // But only if the object we're selecting is NOT a member of the current group
  // (clicking a group member from the sidebar should select it individually).
  if (E.groupPivot) {
    const isMember = E.groupPivotMembers.includes(obj);
    if (!isMember) {
      E.activeGroupGid = null; // suppress re-entry from dragging-changed
      finalizeGroupTransform();
    }
  }
  if (E.selected === obj) return;
  E.selected = obj;
  E.transform.detach();
  if (obj) E.transform.attach(obj);
  updateProps(obj);
  highlightSceneList(obj);
  // Reset face selection when switching objects
  E.selectedFace = null;
  if (E.facePickMode) cancelFacePick();
  updateFaceHighlight(null, null);
  // Update pivot UI
  const hasPivot = obj?.userData.pivotOffset != null;
  document.getElementById('btn-reset-pivot').style.display = hasPivot ? '' : 'none';
  const dot = E.scene.getObjectByName('__pivotDot__');
  if (dot) dot.visible = hasPivot;
  if (obj && hasPivot) _refreshPivotHelper(obj);
}

function deselect() {
  E.selected = null;
  E.transform.detach();
  updateProps(null);
  highlightSceneList(null);
  // Hide pivot dot
  const dot = E.scene.getObjectByName('__pivotDot__');
  if (dot) dot.visible = false;
  document.getElementById('btn-reset-pivot').style.display = 'none';
  // Clear face selection
  E.selectedFace = null;
  if (E.facePickMode) cancelFacePick();
  updateFaceHighlight(null, null);
}

// â”€â”€â”€ Properties panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function syncPropsFromSelected() {
  const obj = E.selected;
  if (!obj) return;
  setVec3Inputs('p', obj.position);
  setVec3Inputs('s', obj.scale);
  setRotInputs(obj.rotation);
}

function setVec3Inputs(prefix, v) {
  for (const a of ['x','y','z']) {
    const el = document.getElementById(prefix + a);
    if (el && document.activeElement !== el) el.value = v[a].toFixed(3);
  }
}

function setRotInputs(euler) {
  for (const a of ['x','y','z']) {
    const el = document.getElementById('r' + a);
    if (el && document.activeElement !== el) el.value = (euler[a] * DEG).toFixed(1);
  }
}

function updateProps(obj) {
  const selName   = document.getElementById('sel-name');
  const pathRow   = document.getElementById('model-path-row');
  const pathText  = document.getElementById('model-path-text');
  const colEl     = document.getElementById('obj-color');
  const opacityEl = document.getElementById('obj-opacity');
  const chkC      = document.getElementById('chk-collidable');
  const chkS      = document.getElementById('chk-shadow');
  const emissiveRow = document.getElementById('emissive-row');
  const emissiveColorEl = document.getElementById('obj-emissive-color');
  const emissiveIntEl   = document.getElementById('obj-emissive-intensity');
  const materialRow     = document.getElementById('material-row');
  const roughnessEl     = document.getElementById('obj-roughness');
  const metalnessEl     = document.getElementById('obj-metalness');
  const labelEl   = document.getElementById('obj-label');
  const lightProps  = document.getElementById('light-props');
  const geomProps   = document.getElementById('geom-props');
  const textureSection = document.getElementById('texture-section');
  const triggerProps = document.getElementById('trigger-props');

  if (!obj) {
    if (selName) selName.textContent = 'None';
    ['px','py','pz','sx','sy','sz','rx','ry','rz'].forEach(id => {
      const el = document.getElementById(id); if (el) { el.value = ''; el.disabled = true; }
    });
    if (colEl)    { colEl.disabled    = true; }
    if (opacityEl) { opacityEl.disabled = true; opacityEl.value = '1'; }
    if (chkC)    { chkC.disabled    = true; }
    if (chkS)    { chkS.disabled    = true; }
    if (labelEl) { labelEl.value = ''; labelEl.disabled = true; }
    if (pathRow) pathRow.style.display = 'none';
    if (lightProps)       lightProps.style.display       = 'none';
    if (geomProps)        geomProps.style.display        = 'none';
    if (textureSection)   textureSection.style.display   = 'none';
    if (triggerProps) triggerProps.style.display = 'none';
    const actorSpawnSection0 = document.getElementById('actor-spawn-section');
    if (actorSpawnSection0) actorSpawnSection0.style.display = 'none';
    setGroupDisplay(null);
    renderStatesPanel(null);
    renderLinksPanel(null);
    return;
  }

  const isLight     = isLightType(obj.userData.primType);
  const isTrigger   = isTriggerType(obj.userData.primType);
  const isCsgResult = obj.userData.primType === 'csg-result';
  const isMerged    = obj.userData.primType === 'merged-model';
  const isActorSpawn = obj.userData.primType === 'actor-spawn';
  const isPrimitive = !isLight && !isTrigger && obj.userData.primType !== 'model' && !isCsgResult && !isMerged && !isActorSpawn;
  const hasTexture  = isPrimitive || isCsgResult;
  const isModel     = obj.userData.primType === 'model' || isMerged;

  const meshEditSection = document.getElementById('mesh-edit-section');
  if (meshEditSection) meshEditSection.style.display = isModel ? '' : 'none';

  const actorSpawnSection = document.getElementById('actor-spawn-section');
  if (actorSpawnSection) {
    actorSpawnSection.style.display = isActorSpawn ? '' : 'none';
    if (isActorSpawn) {
      const modelNameEl = document.getElementById('actor-spawn-model-name');
      if (modelNameEl) modelNameEl.textContent = (obj.userData.actorModel || '').split('/').pop() || '-';
      const radiusEl = document.getElementById('actor-spawn-radius');
      if (radiusEl && document.activeElement !== radiusEl) radiusEl.value = obj.userData.spawnRadius ?? 0;
      const persistEl = document.getElementById('actor-persistent');
      if (persistEl) persistEl.checked = obj.userData.persistent !== false;
      const singleEl = document.getElementById('actor-single-instance');
      if (singleEl) singleEl.checked = obj.userData.singleInstance === true;
    }
  }

  if (selName) selName.textContent = obj.name;
  ['px','py','pz','sx','sy','sz','rx','ry','rz'].forEach(id => {
    const el = document.getElementById(id); if (el) el.disabled = false;
  });
  setVec3Inputs('p', obj.position);
  setVec3Inputs('s', obj.scale);
  setRotInputs(obj.rotation);

  if (colEl) {
    if (isLight) {
      colEl.disabled = false;
      colEl.value = obj.userData.lightColor || '#ffffff';
    } else {
      colEl.disabled = !obj.material?.color || isTrigger;
      if (obj.material?.color && !isTrigger) colEl.value = '#' + obj.material.color.getHexString();
    }
  }
  if (opacityEl && document.activeElement !== opacityEl) {
    opacityEl.disabled = isLight;
    opacityEl.value = isLight ? '1' : +getMeshOpacity(obj).toFixed(2);
  }
  if (chkC) { chkC.disabled = isLight || isTrigger; chkC.checked = !isLight && !isTrigger && obj.userData.collidable !== false; }
  if (chkS) { chkS.disabled = isTrigger; chkS.checked = !isTrigger && (isLight ? obj.userData.castShadow !== false : obj.castShadow !== false); }
  if (labelEl) { labelEl.disabled = false; labelEl.value = obj.userData.label || ''; }

  if (pathRow && pathText) {
    const isModel = obj.userData.primType === 'model' && obj.userData.modelPath;
    pathRow.style.display = isModel ? 'block' : 'none';
    if (isModel) pathText.textContent = obj.userData.modelPath;
  }

  // Emissive row — shown for non-light, non-trigger objects
  if (emissiveRow) {
    const showEmissive = !isLight && !isTrigger;
    emissiveRow.style.display = showEmissive ? '' : 'none';
    if (showEmissive) {
      if (emissiveColorEl) emissiveColorEl.value = obj.userData.emissiveColor ?? '#ffffff';
      if (emissiveIntEl)   emissiveIntEl.value   = obj.userData.emissiveIntensity ?? 0;
    }
  }

  // Material row (roughness/metalness) — shown for non-light, non-trigger objects
  if (materialRow) {
    const showMat = !isLight && !isTrigger;
    materialRow.style.display = showMat ? '' : 'none';
    if (showMat && document.activeElement !== roughnessEl && document.activeElement !== metalnessEl) {
      if (roughnessEl) roughnessEl.value = +(obj.userData.roughness ?? 1).toFixed(2);
      if (metalnessEl) metalnessEl.value = +(obj.userData.metalness ?? 0).toFixed(2);
    }
  }

  // Geometry params — only for editable primitives
  const hasGeomParams = isPrimitive && !!GEOM_DEFAULTS[obj.userData.primType];
  if (geomProps) {
    geomProps.style.display = hasGeomParams ? '' : 'none';
    if (hasGeomParams) refreshGeomPanel(obj);
  }

  // Texture section — for primitives and CSG results (not lights, triggers, or models)
  if (textureSection) {
    textureSection.style.display = hasTexture ? '' : 'none';
    if (hasTexture) {
      // Face selector only for boxes — csg-result is a merged mesh, not a box
      const faceSelectRow = document.getElementById('face-select-row');
      if (faceSelectRow) faceSelectRow.style.display = obj.userData.primType === 'box' ? '' : 'none';
      refreshTexPanel(obj);
    }
  }

  // Light properties
  if (lightProps) {
    lightProps.style.display = isLight ? '' : 'none';
    if (isLight) {
      const setLightInput = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      setLightInput('light-intensity', obj.userData.intensity ?? 1);
      setLightInput('light-distance',  obj.userData.distance  ?? 10);
      setLightInput('light-angle',     obj.userData.angle     ?? 30);
      setLightInput('light-penumbra',  obj.userData.penumbra  ?? 0.15);
      setLightInput('light-decay',     obj.userData.decay     ?? 2);
      // Show/hide spot-only rows
      const isSpot = obj.userData.primType === 'spot-light';
      const angleRow    = document.getElementById('light-angle-row');
      const penumbraRow = document.getElementById('light-penumbra-row');
      const distRow     = document.getElementById('light-distance-row');
      const decayRow    = document.getElementById('light-decay-row');
      if (angleRow)    angleRow.style.display    = isSpot ? '' : 'none';
      if (penumbraRow) penumbraRow.style.display  = isSpot ? '' : 'none';
      if (distRow)     distRow.style.display      = obj.userData.primType === 'dir-light' ? 'none' : '';
      if (decayRow)    decayRow.style.display     = obj.userData.primType === 'dir-light' ? 'none' : '';
    }
  }

  // Trigger properties
  if (triggerProps) {
    triggerProps.style.display = isTrigger ? '' : 'none';
    if (isTrigger) {
      const isCustom = obj.userData.primType === 'custom-trigger';
      const labelEl  = triggerProps.querySelector('.trigger-type-label');
      if (labelEl) labelEl.textContent = isCustom ? 'Custom Trigger' : 'Save Trigger';

      // Show save-trigger rows only for save-trigger
      const saveRows = triggerProps.querySelectorAll('.save-trigger-row');
      saveRows.forEach(r => { r.style.display = isCustom ? 'none' : ''; });
      const customRows = triggerProps.querySelectorAll('.custom-trigger-row');
      customRows.forEach(r => { r.style.display = isCustom ? '' : 'none'; });

      const slotEl    = document.getElementById('trigger-slot');
      const onceEl    = document.getElementById('trigger-once');
      const varNameEl = document.getElementById('trigger-var-name');
      if (!isCustom) {
        if (slotEl    && document.activeElement !== slotEl)    slotEl.value  = obj.userData.saveSlot || 'autosave';
        if (onceEl)                                             onceEl.checked = obj.userData.onceOnly !== false;
      } else {
        const varSel = document.getElementById('trigger-var-name');
        _populateVarSelect(varSel, obj.userData.triggerVar || '');
        const opEl  = document.getElementById('trigger-var-op');
        const valEl = document.getElementById('trigger-var-value');
        if (opEl  && document.activeElement !== opEl)  opEl.value  = obj.userData.triggerVarOp    || 'set';
        if (valEl && document.activeElement !== valEl) valEl.value = String(obj.userData.triggerVarValue ?? 'true');
      }
    }
  }

  setGroupDisplay(findGroupOfObj(obj));
  renderStatesPanel(obj);
  renderLinksPanel(obj);
}

function findGroupOfObj(obj) {
  if (!obj) return null;
  const id = obj.userData.editorId;
  for (const [gid, g] of Object.entries(E.groups)) {
    if (g.ids.has(id)) return gid;
  }
  return null;
}

function setGroupDisplay(gid) {
  const nameLbl = document.getElementById('sel-group-name');
  const movBtn  = document.getElementById('btn-move-group');
  const panel   = document.getElementById('right-panel');
  const g = gid && E.groups[gid];
  if (nameLbl) nameLbl.textContent = g ? g.name : '-';
  if (movBtn) movBtn.style.display = g ? '' : 'none';
}

// â”€â”€â”€ Scene list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateSceneList() {
  const list  = document.getElementById('scene-list');
  const count = document.getElementById('obj-count');
  if (!list) return;
  list.innerHTML = '';
  let n = 0;
  E.placedGroup.children.forEach(obj => {
    if (obj.userData.isEditorHelper) return;
    n++;
    const div = document.createElement('div');
    div.className = 'scene-list-item' + (obj === E.selected ? ' selected' : '');
    div.textContent = obj.name;
    div.title = obj.name;
    div.addEventListener('click', () => {
      selectObj(obj);
      E.orbit.target.copy(obj.position);
    });
    list.appendChild(div);
  });
  if (count) count.textContent = n;
}

function highlightSceneList(obj) {
  const placed = E.placedGroup.children.filter(o => !o.userData.isEditorHelper);
  document.querySelectorAll('#scene-list .scene-list-item').forEach((el, i) => {
    el.classList.toggle('selected', placed[i] === obj);
  });
}

// â”€â”€â”€ Groups panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateGroupsPanel() {
  const panel = document.getElementById('groups-panel');
  const count = document.getElementById('group-count');
  if (!panel) return;
  panel.innerHTML = '';
  const gids = Object.keys(E.groups);
  if (count) count.textContent = gids.length;

  gids.forEach(gid => {
    const g = E.groups[gid];
    if (!(gid in E.groupCollapsed)) E.groupCollapsed[gid] = true;
    const collapsed = E.groupCollapsed[gid];

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `<span class="collapse-arrow">${collapsed ? '>' : 'v'}</span>
      <span class="group-name-lbl">${escHtml(g.name)}</span>`;
    header.addEventListener('click', () => {
      E.groupCollapsed[gid] = !E.groupCollapsed[gid];
      updateGroupsPanel();
    });
    panel.appendChild(header);

    if (!collapsed) {
      [...g.ids].forEach(mid => {
        const obj = E.placedGroup.children.find(o => o.userData.editorId === mid);
        const row = document.createElement('div');
        row.className = 'group-entry' + (obj === E.selected ? ' selected' : '');
        row.innerHTML = `<span class="ge-name">${escHtml(obj ? obj.name : `(#${mid})`)}</span>
          <button class="ge-rm" title="Remove from group">X</button>`;
        row.addEventListener('click', e => {
          if (e.target.classList.contains('ge-rm')) return;
          if (obj) { selectObj(obj); E.orbit.target.copy(obj.position); }
        });
        row.querySelector('.ge-rm').addEventListener('click', () => {
          g.ids.delete(mid);
          if (g.ids.size === 0) delete E.groups[gid];
          updateGroupsPanel();
          if (E.selected) setGroupDisplay(findGroupOfObj(E.selected));
          markDirty();
        });
        panel.appendChild(row);
      });
    }
  });
}

// â”€â”€â”€ Group transform â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function beginGroupTransform(gid) {
  if (!gid || !E.groups[gid]) return;
  E.activeGroupGid = gid;
  const members = [...E.groups[gid].ids]
    .map(id => E.placedGroup.children.find(o => o.userData.editorId === id))
    .filter(Boolean);
  if (!members.length) return;

  const center = new THREE.Vector3();
  members.forEach(m => center.add(m.position));
  center.divideScalar(members.length);

  const pivot = new THREE.Group();
  pivot.position.copy(center);
  pivot.name = '__groupPivot__';
  pivot.userData.isEditorHelper = true;
  E.scene.add(pivot);

  members.forEach(m => {
    E.placedGroup.remove(m);
    m.position.sub(center);
    pivot.add(m);
  });

  E.groupPivot = pivot;
  E.groupPivotMembers = members;
  E.transform.attach(pivot);
  // Show group-mode indicator
  const panel = document.getElementById('right-panel');
  if (panel) panel.classList.add('grp-mode-active');
  const badge = document.getElementById('grp-mode-badge');
  if (badge) badge.style.display = 'inline-block';
  document.getElementById('btn-move-group')?.classList.add('active');
  setStatus(`Group mode: ${E.groups[gid]?.name || gid} — drag gizmo to move group, G or Esc to exit`);
}

function finalizeGroupTransform() {
  if (!E.groupPivot) return;
  E.activeGroupGid = null;
  // Clear group-mode indicator
  const panel = document.getElementById('right-panel');
  if (panel) panel.classList.remove('grp-mode-active');
  const badge = document.getElementById('grp-mode-badge');
  if (badge) badge.style.display = 'none';
  document.getElementById('btn-move-group')?.classList.remove('active');
  setStatus('Group mode exited');
  E.groupPivotMembers.forEach(m => {
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    const ws = new THREE.Vector3();
    m.getWorldPosition(wp);
    m.getWorldQuaternion(wq);
    m.getWorldScale(ws);
    E.groupPivot.remove(m);
    m.position.copy(wp);
    m.quaternion.copy(wq);
    m.scale.copy(ws);
    E.placedGroup.add(m);
  });
  E.scene.remove(E.groupPivot);
  E.groupPivot = null;
  E.groupPivotMembers = [];
  E.transform.detach();
  if (E.selected) E.transform.attach(E.selected);
  markDirty(); updateSceneList();
}

// â”€â”€â”€ Clone / Delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function cloneSelected() {
  if (!E.selected || E.selected.userData.isRef) return;
  pushUndo();
  const src = E.selected;
  const clone = src.clone();
  const srcUD = src.userData;
  clone.userData = {
    ...srcUD,
    editorId: E.nextId++,
    states: srcUD.states ? JSON.parse(JSON.stringify(srcUD.states)) : undefined,
  };
  clone.position.x += 1;
  clone.name = src.name + '_copy';
  E.placedGroup.add(clone);
  selectObj(clone);
  updateSceneList(); markDirty();
}

function cloneGroup(gid) {
  if (!gid || !E.groups[gid]) return;
  pushUndo();
  const g = E.groups[gid];
  const memberIds = [...g.ids];
  const idMap = {};

  const clones = memberIds.map(mid => {
    const src = E.placedGroup.children.find(o => o.userData.editorId === mid);
    if (!src) return null;
    const c = src.clone();
    const newId = E.nextId++;
    idMap[mid] = newId;
    const srcUD = src.userData;
    c.userData = {
      ...srcUD,
      editorId: newId,
      states: srcUD.states ? JSON.parse(JSON.stringify(srcUD.states)) : undefined,
      links: srcUD.links ? [...srcUD.links] : undefined,
    };
    c.position.x += 1;
    c.name = src.name + '_copy';
    return c;
  }).filter(Boolean);

  clones.forEach(c => {
    if (c.userData.links) {
      c.userData.links = c.userData.links.map(lid => idMap[lid] ?? lid);
    }
    E.placedGroup.add(c);
  });

  const newGid = 'g' + Date.now();
  E.groups[newGid] = { name: g.name + '_copy', ids: new Set(clones.map(c => c.userData.editorId)) };
  E.groupCollapsed[newGid] = true;

  updateSceneList(); updateGroupsPanel(); markDirty();
}

function deleteSelected() {
  if (!E.selected || E.selected.userData.isRef) return;
  pushUndo();
  const id = E.selected.userData.editorId;
  for (const g of Object.values(E.groups)) g.ids.delete(id);
  for (const gid of Object.keys(E.groups)) { if (E.groups[gid].ids.size === 0) delete E.groups[gid]; }
  E.placedGroup.remove(E.selected);
  deselect();
  updateSceneList(); updateGroupsPanel(); markDirty();
}

// ─── Texture panel refresh ────────────────────────────────────────────────────
function refreshTexPanel(obj) {
  if (!obj) return;
  const faceKey  = E.selectedFace !== null ? String(E.selectedFace) : 'all';
  const cfg      = getFaceConfig(obj, faceKey) ?? { rx: 1, ry: 1, ox: 0, oy: 0, wrap: 'repeat', tilingMode: 'repeat', worldScale: 1 };

  const set = (id, val) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = val; };
  set('tex-name',        cfg.name   || '');
  set('tex-repeat-x',   cfg.rx     ?? 1);
  set('tex-repeat-y',   cfg.ry     ?? 1);
  set('tex-offset-x',   cfg.ox     ?? 0);
  set('tex-offset-y',   cfg.oy     ?? 0);
  set('tex-world-scale', cfg.worldScale ?? 1);

  const tilingEl = document.getElementById('tex-tiling-mode');
  if (tilingEl) tilingEl.value = cfg.tilingMode || 'repeat';
  _syncTilingModeUI(cfg.tilingMode || 'repeat');

  const wrapEl = document.getElementById('tex-wrap');
  if (wrapEl) wrapEl.value = cfg.wrap || 'repeat';

  const faceEl = document.getElementById('tex-face');
  if (faceEl) faceEl.value = E.selectedFace !== null ? String(E.selectedFace) : 'all';
}

function _syncTilingModeUI(mode) {
  const repeatRow = document.getElementById('tex-repeat-row');
  const worldRow  = document.getElementById('tex-world-row');
  if (repeatRow) repeatRow.style.display = mode === 'world' ? 'none' : 'flex';
  if (worldRow)  { worldRow.style.display = mode === 'world' ? 'flex' : 'none'; }
}

// Build a config from current panel inputs
function _panelToFaceConfig() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const gf = id => parseFloat(g(id)) || 0;
  const tilingMode = g('tex-tiling-mode') || 'repeat';
  return makeFaceTexConfig(
    g('tex-name').trim() || null,
    Math.max(0.01, parseFloat(g('tex-repeat-x')) || 1),
    Math.max(0.01, parseFloat(g('tex-repeat-y')) || 1),
    gf('tex-offset-x'), gf('tex-offset-y'),
    g('tex-wrap') || 'repeat', tilingMode,
    Math.max(0.01, parseFloat(g('tex-world-scale')) || 1)
  );
}

function applyCurrentFaceConfig() {
  const obj = E.selected;
  if (!obj) return;
  const faceKey = E.selectedFace !== null ? String(E.selectedFace) : 'all';
  const cfg = _panelToFaceConfig();
  // World mode: recompute repeat from object scale
  if (cfg.tilingMode === 'world') {
    const [rx, ry] = computeWorldRepeat(obj, faceKey, cfg.worldScale);
    cfg.rx = rx; cfg.ry = ry;
    document.getElementById('tex-repeat-x').value = rx.toFixed(2);
    document.getElementById('tex-repeat-y').value = ry.toFixed(2);
  }
  // Stretch mode: force 1×1
  if (cfg.tilingMode === 'stretch') { cfg.rx = 1; cfg.ry = 1; cfg.ox = 0; cfg.oy = 0; }
  setFaceConfig(obj, faceKey, cfg.name ? cfg : null);
}

// ─── Face pick mode ────────────────────────────────────────────────────────────
function beginFacePick() {
  if (!E.selected || E.selected.userData.primType !== 'box') {
    setStatus('Select a box object to pick a face'); return;
  }
  E.facePickMode = true;
  document.getElementById('face-pick-hint').style.display = '';
  document.getElementById('btn-pick-face').textContent = 'Cancel';
  setStatus('Click a face on the selected object - Esc cancels');
}

function cancelFacePick() {
  E.facePickMode = false;
  document.getElementById('face-pick-hint').style.display = 'none';
  document.getElementById('btn-pick-face').textContent = 'Pick';
  setStatus('Face pick cancelled');
}

function applyFacePick(faceIdx) {
  E.selectedFace = faceIdx;
  E.facePickMode = false;
  document.getElementById('face-pick-hint').style.display = 'none';
  document.getElementById('btn-pick-face').textContent = 'Pick';
  const faceEl = document.getElementById('tex-face');
  if (faceEl) faceEl.value = String(faceIdx);
  updateFaceHighlight(E.selected, faceIdx);
  refreshTexPanel(E.selected);
  setStatus(`Face selected: ${BOX_FACE_NAMES[faceIdx]}`);
}

// ─── UV Editor ────────────────────────────────────────────────────────────────
function openUVEditor() {
  const obj = E.selected;
  if (!obj) return;
  const faceKey = E.selectedFace !== null ? String(E.selectedFace) : 'all';
  const cfg = getFaceConfig(obj, faceKey) ?? {};

  // Sync modal inputs
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('uv-ox', cfg.ox ?? 0);
  set('uv-oy', cfg.oy ?? 0);
  set('uv-rx', cfg.rx ?? 1);
  set('uv-ry', cfg.ry ?? 1);

  const label = document.getElementById('uv-face-label');
  if (label) label.textContent = E.selectedFace !== null ? BOX_FACE_NAMES[E.selectedFace] : 'All Faces';

  const modal = document.getElementById('uv-modal');
  modal.style.display = 'block';

  _loadUVEditorImage(cfg.name);
}

function closeUVEditor() {
  document.getElementById('uv-modal').style.display = 'none';
}

function makeDraggable(modalId, handleId) {
  const modal = document.getElementById(modalId);
  const handle = document.getElementById(handleId);
  if (!modal || !handle) return;
  let ox = 0, oy = 0, startX = 0, startY = 0, dragging = false;
  handle.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    const r = modal.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    ox = r.left; oy = r.top;
    modal.style.transform = 'none';
    modal.style.left = ox + 'px';
    modal.style.top  = oy + 'px';
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = modal.offsetWidth,  mh = modal.offsetHeight;
    const nx = Math.max(0, Math.min(vw - mw, ox + dx));
    const ny = Math.max(0, Math.min(vh - mh, oy + dy));
    modal.style.left = nx + 'px';
    modal.style.top  = ny + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';
  });
}

function openMergeDialog() {
  const candidates = [];
  E.placedGroup.children.forEach(obj => {
    if (obj.userData.isEditorHelper) return;
    const t = obj.userData.primType;
    if (isLightType(t) || isTriggerType(t)) return;
    candidates.push(obj);
  });
  if (!candidates.length) { setStatus('No mergeable objects in scene'); return; }

  const preSelected = new Set();
  const gid = E.selected ? findGroupOfObj(E.selected) : null;
  if (gid) {
    const g = E.groups[gid];
    candidates.forEach(obj => { if (g.ids.has(obj.userData.editorId)) preSelected.add(obj.userData.editorId); });
  } else if (E.selected) {
    preSelected.add(E.selected.userData.editorId);
  } else {
    candidates.forEach(obj => preSelected.add(obj.userData.editorId));
  }

  const list = document.getElementById('merge-object-list');
  list.innerHTML = '';
  candidates.forEach(obj => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;padding:3px 4px;background:#0d0d20;border-radius:3px';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = preSelected.has(obj.userData.editorId);
    chk.style.cssText = 'width:20px;flex-shrink:0;cursor:pointer';
    chk.dataset.eid = obj.userData.editorId;
    const lbl = document.createElement('span');
    lbl.textContent = obj.name || (obj.userData.primType + '_' + obj.userData.editorId);
    lbl.style.cssText = 'font-size:11px;color:#aaaacc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.min = '1';
    numInput.value = '1';
    numInput.className = 'prop-input';
    numInput.style.cssText = 'width:52px;font-size:11px;text-align:center';
    numInput.dataset.eid = obj.userData.editorId;
    row.appendChild(chk);
    row.appendChild(lbl);
    row.appendChild(numInput);
    list.appendChild(row);
  });

  const nameInput = document.getElementById('merge-result-name');
  nameInput.value = gid ? (E.groups[gid]?.name || 'merged') : (E.selected?.userData.label || 'merged');
  document.getElementById('merge-modal').style.display = 'flex';
}

function closeMergeDialog() {
  document.getElementById('merge-modal').style.display = 'none';
}

function executeMerge() {
  const list = document.getElementById('merge-object-list');
  const resultName = document.getElementById('merge-result-name').value.trim() || 'merged';

  const plan = [];
  list.querySelectorAll('div').forEach(row => {
    const chk = row.querySelector('input[type=checkbox]');
    const num = row.querySelector('input[type=number]');
    if (!chk || !num || !chk.checked) return;
    const eid = parseInt(chk.dataset.eid);
    const obj = E.placedGroup.children.find(o => o.userData.editorId === eid);
    if (!obj) return;
    plan.push({ obj, meshGroup: parseInt(num.value) || 1 });
  });

  if (!plan.length) { setStatus('Select at least one object to merge'); return; }

  pushUndo();
  closeMergeDialog();

  const groups = {};
  plan.forEach(({ obj, meshGroup }) => {
    if (!groups[meshGroup]) groups[meshGroup] = [];
    groups[meshGroup].push(obj);
  });

  const centroid = new THREE.Vector3();
  plan.forEach(({ obj }) => { const wp = new THREE.Vector3(); obj.getWorldPosition(wp); centroid.add(wp); });
  centroid.divideScalar(plan.length);

  const root = new THREE.Group();
  const meshOverrides = {};
  const sortedNums = Object.keys(groups).map(Number).sort((a, b) => a - b);

  sortedNums.forEach(gNum => {
    const srcObjs = groups[gNum];
    const allMeshes = [];
    srcObjs.forEach(o => {
      if (o.isMesh) allMeshes.push(o);
      else o.traverse(c => { if (c.isMesh) allMeshes.push(c); });
    });
    if (!allMeshes.length) return;
    const geo = mergeGeometriesWorldSpace(allMeshes);
    if (!geo) return;
    geo.translate(-centroid.x, -centroid.y, -centroid.z);
    const srcMat = allMeshes[0].material;
    const mat = (srcMat && !Array.isArray(srcMat))
      ? srcMat.clone()
      : new THREE.MeshStandardMaterial({ color: '#aaaacc', roughness: 1, metalness: 0 });
    mat.side = THREE.DoubleSide;
    const meshName = 'mesh_' + gNum;
    const childMesh = new THREE.Mesh(geo, mat);
    childMesh.name = meshName;
    childMesh.castShadow = true;
    childMesh.receiveShadow = true;
    root.add(childMesh);
    meshOverrides[meshName] = {};
  });

  if (!root.children.length) { setStatus('Merge failed: no geometry found'); return; }

  const id = E.nextId++;
  root.position.copy(centroid);
  root.castShadow = true;
  root.receiveShadow = true;
  root.userData = {
    primType:      'merged-model',
    editorId:      id,
    label:         resultName,
    collidable:    true,
    meshOverrides: meshOverrides,
  };
  root.name = resultName;

  plan.forEach(({ obj }) => {
    const srcId = obj.userData.editorId;
    for (const g of Object.values(E.groups)) g.ids.delete(srcId);
    E.placedGroup.remove(obj);
  });
  for (const gid of Object.keys(E.groups)) { if (E.groups[gid].ids.size === 0) delete E.groups[gid]; }

  E.placedGroup.add(root);
  selectObj(root);
  updateSceneList();
  updateGroupsPanel();
  markDirty();
  setStatus(`Merged ${plan.length} objects into "${resultName}"`);
}

function _serializeMergedMeshes(obj) {
  const meshes = [];
  obj.children.forEach(child => {
    if (!child.isMesh) return;
    const geo = child.geometry;
    const pos = geo.attributes.position?.array;
    const nor = geo.attributes.normal?.array;
    const uv  = geo.attributes.uv?.array;
    const idx = geo.index?.array;
    meshes.push({
      name:      child.name,
      positions: pos ? Array.from(pos) : [],
      normals:   nor ? Array.from(nor) : null,
      uvs:       uv  ? Array.from(uv)  : null,
      indices:   idx ? Array.from(idx) : null,
    });
  });
  return meshes;
}

function spawnMergedModel(entry) {
  const root = new THREE.Group();
  (entry.mergedMeshes || []).forEach(md => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(md.positions, 3));
    if (md.normals) geo.setAttribute('normal', new THREE.Float32BufferAttribute(md.normals, 3));
    if (md.uvs)     geo.setAttribute('uv',     new THREE.Float32BufferAttribute(md.uvs, 2));
    if (md.indices) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(md.indices), 1));
    const mat = new THREE.MeshStandardMaterial({ color: '#aaaacc', roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = md.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  });
  applyEntryTransform(root, entry);
  root.castShadow = true;
  root.receiveShadow = true;
  root.userData = {
    primType:   'merged-model',
    editorId:   entry.id,
    label:      entry.label || '',
    collidable: entry.collidable !== false,
  };
  root.name = entry.label || ('Merged_' + entry.id);
  if (entry.states?.length)  { root.userData.states = entry.states; root.userData.currentState = 0; }
  if (entry.links?.length)     root.userData.links  = entry.links;
  if (entry.noSelfInteract)    root.userData.noSelfInteract = true;
  if (entry.meshOverrides) {
    root.userData.meshOverrides = entry.meshOverrides;
    root.traverse(c => {
      if (!c.isMesh) return;
      const ovr = entry.meshOverrides[c.name];
      if (!ovr) return;
      if (ovr.visible === false) c.visible = false;
      if (ovr.texture) _applyMeshEditorTexture(c, ovr.texture);
    });
  }
  E.placedGroup.add(root);
  return root;
}

function openMeshEditor() {
  const obj = E.selected;
  if (!obj || (obj.userData.primType !== 'model' && obj.userData.primType !== 'merged-model')) return;
  document.getElementById('mesh-model-name').textContent = obj.name || obj.userData.modelPath || 'Model';

  const masterIn = document.getElementById('mesh-master-tex');
  masterIn.value = obj.userData.masterTexture || '';
  masterIn.onchange = () => {
    const texName = masterIn.value.trim() || null;
    obj.userData.masterTexture = texName || undefined;
    _applyMasterTexture(obj, texName);
    markDirty();
  };
  document.getElementById('btn-mesh-master-import').onclick = async () => {
    if (!window.electron?.importTexture) return;
    const name = await window.electron.importTexture();
    if (!name) return;
    await refreshTextureList();
    masterIn.value = name;
    obj.userData.masterTexture = name;
    _applyMasterTexture(obj, name);
    markDirty();
  };
  document.getElementById('btn-mesh-master-clear').onclick = () => {
    masterIn.value = '';
    delete obj.userData.masterTexture;
    _applyMasterTexture(obj, null);
    markDirty();
  };

  const list = document.getElementById('mesh-list');
  list.innerHTML = '';

  const meshes = [];
  obj.traverse(c => { if (c.isMesh) meshes.push(c); });

  if (!obj.userData.meshOverrides) obj.userData.meshOverrides = {};
  const overrides = obj.userData.meshOverrides;

  meshes.forEach(mesh => {
    const key = mesh.name || mesh.uuid;
    const ovr = overrides[key] || {};

    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:20px 1fr 130px 22px;gap:4px;align-items:center;padding:3px 6px;background:#0d0d20;border-radius:3px';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = ovr.visible !== false;
    chk.style.cursor = 'pointer';
    chk.addEventListener('change', () => {
      mesh.visible = chk.checked;
      if (!overrides[key]) overrides[key] = {};
      overrides[key].visible = chk.checked;
      markDirty();
    });

    const label = document.createElement('span');
    label.textContent = mesh.name || '(unnamed)';
    label.style.cssText = 'font-size:11px;color:#aaaacc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer';
    label.addEventListener('click', () => {
      if (_highlightedMesh === mesh) { _setMeshHighlight(null, null); }
      else { _setMeshHighlight(mesh, row); }
    });

    const texIn = document.createElement('input');
    texIn.type = 'text';
    texIn.className = 'prop-input';
    texIn.value = ovr.texture || '';
    texIn.placeholder = 'texture name';
    texIn.style.cssText = 'font-size:11px;width:100%';
    texIn.setAttribute('list', 'tex-datalist');
    texIn.addEventListener('change', () => {
      const texName = texIn.value.trim() || null;
      if (!overrides[key]) overrides[key] = {};
      overrides[key].texture = texName;
      _applyMeshEditorTexture(mesh, texName);
      markDirty();
    });

    row.appendChild(chk);
    row.appendChild(label);
    row.appendChild(texIn);

    const impBtn = document.createElement('button');
    impBtn.className = 'btn';
    impBtn.textContent = '+';
    impBtn.title = 'Import texture';
    impBtn.style.cssText = 'padding:2px 4px;font-size:11px';
    impBtn.addEventListener('click', async () => {
      if (!window.electron?.importTexture) return;
      const name = await window.electron.importTexture();
      if (!name) return;
      await refreshTextureList();
      texIn.value = name;
      if (!overrides[key]) overrides[key] = {};
      overrides[key].texture = name;
      _applyMeshEditorTexture(mesh, name);
      markDirty();
    });
    row.appendChild(impBtn);

    list.appendChild(row);
  });

  document.getElementById('mesh-modal').style.display = 'flex';
}

function closeMeshEditor() {
  _setMeshHighlight(null, null);
  document.getElementById('mesh-modal').style.display = 'none';
}

function openActorMeshEditor() {
  const obj = E.selected;
  if (!obj || obj.userData.primType !== 'actor-spawn') return;

  const actorPath = obj.userData.actorModel;
  document.getElementById('actor-mesh-model-name').textContent = actorPath.split('/').pop() || 'Actor';

  if (!obj.userData.meshOverrides) obj.userData.meshOverrides = {};
  const overrides = obj.userData.meshOverrides;

  const masterIn = document.getElementById('actor-mesh-master-tex');
  masterIn.value = obj.userData.masterTexture || '';
  masterIn.onchange = () => {
    const texName = masterIn.value.trim() || null;
    obj.userData.masterTexture = texName || undefined;
    markDirty();
  };
  document.getElementById('btn-actor-mesh-master-import').onclick = async () => {
    if (!window.electron?.importTexture) return;
    const name = await window.electron.importTexture();
    if (!name) return;
    await refreshTextureList();
    masterIn.value = name;
    obj.userData.masterTexture = name;
    markDirty();
  };
  document.getElementById('btn-actor-mesh-master-clear').onclick = () => {
    masterIn.value = '';
    delete obj.userData.masterTexture;
    markDirty();
  };

  const listEl = document.getElementById('actor-mesh-list');
  listEl.innerHTML = '<div style="color:#666688;font-size:11px;padding:8px">Loading model meshes...</div>';
  document.getElementById('actor-mesh-modal').style.display = 'flex';

  const ext = actorPath.split('.').pop().toLowerCase();
  const loader = ext === 'fbx' ? new FBXLoader() : new GLTFLoader();
  loader.load(ASSET_ROOT + actorPath, result => {
    const root = result.scene || result;
    const meshes = [];
    root.traverse(c => { if (c.isMesh) meshes.push(c); });
    listEl.innerHTML = '';
    meshes.forEach(mesh => {
      const key = mesh.name || mesh.uuid;
      const ovr = overrides[key] || {};

      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:20px 1fr 130px 22px;gap:4px;align-items:center;padding:3px 6px;background:#0d0d20;border-radius:3px';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = ovr.visible !== false;
      chk.style.cursor = 'pointer';
      chk.addEventListener('change', () => {
        if (!overrides[key]) overrides[key] = {};
        overrides[key].visible = chk.checked;
        markDirty();
      });

      const label = document.createElement('span');
      label.textContent = mesh.name || '(unnamed)';
      label.style.cssText = 'font-size:11px;color:#aaaacc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

      const texIn = document.createElement('input');
      texIn.type = 'text';
      texIn.className = 'prop-input';
      texIn.value = ovr.texture || '';
      texIn.placeholder = 'texture name';
      texIn.style.cssText = 'font-size:11px;width:100%';
      texIn.setAttribute('list', 'tex-datalist');
      texIn.addEventListener('change', () => {
        const texName = texIn.value.trim() || null;
        if (!overrides[key]) overrides[key] = {};
        overrides[key].texture = texName;
        markDirty();
      });

      const impBtn = document.createElement('button');
      impBtn.className = 'btn';
      impBtn.textContent = '+';
      impBtn.title = 'Import texture';
      impBtn.style.cssText = 'padding:2px 4px;font-size:11px';
      impBtn.addEventListener('click', async () => {
        if (!window.electron?.importTexture) return;
        const name = await window.electron.importTexture();
        if (!name) return;
        await refreshTextureList();
        texIn.value = name;
        if (!overrides[key]) overrides[key] = {};
        overrides[key].texture = name;
        markDirty();
      });

      row.appendChild(chk);
      row.appendChild(label);
      row.appendChild(texIn);
      row.appendChild(impBtn);
      listEl.appendChild(row);
    });
    if (!meshes.length) {
      listEl.innerHTML = '<div style="color:#666688;font-size:11px;padding:8px">No meshes found in model.</div>';
    }
  }, undefined, () => {
    listEl.innerHTML = '<div style="color:#e94560;font-size:11px;padding:8px">Failed to load model.</div>';
  });
}

function closeActorMeshEditor() {
  document.getElementById('actor-mesh-modal').style.display = 'none';
}

async function openActorAnimsModal() {
  const obj = E.selected;
  if (!obj || obj.userData.primType !== 'actor-spawn') return;
  document.getElementById('actor-anims-model-name').textContent = (obj.userData.actorModel || '').split('/').pop() || 'Actor';
  if (!obj.userData.animations) obj.userData.animations = [];
  _refreshActorAnimsList(obj);
  document.getElementById('actor-anims-modal').style.display = 'flex';
}

function _refreshActorAnimsList(obj) {
  const listEl = document.getElementById('actor-anims-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  const anims = obj.userData.animations || [];
  if (!anims.length) {
    listEl.innerHTML = '<div style="color:#666688;font-size:11px;padding:8px">No animations imported yet.</div>';
    return;
  }
  anims.forEach((anim, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 120px 22px;gap:4px;align-items:center;padding:3px 6px;background:#0d0d20;border-radius:3px';

    const nameIn = document.createElement('input');
    nameIn.type = 'text';
    nameIn.className = 'prop-input';
    nameIn.value = anim.name || '';
    nameIn.placeholder = 'clip name (key in code)';
    nameIn.style.cssText = 'font-size:11px;width:100%';
    nameIn.addEventListener('change', () => { anims[i].name = nameIn.value.trim(); markDirty(); });

    const fileSpan = document.createElement('span');
    fileSpan.textContent = (anim.file || '').split('/').pop() || '-';
    fileSpan.style.cssText = 'font-size:10px;color:#666688;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    fileSpan.title = anim.file || '';

    const delBtn = document.createElement('button');
    delBtn.className = 'btn';
    delBtn.textContent = '\u00d7';
    delBtn.style.cssText = 'padding:2px 4px;font-size:12px';
    delBtn.addEventListener('click', () => {
      anims.splice(i, 1);
      _refreshActorAnimsList(obj);
      markDirty();
    });

    row.appendChild(nameIn);
    row.appendChild(fileSpan);
    row.appendChild(delBtn);
    listEl.appendChild(row);
  });
}

function closeActorAnimsModal() {
  document.getElementById('actor-anims-modal').style.display = 'none';
}

function _renderSoundSection(container, soundDef, onUpdate) {
  container.innerHTML = '';
  const isRandom = soundDef.mode === 'random';

  const modeRow = document.createElement('div');
  modeRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px';
  const modeLbl = document.createElement('span');
  modeLbl.textContent = 'Mode:';
  modeLbl.style.cssText = 'font-size:10px;color:#666688;flex-shrink:0';
  const modeSel = document.createElement('select');
  modeSel.className = 'prop-input';
  modeSel.style.cssText = 'font-size:11px;padding:2px 4px';
  [['sequential','Sequential'],['random','Random (weighted)']].forEach(([v, l]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = l;
    if (soundDef.mode === v) o.selected = true;
    modeSel.appendChild(o);
  });
  modeSel.addEventListener('change', e => {
    soundDef.mode = e.target.value;
    _renderSoundSection(container, soundDef, onUpdate);
    onUpdate();
  });
  modeRow.appendChild(modeLbl);
  modeRow.appendChild(modeSel);
  container.appendChild(modeRow);

  const listDiv = document.createElement('div');
  listDiv.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin-bottom:6px';
  soundDef.sounds.forEach((s, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center';

    const nameIn = document.createElement('input');
    nameIn.className = 'prop-input';
    nameIn.type = 'text';
    nameIn.value = s.name || '';
    nameIn.placeholder = 'sound name';
    nameIn.setAttribute('list', 'sound-datalist');
    nameIn.style.cssText = 'flex:1;font-size:11px';
    nameIn.addEventListener('change', e => { s.name = e.target.value.trim(); onUpdate(); });

    row.appendChild(nameIn);

    if (isRandom) {
      const wtLbl = document.createElement('span');
      wtLbl.textContent = 'w:';
      wtLbl.style.cssText = 'font-size:10px;color:#666688;flex-shrink:0';
      const wtIn = document.createElement('input');
      wtIn.className = 'prop-input';
      wtIn.type = 'number'; wtIn.min = '0'; wtIn.step = '0.1';
      wtIn.value = s.weight ?? 1;
      wtIn.style.width = '44px';
      wtIn.addEventListener('change', e => { s.weight = parseFloat(e.target.value) || 1; onUpdate(); });
      row.appendChild(wtLbl);
      row.appendChild(wtIn);
    }

    const del = document.createElement('button');
    del.className = 'btn btn-del';
    del.style.cssText = 'padding:2px 6px;font-size:11px;flex-shrink:0';
    del.textContent = '×';
    del.addEventListener('click', () => {
      soundDef.sounds.splice(i, 1);
      _renderSoundSection(container, soundDef, onUpdate);
      onUpdate();
    });
    row.appendChild(del);
    listDiv.appendChild(row);
  });
  container.appendChild(listDiv);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:4px';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.style.cssText = 'font-size:11px;padding:2px 10px';
  addBtn.textContent = '+ Add';
  addBtn.addEventListener('click', () => {
    soundDef.sounds.push({ name: '', weight: 1 });
    _renderSoundSection(container, soundDef, onUpdate);
    onUpdate();
  });
  const impBtn = document.createElement('button');
  impBtn.className = 'btn';
  impBtn.style.cssText = 'font-size:11px;padding:2px 10px';
  impBtn.textContent = '+ Import';
  impBtn.addEventListener('click', async () => {
    if (!window.electron?.importSound) return;
    const name = await window.electron.importSound();
    if (!name) return;
    await refreshSoundList();
    soundDef.sounds.push({ name, weight: 1 });
    _renderSoundSection(container, soundDef, onUpdate);
    onUpdate();
  });
  btnRow.appendChild(addBtn);
  btnRow.appendChild(impBtn);
  container.appendChild(btnRow);
}

function openSoundListModal(obj, stateIdx) {
  const state = obj.userData.states[stateIdx];
  document.getElementById('sound-list-modal-title').textContent = state.name || ('State ' + stateIdx);
  if (!state.enterSounds) state.enterSounds = { mode: 'sequential', sounds: [] };
  if (!state.exitSounds)  state.exitSounds  = { mode: 'sequential', sounds: [] };
  const dirty = () => markDirty();
  _renderSoundSection(document.getElementById('snd-enter-list'), state.enterSounds, dirty);
  _renderSoundSection(document.getElementById('snd-exit-list'),  state.exitSounds,  dirty);
  document.getElementById('sound-list-modal').style.display = 'flex';
}

function closeSoundListModal() {
  document.getElementById('sound-list-modal').style.display = 'none';
}

function _applyMeshEditorTexture(mesh, texName) {
  if (!texName) return;
  const loader = new THREE.TextureLoader();
  const tryLoad = url => new Promise(resolve => loader.load(url, resolve, undefined, () => resolve(null)));
  (async () => {
    let tex = await tryLoad(`${ASSET_ROOT}textures/${texName}.png`);
    if (!tex) tex = await tryLoad(`${ASSET_ROOT}textures/${texName}.jpg`);
    if (!tex) return;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => { if (m) { m.map = tex; m.needsUpdate = true; } });
  })();
}

function _applyMasterTexture(obj, texName) {
  if (texName) {
    const loader = new THREE.TextureLoader();
    const tryLoad = url => new Promise(resolve => loader.load(url, resolve, undefined, () => resolve(null)));
    (async () => {
      let tex = await tryLoad(`${ASSET_ROOT}textures/${texName}.png`);
      if (!tex) tex = await tryLoad(`${ASSET_ROOT}textures/${texName}.jpg`);
      if (!tex) return;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      obj.traverse(c => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { if (m) { m.map = tex; m.needsUpdate = true; } });
      });
    })();
  } else {
    obj.traverse(c => {
      if (!c.isMesh) return;
      const key = c.name || c.uuid;
      const ovr = obj.userData.meshOverrides?.[key];
      if (ovr?.texture) {
        _applyMeshEditorTexture(c, ovr.texture);
      }
    });
  }
}

function _loadUVEditorImage(texName) {
  if (!texName) { E.uvEditorImage = null; _drawUVCanvas(); return; }
  const img = new Image();
  img.onload = () => { E.uvEditorImage = img; _drawUVCanvas(); };
  img.onerror = () => {
    const jpg = new Image();
    jpg.onload = () => { E.uvEditorImage = jpg; _drawUVCanvas(); };
    jpg.onerror = () => { E.uvEditorImage = null; _drawUVCanvas(); };
    jpg.src = `textures/${texName}.jpg`;
  };
  img.src = `textures/${texName}.png`;
}

function _drawUVCanvas() {
  const canvas = document.getElementById('uv-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Checkerboard background
  const ts = 20;
  for (let ty = 0; ty < H; ty += ts) {
    for (let tx = 0; tx < W; tx += ts) {
      ctx.fillStyle = ((tx / ts + ty / ts) % 2 === 0) ? '#12122a' : '#1e1e38';
      ctx.fillRect(tx, ty, ts, ts);
    }
  }

  // Draw texture image as 2×2 tiles
  const img = E.uvEditorImage;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    for (let tx = 0; tx < 2; tx++) for (let ty = 0; ty < 2; ty++)
      ctx.drawImage(img, tx * W / 2, ty * H / 2, W / 2, H / 2);
    ctx.restore();
  }

  // Grid lines at UV = 1.0 boundary
  ctx.strokeStyle = '#444466';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.stroke();

  // Parse current UV values
  const ox = parseFloat(document.getElementById('uv-ox')?.value) || 0;
  const oy = parseFloat(document.getElementById('uv-oy')?.value) || 0;
  const rx = Math.max(0.01, parseFloat(document.getElementById('uv-rx')?.value) || 1);
  const ry = Math.max(0.01, parseFloat(document.getElementById('uv-ry')?.value) || 1);

  // UV window in pixel space (canvas spans 2×2 UV tiles)
  const uvW = 1 / rx, uvH = 1 / ry;
  const pxX = (ox / 2) * W;
  const pxY = (oy / 2) * H;
  const pxW = (uvW / 2) * W;
  const pxH = (uvH / 2) * H;

  // Fill
  ctx.fillStyle = 'rgba(68,153,255,0.12)';
  ctx.fillRect(pxX, pxY, pxW, pxH);

  // Dashed border
  ctx.strokeStyle = '#4499ff';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(pxX, pxY, pxW, pxH);
  ctx.setLineDash([]);

  // Corner handles
  const corners = [
    [pxX, pxY], [pxX + pxW, pxY],
    [pxX, pxY + pxH], [pxX + pxW, pxY + pxH]
  ];
  ctx.fillStyle = '#4499ff';
  corners.forEach(([cx, cy]) => ctx.fillRect(cx - 5, cy - 5, 10, 10));

  // Center dot
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(pxX + pxW / 2 - 3, pxY + pxH / 2 - 3, 6, 6);
}

// UV canvas drag state
let _uvDrag = null;

function _setupUVCanvasDrag() {
  const canvas = document.getElementById('uv-canvas');
  if (!canvas) return;

  const getUV = () => ({
    ox: parseFloat(document.getElementById('uv-ox').value) || 0,
    oy: parseFloat(document.getElementById('uv-oy').value) || 0,
    rx: Math.max(0.01, parseFloat(document.getElementById('uv-rx').value) || 1),
    ry: Math.max(0.01, parseFloat(document.getElementById('uv-ry').value) || 1),
  });
  const setUV = (ox, oy, rx, ry) => {
    document.getElementById('uv-ox').value = ox.toFixed(3);
    document.getElementById('uv-oy').value = oy.toFixed(3);
    document.getElementById('uv-rx').value = Math.max(0.01, rx).toFixed(2);
    document.getElementById('uv-ry').value = Math.max(0.01, ry).toFixed(2);
    _drawUVCanvas();
  };

  canvas.addEventListener('mousedown', e => {
    const r  = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const W  = canvas.width, H = canvas.height;
    const uv = getUV();
    const uvW = 1 / uv.rx, uvH = 1 / uv.ry;
    const pxX = (uv.ox / 2) * W, pxY = (uv.oy / 2) * H;
    const pxW = (uvW / 2) * W,  pxH = (uvH / 2) * H;

    const corners = [
      { x: pxX, y: pxY, ci: 0 }, { x: pxX + pxW, y: pxY, ci: 1 },
      { x: pxX, y: pxY + pxH, ci: 2 }, { x: pxX + pxW, y: pxY + pxH, ci: 3 }
    ];
    const hit = corners.find(c => Math.abs(mx - c.x) < 9 && Math.abs(my - c.y) < 9);
    if (hit) {
      _uvDrag = { type: 'corner', mx, my, ci: hit.ci, ...uv };
    } else if (mx >= pxX && mx <= pxX + pxW && my >= pxY && my <= pxY + pxH) {
      _uvDrag = { type: 'move', mx, my, ...uv };
    }
    if (_uvDrag) e.preventDefault();
  });

  canvas.addEventListener('mousemove', e => {
    if (!_uvDrag) return;
    const r  = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const W  = canvas.width, H = canvas.height;
    const dx = (mx - _uvDrag.mx) / W * 2;   // delta in UV space (0→2 canvas)
    const dy = (my - _uvDrag.my) / H * 2;

    let { ox, oy, rx, ry } = _uvDrag;
    const uvW = 1 / rx, uvH = 1 / ry;

    if (_uvDrag.type === 'move') {
      setUV(ox + dx, oy + dy, rx, ry);
    } else {
      const ci = _uvDrag.ci;
      // Horizontal: right corners expand width, left corners shift ox + shrink width
      if (ci === 1 || ci === 3) {
        const newUvW = Math.max(0.02, uvW + dx);
        setUV(ox, oy, 1 / newUvW, 1 / (ci === 2 || ci === 3 ? Math.max(0.02, uvH + dy) : Math.max(0.02, uvH - dy)));
      } else {
        const newUvW = Math.max(0.02, uvW - dx);
        const newUvH = ci === 2 || ci === 3 ? Math.max(0.02, uvH + dy) : Math.max(0.02, uvH - dy);
        setUV(ox + dx, ci < 2 ? oy + dy : oy, 1 / newUvW, 1 / newUvH);
      }
    }
  });

  canvas.addEventListener('mouseup',    () => { _uvDrag = null; });
  canvas.addEventListener('mouseleave', () => { _uvDrag = null; });

  // Redraw when inputs change
  ['uv-ox','uv-oy','uv-rx','uv-ry'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', _drawUVCanvas);
  });
}

// ─── CSG Cut ──────────────────────────────────────────────────────────────────
// ─── Pivot pick ──────────────────────────────────────────────────────────────
function beginPivot() {
  if (!E.selected || E.selected.userData.isRef) {
    setStatus('Select a placed object first to set its pivot');
    return;
  }
  E.pivotMode   = true;
  E.pivotSource = E.selected;
  document.getElementById('pivot-hint').style.display = '';
  document.getElementById('btn-set-pivot').classList.add('active');
  setStatus('Pivot mode — click any surface to set the pivot point (Esc cancels)');
}

function cancelPivot() {
  if (!E.pivotMode) return;
  E.pivotMode   = false;
  E.pivotSource = null;
  document.getElementById('pivot-hint').style.display = 'none';
  document.getElementById('btn-set-pivot').classList.remove('active');
  setStatus('Pivot cancelled');
}

function applyPivot(worldPoint) {
  const obj = E.pivotSource;
  cancelPivot();
  if (!obj) return;

  // Convert the clicked world point into object-local space
  const localHit = obj.worldToLocal(worldPoint.clone());
  obj.userData.pivotOffset = localHit.toArray();

  // Re-attach TransformControls to a helper that sits at the pivot
  _refreshPivotHelper(obj);
  document.getElementById('btn-reset-pivot').style.display = '';
  markDirty();
  setStatus(`Pivot set to (${localHit.x.toFixed(2)}, ${localHit.y.toFixed(2)}, ${localHit.z.toFixed(2)}) in local space`);
}

function resetPivot() {
  const obj = E.selected;
  if (!obj) return;
  delete obj.userData.pivotOffset;
  // Remove any pivot helper and re-attach TransformControls directly to obj
  const helper = E.scene.getObjectByName('__pivotHelper__');
  if (helper) {
    // If obj was parented under helper, un-parent
    if (obj.parent === helper) {
      const wPos = new THREE.Vector3(), wRot = new THREE.Quaternion(), wScl = new THREE.Vector3();
      obj.getWorldPosition(wPos); obj.getWorldQuaternion(wRot); obj.getWorldScale(wScl);
      E.placedGroup.add(obj);
      obj.position.copy(wPos); obj.quaternion.copy(wRot); obj.scale.copy(wScl);
    }
    E.scene.remove(helper);
  }
  E.transform.detach();
  E.transform.attach(obj);
  document.getElementById('btn-reset-pivot').style.display = 'none';
  markDirty();
  setStatus('Pivot reset to object centre');
}

function _refreshPivotHelper(obj) {
  // Remove previous helper
  const old = E.scene.getObjectByName('__pivotHelper__');
  if (old) E.scene.remove(old);

  if (!obj.userData.pivotOffset) {
    E.transform.detach();
    E.transform.attach(obj);
    return;
  }

  const localOffset = new THREE.Vector3().fromArray(obj.userData.pivotOffset);
  const worldOffset = localOffset.clone().applyMatrix4(obj.matrixWorld);
  // Just attach controls at the object itself — the visual pivot dot shows the offset
  // We show a small dot at the pivot world position and let the user intuitively understand
  E.transform.detach();
  E.transform.attach(obj);

  // Show a visible pivot dot in the scene
  let dot = E.scene.getObjectByName('__pivotDot__');
  if (!dot) {
    dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x44aaff, depthTest: false, toneMapped: false })
    );
    dot.name = '__pivotDot__';
    dot.renderOrder = 998;
    E.scene.add(dot);
  }
  dot.position.copy(worldOffset);
  dot.visible = true;
}

function _updatePivotDot() {
  const dot = E.scene.getObjectByName('__pivotDot__');
  if (!dot) return;
  const obj = E.selected;
  if (!obj || !obj.userData.pivotOffset) { dot.visible = false; return; }
  const localOffset = new THREE.Vector3().fromArray(obj.userData.pivotOffset);
  dot.position.copy(localOffset.clone().applyMatrix4(obj.matrixWorld));
  dot.visible = true;
}

function beginCut() {
  if (!E.selected || E.selected.userData.isRef) {
    setStatus('Select a placed object first to use as the cutter');
    return;
  }
  if (isLightType(E.selected.userData.primType)) {
    setStatus('Lights cannot be used as CSG cutters');
    return;
  }
  if (!E.levelName) { setStatus('Open a level first'); return; }
  E.cutMode   = true;
  E.cutSource = E.selected;
  // Highlight the cutter in orange so it's clearly distinguishable
  _tintCutter(E.cutSource, true);
  document.getElementById('cut-hint').style.display = '';
  document.getElementById('btn-cut').classList.add('active');
  setStatus('Cut mode — click the object you want to cut into (Esc cancels)');
}

function cancelCut() {
  if (!E.cutMode) return;
  _tintCutter(E.cutSource, false);
  E.cutMode   = false;
  E.cutSource = null;
  document.getElementById('cut-hint').style.display = 'none';
  document.getElementById('btn-cut').classList.remove('active');
  setStatus('Cut cancelled');
}

// Temporarily tint the cutter mesh orange / restore original material
function _tintCutter(obj, on) {
  if (!obj) return;
  obj.traverse(c => {
    if (!c.isMesh) return;
    if (on) {
      c.userData._savedMaterial = c.material;
      const tinted = c.material.clone();
      if (tinted.color) tinted.color.setHex(0xff6600);
      c.material = tinted;
    } else {
      if (c.userData._savedMaterial) {
        c.material = c.userData._savedMaterial;
        delete c.userData._savedMaterial;
      }
    }
  });
}

async function performCut(targetObj) {
  const cutter = E.cutSource;
  cancelCut(); // clear state / tint

  // Both must be placed (not isRef)
  if (!cutter || !targetObj || cutter === targetObj) {
    setStatus('Invalid cut targets');
    return;
  }
  if (targetObj.userData.isRef) {
    setStatus('Cannot cut into reference scene objects — place a box wall instead');
    return;
  }
  if (isLightType(targetObj.userData.primType)) {
    setStatus('Cannot cut into a light object');
    return;
  }
  if (!cutter.isMesh && !cutter.isGroup) {
    setStatus('Cutter must be a simple primitive or model for CSG');
    return;
  }

  setStatus('Running CSG subtraction…');

  // Lazy-create evaluator
  if (!E.csgEvaluator) E.csgEvaluator = new Evaluator();

  try {
    // Build Brush objects. Brush is a Mesh, so for groups we need a merged geometry.
    const brushA = _meshToBrush(targetObj);
    const brushB = _meshToBrush(cutter);

    if (!brushA || !brushB) {
      setStatus('CSG failed: object has no mesh geometry');
      return;
    }

    brushA.updateMatrixWorld(true);
    brushB.updateMatrixWorld(true);

    // Perform subtraction: A minus B
    const result = E.csgEvaluator.evaluate(brushA, brushB, SUBTRACTION);

    // Center the geometry at its bounding box midpoint so the gizmo and
    // orbit target land on the wall, not at world origin.
    result.geometry.computeBoundingBox();
    const _csgCenter = new THREE.Vector3();
    result.geometry.boundingBox.getCenter(_csgCenter);
    result.geometry.translate(-_csgCenter.x, -_csgCenter.y, -_csgCenter.z);
    result.position.copy(_csgCenter);
    result.rotation.set(0, 0, 0);
    result.scale.setScalar(1);
    result.castShadow    = targetObj.castShadow;
    result.receiveShadow = true;
    result.userData = {
      ...targetObj.userData,
      primType:  'csg-result',
      csgRecipe: {
        base:    _entryFromObj(targetObj),
        cutters: [ _entryFromObj(cutter) ],
      },
    };
    // Carry forward any existing cutters (stacked cuts)
    if (targetObj.userData.csgRecipe) {
      result.userData.csgRecipe.cutters.push(...targetObj.userData.csgRecipe.cutters);
    }
    result.name = targetObj.name;

    E.placedGroup.remove(targetObj);
    E.placedGroup.add(result);

    // Remove the cutter from the scene
    const cutterId = cutter.userData.editorId;
    for (const g of Object.values(E.groups)) g.ids.delete(cutterId);
    for (const gid of Object.keys(E.groups)) { if (E.groups[gid].ids.size === 0) delete E.groups[gid]; }
    E.placedGroup.remove(cutter);

    selectObj(result);
    pushUndo(); updateSceneList(); updateGroupsPanel(); markDirty();
    setStatus(`Cut complete — "${result.name}" geometry updated`);

  } catch (err) {
    setStatus('CSG error: ' + err.message);
    console.error(err);
  }
}

// Build a Brush (Mesh with world transform baked) from a possibly-grouped object.
// We use a simple merged-geometry approach for groups/models.
function _meshToBrush(obj) {
  obj.updateMatrixWorld(true);

  // Collect all descendant meshes (or self if it's a single mesh)
  const meshes = [];
  if (obj.isMesh) {
    meshes.push(obj);
  } else {
    obj.traverse(c => { if (c.isMesh) meshes.push(c); });
  }
  if (!meshes.length) return null;

  // Merge all into one BufferGeometry in world space
  const merged = mergeGeometriesWorldSpace(meshes);
  if (!merged) return null;

  const material = meshes[0].material ?? new THREE.MeshStandardMaterial();
  const brush = new Brush(merged, Array.isArray(material) ? material[0] : material);
  // Brush is already in world space, so identity transform
  brush.updateMatrixWorld(true);
  return brush;
}

// Merge multiple meshes into a single BufferGeometry, transforming each into world space.
function mergeGeometriesWorldSpace(meshes) {
  const posArrays  = [], normArrays = [], uvArrays = [], idxArrays = [];
  let vertOffset = 0;

  meshes.forEach(mesh => {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);

    // If the world matrix has a negative determinant (odd number of negative scales),
    // winding order is flipped which breaks CSG inside/outside detection — flip it back.
    if (mesh.matrixWorld.determinant() < 0) {
      const idx = geo.index;
      if (idx) {
        for (let i = 0; i < idx.array.length; i += 3) {
          const tmp = idx.array[i + 1]; idx.array[i + 1] = idx.array[i + 2]; idx.array[i + 2] = tmp;
        }
      } else {
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i += 3) {
          for (let c = 0; c < 3; c++) {
            const tmp = pos.getComponent(i + 1, c);
            pos.setComponent(i + 1, c, pos.getComponent(i + 2, c));
            pos.setComponent(i + 2, c, tmp);
          }
        }
      }
      geo.computeVertexNormals();
    }

    const pos  = geo.attributes.position;
    const norm = geo.attributes.normal;
    const uv   = geo.attributes.uv;
    const idx  = geo.index;

    posArrays.push(pos.array);
    if (norm) normArrays.push(norm.array);
    if (uv)   uvArrays.push(uv.array);

    if (idx) {
      const shifted = new Uint32Array(idx.array.length);
      for (let i = 0; i < idx.array.length; i++) shifted[i] = idx.array[i] + vertOffset;
      idxArrays.push(shifted);
    } else {
      const count   = pos.count;
      const trivial = new Uint32Array(count);
      for (let i = 0; i < count; i++) trivial[i] = i + vertOffset;
      idxArrays.push(trivial);
    }
    vertOffset += pos.count;
  });

  const totalVerts = posArrays.reduce((s, a) => s + a.length / 3, 0);
  const totalIdx   = idxArrays.reduce((s, a) => s + a.length, 0);

  const positions = new Float32Array(totalVerts * 3);
  const normals   = normArrays.length === meshes.length ? new Float32Array(totalVerts * 3) : null;
  const uvs       = uvArrays.length   === meshes.length ? new Float32Array(totalVerts * 2) : null;
  const indices   = new Uint32Array(totalIdx);

  let pOff = 0, nOff = 0, uOff = 0, iOff = 0;
  posArrays.forEach((pa, i) => {
    positions.set(pa, pOff); pOff += pa.length;
    if (normals && normArrays[i]) { normals.set(normArrays[i], nOff); nOff += normArrays[i].length; }
    if (uvs     && uvArrays[i])   { uvs.set(uvArrays[i],     uOff); uOff += uvArrays[i].length; }
  });
  idxArrays.forEach(ia => { indices.set(ia, iOff); iOff += ia.length; });

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) result.setAttribute('normal',   new THREE.BufferAttribute(normals, 3));
  if (uvs)     result.setAttribute('uv',       new THREE.BufferAttribute(uvs,     2));
  result.setIndex(new THREE.BufferAttribute(indices, 1));
  return result;
}

// Serialize an object to a level-entry-style record (for csgRecipe storage)
function _entryFromObj(obj) {
  return {
    type:      obj.userData.primType || 'box',
    modelPath: obj.userData.modelPath || null,
    pos:       [+obj.position.x.toFixed(4), +obj.position.y.toFixed(4), +obj.position.z.toFixed(4)],
    rot:       [+(obj.rotation.x*DEG).toFixed(2), +(obj.rotation.y*DEG).toFixed(2), +(obj.rotation.z*DEG).toFixed(2)],
    size:      [+obj.scale.x.toFixed(4), +obj.scale.y.toFixed(4), +obj.scale.z.toFixed(4)],
    color:     obj.material?.color ? '#' + obj.material.color.getHexString() : '#aaaacc',
  };
}

// Rebuild a CSG result from a saved recipe (used in loadLevel)
async function spawnCsgResult(entry, gltfLoader, fbxLoader) {
  if (!E.csgEvaluator) E.csgEvaluator = new Evaluator();

  const recipe = entry.csgRecipe;

  // Build the base mesh
  const baseObj = await _buildEntryObj(recipe.base, gltfLoader, fbxLoader);
  if (!baseObj) return null;

  let brushA = _meshToBrush(baseObj);
  if (!brushA) return null;

  // Apply each cutter in sequence
  for (const cutEntry of (recipe.cutters || [])) {
    const cutObj = await _buildEntryObj(cutEntry, gltfLoader, fbxLoader);
    if (!cutObj) continue;
    const brushB = _meshToBrush(cutObj);
    if (!brushB) continue;
    brushA.updateMatrixWorld(true);
    brushB.updateMatrixWorld(true);
    try {
      brushA = E.csgEvaluator.evaluate(brushA, brushB, SUBTRACTION);
    } catch (err) {
      console.warn('CSG evaluate failed for cutter, skipping:', err);
    }
  }

  const result = brushA;
  // Center geometry at bounding box midpoint so gizmo/orbit land on the object.
  result.geometry.computeBoundingBox();
  const _csgCenter = new THREE.Vector3();
  result.geometry.boundingBox.getCenter(_csgCenter);
  result.geometry.translate(-_csgCenter.x, -_csgCenter.y, -_csgCenter.z);
  result.position.copy(_csgCenter);
  result.rotation.set(0, 0, 0);
  result.scale.setScalar(1);
  result.castShadow = entry.castShadow !== false;
  result.receiveShadow = true;
  result.userData = {
    primType:   'csg-result',
    editorId:   entry.id,
    label:      entry.label || '',
    collidable: entry.collidable !== false,
    csgRecipe:  recipe,
  };
  result.name = entry.label || ('CSG_' + entry.id);
  if (entry.states?.length)  { result.userData.states = entry.states; result.userData.currentState = 0; }
  if (entry.links?.length)     result.userData.links  = entry.links;
  if (entry.noSelfInteract)    result.userData.noSelfInteract = true;
  if (entry.emissiveIntensity > 0 && result.material) {
    result.userData.emissiveIntensity = entry.emissiveIntensity;
    result.userData.emissiveColor     = entry.emissiveColor ?? '#ffffff';
    const col = new THREE.Color(entry.emissiveColor ?? '#ffffff');
    const mats = Array.isArray(result.material) ? result.material : [result.material];
    mats.forEach(m => { if (m && 'emissive' in m) { m.emissive.copy(col); m.emissiveIntensity = entry.emissiveIntensity; } });
  }
  // Restore texture if saved
  if (entry.faceTextures) {
    result.userData.faceTextures = entry.faceTextures;
    applyFaceTextures(result);
  }
  E.placedGroup.add(result);
  return result;
}

// Build a temporary mesh from a recipe entry (for CSG source geometry)
async function _buildEntryObj(e, gltfLoader, fbxLoader) {
  if (e.type === 'model' && e.modelPath) {
    return new Promise(resolve => {
      const ext = e.modelPath.split('.').pop().toLowerCase();
      const loader = ext === 'fbx' ? fbxLoader : gltfLoader;
      loader.load(ASSET_ROOT + e.modelPath, result => {
        const root = result.scene || result;
        root.position.set(...e.pos);
        root.rotation.set(e.rot[0]*RAD, e.rot[1]*RAD, e.rot[2]*RAD);
        root.scale.set(...e.size);
        root.updateMatrixWorld(true);
        resolve(root);
      }, undefined, () => resolve(null));
    });
  }
  const mesh = makePrimMesh(e.type, e.color);
  if (!mesh) return null;
  applyEntryTransform(mesh, e);
  mesh.updateMatrixWorld(true);
  return mesh;
}

// â”€â”€â”€ Undo / Redo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function pushUndo() {
  E.undoStack.push(JSON.stringify(levelToJSON()));
  if (E.undoStack.length > 20) E.undoStack.shift();
  E.redoStack = [];
}

function undo() {
  if (!E.undoStack.length) return;
  E.redoStack.push(JSON.stringify(levelToJSON()));
  restoreSnapshot(E.undoStack.pop());
  setStatus('Undo');
}

function redo() {
  if (!E.redoStack.length) return;
  E.undoStack.push(JSON.stringify(levelToJSON()));
  restoreSnapshot(E.redoStack.pop());
  setStatus('Redo');
}

async function restoreSnapshot(json) {
  const data = JSON.parse(json);
  clearPlaced();
  E.nextId = data.nextId || 1;
  if (data.groups) {
    for (const [gid, g] of Object.entries(data.groups)) {
      E.groups[gid] = { name: g.name, ids: new Set(g.ids) };
    }
  }
  const gltfLoader = new GLTFLoader(), fbxLoader = new FBXLoader();
  for (const entry of (data.objects || [])) {
    if (entry.type === 'csg-result')          await spawnCsgResult(entry, gltfLoader, fbxLoader).catch(err => console.warn('CSG spawn failed:', err));
    else if (entry.type === 'model')           await loadModelIntoPlaced(entry, gltfLoader, fbxLoader);
    else if (entry.type === 'merged-model')    spawnMergedModel(entry);
    else spawnPrimFromEntry(entry);
  }
  updateSceneList(); updateGroupsPanel(); markDirty();
}

// â”€â”€â”€ Dirty / display helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function markDirty() {
  E.isDirty = true;
  refreshLevelNameDisplay();
}

function refreshLevelNameDisplay() {
  const el = document.getElementById('level-name-display');
  if (!el) return;
  el.textContent = E.levelName || '-';
  el.classList.toggle('dirty', E.isDirty);
}

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

function updatePlacingHint(show) {
  const el = document.getElementById('placing-hint');
  if (el) el.style.display = show ? 'block' : 'none';
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// â”€â”€â”€ Model list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function refreshModelList() {
  if (!window.electron) return;
  try { E.importedModels = await window.electron.listModels(); } catch { E.importedModels = []; }
  renderModelList();
  await refreshTextureList();
  await refreshSoundList();
}

async function refreshActorList() {
  if (!window.electron?.listActors) return;
  try { E.importedActors = await window.electron.listActors(); } catch { E.importedActors = []; }
  renderActorList();
}

function renderActorList() {
  const empty = document.getElementById('actor-empty');
  const list  = document.getElementById('actor-list');
  if (!list) return;
  list.querySelectorAll('.actor-item').forEach(el => el.remove());
  if (!E.importedActors.length) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';
  E.importedActors.forEach(a => {
    const div = document.createElement('div');
    div.className = 'actor-item model-item';
    div.textContent = a.name;
    div.title = a.path;
    div.addEventListener('click', () => {
      if (!E.levelName) { setStatus('Open or create a level first'); return; }
      document.querySelectorAll('.prim-btn, .model-item, .actor-item').forEach(b => b.classList.remove('active'));
      div.classList.add('active');
      beginPlace('actor:' + a.path);
    });
    list.appendChild(div);
  });
}

async function refreshTextureList() {
  if (!window.electron?.listTextures) return;
  try { E.availableTextures = await window.electron.listTextures(); } catch { E.availableTextures = []; }
  const dl = document.getElementById('tex-datalist');
  if (!dl) return;
  dl.innerHTML = '';
  E.availableTextures.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    dl.appendChild(opt);
  });
}

async function refreshSoundList() {
  if (!window.electron?.listSounds) return;
  let sounds = [];
  try { sounds = await window.electron.listSounds(); } catch { sounds = []; }
  const dl = document.getElementById('sound-datalist');
  if (!dl) return;
  dl.innerHTML = '';
  sounds.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    dl.appendChild(opt);
  });
}

function renderModelList() {
  const empty   = document.getElementById('palette-empty');
  const palette = document.getElementById('palette-list');
  if (!palette) return;
  palette.querySelectorAll('.model-item').forEach(el => el.remove());
  if (!E.importedModels.length) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';
  E.importedModels.forEach(m => {
    const div = document.createElement('div');
    div.className = 'model-item';
    div.textContent = m.name;
    div.title = m.path;
    div.addEventListener('click', () => {
      if (!E.levelName) { setStatus('Open or create a level first'); return; }
      document.querySelectorAll('.prim-btn, .model-item').forEach(b => b.classList.remove('active'));
      div.classList.add('active');
      beginPlace('model:' + m.path);
    });
    palette.appendChild(div);
  });
}

// â”€â”€â”€ Level modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function openLevelModal() {
  const modal   = document.getElementById('level-modal');
  const listDiv = document.getElementById('level-modal-list');
  if (!modal || !listDiv) return;
  listDiv.innerHTML = '';

  // "main" - always listed first (hard-coded scene base)
  const mainItem = document.createElement('div');
  mainItem.className = 'level-list-item';
  mainItem.dataset.level = 'main';
  mainItem.textContent = 'main';
  mainItem.addEventListener('click', () => {
    listDiv.querySelectorAll('.level-list-item').forEach(el => el.classList.remove('selected'));
    mainItem.classList.add('selected');
    document.getElementById('modal-new-name').value = '';
  });
  listDiv.appendChild(mainItem);

  if (window.electron) {
    try {
      const levels = await window.electron.listLevels();
      levels.filter(n => n !== 'main').forEach(name => {
        const item = document.createElement('div');
        item.className = 'level-list-item';
        item.dataset.level = name;
        item.textContent = name;
        item.addEventListener('click', () => {
          listDiv.querySelectorAll('.level-list-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          document.getElementById('modal-new-name').value = name;
        });
        listDiv.appendChild(item);
      });
    } catch { /* ok */ }
  }

  modal.classList.add('open');
}

function closeLevelModal() {
  document.getElementById('level-modal')?.classList.remove('open');
}

// ─── States panel helpers ─────────────────────────────────────────────────────

function captureStateFromObj(obj) {
  const isLight  = isLightType(obj.userData.primType);
  const isSpot   = obj.userData.primType === 'spot-light';
  const stateIdx = obj.userData.states?.length ?? 0;
  const state = {
    name:     'State ' + stateIdx,
    pos:      [+obj.position.x.toFixed(4), +obj.position.y.toFixed(4), +obj.position.z.toFixed(4)],
    rot:      [+(obj.rotation.x * DEG).toFixed(2), +(obj.rotation.y * DEG).toFixed(2), +(obj.rotation.z * DEG).toFixed(2)],
    scale:    [+obj.scale.x.toFixed(4), +obj.scale.y.toFixed(4), +obj.scale.z.toFixed(4)],
    duration: stateIdx === 0 ? 0 : 0.4,
  };
  if (isLight) {
    state.intensity  = obj.userData.intensity  ?? 1;
    state.lightColor = obj.userData.lightColor || '#ffffff';
    state.distance   = obj.userData.distance   ?? (isSpot ? 20 : 10);
    state.decay      = obj.userData.decay      ?? 2;
    if (isSpot) {
      state.angle    = obj.userData.angle    ?? 30;
      state.penumbra = obj.userData.penumbra ?? 0.15;
    }
  }
  return state;
}

function applyStateToEditorObj(obj, state) {
  const posOn      = state.posEnabled   !== false;
  const rotOn      = state.rotEnabled   !== false;
  const scaleOn    = state.scaleEnabled !== false;
  const intOn      = state.intensityEnabled !== false;
  const colOn      = state.lightColorEnabled !== false;
  const distOn     = state.distanceEnabled   !== false;
  const decayOn    = state.decayEnabled      !== false;
  const angleOn    = state.angleEnabled      !== false;
  const penumbraOn = state.penumbraEnabled   !== false;

  if (posOn && state.pos) {
    if (state.posRelative) {
      obj.position.x += state.pos[0];
      obj.position.y += state.pos[1];
      obj.position.z += state.pos[2];
    } else {
      obj.position.set(...state.pos);
    }
  }
  if (rotOn && state.rot) {
    if (state.rotRelative) {
      obj.rotation.x += state.rot[0] * RAD;
      obj.rotation.y += state.rot[1] * RAD;
      obj.rotation.z += state.rot[2] * RAD;
    } else {
      obj.rotation.set(state.rot[0] * RAD, state.rot[1] * RAD, state.rot[2] * RAD);
    }
  }
  if (scaleOn && state.scale) {
    const mode = state.scaleMode || 'abs';
    if (mode === 'mul') {
      obj.scale.x *= state.scale[0]; obj.scale.y *= state.scale[1]; obj.scale.z *= state.scale[2];
    } else if (mode === 'add') {
      obj.scale.x += state.scale[0]; obj.scale.y += state.scale[1]; obj.scale.z += state.scale[2];
    } else {
      obj.scale.set(...state.scale);
    }
  }
  if (isLightType(obj.userData.primType)) {
    if (intOn && state.intensity != null) {
      const val = state.intensityRelative ? ((obj.userData.intensity ?? 1) + state.intensity) : state.intensity;
      obj.userData.intensity = val;
      obj.traverse(c => { if (c.isLight) c.intensity = val; });
    }
    if (colOn && state.lightColor != null) {
      obj.userData.lightColor = state.lightColor;
      obj.traverse(c => { if (c.isLight) c.color.set(state.lightColor); });
    }
    if (distOn && state.distance != null) {
      obj.userData.distance = state.distance;
      obj.traverse(c => { if (c.isLight && 'distance' in c) c.distance = state.distance; });
    }
    if (decayOn && state.decay != null) {
      obj.userData.decay = state.decay;
      obj.traverse(c => { if (c.isLight && 'decay' in c) c.decay = state.decay; });
    }
    if (angleOn && state.angle != null && obj.userData.primType === 'spot-light') {
      obj.userData.angle = state.angle;
      obj.traverse(c => { if (c.isSpotLight) c.angle = THREE.MathUtils.degToRad(state.angle); });
    }
    if (penumbraOn && state.penumbra != null && obj.userData.primType === 'spot-light') {
      obj.userData.penumbra = state.penumbra;
      obj.traverse(c => { if (c.isSpotLight) c.penumbra = state.penumbra; });
    }
  }
  if (state.collidableEnabled && state.collidable != null) {
    obj.userData.collidable = state.collidable;
  }
  if (state.castShadowEnabled && state.castShadow != null) {
    const v = !!state.castShadow;
    obj.userData.castShadow = v;
    obj.castShadow = v;
    obj.traverse(c => {
      if (c.isMesh)  c.castShadow = v;
      if (c.isLight) c.castShadow = v;
    });
  }
  if (state.emissiveEnabled) {
    if (state.emissiveIntensity != null) {
      obj.userData.emissiveIntensity = state.emissiveIntensity;
      obj.traverse(c => {
        if (c.isMesh && c.material) {
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { if ('emissiveIntensity' in m) m.emissiveIntensity = state.emissiveIntensity; });
        }
      });
    }
    if (state.emissiveColor != null) {
      obj.userData.emissiveColor = state.emissiveColor;
      obj.traverse(c => {
        if (c.isMesh && c.material) {
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { if ('emissive' in m) m.emissive.set(state.emissiveColor); });
        }
      });
    }
  }
  if (state.opacityEnabled && state.opacity != null) {
    const v = Math.max(0, Math.min(1, state.opacity));
    obj.traverse(c => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { m.transparent = v < 1; m.opacity = v; m.needsUpdate = true; });
      }
    });
  }
  if (state.meshColorEnabled && state.meshColor != null) {
    obj.traverse(c => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { if (m.color) { m.color.set(state.meshColor); m.needsUpdate = true; } });
      }
    });
  }
  obj.updateMatrixWorld(true);
  updateProps(obj);
  markDirty();
}

function renderStatesPanel(obj) {
  const section = document.getElementById('states-section');
  const list    = document.getElementById('states-list');
  if (!section || !list) return;
  section.style.display = obj ? '' : 'none';
  if (!obj) return;

  // Wire the Link-only checkbox
  const chkNoSelf = document.getElementById('chk-no-self-interact');
  if (chkNoSelf) {
    chkNoSelf.checked = !!obj.userData.noSelfInteract;
    chkNoSelf.onchange = e => {
      if (e.target.checked) obj.userData.noSelfInteract = true;
      else delete obj.userData.noSelfInteract;
      markDirty();
    };
  }

  list.innerHTML = '';
  const states   = obj.userData.states || [];
  const isLight    = isLightType(obj.userData.primType);
  const isTrigger  = isTriggerType(obj.userData.primType);
  const isSpot     = obj.userData.primType === 'spot-light';
  const isDirLight = obj.userData.primType === 'dir-light';

  states.forEach((state, idx) => {
    const item = document.createElement('div');
    item.className = 'state-item';

    const posEnabled      = state.posEnabled        !== false;
    const rotEnabled      = state.rotEnabled        !== false;
    const scaleEnabled    = state.scaleEnabled      !== false;
    const intEnabled      = state.intensityEnabled  !== false;
    const colEnabled      = state.lightColorEnabled !== false;
    const distEnabled     = state.distanceEnabled   !== false;
    const decayEnabled    = state.decayEnabled      !== false;
    const angleEnabled    = state.angleEnabled      !== false;
    const penumbraEnabled = state.penumbraEnabled   !== false;
    const collidableEnabled  = !!state.collidableEnabled;
    const castShadowEnabled  = !!state.castShadowEnabled;
    const emissiveEnabled    = !!state.emissiveEnabled;
    const opacityEnabled     = !!state.opacityEnabled;
    const meshColorEnabled   = !!state.meshColorEnabled;
    const conditionEnabled   = !!state.conditionEnabled;

    const posRel    = !!state.posRelative;
    const rotRel    = !!state.rotRelative;
    const scaleMode = state.scaleMode || 'abs';
    const intRel    = !!state.intensityRelative;
    const pos = state.pos   || [0,0,0];
    const rot = state.rot   || [0,0,0];
    const sc  = state.scale || [1,1,1];

    item.innerHTML = `
      <div class="state-item-header">
        <span data-si="drag-handle" style="cursor:grab;color:#444466;font-size:12px;padding:0 4px 0 0;user-select:none;flex-shrink:0" title="Drag to reorder">&#8942;</span>
        <span style="font-size:10px;color:#5555aa;min-width:16px">${idx}</span>
        <input class="prop-input" data-si="name" value="${escHtml(state.name || ('State '+idx))}" style="flex:1">
        <input class="prop-input" data-si="dur" type="number" step="0.1" min="0" value="${state.duration ?? 0}" style="width:34px" title="Transition duration (s)">s
        <button class="btn" data-si="goto" style="font-size:10px;padding:2px 6px" title="Apply state to object">Go</button>
        <button class="btn btn-del" data-si="del" style="font-size:10px;padding:2px 6px">&times;</button>
      </div>
      <div class="state-item-row">
        <label>Label</label>
        <input class="prop-input" data-si="label" type="text" value="${escHtml(state.interactLabel || '')}" placeholder="[RIGHT CLICK] Interact" style="flex:1">
      </div>
      <div class="state-field-row${posEnabled ? '' : ' sf-disabled'}" data-field="pos">
        <div class="state-field-head">
          <label><input type="checkbox" data-si="posEn" ${posEnabled ? 'checked' : ''}> Pos</label>
          <span class="state-rel-lbl"><input type="checkbox" data-si="posRel" ${posRel ? 'checked' : ''}> +&Delta; offset</span>
        </div>
        <div class="state-field-xyz">
          <span class="xyz-lbl">x</span><input class="prop-input" data-si="pv0" type="number" step="0.01" value="${pos[0]}">
          <span class="xyz-lbl">y</span><input class="prop-input" data-si="pv1" type="number" step="0.01" value="${pos[1]}">
          <span class="xyz-lbl">z</span><input class="prop-input" data-si="pv2" type="number" step="0.01" value="${pos[2]}">
        </div>
      </div>
      <div class="state-field-row${rotEnabled ? '' : ' sf-disabled'}" data-field="rot">
        <div class="state-field-head">
          <label><input type="checkbox" data-si="rotEn" ${rotEnabled ? 'checked' : ''}> Rot (deg)</label>
          <span class="state-rel-lbl"><input type="checkbox" data-si="rotRel" ${rotRel ? 'checked' : ''}> +&Delta; deg</span>
        </div>
        <div class="state-field-xyz">
          <span class="xyz-lbl">x</span><input class="prop-input" data-si="rv0" type="number" step="0.1" value="${rot[0]}">
          <span class="xyz-lbl">y</span><input class="prop-input" data-si="rv1" type="number" step="0.1" value="${rot[1]}">
          <span class="xyz-lbl">z</span><input class="prop-input" data-si="rv2" type="number" step="0.1" value="${rot[2]}">
        </div>
      </div>
      <div class="state-field-row${scaleEnabled ? '' : ' sf-disabled'}" data-field="scale">
        <div class="state-field-head">
          <label><input type="checkbox" data-si="scaleEn" ${scaleEnabled ? 'checked' : ''}> Scale</label>
          <select class="prop-input" data-si="scaleMode" style="width:64px;padding:2px 3px;font-size:10px">
            <option value="abs" ${scaleMode==='abs'?'selected':''}>abs</option>
            <option value="mul" ${scaleMode==='mul'?'selected':''}>&#215; mult</option>
            <option value="add" ${scaleMode==='add'?'selected':''}>+ add</option>
          </select>
        </div>
        <div class="state-field-xyz">
          <span class="xyz-lbl">x</span><input class="prop-input" data-si="sv0" type="number" step="0.001" value="${sc[0]}">
          <span class="xyz-lbl">y</span><input class="prop-input" data-si="sv1" type="number" step="0.001" value="${sc[1]}">
          <span class="xyz-lbl">z</span><input class="prop-input" data-si="sv2" type="number" step="0.001" value="${sc[2]}">
        </div>
      </div>
      ${isLight ? `
      <div class="state-field-row${intEnabled ? '' : ' sf-disabled'}" data-field="intensity">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="intensityEn" ${intEnabled ? 'checked' : ''}> Intensity</label>
          <span class="state-rel-lbl" style="flex:1;justify-content:flex-end;gap:3px">
            <input class="prop-input" data-si="intVal" type="number" step="0.1" min="0" value="${state.intensity ?? 1}" style="width:46px">
            <label style="color:#666688"><input type="checkbox" data-si="intensityRel" ${intRel ? 'checked' : ''}> +&Delta;</label>
          </span>
        </div>
      </div>
      <div class="state-field-row${colEnabled ? '' : ' sf-disabled'}" data-field="lightColor">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="lightColorEn" ${colEnabled ? 'checked' : ''}> Color</label>
          <input class="prop-input" data-si="colVal" type="color" value="${state.lightColor || '#ffffff'}" style="width:44px;height:22px;padding:1px 2px">
        </div>
      </div>
      ${!isDirLight ? `
      <div class="state-field-row${distEnabled ? '' : ' sf-disabled'}" data-field="distance">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="distEn" ${distEnabled ? 'checked' : ''}> Distance</label>
          <input class="prop-input" data-si="distVal" type="number" step="0.5" min="0" value="${state.distance ?? 10}" style="width:50px">
        </div>
      </div>
      <div class="state-field-row${decayEnabled ? '' : ' sf-disabled'}" data-field="decay">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="decayEn" ${decayEnabled ? 'checked' : ''}> Decay</label>
          <input class="prop-input" data-si="decayVal" type="number" step="0.1" min="0" value="${state.decay ?? 2}" style="width:50px">
        </div>
      </div>` : ''}
      ${isSpot ? `
      <div class="state-field-row${angleEnabled ? '' : ' sf-disabled'}" data-field="angle">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="angleEn" ${angleEnabled ? 'checked' : ''}> Angle&deg;</label>
          <input class="prop-input" data-si="angleVal" type="number" step="1" min="1" max="89" value="${state.angle ?? 30}" style="width:50px">
        </div>
      </div>
      <div class="state-field-row${penumbraEnabled ? '' : ' sf-disabled'}" data-field="penumbra">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="penumbraEn" ${penumbraEnabled ? 'checked' : ''}> Penumbra</label>
          <input class="prop-input" data-si="penumbraVal" type="number" step="0.01" min="0" max="1" value="${state.penumbra ?? 0.15}" style="width:50px">
        </div>
      </div>` : ''}
      ` : ''}
      <div class="state-field-row${collidableEnabled ? '' : ' sf-disabled'}" data-field="collidable">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="collidableEn" ${collidableEnabled ? 'checked' : ''}> Collidable</label>
          <label style="color:#888"><input type="checkbox" data-si="collidableVal" ${state.collidable ? 'checked' : ''}> on</label>
        </div>
      </div>
      <div class="state-field-row${castShadowEnabled ? '' : ' sf-disabled'}" data-field="castShadow">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="castShadowEn" ${castShadowEnabled ? 'checked' : ''}> CastShadow</label>
          <label style="color:#888"><input type="checkbox" data-si="castShadowVal" ${(state.castShadow !== false && state.castShadow !== undefined) ? 'checked' : ''}> on</label>
        </div>
      </div>
      ${!isLight && !isTrigger ? `
      <div class="state-field-row${opacityEnabled ? '' : ' sf-disabled'}" data-field="opacity">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="opacityEn" ${opacityEnabled ? 'checked' : ''}> Opacity</label>
          <input class="prop-input" data-si="opacityVal" type="number" step="0.01" min="0" max="1" value="${state.opacity ?? 1}" style="width:50px">
        </div>
      </div>
      <div class="state-field-row${meshColorEnabled ? '' : ' sf-disabled'}" data-field="meshColor">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="meshColorEn" ${meshColorEnabled ? 'checked' : ''}> Color</label>
          <input class="prop-input" data-si="meshColorVal" type="color" value="${state.meshColor || '#ffffff'}" style="width:44px;height:22px;padding:1px 2px">
        </div>
      </div>
      <div class="state-field-row${emissiveEnabled ? '' : ' sf-disabled'}" data-field="emissive">
        <div class="state-field-head" style="gap:4px">
          <label><input type="checkbox" data-si="emissiveEn" ${emissiveEnabled ? 'checked' : ''}> Emissive</label>
          <input class="prop-input" data-si="emissiveIntensityVal" type="number" step="0.1" min="0" value="${state.emissiveIntensity ?? 0}" style="width:50px" title="Emissive intensity (0 = off)">
          <input class="prop-input" data-si="emissiveColorVal" type="color" value="${state.emissiveColor ?? '#ffffff'}" style="width:36px;padding:1px 2px" title="Emissive color">
        </div>
      </div>` : ''}
      <div class="state-field-row${conditionEnabled ? '' : ' sf-disabled'}" data-field="condition">
        <div class="state-field-head" style="gap:3px">
          <label><input type="checkbox" data-si="condEn" ${conditionEnabled ? 'checked' : ''}> If var</label>
          <select class="prop-input" data-si="condVar" style="flex:1;font-size:10px;padding:2px 2px">
            <option value="">(none)</option>
            ${Object.keys(E.levelVars).map(k => `<option value="${escHtml(k)}" ${state.condition?.var === k ? 'selected' : ''}>${escHtml(k)}</option>`).join('')}
          </select>
          <select class="prop-input" data-si="condOp" style="width:44px;font-size:10px;padding:2px 2px">
            <option value="eq" ${state.condition?.op === 'eq' ? 'selected' : ''}>=</option>
            <option value="ne" ${state.condition?.op === 'ne' ? 'selected' : ''}>&ne;</option>
            <option value="lt" ${state.condition?.op === 'lt' ? 'selected' : ''}>&lt;</option>
            <option value="le" ${state.condition?.op === 'le' ? 'selected' : ''}>&le;</option>
            <option value="gt" ${state.condition?.op === 'gt' ? 'selected' : ''}>&gt;</option>
            <option value="ge" ${state.condition?.op === 'ge' ? 'selected' : ''}>&ge;</option>
          </select>
          <input class="prop-input" data-si="condVal" type="text" value="${escHtml(String(state.condition?.value ?? ''))}" style="width:44px" placeholder="value">
        </div>
      </div>
      <div class="state-item-row">
        <label style="white-space:nowrap">Active var</label>
        <input class="prop-input" data-si="activeVar" type="text" value="${escHtml(state.activeVar || '')}" placeholder="lv_... (set true when active)" style="flex:1">
      </div>
      <div class="state-item-row">
        <button class="btn" data-si="soundsBtn" style="font-size:11px;padding:3px 10px;width:100%">&#127925; Sounds...</button>
      </div>
    `;

    const g  = sel => item.querySelector(`[data-si="${sel}"]`);
    const st = obj.userData.states[idx];

    g('name').addEventListener('input',  e => { st.name = e.target.value; markDirty(); });
    g('dur').addEventListener('change',  e => { st.duration = parseFloat(e.target.value) || 0; markDirty(); });
    g('label').addEventListener('input', e => {
      const v = e.target.value.trim();
      if (v) st.interactLabel = v; else delete st.interactLabel;
      markDirty();
    });

    // Pos
    g('posEn').addEventListener('change', e => {
      st.posEnabled = e.target.checked;
      item.querySelector('[data-field="pos"]').classList.toggle('sf-disabled', !e.target.checked);
      markDirty();
    });
    g('posRel').addEventListener('change', e => {
      st.posRelative = e.target.checked;
      if (e.target.checked) { st.pos = [0,0,0]; g('pv0').value=0; g('pv1').value=0; g('pv2').value=0; }
      markDirty();
    });
    [0,1,2].forEach(i => g(`pv${i}`).addEventListener('change', e => { if (!st.pos) st.pos=[0,0,0]; st.pos[i] = parseFloat(e.target.value)||0; markDirty(); }));

    // Rot
    g('rotEn').addEventListener('change', e => {
      st.rotEnabled = e.target.checked;
      item.querySelector('[data-field="rot"]').classList.toggle('sf-disabled', !e.target.checked);
      markDirty();
    });
    g('rotRel').addEventListener('change', e => {
      st.rotRelative = e.target.checked;
      if (e.target.checked) { st.rot = [0,0,0]; g('rv0').value=0; g('rv1').value=0; g('rv2').value=0; }
      markDirty();
    });
    [0,1,2].forEach(i => g(`rv${i}`).addEventListener('change', e => { if (!st.rot) st.rot=[0,0,0]; st.rot[i] = parseFloat(e.target.value)||0; markDirty(); }));

    // Scale
    g('scaleEn').addEventListener('change', e => {
      st.scaleEnabled = e.target.checked;
      item.querySelector('[data-field="scale"]').classList.toggle('sf-disabled', !e.target.checked);
      markDirty();
    });
    g('scaleMode').addEventListener('change', e => {
      const prev = st.scaleMode || 'abs';
      st.scaleMode = e.target.value;
      if (prev === 'abs' && e.target.value === 'mul') { st.scale=[1,1,1]; g('sv0').value=1; g('sv1').value=1; g('sv2').value=1; }
      if (prev === 'abs' && e.target.value === 'add') { st.scale=[0,0,0]; g('sv0').value=0; g('sv1').value=0; g('sv2').value=0; }
      markDirty();
    });
    [0,1,2].forEach(i => g(`sv${i}`).addEventListener('change', e => { if (!st.scale) st.scale=[1,1,1]; st.scale[i] = parseFloat(e.target.value)||0; markDirty(); }));

    // Light-specific fields
    if (isLight) {
      g('intensityEn').addEventListener('change', e => {
        st.intensityEnabled = e.target.checked;
        item.querySelector('[data-field="intensity"]').classList.toggle('sf-disabled', !e.target.checked);
        markDirty();
      });
      g('intVal').addEventListener('change', e => { st.intensity = parseFloat(e.target.value) ?? 1; markDirty(); });
      g('intensityRel').addEventListener('change', e => {
        st.intensityRelative = e.target.checked;
        if (e.target.checked) { st.intensity = 0; g('intVal').value = 0; }
        markDirty();
      });
      g('lightColorEn').addEventListener('change', e => {
        st.lightColorEnabled = e.target.checked;
        item.querySelector('[data-field="lightColor"]').classList.toggle('sf-disabled', !e.target.checked);
        markDirty();
      });
      g('colVal').addEventListener('input', e => { st.lightColor = e.target.value; markDirty(); });

      if (!isDirLight) {
        g('distEn').addEventListener('change', e => {
          st.distanceEnabled = e.target.checked;
          item.querySelector('[data-field="distance"]').classList.toggle('sf-disabled', !e.target.checked);
          markDirty();
        });
        g('distVal').addEventListener('change', e => { st.distance = parseFloat(e.target.value) || 0; markDirty(); });
        g('decayEn').addEventListener('change', e => {
          st.decayEnabled = e.target.checked;
          item.querySelector('[data-field="decay"]').classList.toggle('sf-disabled', !e.target.checked);
          markDirty();
        });
        g('decayVal').addEventListener('change', e => { st.decay = parseFloat(e.target.value) || 0; markDirty(); });
      }

      if (isSpot) {
        g('angleEn').addEventListener('change', e => {
          st.angleEnabled = e.target.checked;
          item.querySelector('[data-field="angle"]').classList.toggle('sf-disabled', !e.target.checked);
          markDirty();
        });
        g('angleVal').addEventListener('change', e => { st.angle = parseFloat(e.target.value) || 30; markDirty(); });
        g('penumbraEn').addEventListener('change', e => {
          st.penumbraEnabled = e.target.checked;
          item.querySelector('[data-field="penumbra"]').classList.toggle('sf-disabled', !e.target.checked);
          markDirty();
        });
        g('penumbraVal').addEventListener('change', e => { st.penumbra = parseFloat(e.target.value) ?? 0.15; markDirty(); });
      }
    }

    // Collidable / CastShadow (all objects)
    g('collidableEn').addEventListener('change', e => {
      st.collidableEnabled = e.target.checked;
      item.querySelector('[data-field="collidable"]').classList.toggle('sf-disabled', !e.target.checked);
      markDirty();
    });
    g('collidableVal').addEventListener('change', e => { st.collidable = e.target.checked; markDirty(); });
    g('castShadowEn').addEventListener('change', e => {
      st.castShadowEnabled = e.target.checked;
      item.querySelector('[data-field="castShadow"]').classList.toggle('sf-disabled', !e.target.checked);
      markDirty();
    });
    g('castShadowVal').addEventListener('change', e => { st.castShadow = e.target.checked; markDirty(); });

    // Emissive / Opacity / Color (non-light, non-trigger only — elements conditionally rendered)
    g('emissiveEn')?.addEventListener('change', e => {
      st.emissiveEnabled = e.target.checked;
      item.querySelector('[data-field="emissive"]').classList.toggle('sf-disabled', !e.target.checked);
      markDirty();
    });
    g('emissiveIntensityVal')?.addEventListener('change', e => { st.emissiveIntensity = parseFloat(e.target.value) || 0; markDirty(); });
    g('emissiveColorVal')?.addEventListener('change', e => { st.emissiveColor = e.target.value; markDirty(); });
    g('opacityEn')?.addEventListener('change', e => {
      st.opacityEnabled = e.target.checked;
      item.querySelector('[data-field="opacity"]').classList.toggle('sf-disabled', !e.target.checked);
      markDirty();
    });
    g('opacityVal')?.addEventListener('change', e => { st.opacity = parseFloat(e.target.value) ?? 1; markDirty(); });
    g('meshColorEn')?.addEventListener('change', e => {
      st.meshColorEnabled = e.target.checked;
      item.querySelector('[data-field="meshColor"]').classList.toggle('sf-disabled', !e.target.checked);
      markDirty();
    });
    g('meshColorVal')?.addEventListener('change', e => { st.meshColor = e.target.value; markDirty(); });

    // Condition
    g('condEn').addEventListener('change', e => {
      st.conditionEnabled = e.target.checked;
      item.querySelector('[data-field="condition"]').classList.toggle('sf-disabled', !e.target.checked);
      markDirty();
    });
    g('condVar').addEventListener('change', e => {
      if (!st.condition) st.condition = { var: '', op: 'eq', value: '' };
      st.condition.var = e.target.value;
      markDirty();
    });
    g('condOp').addEventListener('change', e => {
      if (!st.condition) st.condition = { var: '', op: 'eq', value: '' };
      st.condition.op = e.target.value;
      markDirty();
    });
    g('condVal').addEventListener('change', e => {
      if (!st.condition) st.condition = { var: '', op: 'eq', value: '' };
      st.condition.value = e.target.value;
      markDirty();
    });

    g('activeVar').addEventListener('change', e => {
      const v = e.target.value.trim();
      if (v) st.activeVar = v; else delete st.activeVar;
      markDirty();
    });

    g('soundsBtn').addEventListener('click', () => openSoundListModal(obj, idx));

    g('goto').addEventListener('click', () => applyStateToEditorObj(obj, obj.userData.states[idx]));
    g('del').addEventListener('click', () => {
      obj.userData.states.splice(idx, 1);
      if (!obj.userData.states.length) delete obj.userData.states;
      renderStatesPanel(obj); markDirty();
    });

    // Inputs section — button trigger → var operation bindings
    const inputsSection = document.createElement('div');
    inputsSection.className = 'state-field-row';
    inputsSection.style.marginTop = '4px';
    const inputsHead = document.createElement('div');
    inputsHead.className = 'state-field-head';
    inputsHead.style.gap = '4px';
    const inputsLabel = document.createElement('label');
    inputsLabel.style.cssText = 'font-size:10px;font-weight:bold';
    inputsLabel.textContent = 'Inputs';
    const btnAddInput = document.createElement('button');
    btnAddInput.className = 'btn';
    btnAddInput.style.cssText = 'font-size:10px;padding:2px 6px;margin-left:auto';
    btnAddInput.textContent = '+ Add';
    inputsHead.appendChild(inputsLabel);
    inputsHead.appendChild(btnAddInput);
    inputsSection.appendChild(inputsHead);
    const inputsList = document.createElement('div');
    inputsSection.appendChild(inputsList);

    const renderInputRows = () => {
      inputsList.innerHTML = '';
      (st.buttons || []).forEach((b, bi) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:3px;align-items:center;flex-wrap:wrap;margin-top:3px';

        const trigSel = document.createElement('select');
        trigSel.className = 'prop-input';
        trigSel.style.cssText = 'width:96px;font-size:10px;padding:2px';
        [['scrollup','↑ scroll up'],['scrolldown','↓ scroll down'],['rightclick','right-click'],['click','click']].forEach(([v, lbl]) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = lbl;
          if (b.trigger === v) o.selected = true;
          trigSel.appendChild(o);
        });
        trigSel.addEventListener('change', e => { b.trigger = e.target.value; markDirty(); });

        const opSel = document.createElement('select');
        opSel.className = 'prop-input';
        opSel.style.cssText = 'width:46px;font-size:10px;padding:2px';
        [['set','set'],['add','add'],['sub','sub'],['mul','mul']].forEach(([v, lbl]) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = lbl;
          if (b.varOp === v) o.selected = true;
          opSel.appendChild(o);
        });
        opSel.addEventListener('change', e => { b.varOp = e.target.value; markDirty(); });

        const varSel = document.createElement('select');
        varSel.className = 'prop-input';
        varSel.style.cssText = 'flex:1;min-width:50px;font-size:10px;padding:2px';
        const noneOpt = document.createElement('option');
        noneOpt.value = ''; noneOpt.textContent = '(none)';
        varSel.appendChild(noneOpt);
        Object.keys(E.levelVars).forEach(k => {
          const o = document.createElement('option');
          o.value = k; o.textContent = k;
          if (b.varName === k) o.selected = true;
          varSel.appendChild(o);
        });
        varSel.addEventListener('change', e => { b.varName = e.target.value; markDirty(); });

        const valInput = document.createElement('input');
        valInput.className = 'prop-input';
        valInput.type = 'number'; valInput.step = '0.01';
        valInput.style.width = '44px';
        valInput.value = b.varValue ?? 0;
        valInput.addEventListener('change', e => { b.varValue = parseFloat(e.target.value) || 0; markDirty(); });

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-del';
        delBtn.style.cssText = 'font-size:10px;padding:2px 5px';
        delBtn.textContent = '\xd7';
        delBtn.addEventListener('click', () => {
          st.buttons.splice(bi, 1);
          if (!st.buttons.length) delete st.buttons;
          renderInputRows();
          markDirty();
        });

        row.appendChild(trigSel); row.appendChild(opSel); row.appendChild(varSel);
        row.appendChild(valInput); row.appendChild(delBtn);
        inputsList.appendChild(row);
      });
    };

    btnAddInput.addEventListener('click', () => {
      if (!st.buttons) st.buttons = [];
      st.buttons.push({ trigger: 'scrollup', varOp: 'add', varName: '', varValue: 0 });
      renderInputRows();
      markDirty();
    });

    renderInputRows();
    item.appendChild(inputsSection);

    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', e => {
      E._stateDragSrc = idx;
      e.dataTransfer.effectAllowed = 'move';
      item.style.opacity = '0.5';
    });
    item.addEventListener('dragend', () => { item.style.opacity = ''; });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.style.outline = '1px dashed #5577aa';
    });
    item.addEventListener('dragleave', () => { item.style.outline = ''; });
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.style.outline = '';
      if (E._stateDragSrc === undefined || E._stateDragSrc === idx) return;
      pushUndo();
      const [moved] = obj.userData.states.splice(E._stateDragSrc, 1);
      obj.userData.states.splice(idx, 0, moved);
      renderStatesPanel(obj);
      markDirty();
    });

    list.appendChild(item);
  });

  if (!states.length) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:#555577;padding:2px 0';
    hint.textContent = 'No states — click + Add to capture object transform as a state';
    list.appendChild(hint);
  }
}

// â”€â”€â”€ UI wiring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function beginLink() {
  const obj = E.selected;
  if (!obj || obj.userData.isRef) { setStatus('Select a placed object first'); return; }
  E.linkMode   = true;
  E.linkSource = obj;
  document.getElementById('link-hint').style.display = '';
  document.getElementById('btn-add-link').classList.add('active');
  setStatus('Link mode — click the object to wire to this interact (Esc cancels)');
}

function cancelLink() {
  if (!E.linkMode) return;
  E.linkMode   = false;
  E.linkSource = null;
  document.getElementById('link-hint').style.display = 'none';
  document.getElementById('btn-add-link').classList.remove('active');
  setStatus('Link cancelled');
}

function renderLinksPanel(obj) {
  const section = document.getElementById('links-section');
  const list    = document.getElementById('links-list');
  if (!section || !list) return;
  section.style.display = obj ? '' : 'none';
  if (!obj) {
    const hint = document.getElementById('link-hint');
    if (hint) hint.style.display = 'none';
    return;
  }

  list.innerHTML = '';
  const links = obj.userData.links || [];

  links.forEach((targetId, idx) => {
    let targetName = '#' + targetId;
    E.placedGroup.traverse(o => {
      if (o.userData.editorId === targetId) targetName = o.name || targetName;
    });
    const item = document.createElement('div');
    item.className = 'link-item';
    item.innerHTML = `<span title="${escHtml(targetName)}">${escHtml(targetName)}</span>
      <button class="btn btn-del" data-li="del" style="font-size:10px;padding:2px 6px">&times;</button>`;
    item.querySelector('[data-li="del"]').addEventListener('click', () => {
      obj.userData.links.splice(idx, 1);
      if (!obj.userData.links.length) delete obj.userData.links;
      renderLinksPanel(obj); markDirty();
    });
    list.appendChild(item);
  });

  if (!links.length) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:#555577;padding:2px 0';
    hint.textContent = 'No links — click + Link then click a target object';
    list.appendChild(hint);
  }
}

// ─── Variables panel ──────────────────────────────────────────────────────────
function renderVarsPanel() {
  const list = document.getElementById('vars-list');
  if (!list) return;
  list.innerHTML = '';

  const entries = Object.entries(E.levelVars);
  if (!entries.length) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;color:#445566;padding:2px 0';
    hint.textContent = 'No variables — click + Add to define a level variable';
    list.appendChild(hint);
    return;
  }

  entries.forEach(([fullName, v]) => {
    const shortName = fullName.startsWith('lv_') ? fullName.slice(3) : fullName;
    const row = document.createElement('div');
    row.className = 'prop-row';
    row.style.cssText = 'align-items:center;gap:3px;flex-wrap:nowrap';
    row.innerHTML = `
      <span style="font-size:10px;color:#7799bb;white-space:nowrap">lv_</span>
      <input class="prop-input" data-vi="name" value="${escHtml(shortName)}" style="flex:1;min-width:40px" placeholder="name">
      <select class="prop-input" data-vi="type" style="width:60px;padding:2px 2px;font-size:10px">
        <option value="number" ${v.type==='number'?'selected':''}>number</option>
        <option value="bool"   ${v.type==='bool'  ?'selected':''}>bool</option>
        <option value="string" ${v.type==='string'?'selected':''}>string</option>
      </select>
      <input class="prop-input" data-vi="initial" value="${escHtml(String(v.initial ?? ''))}" style="width:44px" placeholder="init" title="Initial value when level loads">
      <button class="btn btn-del" data-vi="del" style="font-size:10px;padding:2px 5px" title="Delete variable">&times;</button>
    `;

    const g = sel => row.querySelector(`[data-vi="${sel}"]`);

    const rename = newShort => {
      const newFull = 'lv_' + newShort.replace(/[^a-zA-Z0-9_]/g, '_');
      if (newFull === fullName) return fullName;
      if (E.levelVars[newFull]) return fullName; // conflict — keep old
      E.levelVars[newFull] = E.levelVars[fullName];
      delete E.levelVars[fullName];
      return newFull;
    };

    g('name').addEventListener('change', e => {
      const newFull = rename(e.target.value.trim() || 'var');
      e.target.value = newFull.startsWith('lv_') ? newFull.slice(3) : newFull;
      markDirty();
      refreshVarDropdowns();
    });
    g('type').addEventListener('change', e => {
      E.levelVars[fullName].type = e.target.value;
      markDirty();
    });
    g('initial').addEventListener('change', e => {
      const vd = E.levelVars[fullName];
      if (!vd) return;
      const raw = e.target.value;
      vd.initial = vd.type === 'number' ? (parseFloat(raw) || 0)
                 : vd.type === 'bool'   ? (raw === 'true' || raw === '1')
                 : raw;
      markDirty();
    });
    g('del').addEventListener('click', () => {
      delete E.levelVars[fullName];
      markDirty();
      renderVarsPanel();
      refreshVarDropdowns();
    });

    list.appendChild(row);
  });
}

function refreshVarDropdowns() {
  // Update all trigger-var-name dropdowns (there's one in the trigger props panel)
  _populateVarSelect(document.getElementById('trigger-var-name'), null);
  // Re-render states panel to update condition var dropdowns (if obj selected)
  if (E.selected) renderStatesPanel(E.selected);
}

function _populateVarSelect(selectEl, currentVal) {
  if (!selectEl) return;
  const prev = currentVal ?? selectEl.value;
  selectEl.innerHTML = '<option value="">(none)</option>';
  Object.keys(E.levelVars).forEach(k => {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    if (k === prev) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function setupUI() {
  // Links panel — "+ Link" button
  document.getElementById('btn-add-link')?.addEventListener('click', () => {
    if (E.linkMode) cancelLink();
    else beginLink();
  });

  // States panel — "Add State" button
  document.getElementById('btn-add-state')?.addEventListener('click', () => {
    const obj = E.selected;
    if (!obj) { setStatus('Select an object first'); return; }
    if (!obj.userData.states) obj.userData.states = [];
    obj.userData.states.push(captureStateFromObj(obj));
    renderStatesPanel(obj);
    markDirty();
  });

  // Variables panel — "Add Variable" button
  document.getElementById('btn-add-var')?.addEventListener('click', () => {
    let n = 1;
    while (E.levelVars['lv_var' + n]) n++;
    E.levelVars['lv_var' + n] = { type: 'number', initial: 0 };
    renderVarsPanel();
    refreshVarDropdowns();
    markDirty();
  });

  // Level toolbar
  document.getElementById('btn-new-level').addEventListener('click',  openLevelModal);
  document.getElementById('btn-open-level').addEventListener('click', openLevelModal);
  document.getElementById('btn-save-level').addEventListener('click', saveLevel);

  // Modal
  document.getElementById('modal-cancel').addEventListener('click', closeLevelModal);
  document.getElementById('modal-confirm').addEventListener('click', async () => {
    const nameInput = document.getElementById('modal-new-name').value.trim();
    const selected  = document.querySelector('#level-modal-list .level-list-item.selected');
    const name = nameInput || selected?.dataset.level || '';
    if (!name) { setStatus('Enter a level name or select one'); return; }
    closeLevelModal();
    await loadLevel(name);
  });
  document.getElementById('level-modal-list').addEventListener('dblclick', async e => {
    const item = e.target.closest('.level-list-item');
    if (!item) return;
    closeLevelModal();
    await loadLevel(item.dataset.level);
  });

  // Transform mode buttons
  document.getElementById('btn-move').addEventListener('click',   () => setTransformMode('translate'));
  document.getElementById('btn-rotate').addEventListener('click', () => setTransformMode('rotate'));
  document.getElementById('btn-scale').addEventListener('click',  () => setTransformMode('scale'));

  // Toolbar toggles
  document.getElementById('btn-grid').addEventListener('click', () => {
    E.showGrid = !E.showGrid;
    E.gridHelper.visible = E.showGrid;
    document.getElementById('btn-grid').classList.toggle('active', E.showGrid);
  });
  document.getElementById('btn-colliders').addEventListener('click', () => {
    E.showColliders = !E.showColliders;
    document.getElementById('btn-colliders').classList.toggle('active', E.showColliders);
    updateColliderHelpers();
  });

  document.getElementById('btn-preview-lighting').addEventListener('click', () => {
    E.previewLighting = !E.previewLighting;
    document.getElementById('btn-preview-lighting').classList.toggle('active', E.previewLighting);
    applyLightingMode();
  });

  function applyLightingMode() {
    const preview = E.previewLighting;
    // Swap ambient lights
    const editorAmbient  = E.scene.getObjectByName('__editorAmbient__');
    const editorSun      = E.scene.getObjectByName('__editorSun__');
    const previewAmbient = E.scene.getObjectByName('__previewAmbient__');
    if (editorAmbient)  editorAmbient.visible  = !preview;
    if (editorSun)      editorSun.visible       = !preview;
    if (previewAmbient) previewAmbient.visible  =  preview;

    // Tone mapping — match game's ACESFilmic exposure 1.4 vs flat editor look
    E.renderer.toneMapping         = preview ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    E.renderer.toneMappingExposure = preview ? 1.4 : 1.0;

    // Background and fog
    if (preview) {
      E.scene.background = new THREE.Color(0x000000);
      E.scene.fog        = new THREE.FogExp2(0x000000, 0.1);
    } else {
      E.scene.background = null;
      E.scene.fog        = null;
    }

    // Force material updates so tone-mapping change takes effect immediately
    E.scene.traverse(obj => { if (obj.isMesh && obj.material) obj.material.needsUpdate = true; });

    // Show/hide range wires on all placed lights
    E.placedGroup.children.forEach(obj => {
      if (!obj.userData.isLightGroup) return;
      const wire = obj.getObjectByName('__rangeWire__');
      if (wire) wire.visible = !preview;
    });
  }

  // Primitives palette
  document.querySelectorAll('.prim-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!E.levelName) { setStatus('Open or create a level first'); return; }
      const type = btn.dataset.prim;
      if (E.placingType === type) { cancelPlace(); return; }
      document.querySelectorAll('.prim-btn, .model-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      beginPlace(type);
    });
  });

  // Import model
  document.getElementById('btn-import-model').addEventListener('click', async () => {
    if (!window.electron) { setStatus('Model import requires Electron'); return; }
    const p = await window.electron.importModel();
    if (p) {
      await refreshModelList();
      // Auto-activate placement for the newly imported model
      if (E.levelName) {
        document.querySelectorAll('.prim-btn, .model-item').forEach(b => b.classList.remove('active'));
        // Find and highlight the matching model-item
        document.querySelectorAll('.model-item').forEach(el => {
          if (el.title === p) el.classList.add('active');
        });
        beginPlace('model:' + p);
        setStatus(`Imported "${p.split(/[\\/]/).pop()}" — click in viewport to place`);
      } else {
        setStatus(`Imported: ${p.split(/[\\/]/).pop()} — open a level to place it`);
      }
    }
  });

  // Right-panel property inputs - live sync to selected object
  function bindProp(id, apply) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('focus', () => { if (E.selected) pushUndo(); });
    const cb = () => { if (E.selected) { apply(parseFloat(el.value) || 0); markDirty(); } };
    el.addEventListener('input',  cb);
    el.addEventListener('change', cb);
  }
  bindProp('px', v => E.selected.position.x = v);
  bindProp('py', v => E.selected.position.y = v);
  bindProp('pz', v => E.selected.position.z = v);
  bindProp('sx', v => E.selected.scale.x = Math.max(0.001, v));
  bindProp('sy', v => E.selected.scale.y = Math.max(0.001, v));
  bindProp('sz', v => E.selected.scale.z = Math.max(0.001, v));
  bindProp('rx', v => E.selected.rotation.x = v * RAD);
  bindProp('ry', v => E.selected.rotation.y = v * RAD);
  bindProp('rz', v => E.selected.rotation.z = v * RAD);

  document.getElementById('obj-color').addEventListener('focus', () => { if (E.selected) pushUndo(); });
  document.getElementById('obj-color').addEventListener('input', e => {
    if (!E.selected) return;
    if (isLightType(E.selected.userData.primType)) {
      // Update light color
      E.selected.userData.lightColor = e.target.value;
      const col = new THREE.Color(e.target.value);
      E.selected.traverse(c => {
        if (c.isLight) c.color.set(col);
        if (c.isMesh && c.material) c.material.color.set(col);
        if ((c.isLine || c.isLineSegments) && c.material) c.material.color.set(col);
      });
      markDirty();
    } else if (E.selected?.material?.color) {
      E.selected.material.color.set(e.target.value); markDirty();
    }
  });
  document.getElementById('chk-collidable').addEventListener('mousedown', () => { if (E.selected) pushUndo(); });
  document.getElementById('chk-collidable').addEventListener('change', e => {
    if (E.selected) { E.selected.userData.collidable = e.target.checked; markDirty(); }
  });
  document.getElementById('chk-shadow').addEventListener('mousedown', () => { if (E.selected) pushUndo(); });
  document.getElementById('chk-shadow').addEventListener('change', e => {
    if (!E.selected) return;
    if (isLightType(E.selected.userData.primType)) {
      E.selected.userData.castShadow = e.target.checked;
      E.selected.traverse(c => { if (c.isLight) c.castShadow = e.target.checked; });
    } else {
      const v = e.target.checked;
      E.selected.userData.castShadow = v;
      E.selected.castShadow = v;
      E.selected.traverse(c => { if (c.isMesh) c.castShadow = v; });
    }
    markDirty();
  });
  document.getElementById('obj-emissive-color')?.addEventListener('focus', () => { if (E.selected) pushUndo(); });
  document.getElementById('obj-emissive-color')?.addEventListener('input', e => {
    if (!E.selected) return;
    E.selected.userData.emissiveColor = e.target.value;
    const col = new THREE.Color(e.target.value);
    E.selected.traverse(c => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { if ('emissive' in m) m.emissive.copy(col); });
      }
    });
    markDirty();
  });
  document.getElementById('obj-emissive-intensity')?.addEventListener('focus', () => { if (E.selected) pushUndo(); });
  document.getElementById('obj-emissive-intensity')?.addEventListener('input', e => {
    if (!E.selected) return;
    const v = parseFloat(e.target.value) || 0;
    E.selected.userData.emissiveIntensity = v;
    E.selected.traverse(c => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { if ('emissiveIntensity' in m) m.emissiveIntensity = v; });
      }
    });
    markDirty();
  });
  document.getElementById('obj-roughness')?.addEventListener('focus', () => { if (E.selected) pushUndo(); });
  document.getElementById('obj-roughness')?.addEventListener('input', e => {
    if (!E.selected) return;
    const v = Math.max(0, Math.min(1, parseFloat(e.target.value) ?? 1));
    E.selected.userData.roughness = v;
    E.selected.traverse(c => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { if ('roughness' in m) { m.roughness = v; m.needsUpdate = true; } });
      }
    });
    markDirty();
  });
  document.getElementById('obj-metalness')?.addEventListener('focus', () => { if (E.selected) pushUndo(); });
  document.getElementById('obj-metalness')?.addEventListener('input', e => {
    if (!E.selected) return;
    const v = Math.max(0, Math.min(1, parseFloat(e.target.value) ?? 0));
    E.selected.userData.metalness = v;
    E.selected.traverse(c => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { if ('metalness' in m) { m.metalness = v; m.needsUpdate = true; } });
      }
    });
    markDirty();
  });
  document.getElementById('obj-opacity')?.addEventListener('focus', () => { if (E.selected) pushUndo(); });
  document.getElementById('obj-opacity')?.addEventListener('input', e => {
    if (!E.selected || !E.selected.material) return;
    const parsed = parseFloat(e.target.value);
    const v = Math.max(0, Math.min(1, isNaN(parsed) ? 1 : parsed));
    E.selected.userData._opacity = v < 1 ? v : undefined;
    setMeshOpacity(E.selected, v);
    syncOpacityWireframe(E.selected);
    markDirty();
  });

  // ─── Geometry param inputs ──────────────────────────────────────────────────
  function setGeomParam(key, rawVal, isCheckbox) {
    const obj = E.selected;
    if (!obj || !GEOM_DEFAULTS[obj.userData.primType]) return;
    if (!obj.userData.geomParams) obj.userData.geomParams = {};
    obj.userData.geomParams[key] = isCheckbox ? rawVal : (parseFloat(rawVal) || 0);
    rebuildGeometry(obj);
    // If per-face textures exist, re-apply since the geometry groups are the same
    if (obj.userData.faceTextures) applyFaceTextures(obj);
  }
  const geomBindings = [
    // [inputId, paramKey, isCheckbox]
    ['geom-bevel',      'bevel',    false],
    ['geom-bevel-segs', 'bevelSegs',false],
    ['geom-box-ws',     'wSegs',    false],
    ['geom-box-hs',     'hSegs',    false],
    ['geom-box-ds',     'dSegs',    false],
    ['geom-sph-ws',     'wSegs',    false],
    ['geom-sph-hs',     'hSegs',    false],
    ['geom-sph-phi',    'phi',      false],
    ['geom-sph-theta',  'theta',    false],
    ['geom-cyl-rs',     'radSegs',  false],
    ['geom-cyl-hs',     'hSegs',    false],
    ['geom-cyl-rt',     'radTop',   false],
    ['geom-cyl-open',   'open',     true],
    ['geom-plane-ws',   'wSegs',    false],
    ['geom-plane-hs',   'hSegs',    false],
  ];
  geomBindings.forEach(([id, key, isChk]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const ev = isChk ? 'change' : 'change';
    el.addEventListener(ev, () => setGeomParam(key, isChk ? el.checked : el.value, isChk));
  });

  // Save trigger inputs
  document.getElementById('trigger-slot')?.addEventListener('input', e => {
    if (E.selected && E.selected.userData.primType === 'save-trigger') {
      E.selected.userData.saveSlot = e.target.value.trim() || 'autosave'; markDirty();
    }
  });
  document.getElementById('trigger-once')?.addEventListener('change', e => {
    if (E.selected && E.selected.userData.primType === 'save-trigger') {
      E.selected.userData.onceOnly = e.target.checked; markDirty();
    }
  });
  document.getElementById('trigger-var-name')?.addEventListener('change', e => {
    if (E.selected && E.selected.userData.primType === 'custom-trigger') {
      E.selected.userData.triggerVar = e.target.value; markDirty();
    }
  });
  document.getElementById('trigger-var-op')?.addEventListener('change', e => {
    if (E.selected && E.selected.userData.primType === 'custom-trigger') {
      E.selected.userData.triggerVarOp = e.target.value; markDirty();
    }
  });
  document.getElementById('trigger-var-value')?.addEventListener('change', e => {
    if (E.selected && E.selected.userData.primType === 'custom-trigger') {
      E.selected.userData.triggerVarValue = e.target.value; markDirty();
    }
  });

  // Light property inputs
  function applyLightParam(param, getValue) {
    return () => {
      if (!E.selected || !isLightType(E.selected.userData.primType)) return;
      const val = getValue();
      E.selected.userData[param] = val;
      E.selected.traverse(child => {
        if (!child.isLight) return;
        if (param === 'intensity') child.intensity = val;
        else if (param === 'distance' && child.distance !== undefined) child.distance = val;
        else if (param === 'decay'    && child.decay    !== undefined) child.decay    = val;
        else if (param === 'angle'    && child.angle    !== undefined) child.angle    = THREE.MathUtils.degToRad(val);
        else if (param === 'penumbra' && child.penumbra !== undefined) child.penumbra = val;
      });
      // Rebuild range wire if shape-defining params change
      if (param === 'distance' || param === 'angle') updateLightRangeHelper(E.selected);
      markDirty();
    };
  }
  function bindLightProp(id, param, parseFn = parseFloat) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('focus', () => { if (E.selected) pushUndo(); });
    const fn = applyLightParam(param, () => parseFn(el.value) || 0);
    el.addEventListener('input', fn);
    el.addEventListener('change', fn);
  }
  bindLightProp('light-intensity', 'intensity');
  bindLightProp('light-distance',  'distance');
  bindLightProp('light-angle',     'angle');
  bindLightProp('light-penumbra',  'penumbra');
  bindLightProp('light-decay',     'decay');

  // ─── Texture panel wiring ──────────────────────────────────────────────────
  // Import texture
  document.getElementById('btn-import-tex')?.addEventListener('click', async () => {
    if (!window.electron?.importTexture) return;
    const name = await window.electron.importTexture();
    if (!name) return;
    await refreshTextureList();
    const el = document.getElementById('tex-name');
    if (el) el.value = name;
    applyCurrentFaceConfig();
    setStatus(`Texture "${name}" imported`);
  });

  // Face dropdown
  document.getElementById('tex-face')?.addEventListener('change', e => {
    const val = e.target.value;
    E.selectedFace = val === 'all' ? null : parseInt(val);
    updateFaceHighlight(E.selected, E.selectedFace);
    refreshTexPanel(E.selected);
  });

  // Pick face button
  document.getElementById('btn-pick-face')?.addEventListener('click', () => {
    E.facePickMode ? cancelFacePick() : beginFacePick();
  });

  // Texture name (apply on change/datalist pick)
  const texNameEl = document.getElementById('tex-name');
  if (texNameEl) {
    texNameEl.addEventListener('change', applyCurrentFaceConfig);
    texNameEl.addEventListener('input', () => {
      if (E.availableTextures.includes(texNameEl.value)) applyCurrentFaceConfig();
    });
  }

  // Tiling mode
  document.getElementById('tex-tiling-mode')?.addEventListener('change', e => {
    _syncTilingModeUI(e.target.value);
    applyCurrentFaceConfig();
  });

  // Repeat, world scale, offset, wrap — all trigger applyCurrentFaceConfig
  ['tex-repeat-x','tex-repeat-y','tex-world-scale','tex-offset-x','tex-offset-y','tex-wrap'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', applyCurrentFaceConfig);
  });

  // Clear texture
  document.getElementById('btn-clear-tex')?.addEventListener('click', () => {
    const el = document.getElementById('tex-name');
    if (el) el.value = '';
    applyCurrentFaceConfig();
  });

  // Edit UV button
  document.getElementById('btn-uv-edit')?.addEventListener('click', openUVEditor);

  // Edit Meshes button + mesh modal wiring
  document.getElementById('btn-mesh-edit')?.addEventListener('click', openMeshEditor);
  document.getElementById('btn-mesh-close')?.addEventListener('click', closeMeshEditor);

  makeDraggable('uv-modal', 'uv-modal-drag');
  makeDraggable('mesh-modal', 'mesh-modal-drag');
  makeDraggable('sound-list-modal', 'sound-list-modal-drag');
  makeDraggable('actor-mesh-modal', 'actor-mesh-modal-drag');

  document.getElementById('btn-sound-list-close')?.addEventListener('click', closeSoundListModal);

  // UV modal wiring
  document.getElementById('btn-uv-close')?.addEventListener('click', closeUVEditor);
  document.getElementById('btn-uv-apply')?.addEventListener('click', () => {
    const obj = E.selected;
    if (!obj) { closeUVEditor(); return; }
    const faceKey = E.selectedFace !== null ? String(E.selectedFace) : 'all';
    const existing = getFaceConfig(obj, faceKey) ?? {};
    existing.ox = parseFloat(document.getElementById('uv-ox').value) || 0;
    existing.oy = parseFloat(document.getElementById('uv-oy').value) || 0;
    existing.rx = Math.max(0.01, parseFloat(document.getElementById('uv-rx').value) || 1);
    existing.ry = Math.max(0.01, parseFloat(document.getElementById('uv-ry').value) || 1);
    setFaceConfig(obj, faceKey, existing);
    // Sync panel inputs too
    document.getElementById('tex-repeat-x').value = existing.rx.toFixed(2);
    document.getElementById('tex-repeat-y').value = existing.ry.toFixed(2);
    document.getElementById('tex-offset-x').value = existing.ox.toFixed(3);
    document.getElementById('tex-offset-y').value = existing.oy.toFixed(3);
    closeUVEditor();
  });

  // Click outside UV modal to close
  document.getElementById('uv-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('uv-modal')) closeUVEditor();
  });

  // UV canvas drag
  _setupUVCanvasDrag();

  document.getElementById('obj-label').addEventListener('focus', () => { if (E.selected) pushUndo(); });
  document.getElementById('obj-label').addEventListener('input', e => {
    if (!E.selected) return;
    E.selected.userData.label = e.target.value;
    E.selected.name = e.target.value || (E.selected.userData.primType + '_' + E.selected.userData.editorId);
    document.getElementById('sel-name').textContent = E.selected.name;
    updateSceneList(); markDirty();
  });

  // Groups
  const groupNameRow    = document.getElementById('group-name-row');
  const groupNameInput  = document.getElementById('group-name-input');
  const groupPickRow    = document.getElementById('group-pick-row');
  const groupPickSelect = document.getElementById('group-pick-select');

  function hideGroupInputs() {
    groupNameRow.style.display  = 'none';
    groupPickRow.style.display  = 'none';
    groupNameInput.value = '';
  }

  document.getElementById('btn-new-group').addEventListener('click', () => {
    hideGroupInputs();
    groupNameRow.style.display = '';
    groupNameInput.focus();
  });

  function commitNewGroup() {
    const name = groupNameInput.value.trim();
    hideGroupInputs();
    if (!name) return;
    const gid = 'g_' + Date.now();
    E.groups[gid] = { name, ids: new Set() };
    if (E.selected) {
      E.groups[gid].ids.add(E.selected.userData.editorId);
      setGroupDisplay(gid);
    }
    updateGroupsPanel(); markDirty();
  }
  document.getElementById('group-name-ok').addEventListener('click', commitNewGroup);
  document.getElementById('group-name-cancel').addEventListener('click', hideGroupInputs);
  groupNameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.stopPropagation(); commitNewGroup(); }
    if (e.key === 'Escape') { e.stopPropagation(); hideGroupInputs(); }
  });

  document.getElementById('btn-add-to-group').addEventListener('click', () => {
    if (!E.selected) { setStatus('Select an object first'); return; }
    const gids = Object.keys(E.groups);
    if (!gids.length) { setStatus('No groups yet — create one first'); return; }
    hideGroupInputs();
    groupPickSelect.innerHTML = '';
    gids.forEach(gid => {
      const opt = document.createElement('option');
      opt.value = gid;
      opt.textContent = E.groups[gid].name;
      groupPickSelect.appendChild(opt);
    });
    groupPickRow.style.display = '';
  });

  function commitAddToGroup() {
    const gid = groupPickSelect.value;
    hideGroupInputs();
    if (!gid || !E.groups[gid] || !E.selected) return;
    E.groups[gid].ids.add(E.selected.userData.editorId);
    setGroupDisplay(gid); updateGroupsPanel(); markDirty();
  }
  document.getElementById('group-pick-ok').addEventListener('click', commitAddToGroup);
  document.getElementById('group-pick-cancel').addEventListener('click', hideGroupInputs);
  document.getElementById('btn-move-group').addEventListener('click', () => {
    beginGroupTransform(findGroupOfObj(E.selected));
  });
  document.getElementById('btn-ungroup').addEventListener('click', () => {
    if (!E.selected) return;
    const id = E.selected.userData.editorId;
    for (const g of Object.values(E.groups)) g.ids.delete(id);
    for (const gid of Object.keys(E.groups)) { if (E.groups[gid].ids.size === 0) delete E.groups[gid]; }
    setGroupDisplay(null); updateGroupsPanel(); markDirty();
  });

  document.getElementById('btn-clone-group').addEventListener('click', () => {
    if (!E.selected) { setStatus('Select a member of the group to clone'); return; }
    const gid = findGroupOfObj(E.selected);
    if (!gid) { setStatus('Selected object is not in a group'); return; }
    cloneGroup(gid);
  });

  document.getElementById('btn-toggle-groups-panel').addEventListener('click', () => {
    const p = document.getElementById('groups-panel');
    const open = p.style.display !== 'none';
    p.style.display = open ? 'none' : '';
    document.getElementById('btn-toggle-groups-panel').textContent = open ? '>' : 'v';
  });

  // Actions
  document.getElementById('btn-clone').addEventListener('click', cloneSelected);
  document.getElementById('btn-del').addEventListener('click', deleteSelected);
  document.getElementById('btn-cut').addEventListener('click', () => {
    if (E.cutMode) cancelCut();
    else beginCut();
  });
  document.getElementById('btn-set-pivot').addEventListener('click', () => {
    if (E.pivotMode) cancelPivot();
    else beginPivot();
  });
  document.getElementById('btn-reset-pivot').addEventListener('click', resetPivot);
  document.getElementById('btn-merge').addEventListener('click', openMergeDialog);
  document.getElementById('btn-merge-confirm').addEventListener('click', executeMerge);
  document.getElementById('btn-merge-modal-close').addEventListener('click', closeMergeDialog);

  // Scene list collapse
  document.getElementById('btn-toggle-scene-list').addEventListener('click', () => {
    const wrap = document.getElementById('scene-list-wrap');
    const open = wrap.style.display !== 'none';
    wrap.style.display = open ? 'none' : '';
    document.getElementById('btn-toggle-scene-list').textContent = open ? '>' : 'v';
  });

  // Actor import
  document.getElementById('btn-import-actor')?.addEventListener('click', async () => {
    if (!window.electron?.importActor) { setStatus('Actor import requires Electron'); return; }
    const p = await window.electron.importActor();
    if (p) {
      await refreshActorList();
      setStatus(`Imported actor: ${p.split(/[\\/]/).pop()}`);
    }
  });

  // Actor spawn property inputs
  document.getElementById('actor-spawn-radius')?.addEventListener('focus', () => { if (E.selected) pushUndo(); });
  document.getElementById('actor-spawn-radius')?.addEventListener('input', e => {
    if (E.selected?.userData.primType === 'actor-spawn') {
      E.selected.userData.spawnRadius = parseFloat(e.target.value) || 0;
      markDirty();
    }
  });
  document.getElementById('actor-persistent')?.addEventListener('change', e => {
    if (E.selected?.userData.primType === 'actor-spawn') {
      E.selected.userData.persistent = e.target.checked;
      markDirty();
    }
  });
  document.getElementById('actor-single-instance')?.addEventListener('change', e => {
    if (E.selected?.userData.primType === 'actor-spawn') {
      E.selected.userData.singleInstance = e.target.checked;
      markDirty();
    }
  });

  // Actor modal buttons
  document.getElementById('btn-actor-mesh-edit')?.addEventListener('click', openActorMeshEditor);
  document.getElementById('btn-actor-anims')?.addEventListener('click', openActorAnimsModal);
  document.getElementById('btn-actor-mesh-close')?.addEventListener('click', closeActorMeshEditor);
  document.getElementById('btn-actor-anims-close')?.addEventListener('click', closeActorAnimsModal);
  document.getElementById('btn-actor-import-anim')?.addEventListener('click', async () => {
    const obj = E.selected;
    if (!obj || obj.userData.primType !== 'actor-spawn') return;
    if (!window.electron?.importActorAnim) return;
    const filePath = await window.electron.importActorAnim(obj.userData.actorModel);
    if (!filePath) return;
    if (!obj.userData.animations) obj.userData.animations = [];
    const clipName = filePath.split('/').pop().replace(/\.[^.]+$/, '');
    obj.userData.animations.push({ name: clipName, file: filePath });
    _refreshActorAnimsList(obj);
    markDirty();
  });
  document.getElementById('btn-actor-ai')?.addEventListener('click', () => {
    document.getElementById('actor-ai-modal').style.display = '';
  });
  document.getElementById('btn-actor-pathfinding')?.addEventListener('click', () => {
    document.getElementById('actor-pathfinding-modal').style.display = '';
  });
  document.getElementById('btn-actor-ai-close')?.addEventListener('click', () => {
    document.getElementById('actor-ai-modal').style.display = 'none';
  });
  document.getElementById('btn-actor-pathfinding-close')?.addEventListener('click', () => {
    document.getElementById('actor-pathfinding-modal').style.display = 'none';
  });

  window.addEventListener('resize', resizeRenderer);
}

function setTransformMode(mode) {
  E.transform.setMode(mode);
  document.getElementById('btn-move').classList.toggle('active',   mode === 'translate');
  document.getElementById('btn-rotate').classList.toggle('active', mode === 'rotate');
  document.getElementById('btn-scale').classList.toggle('active',  mode === 'scale');
  updateTransformSnap(); // re-evaluate snap for new mode
}

// Update TransformControls translation snap based on Ctrl key state.
// Called on keydown, keyup, and mode change.
function updateTransformSnap() {
  const ctrl = E.keys['ControlLeft'] || E.keys['ControlRight'];
  E.transform.setTranslationSnap(ctrl ? 0.25 : null);
}

// Snap obj's nearest face to the nearest face of any other placed mesh (Alt-snap).
// Each axis is evaluated independently so e.g. floor-snap (Y) doesn't block wall-snap (X).
function snapToNearestFace(obj) {
  const THRESHOLD = 0.35;
  const box = new THREE.Box3().setFromObject(obj);
  const best = { x: null, y: null, z: null };

  E.placedGroup.children.forEach(other => {
    if (other === obj || other.userData.isEditorHelper || other.userData.isLightGroup) return;
    const otherBox = new THREE.Box3().setFromObject(other);
    ['x','y','z'].forEach(axis => {
      const perp = axis === 'x' ? ['y','z'] : axis === 'y' ? ['x','z'] : ['x','y'];
      // Only snap faces that actually overlap in the perpendicular axes
      if (box.max[perp[0]] <= otherBox.min[perp[0]] || box.min[perp[0]] >= otherBox.max[perp[0]]) return;
      if (box.max[perp[1]] <= otherBox.min[perp[1]] || box.min[perp[1]] >= otherBox.max[perp[1]]) return;
      // selected +face vs other -face
      const d1 = Math.abs(box.max[axis] - otherBox.min[axis]);
      if (d1 < THRESHOLD && (!best[axis] || d1 < best[axis].dist))
        best[axis] = { delta: otherBox.min[axis] - box.max[axis], dist: d1 };
      // selected -face vs other +face
      const d2 = Math.abs(box.min[axis] - otherBox.max[axis]);
      if (d2 < THRESHOLD && (!best[axis] || d2 < best[axis].dist))
        best[axis] = { delta: otherBox.max[axis] - box.min[axis], dist: d2 };
    });
  });

  let snapped = false;
  ['x','y','z'].forEach(axis => {
    if (best[axis]) { obj.position[axis] += best[axis].delta; snapped = true; }
  });
  if (snapped) obj.updateMatrixWorld(true);
}

// â”€â”€â”€ Collider helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateColliderHelpers() {
  E.colHelpers.forEach(h => E.scene.remove(h));
  E.colHelpers = [];
  if (!E.showColliders) return;
  E.placedGroup.children.forEach(obj => {
    if (!obj.userData.collidable || obj.userData.isEditorHelper || obj.userData.isLightGroup) return;
    const h = new THREE.BoxHelper(obj, 0x00ffcc);
    h.userData.isEditorHelper = true;
    E.scene.add(h);
    E.colHelpers.push(h);
  });
}

// â”€â”€â”€ Keyboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setupKeys() {
  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.code === 'KeyS')                         { e.preventDefault(); saveLevel(); return; }
    if (e.ctrlKey && !e.shiftKey && e.code === 'KeyZ')          { e.preventDefault(); undo(); return; }
    if (e.ctrlKey && (e.shiftKey && e.code === 'KeyZ' || e.code === 'KeyY')) { e.preventDefault(); redo(); return; }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') e.preventDefault(); // prevent page scroll
    E.keys[e.code] = true;

    if (e.ctrlKey && e.code === 'KeyD')                         { e.preventDefault(); cloneSelected(); return; }

    if (e.ctrlKey && e.code === 'KeyW') { e.preventDefault(); setTransformMode('translate'); return; }
    if (e.ctrlKey && e.code === 'KeyE') { e.preventDefault(); setTransformMode('rotate');    return; }
    if (e.ctrlKey && e.code === 'KeyR') { e.preventDefault(); setTransformMode('scale');     return; }

    if (e.code === 'KeyG') {
      if (E.groupPivot) finalizeGroupTransform();
      else { const gid = findGroupOfObj(E.selected); if (gid) beginGroupTransform(gid); }
    }

    if (e.code === 'KeyX') {
      if (E.cutMode) cancelCut();
      else beginCut();
    }

    if (e.code === 'Delete' || e.code === 'Backspace') deleteSelected();

    if (e.code === 'Escape') {
      if (E.facePickMode){ cancelFacePick(); return; }
      if (E.pivotMode)   { cancelPivot(); return; }
      if (E.linkMode)    { cancelLink(); return; }
      if (E.cutMode)     { cancelCut(); return; }
      if (E.placingType) { cancelPlace(); return; }
      if (E.groupPivot)  { finalizeGroupTransform(); return; }
      deselect();
    }
    updateTransformSnap();
  });
  window.addEventListener('keyup', e => {
    delete E.keys[e.code];
    updateTransformSnap();
  });
}

// â”€â”€â”€ Mouse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _ray  = new THREE.Raycaster();
const _ndcM = new THREE.Vector2();

function mouseToNDC(e) {
  const vp   = document.getElementById('viewport');
  const rect = vp.getBoundingClientRect();
  _ndcM.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  _ndcM.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
}

function worldFromMouse(e) {
  mouseToNDC(e);
  _ray.setFromCamera(_ndcM, E.camera);
  const hits = _ray.intersectObject(E.floorPlane);
  if (hits.length) return hits[0].point.clone();
  // fallback if camera is looking straight down
  const dir = _ray.ray.direction, o = _ray.ray.origin;
  const t = -o.y / dir.y;
  return t > 0 ? o.clone().addScaledVector(dir, t) : null;
}

function setupMouse() {
  const vp = document.getElementById('viewport');

  vp.addEventListener('mousemove', e => {
    if (!E.ghostMesh) return;
    const pos = worldFromMouse(e);
    if (pos) {
      E.ghostMesh.position.set(
        Math.round(pos.x * 4) / 4,
        0.5,      // slightly above floor
        Math.round(pos.z * 4) / 4
      );
    }
  });

  vp.addEventListener('click', e => {
    if (e.button !== 0) return;

    // Placement commit
    if (E.placingType) {
      const pos = worldFromMouse(e);
      if (pos) commitPlace(new THREE.Vector3(
        Math.round(pos.x * 4) / 4, 0,
        Math.round(pos.z * 4) / 4
      ));
      return;
    }

    if (E.wasDragging) return;

    // Selection - only placed objects, not ref
    mouseToNDC(e);
    _ray.setFromCamera(_ndcM, E.camera);
    const candidates = [];
    E.placedGroup.traverse(o => { if (o.isMesh && !o.userData.isEditorHelper) candidates.push(o); });
    // When group pivot is active its members live under E.groupPivot, not E.placedGroup.
    if (E.groupPivot) E.groupPivot.traverse(o => { if (o.isMesh && !o.userData.isEditorHelper) candidates.push(o); });
    const hits = _ray.intersectObjects(candidates, false);

    // Link mode — click target to wire to link source
    if (E.linkMode) {
      if (hits.length) {
        let obj = hits[0].object;
        while (obj.parent && obj.parent !== E.placedGroup) obj = obj.parent;
        if (obj !== E.linkSource) {
          const targetId = obj.userData.editorId;
          if (targetId !== undefined) {
            if (!E.linkSource.userData.links) E.linkSource.userData.links = [];
            if (!E.linkSource.userData.links.includes(targetId)) {
              E.linkSource.userData.links.push(targetId);
              markDirty();
            }
            renderLinksPanel(E.linkSource);
          }
          cancelLink();
          return;
        }
      }
      setStatus('Click a different object to link to it \u2014 Esc cancels');
      return;
    }

    // Face pick mode — click the selected object to pick a face
    if (E.facePickMode && E.selected) {
      const faceHits = _ray.intersectObject(E.selected, false);
      if (faceHits.length) {
        const hit = faceHits[0];
        const faceIdx = hit.face?.materialIndex ?? 0;
        applyFacePick(faceIdx);
      } else {
        setStatus('Click a face on the selected box - Esc cancels');
      }
      return;
    }

    // Pivot mode — click any surface to define pivot point
    if (E.pivotMode) {
      // Raycast against ALL placed meshes and the floor
      const allCandidates = [];
      E.placedGroup.traverse(o => { if (o.isMesh && !o.userData.isEditorHelper) allCandidates.push(o); });
      allCandidates.push(E.floorPlane);
      const pivotHits = _ray.intersectObjects(allCandidates, false);
      if (pivotHits.length) {
        applyPivot(pivotHits[0].point);
      } else {
        setStatus('Pivot mode — click any surface to set pivot (Esc cancels)');
      }
      return;
    }

    // Cut mode — click target to subtract cutter from it
    if (E.cutMode) {
      if (hits.length) {
        let obj = hits[0].object;
        while (obj.parent && obj.parent !== E.placedGroup) obj = obj.parent;
        if (obj !== E.cutSource) { performCut(obj); return; }
      }
      setStatus('Click a different object to cut into it \u2014 Esc cancels');
      return;
    }

    // Normal selection
    if (hits.length) {
      let obj = hits[0].object;
      // Walk up to the direct child of placedGroup OR groupPivot (whichever is immediate parent).
      while (obj.parent && obj.parent !== E.placedGroup && obj.parent !== E.groupPivot) obj = obj.parent;
      // If group mode is active and this object belongs to the active group, keep group mode
      // (i.e. the click is just acknowledging a group member — don't exit group mode).
      if (E.groupPivot && E.groupPivotMembers.includes(obj)) {
        // Stay in group mode; nothing to do
      } else {
        selectObj(obj);
      }
    } else {
      deselect();
    }
  });
}

// â”€â”€â”€ WASD camera pan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateCameraPan(delta) {
  // Don't pan while typing in inputs
  if (document.activeElement?.tagName === 'INPUT') return;
  const speed = E.panSpeed;  // Space/Shift handle up/down; no sprint modifier needed
  const fwd = new THREE.Vector3();
  E.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, E.camera.up).normalize();
  const pan = (dir, s) => { E.camera.position.addScaledVector(dir, s); E.orbit.target.addScaledVector(dir, s); };

  if (E.keys['KeyA']) pan(right, -speed * delta);
  if (E.keys['KeyD']) pan(right,  speed * delta);
  if (E.keys['KeyW']) pan(fwd,    speed * delta);
  if (E.keys['KeyS']) pan(fwd,   -speed * delta);
  if (E.keys['Space'])      { E.camera.position.y += speed * delta; E.orbit.target.y += speed * delta; }
  if (E.keys['ShiftLeft'] || E.keys['ShiftRight']) { E.camera.position.y -= speed * delta; E.orbit.target.y -= speed * delta; }
}

// â”€â”€â”€ Animate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function animate(now = 0) {
  requestAnimationFrame(animate);
  const delta = Math.min((now - E.lastTime) / 1000, 0.1);
  E.lastTime = now;

  updateCameraPan(delta);
  _updatePivotDot();
  // Keep player origin dot tracking camera XZ at ground level
  const originDot   = E.scene.getObjectByName('__playerOrigin__');
  const originCross = E.scene.getObjectByName('__playerOriginCross__');
  if (originDot || originCross) {
    const cx = E.camera.position.x;
    const cz = E.camera.position.z;
    if (originDot)   originDot.position.set(cx, 0, cz);
    if (originCross) originCross.position.set(cx, 0, cz);
  }
  E.orbit.update();
  E.colHelpers.forEach(h => h.update());
  E.renderer.render(E.scene, E.camera);
}

// â”€â”€â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function initEditor() { return init().catch(console.error); }



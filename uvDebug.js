// uvDebug.js - Debug tool to visualize UV mapping and detect rotated regions
import * as THREE from 'three';
import { gameState } from './globals.js';

let _debugTarget = null;
let _originalMaterial = null;
export function setUVDebugTarget(mesh) { _debugTarget = mesh; _originalMaterial = null; }

let debugMode = false;
let uvVisualizationMaterial = null;

// Create a UV checker pattern texture
function createUVCheckerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  
  // Draw UV grid
  const gridSize = 8;
  const cellSize = canvas.width / gridSize;
  
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      // Checkerboard pattern
      const isLight = (x + y) % 2 === 0;
      ctx.fillStyle = isLight ? '#ffffff' : '#000000';
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      
      // Draw UV coordinates
      ctx.fillStyle = isLight ? '#ff0000' : '#00ff00';
      ctx.font = '20px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const u = (x / gridSize).toFixed(2);
      const v = (1 - y / gridSize).toFixed(2); // Flip V
      ctx.fillText(`${u},${v}`, x * cellSize + cellSize / 2, y * cellSize + cellSize / 2);
      
      // Draw arrows to show orientation
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 3;
      ctx.beginPath();
      // Horizontal arrow (U direction)
      ctx.moveTo(x * cellSize + 10, y * cellSize + cellSize - 30);
      ctx.lineTo(x * cellSize + 40, y * cellSize + cellSize - 30);
      ctx.lineTo(x * cellSize + 35, y * cellSize + cellSize - 35);
      ctx.moveTo(x * cellSize + 40, y * cellSize + cellSize - 30);
      ctx.lineTo(x * cellSize + 35, y * cellSize + cellSize - 25);
      ctx.stroke();
      
      // Vertical arrow (V direction)
      ctx.strokeStyle = '#0000ff';
      ctx.beginPath();
      ctx.moveTo(x * cellSize + cellSize - 30, y * cellSize + cellSize - 10);
      ctx.lineTo(x * cellSize + cellSize - 30, y * cellSize + cellSize - 40);
      ctx.lineTo(x * cellSize + cellSize - 35, y * cellSize + cellSize - 35);
      ctx.moveTo(x * cellSize + cellSize - 30, y * cellSize + cellSize - 40);
      ctx.lineTo(x * cellSize + cellSize - 25, y * cellSize + cellSize - 35);
      ctx.stroke();
    }
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Toggle UV debug visualization
export function toggleUVDebug() {
  debugMode = !debugMode;
  
  if (!_debugTarget) {
    console.log('No UV debug target set — call setUVDebugTarget(mesh) first');
    return;
  }
  
  if (debugMode) {
    if (!_originalMaterial && _debugTarget.material) {
      _originalMaterial = _debugTarget.material;
    }
    const uvTexture = createUVCheckerTexture();
    uvVisualizationMaterial = new THREE.MeshBasicMaterial({
      map: uvTexture,
      side: THREE.DoubleSide
    });
    _debugTarget.material = uvVisualizationMaterial;
    console.log('UV Debug Mode: ON');
    console.log('Red arrows = U direction, Blue arrows = V direction');
    console.log('Look for regions where arrows point in different directions than the rest');
  } else {
    if (_originalMaterial) {
      _debugTarget.material = _originalMaterial;
    }
    console.log('UV Debug Mode: OFF');
  }
}

// Click on mesh to see UV coordinates at that point
export function setupUVInspector() {
  const canvas = gameState.renderer.domElement;
  
  canvas.addEventListener('click', (event) => {
    if (!debugMode) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, gameState.camera);
    
    if (!_debugTarget) return;
    
    const intersects = raycaster.intersectObject(_debugTarget);
    if (intersects.length > 0) {
      const uv = intersects[0].uv;
      const point = intersects[0].point;
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Clicked UV:', {
        u: uv.x.toFixed(4),
        v: uv.y.toFixed(4)
      });
      console.log('World Position:', {
        x: point.x.toFixed(4),
        y: point.y.toFixed(4),
        z: point.z.toFixed(4)
      });
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
  });
}

// Analyze UV layout to detect rotated regions
export function analyzeUVLayout() {
  if (!_debugTarget) {
    console.log('No UV debug target set');
    return;
  }
  
  const geometry = _debugTarget.geometry;
  const uvAttribute = geometry.attributes.uv;
  
  if (!uvAttribute) {
    console.log('No UV attribute found');
    return;
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('UV Layout Analysis:');
  console.log('Total UV coordinates:', uvAttribute.count);
  
  // Find UV bounds
  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;
  
  const uvRegions = new Map(); // Group similar UV ranges
  
  for (let i = 0; i < uvAttribute.count; i++) {
    const u = uvAttribute.getX(i);
    const v = uvAttribute.getY(i);
    
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
    
    // Bucket UVs into regions
    const bucketU = Math.floor(u * 10) / 10;
    const bucketV = Math.floor(v * 10) / 10;
    const key = `${bucketU.toFixed(1)},${bucketV.toFixed(1)}`;
    
    uvRegions.set(key, (uvRegions.get(key) || 0) + 1);
  }
  
  console.log('UV Bounds:', {
    U: `${minU.toFixed(4)} to ${maxU.toFixed(4)}`,
    V: `${minV.toFixed(4)} to ${maxV.toFixed(4)}`
  });
  
  console.log('\nUV Region Density (buckets with >10 vertices):');
  const sortedRegions = Array.from(uvRegions.entries())
    .filter(([_, count]) => count > 10)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  
  sortedRegions.forEach(([coords, count]) => {
    console.log(`  ${coords}: ${count} vertices`);
  });
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// Auto-detect the rotated screen region by analyzing UV orientation
export function detectRotatedScreenBounds() {
  if (!_debugTarget) {
    console.log('No UV debug target set');
    return null;
  }
  
  const geometry = _debugTarget.geometry;
  const positionAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;
  const indexAttr = geometry.index;
  
  if (!positionAttr || !uvAttr) {
    console.log('Missing position or UV attributes');
    return null;
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Detecting rotated screen region...');
  
  const rotatedUVs = [];
  const normalUVs = [];
  
  // Helper to get vertex data
  const getVertex = (idx) => {
    return new THREE.Vector3(
      positionAttr.getX(idx),
      positionAttr.getY(idx),
      positionAttr.getZ(idx)
    );
  };
  
  const getUV = (idx) => {
    return new THREE.Vector2(
      uvAttr.getX(idx),
      uvAttr.getY(idx)
    );
  };
  
  // Analyze each triangle
  const triangleCount = indexAttr ? indexAttr.count / 3 : positionAttr.count / 3;
  
  for (let i = 0; i < triangleCount; i++) {
    let idx0, idx1, idx2;
    
    if (indexAttr) {
      idx0 = indexAttr.getX(i * 3);
      idx1 = indexAttr.getX(i * 3 + 1);
      idx2 = indexAttr.getX(i * 3 + 2);
    } else {
      idx0 = i * 3;
      idx1 = i * 3 + 1;
      idx2 = i * 3 + 2;
    }
    
    // Get world space positions
    const v0 = getVertex(idx0);
    const v1 = getVertex(idx1);
    const v2 = getVertex(idx2);
    
    // Get UV coordinates
    const uv0 = getUV(idx0);
    const uv1 = getUV(idx1);
    const uv2 = getUV(idx2);
    
    // Skip triangles outside the reasonable screen area (0.5-1.0 range)
    const avgU = (uv0.x + uv1.x + uv2.x) / 3;
    const avgV = (uv0.y + uv1.y + uv2.y) / 3;
    if (avgU < 0.5 || avgV < 0.3 || avgV > 0.8) continue;
    
    // Calculate triangle normal in world space
    const edge1_3d = new THREE.Vector3().subVectors(v1, v0);
    const edge2_3d = new THREE.Vector3().subVectors(v2, v0);
    const normal = new THREE.Vector3().crossVectors(edge1_3d, edge2_3d).normalize();
    
    // Calculate UV triangle area and orientation
    const uvEdge1 = new THREE.Vector2(uv1.x - uv0.x, uv1.y - uv0.y);
    const uvEdge2 = new THREE.Vector2(uv2.x - uv0.x, uv2.y - uv0.y);
    
    // UV "normal" (perpendicular direction in UV space)
    const uvNormal = new THREE.Vector2(-uvEdge1.y, uvEdge1.x).normalize();
    
    // Project world edges to 2D (use XY plane since TV faces -Z)
    const worldEdge1_2d = new THREE.Vector2(edge1_3d.x, edge1_3d.y).normalize();
    const worldEdge2_2d = new THREE.Vector2(edge2_3d.x, edge2_3d.y).normalize();
    
    // Compare UV edge direction to world edge direction
    uvEdge1.normalize();
    
    const dot = worldEdge1_2d.dot(uvEdge1);
    const angle = Math.acos(THREE.MathUtils.clamp(dot, -1, 1)) * (180 / Math.PI);
    
    // Check if rotated ~90 degrees (tighter tolerance now)
    const isRotated = (Math.abs(angle - 90) < 20) || (Math.abs(angle - 270) < 20);
    
    if (isRotated) {
      rotatedUVs.push(uv0.clone(), uv1.clone(), uv2.clone());
    } else {
      normalUVs.push(uv0.clone(), uv1.clone(), uv2.clone());
    }
  }
  
  console.log(`Found ${rotatedUVs.length} UVs in rotated region`);
  console.log(`Found ${normalUVs.length} UVs in normal region`);
  
  if (rotatedUVs.length === 0) {
    console.log('No rotated region detected!');
    return null;
  }
  
  // Find bounds of rotated UVs
  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;
  
  rotatedUVs.forEach(uv => {
    minU = Math.min(minU, uv.x);
    maxU = Math.max(maxU, uv.x);
    minV = Math.min(minV, uv.y);
    maxV = Math.max(maxV, uv.y);
  });
  
  // Add small margin for curved edges
  const marginU = (maxU - minU) * 0.02;
  const marginV = (maxV - minV) * 0.02;
  
  const bounds = {
    minU: Math.max(0, minU - marginU),
    maxU: Math.min(1, maxU + marginU),
    minV: Math.max(0, minV - marginV),
    maxV: Math.min(1, maxV + marginV)
  };
  
  console.log('Detected screen bounds:', bounds);
  console.log('Width:', ((bounds.maxU - bounds.minU) * 100).toFixed(1) + '%');
  console.log('Height:', ((bounds.maxV - bounds.minV) * 100).toFixed(1) + '%');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  return bounds;
}

// Generate a texture mask for the rotated screen region
export function generateScreenMask() {
  if (!_debugTarget) {
    console.log('No UV debug target set');
    return null;
  }
  
  const geometry = _debugTarget.geometry;
  const positionAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;
  const indexAttr = geometry.index;
  
  // Create a canvas for the mask
  const maskSize = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = maskSize;
  canvas.height = maskSize;
  const ctx = canvas.getContext('2d');
  
  // Fill with black (not screen)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, maskSize, maskSize);
  
  // Draw white for rotated triangles (screen area)
  ctx.fillStyle = '#ffffff';
  
  const getVertex = (idx) => new THREE.Vector3(
    positionAttr.getX(idx),
    positionAttr.getY(idx),
    positionAttr.getZ(idx)
  );
  
  const getUV = (idx) => new THREE.Vector2(
    uvAttr.getX(idx),
    uvAttr.getY(idx)
  );
  
  const triangleCount = indexAttr ? indexAttr.count / 3 : positionAttr.count / 3;
  
  for (let i = 0; i < triangleCount; i++) {
    let idx0, idx1, idx2;
    
    if (indexAttr) {
      idx0 = indexAttr.getX(i * 3);
      idx1 = indexAttr.getX(i * 3 + 1);
      idx2 = indexAttr.getX(i * 3 + 2);
    } else {
      idx0 = i * 3;
      idx1 = i * 3 + 1;
      idx2 = i * 3 + 2;
    }
    
    const v0 = getVertex(idx0);
    const v1 = getVertex(idx1);
    const v2 = getVertex(idx2);
    
    const uv0 = getUV(idx0);
    const uv1 = getUV(idx1);
    const uv2 = getUV(idx2);
    
    // Check rotation
    const worldEdge1 = new THREE.Vector2(v1.x - v0.x, v1.y - v0.y);
    const uvEdge1 = new THREE.Vector2(uv1.x - uv0.x, uv1.y - uv0.y);
    
    if (worldEdge1.length() < 0.001 || uvEdge1.length() < 0.001) continue;
    
    worldEdge1.normalize();
    uvEdge1.normalize();
    
    const dot = worldEdge1.dot(uvEdge1);
    const angle = Math.acos(THREE.MathUtils.clamp(dot, -1, 1)) * (180 / Math.PI);
    
    const isRotated = (Math.abs(angle - 90) < 30) || (Math.abs(angle - 270) < 30);
    
    if (isRotated) {
      // Draw this triangle in UV space
      ctx.beginPath();
      ctx.moveTo(uv0.x * maskSize, (1 - uv0.y) * maskSize);
      ctx.lineTo(uv1.x * maskSize, (1 - uv1.y) * maskSize);
      ctx.lineTo(uv2.x * maskSize, (1 - uv2.y) * maskSize);
      ctx.closePath();
      ctx.fill();
    }
  }
  
  console.log('Screen mask generated');
  return canvas;
}

// Visualize the mask
export function showScreenMask() {
  const canvas = generateScreenMask();
  if (canvas) {
    // Open in new window
    const win = window.open('', 'Screen Mask');
    win.document.write('<img src="' + canvas.toDataURL() + '"/>');
  }
}

// Apply detected bounds to gameState
export function applyDetectedBounds() {
  const bounds = detectRotatedScreenBounds();
  if (bounds) {
    gameState.screenUVBounds = bounds;
    console.log('✓ Screen bounds updated in gameState');
    console.log('You can now use these values in globals.js:');
    console.log(`screenUVBounds: { minU: ${bounds.minU.toFixed(4)}, maxU: ${bounds.maxU.toFixed(4)}, minV: ${bounds.minV.toFixed(4)}, maxV: ${bounds.maxV.toFixed(4)} }`);
    return bounds;
  }
  return null;
}

// Call this to enable UV debugging
console.log('UV Debug Tools Loaded!');
console.log('Commands:');
console.log('  toggleUVDebug() - Show UV checker pattern on TV');
console.log('  analyzeUVLayout() - Analyze UV distribution');
console.log('  setupUVInspector() - Click on TV to see UV coords');
console.log('  detectRotatedScreenBounds() - Auto-detect screen region');
console.log('  applyDetectedBounds() - Detect and apply to gameState');
console.log('  showScreenMask() - Visualize exact screen shape (curved)');

// Make functions available globally
window.toggleUVDebug = toggleUVDebug;
window.analyzeUVLayout = analyzeUVLayout;
window.setupUVInspector = setupUVInspector;
window.detectRotatedScreenBounds = detectRotatedScreenBounds;
window.applyDetectedBounds = applyDetectedBounds;
window.showScreenMask = showScreenMask;

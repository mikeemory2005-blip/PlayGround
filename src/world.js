import * as THREE from '../vendor/three.module.js';

export const CELL = 3.6;
export const GRID = 12;
export const CHUNK = CELL * GRID;
export const WALL_H = 3.2;
export const WALL_T = 0.17;
export const WALL_TEX = 3.2;
export const FLOOR_TEX = 4.8;
export const CEIL_TEX = 4.8;

const TAU = Math.PI * 2;

function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fract(x) {
  return x - Math.floor(x);
}

function flickerAt(seed, t) {
  const n = fract(Math.sin(seed * 127.1 + 311.7) * 43758.5453);
  const base = 0.86 + 0.14 * Math.sin(t * (2.0 + n * 3.0) + n * 6.283);
  const h = fract(Math.sin((Math.floor(t * 7.0) + seed * 13.0) * 127.1) * 43758.5453);
  let level = base;
  if (h > 0.972) level *= 0.12 + 0.18 * fract(h * 913.0);
  if (n > 0.93) level *= (Math.sin(t * 41.0 + n * 30.0) > 0.1 ? 1.0 : 0.35);
  return level;
}

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function makeBoxGeo(w, h, d, x, y, z, tile, tint, damp) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    let su;
    let sv;
    if (Math.abs(nx) > 0.5) {
      su = d;
      sv = h;
    } else if (Math.abs(ny) > 0.5) {
      su = w;
      sv = d;
    } else {
      su = w;
      sv = h;
    }
    uv.setXY(i, uv.getX(i) * (su / tile), uv.getY(i) * (sv / tile));

    let shade = tint;
    if (damp) {
      const wy = y + pos.getY(i);
      const f = 0.7 + 0.33 * Math.min(1, Math.max(0, wy / WALL_H));
      shade *= f;
      // slight green-black damp gradient near the carpet
      colors[i * 3] = shade * 0.96;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade * 0.86;
    } else {
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade;
    }
  }

  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.translate(x, y, z);
  return g;
}

function makePlaneGeo(w, d, x, y, z, tile, down) {
  const g = new THREE.PlaneGeometry(w, d, 1, 1);
  g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  g.translate(x, y, z);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
  }
  return g;
}

function mergeGeos(geos, attrs = ['position', 'normal', 'uv', 'color']) {
  if (!geos.length) return null;
  const expanded = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of expanded) count += g.attributes.position.count;

  const out = new THREE.BufferGeometry();
  for (const name of attrs) {
    const first = expanded[0].attributes[name];
    if (!first) continue;
    const itemSize = first.itemSize;
    const arr = new Float32Array(count * itemSize);
    let offset = 0;
    for (const g of expanded) {
      const a = g.attributes[name];
      arr.set(a.array, offset);
      offset += a.array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }

  for (const g of geos) g.dispose();
  for (const g of expanded) if (!geos.includes(g)) g.dispose();
  out.computeBoundingSphere();
  return out;
}

function addSignGeo(list, x, y, z, axis) {
  const g = new THREE.PlaneGeometry(0.72, 0.36);
  if (axis === 'z') g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  list.push(g);
}

// Re-map wall UVs from world space so wallpaper stripes line up across every
// wall segment and across chunk borders.
function applyWorldUV(geo, tile, ox, oz) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    let u;
    let v;
    if (Math.abs(nx) > 0.5) {
      u = (pos.getZ(i) + oz) / tile;
      v = pos.getY(i) / tile;
    } else if (Math.abs(ny) > 0.5) {
      u = (pos.getX(i) + ox) / tile;
      v = (pos.getZ(i) + oz) / tile;
    } else {
      u = (pos.getX(i) + ox) / tile;
      v = pos.getY(i) / tile;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

/* ------------------------------------------------------------------ */

export class World {
  constructor(scene, textures, { mobile = false } = {}) {
    this.scene = scene;
    this.textures = textures;
    this.mobile = mobile;
    this.chunks = new Map();
    this.time = 0;
    this.playerX = 0;
    this.playerZ = 0;

    this.startPosition = new THREE.Vector3(CHUNK * 0.5, 0, CHUNK * 0.5);
    this.startYaw = 0;

    this.wallMat = new THREE.MeshStandardMaterial({
      map: textures.wallpaper,
      bumpMap: textures.wallpaperBump,
      bumpScale: 0.025,
      roughness: 0.94,
      metalness: 0.0,
      vertexColors: true,
    });
    this.floorMat = new THREE.MeshStandardMaterial({
      map: textures.carpet,
      bumpMap: textures.carpetBump,
      bumpScale: 0.045,
      roughness: 1.0,
      metalness: 0.0,
      color: 0xffffff,
    });
    this.ceilMat = new THREE.MeshStandardMaterial({
      map: textures.ceiling,
      bumpMap: textures.ceilingBump,
      bumpScale: 0.02,
      roughness: 0.96,
      metalness: 0.0,
    });
    this.trimMat = new THREE.MeshStandardMaterial({
      color: 0x3a301c,
      roughness: 0.78,
      metalness: 0.04,
      vertexColors: true,
    });
    this.frameMat = new THREE.MeshStandardMaterial({
      color: 0x57482b,
      roughness: 0.62,
      metalness: 0.08,
      vertexColors: true,
    });
    this.metalMat = new THREE.MeshStandardMaterial({
      color: 0x938b73,
      roughness: 0.4,
      metalness: 0.62,
      vertexColors: true,
    });
    this.cardboardMat = new THREE.MeshStandardMaterial({
      map: textures.cardboard,
      roughness: 0.96,
      metalness: 0.0,
    });
    this.signMat = new THREE.MeshBasicMaterial({
      map: textures.exit,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.panelMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: new THREE.Color(0x1a160c) },
        uFogNear: { value: 9 },
        uFogFar: { value: 52 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        varying vec2 vUv;
        varying float vSeed;
        varying float vFogDepth;
        void main() {
          vUv = uv;
          vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        varying vec2 vUv;
        varying float vSeed;
        varying float vFogDepth;

        float hash1(float n) {
          return fract(sin(n * 127.1 + 311.7) * 43758.5453);
        }

        void main() {
          vec3 col;
          if (vSeed < 0.0) {
            col = vec3(0.055, 0.052, 0.04);
          } else {
            float n = hash1(vSeed * 17.0);
            float base = 0.88 + 0.12 * sin(uTime * (2.0 + n * 3.0) + n * 6.283);
            float drop = step(0.972, hash1(floor(uTime * 7.0) + vSeed * 13.0));
            float level = base * mix(1.0, 0.14, drop * 0.85);
            float grad = smoothstep(0.0, 0.62, 1.0 - abs(vUv.x - 0.5) * 2.0);
            vec3 warm = mix(vec3(0.72, 0.57, 0.28), vec3(1.0, 0.94, 0.7), grad);
            col = warm * level * 2.3;
            // hot centre of the tube
            float tube = smoothstep(0.2, 0.0, abs(vUv.y - 0.5));
            col += vec3(1.0, 0.92, 0.7) * tube * 0.35 * level;
          }
          float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
          col = mix(col, uFogColor, fogFactor);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.DoubleSide,
      toneMapped: true,
    });

    this.glowMat = new THREE.PointsMaterial({
      map: textures.glow,
      color: 0xffe4a6,
      size: 3.8,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });

    this.lightCount = mobile ? 5 : 8;
    this.lightPool = [];
    for (let i = 0; i < this.lightCount; i++) {
      const l = new THREE.PointLight(0xffdf9e, 0, 15, 1.85);
      l.position.set(0, -50, 0);
      l.visible = true;
      this.scene.add(l);
      this.lightPool.push(l);
    }

    this._candidateCache = [];
    this._tmp = new THREE.Vector3();
  }

  /* ---------------------------------------------------------------- */

  key(cx, cz) {
    return `${cx},${cz}`;
  }

  ensureChunk(cx, cz) {
    const k = this.key(cx, cz);
    if (this.chunks.has(k)) return this.chunks.get(k);
    const chunk = this.buildChunk(cx, cz);
    this.chunks.set(k, chunk);
    this.scene.add(chunk.group);
    return chunk;
  }

  update(px, pz, time) {
    this.playerX = px;
    this.playerZ = pz;
    this.time = time;
    this.panelMat.uniforms.uTime.value = time;

    const pcx = Math.floor(px / CHUNK);
    const pcz = Math.floor(pz / CHUNK);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.ensureChunk(pcx + dx, pcz + dz);
      }
    }

    for (const [k, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - pcx) > 2 || Math.abs(chunk.cz - pcz) > 2) {
        this.scene.remove(chunk.group);
        chunk.group.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
        });
        this.chunks.delete(k);
      }
    }

    this.updateLights(px, pz, time);
  }

  updateLights(px, pz, time) {
    const candidates = this._candidateCache;
    candidates.length = 0;
    for (const chunk of this.chunks.values()) {
      for (const f of chunk.fixtures) {
        if (!f.active) continue;
        const dx = f.x - px;
        const dz = f.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < 34 * 34) candidates.push({ f, d2 });
      }
    }
    candidates.sort((a, b) => a.d2 - b.d2);

    for (let i = 0; i < this.lightPool.length; i++) {
      const light = this.lightPool[i];
      if (i < candidates.length) {
        const f = candidates[i].f;
        light.position.set(f.x, WALL_H - 0.24, f.z);
        const level = flickerAt(f.seed, time);
        light.intensity = 13.5 * level;
        light.distance = 15;
      } else {
        light.intensity = 0;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* chunk construction                                                */
  /* ---------------------------------------------------------------- */

  buildChunk(cx, cz) {
    const rng = mulberry32(hash2(cx, cz, 0x51ed270b));
    const originX = cx * CHUNK;
    const originZ = cz * CHUNK;
    const isStart = cx === 0 && cz === 0;

    const wallGeos = [];
    const trimGeos = [];
    const frameGeos = [];
    const metalGeos = [];
    const panelGeos = [];
    const signGeos = [];
    const propGeos = [];
    const debrisGeos = [];
    const colliders = [];
    const fixtures = [];
    const columns = [];
    const glowPositions = [];

    const tint = () => 0.9 + rng() * 0.13;

    const addCollider = (minX, maxX, minZ, maxZ) => {
      colliders.push({ minX, maxX, minZ, maxZ });
    };

    const addWallSegment = (x1, z1, x2, z2, y0, y1, thickness, collide, wallTint, withBase) => {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.03) return;
      const horizontal = Math.abs(dx) >= Math.abs(dz);
      const w = horizontal ? len : thickness;
      const d = horizontal ? thickness : len;
      const mx = (x1 + x2) * 0.5;
      const mz = (z1 + z2) * 0.5;
      const h = y1 - y0;

      wallGeos.push(makeBoxGeo(w, h, d, mx, y0 + h * 0.5, mz, WALL_TEX, wallTint, y0 < 0.01));
      if (collide) {
        addCollider(mx - w * 0.5, mx + w * 0.5, mz - d * 0.5, mz + d * 0.5);
      }
      if (withBase && y0 < 0.01) {
        const bw = horizontal ? len + 0.01 : thickness + 0.075;
        const bd = horizontal ? thickness + 0.075 : len + 0.01;
        trimGeos.push(makeBoxGeo(bw, 0.145, bd, mx, 0.0725, mz, 1, wallTint * 0.55, false));
      }
    };

    const addTrimBox = (w, h, d, x, y, z, t = 1) => {
      frameGeos.push(makeBoxGeo(w, h, d, x, y, z, 1, t, false));
    };

    const addDoorFrame = (axis, fixed, a, b, wallTint, signChance) => {
      const frameT = WALL_T + 0.08;
      if (axis === 'x') {
        addTrimBox(0.105, 2.5, frameT, a, 1.25, fixed, wallTint * 0.9);
        addTrimBox(0.105, 2.5, frameT, b, 1.25, fixed, wallTint * 0.9);
        addTrimBox(b - a + 0.12, 0.12, frameT, (a + b) * 0.5, 2.46, fixed, wallTint * 0.9);
        if (rng() < signChance) {
          addSignGeo(signGeos, (a + b) * 0.5, 2.79, fixed + 0.105, axis);
        }
      } else {
        addTrimBox(frameT, 2.5, 0.105, fixed, 1.25, a, wallTint * 0.9);
        addTrimBox(frameT, 2.5, 0.105, fixed, 1.25, b, wallTint * 0.9);
        addTrimBox(frameT, 0.12, b - a + 0.12, fixed, 2.46, (a + b) * 0.5, wallTint * 0.9);
        if (rng() < signChance) {
          addSignGeo(signGeos, fixed + 0.105, 2.79, (a + b) * 0.5, axis);
        }
      }
    };

    const addWallWithDoor = (axis, fixed, start, end, doorCenter, doorWidth, wallTint, signChance = 0.12) => {
      const a = doorCenter - doorWidth * 0.5;
      const b = doorCenter + doorWidth * 0.5;
      if (a > start + 0.06) {
        if (axis === 'x') addWallSegment(start, fixed, a, fixed, 0, WALL_H, WALL_T, true, wallTint, true);
        else addWallSegment(fixed, start, fixed, a, 0, WALL_H, WALL_T, true, wallTint, true);
      }
      if (b < end - 0.06) {
        if (axis === 'x') addWallSegment(b, fixed, end, fixed, 0, WALL_H, WALL_T, true, wallTint, true);
        else addWallSegment(fixed, b, fixed, end, 0, WALL_H, WALL_T, true, wallTint, true);
      }
      // header above the opening
      if (axis === 'x') addWallSegment(a, fixed, b, fixed, 2.47, WALL_H, WALL_T, false, wallTint, false);
      else addWallSegment(fixed, a, fixed, b, 2.47, WALL_H, WALL_T, false, wallTint, false);
      addDoorFrame(axis, fixed, a, b, wallTint, signChance);
    };

    const addWallPlain = (axis, fixed, start, end, wallTint) => {
      if (axis === 'x') addWallSegment(start, fixed, end, fixed, 0, WALL_H, WALL_T, true, wallTint, true);
      else addWallSegment(fixed, start, fixed, end, 0, WALL_H, WALL_T, true, wallTint, true);
    };

    const addColumn = (x, z, colTint) => {
      wallGeos.push(makeBoxGeo(0.56, WALL_H, 0.56, x, WALL_H * 0.5, z, WALL_TEX, colTint, true));
      trimGeos.push(makeBoxGeo(0.63, 0.15, 0.63, x, 0.075, z, 1, colTint * 0.55, false));
      addCollider(x - 0.28, x + 0.28, z - 0.28, z + 0.28);
      columns.push({ x, z });
    };

    /* ---------- border walls (owned by this chunk: north & west) ---------- */

    if (isStart) {
      addWallWithDoor('x', 0, 0.0, CHUNK, CHUNK * 0.5, 2.8, tint(), 1.0);
      addWallWithDoor('z', 0, 0.0, CHUNK, CHUNK * 0.5, 2.8, tint(), 0.2);
    } else {
      const northDoor = 3.2 + rng() * (CHUNK - 6.4);
      addWallWithDoor('x', 0, 0.0, CHUNK, northDoor, 2.7, tint(), 0.1);
      const westDoor = 3.2 + rng() * (CHUNK - 6.4);
      addWallWithDoor('z', 0, 0.0, CHUNK, westDoor, 2.7, tint(), 0.1);
    }

    /* ---------- interior BSP rooms ---------- */

    const rooms = [];

    if (isStart) {
      rooms.push({ x0: 0, z0: 0, x1: GRID, z1: GRID });
      addColumn(CHUNK * 0.5 - 5.4, CHUNK * 0.5 - 5.4, tint());
      addColumn(CHUNK * 0.5 + 5.4, CHUNK * 0.5 - 5.4, tint());
      addColumn(CHUNK * 0.5 - 5.4, CHUNK * 0.5 + 5.4, tint());
      addColumn(CHUNK * 0.5 + 5.4, CHUNK * 0.5 + 5.4, tint());
    } else {
      const splitRoom = (x0, z0, x1, z1, depth) => {
        const w = x1 - x0;
        const h = z1 - z0;
        if (depth >= 2 || (w < 6 && h < 6)) {
          rooms.push({ x0, z0, x1, z1 });
          return;
        }
        const canV = w >= 6;
        const canH = h >= 6;
        if (!canV && !canH) {
          rooms.push({ x0, z0, x1, z1 });
          return;
        }
        let vertical;
        if (canV && canH) vertical = w > h ? true : h > w ? false : rng() < 0.5;
        else vertical = canV;

        if (vertical) {
          const min = x0 + 3;
          const max = x1 - 3;
          if (max < min) {
            rooms.push({ x0, z0, x1, z1 });
            return;
          }
          const s = min + Math.floor(rng() * (max - min + 1));
          const start = z0 * CELL;
          const end = z1 * CELL;
          const doorCenter = start + 2.2 + rng() * Math.max(0.1, end - start - 4.4);
          addWallWithDoor('z', s * CELL, start, end, doorCenter, 2.35, tint(), 0.13);
          splitRoom(x0, z0, s, z1, depth + 1);
          splitRoom(s, z0, x1, z1, depth + 1);
        } else {
          const min = z0 + 3;
          const max = z1 - 3;
          if (max < min) {
            rooms.push({ x0, z0, x1, z1 });
            return;
          }
          const s = min + Math.floor(rng() * (max - min + 1));
          const start = x0 * CELL;
          const end = x1 * CELL;
          const doorCenter = start + 2.2 + rng() * Math.max(0.1, end - start - 4.4);
          addWallWithDoor('x', s * CELL, start, end, doorCenter, 2.35, tint(), 0.13);
          splitRoom(x0, z0, x1, s, depth + 1);
          splitRoom(x0, s, x1, z1, depth + 1);
        }
      };
      splitRoom(0, 0, GRID, GRID, 0);
    }

    /* ---------- columns in the larger rooms ---------- */

    for (const room of rooms) {
      const w = room.x1 - room.x0;
      const h = room.z1 - room.z0;
      if (w < 5 || h < 5) continue;
      if (rng() > 0.58) continue;
      const count = rng() < 0.25 ? 2 : 1;
      for (let n = 0; n < count; n++) {
        const cxi = room.x0 + 2 + Math.floor(rng() * Math.max(1, w - 4));
        const czi = room.z0 + 2 + Math.floor(rng() * Math.max(1, h - 4));
        const x = (cxi + 0.5) * CELL;
        const z = (czi + 0.5) * CELL;
        if (columns.some((c) => Math.hypot(c.x - x, c.z - z) < 2.2)) continue;
        addColumn(x, z, tint());
      }
    }

    /* ---------- ceiling light fixtures ---------- */

    const addFixture = (x, z, forceActive = false) => {
      if (columns.some((c) => Math.hypot(c.x - x, c.z - z) < 1.05)) return;
      const seed = rng() * 997;
      const active = forceActive || rng() > 0.1;

      const panel = new THREE.PlaneGeometry(1.34, 0.64);
      panel.rotateX(Math.PI / 2);
      panel.translate(x, WALL_H - 0.055, z);
      const seeds = new Float32Array(panel.attributes.position.count);
      seeds.fill(active ? seed : -1);
      panel.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      panelGeos.push(panel);

      // metal frame around the panel
      const fy = WALL_H - 0.028;
      metalGeos.push(makeBoxGeo(1.5, 0.055, 0.075, x, fy, z - 0.365, 1, 1, false));
      metalGeos.push(makeBoxGeo(1.5, 0.055, 0.075, x, fy, z + 0.365, 1, 1, false));
      metalGeos.push(makeBoxGeo(0.075, 0.055, 0.8, x - 0.715, fy, z, 1, 1, false));
      metalGeos.push(makeBoxGeo(0.075, 0.055, 0.8, x + 0.715, fy, z, 1, 1, false));

      if (active) {
        fixtures.push({ x, z, seed, active: true });
        glowPositions.push(x, WALL_H - 0.19, z);
      }
    };

    const step = 2;
    for (let i = 0; i < GRID; i += step) {
      for (let j = 0; j < GRID; j += step) {
        const chance = isStart ? 0.94 : 0.64;
        if (rng() > chance) continue;
        const x = (i + 0.5) * CELL + (rng() - 0.5) * 0.55;
        const z = (j + 0.5) * CELL + (rng() - 0.5) * 0.55;
        addFixture(x, z, isStart && Math.abs(x - CHUNK * 0.5) < 9 && Math.abs(z - CHUNK * 0.5) < 9);
      }
    }
    if (isStart) {
      addFixture(CHUNK * 0.5, CHUNK * 0.5 - 3.0, true);
    }

    /* ---------- cardboard boxes / debris ---------- */

    const addBoxProp = (x, z, size, rot) => {
      const g = new THREE.BoxGeometry(size, size * (0.65 + rng() * 0.4), size * (0.8 + rng() * 0.35));
      g.rotateY(rot);
      g.translate(x, g.parameters.height * 0.5, z);
      propGeos.push(g);
      const r = size * 0.55;
      addCollider(x - r, x + r, z - r, z + r);
    };

    if (rng() < 0.7) {
      const px = 1.4 + rng() * (CHUNK - 2.8);
      const pz = 1.4 + rng() * (CHUNK - 2.8);
      if (this.isFreeIn(colliders, px, pz, 1.1)) {
        addBoxProp(px, pz, 0.5 + rng() * 0.5, rng() * TAU);
      }
    }
    if (isStart) {
      addBoxProp(CHUNK * 0.5 - 4.4, CHUNK * 0.5 + 2.0, 0.78, 0.3);
      addBoxProp(CHUNK * 0.5 + 3.1, CHUNK * 0.5 + 3.4, 0.55, 1.2);
    }

    if (rng() < 0.55) {
      const dx = 2 + rng() * (CHUNK - 4);
      const dz = 2 + rng() * (CHUNK - 4);
      const g = new THREE.BoxGeometry(0.72, 0.025, 0.52);
      g.rotateY(rng() * TAU);
      g.translate(dx, 0.018, dz);
      debrisGeos.push(g);
    }

    /* ---------- build meshes ---------- */

    const group = new THREE.Group();
    group.position.set(originX, 0, originZ);

    const floorGeo = makePlaneGeo(CHUNK, CHUNK, CHUNK * 0.5, 0, CHUNK * 0.5, FLOOR_TEX, false);
    group.add(new THREE.Mesh(floorGeo, this.floorMat));

    const ceilGeo = makePlaneGeo(CHUNK, CHUNK, CHUNK * 0.5, WALL_H, CHUNK * 0.5, CEIL_TEX, true);
    group.add(new THREE.Mesh(ceilGeo, this.ceilMat));

    const wallGeo = mergeGeos(wallGeos);
    if (wallGeo) {
      applyWorldUV(wallGeo, WALL_TEX, originX, originZ);
      group.add(new THREE.Mesh(wallGeo, this.wallMat));
    }

    const trimGeo = mergeGeos(trimGeos);
    if (trimGeo) group.add(new THREE.Mesh(trimGeo, this.trimMat));

    const frameGeo = mergeGeos(frameGeos);
    if (frameGeo) group.add(new THREE.Mesh(frameGeo, this.frameMat));

    const metalGeo = mergeGeos(metalGeos);
    if (metalGeo) group.add(new THREE.Mesh(metalGeo, this.metalMat));

    const panelGeo = mergeGeos(panelGeos, ['position', 'normal', 'uv', 'aSeed']);
    if (panelGeo) group.add(new THREE.Mesh(panelGeo, this.panelMat));

    const signGeo = mergeGeos(signGeos, ['position', 'normal', 'uv']);
    if (signGeo) group.add(new THREE.Mesh(signGeo, this.signMat));

    const propGeo = mergeGeos(propGeos, ['position', 'normal', 'uv']);
    if (propGeo) group.add(new THREE.Mesh(propGeo, this.cardboardMat));

    const debrisGeo = mergeGeos(debrisGeos, ['position', 'normal', 'uv']);
    if (debrisGeo) group.add(new THREE.Mesh(debrisGeo, this.ceilMat));

    if (glowPositions.length) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(glowPositions, 3));
      group.add(new THREE.Points(pg, this.glowMat));
    }

    return {
      cx,
      cz,
      group,
      colliders: colliders.map((c) => ({
        minX: c.minX + originX,
        maxX: c.maxX + originX,
        minZ: c.minZ + originZ,
        maxZ: c.maxZ + originZ,
      })),
      fixtures: fixtures.map((f) => ({ ...f, x: f.x + originX, z: f.z + originZ })),
      originX,
      originZ,
    };
  }

  isFreeIn(colliderList, x, z, r) {
    for (const c of colliderList) {
      const nx = Math.max(c.minX, Math.min(x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
      const dx = x - nx;
      const dz = z - nz;
      if (dx * dx + dz * dz < r * r) return false;
    }
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* collision / queries                                               */
  /* ---------------------------------------------------------------- */

  isFree(x, z, r = 0.35) {
    for (const chunk of this.chunks.values()) {
      for (const c of chunk.colliders) {
        const nx = Math.max(c.minX, Math.min(x, c.maxX));
        const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
        const dx = x - nx;
        const dz = z - nz;
        if (dx * dx + dz * dz < r * r) return false;
      }
    }
    return true;
  }

  resolveCircle(pos, r) {
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      for (const chunk of this.chunks.values()) {
        for (const c of chunk.colliders) {
          const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
          const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
          let dx = pos.x - nx;
          let dz = pos.z - nz;
          let d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            hit = true;
            if (d2 > 1e-9) {
              const d = Math.sqrt(d2);
              const push = (r - d) / d;
              pos.x += dx * push;
              pos.z += dz * push;
            } else {
              const left = pos.x - c.minX;
              const right = c.maxX - pos.x;
              const top = pos.z - c.minZ;
              const bottom = c.maxZ - pos.z;
              const m = Math.min(left, right, top, bottom);
              if (m === left) pos.x = c.minX - r;
              else if (m === right) pos.x = c.maxX + r;
              else if (m === top) pos.z = c.minZ - r;
              else pos.z = c.maxZ + r;
            }
          }
        }
      }
      if (!hit) break;
    }
  }

  segmentHitsBox(x1, z1, x2, z2, minX, maxX, minZ, maxZ) {
    let tmin = 0;
    let tmax = 1;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const axes = [
      [x1, dx, minX, maxX],
      [z1, dz, minZ, maxZ],
    ];
    for (const [p, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-8) {
        if (p < lo || p > hi) return false;
      } else {
        let t1 = (lo - p) / d;
        let t2 = (hi - p) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
      }
    }
    return true;
  }

  hasLineOfSight(x1, z1, x2, z2) {
    for (const chunk of this.chunks.values()) {
      for (const c of chunk.colliders) {
        // skip tiny props only if the segment starts inside their padding? keep all
        if (this.segmentHitsBox(x1, z1, x2, z2, c.minX, c.maxX, c.minZ, c.maxZ)) {
          return false;
        }
      }
    }
    return true;
  }

  findOpenPosition(px, pz, minDist, maxDist, { behind = false, forwardX = 0, forwardZ = -1, hidden = false } = {}) {
    const candidates = [];
    for (const chunk of this.chunks.values()) {
      for (let i = 0; i < GRID; i++) {
        for (let j = 0; j < GRID; j++) {
          const x = chunk.originX + (i + 0.5) * CELL;
          const z = chunk.originZ + (j + 0.5) * CELL;
          const dx = x - px;
          const dz = z - pz;
          const d = Math.hypot(dx, dz);
          if (d < minDist || d > maxDist) continue;
          if (!this.isFree(x, z, 0.62)) continue;
          if (behind) {
            const dot = (dx * forwardX + dz * forwardZ) / Math.max(0.001, d);
            if (dot > -0.05) continue;
          }
          if (hidden && this.hasLineOfSight(px, pz, x, z)) continue;
          candidates.push({ x, z, d });
        }
      }
    }
    if (!candidates.length) {
      if (behind || hidden) return this.findOpenPosition(px, pz, minDist, maxDist, { behind: false, hidden: false });
      return null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  clear() {
    for (const chunk of this.chunks.values()) {
      this.scene.remove(chunk.group);
      chunk.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    this.chunks.clear();
  }

  dispose() {
    this.clear();
    for (const l of this.lightPool) this.scene.remove(l);
    this.wallMat.dispose();
    this.floorMat.dispose();
    this.ceilMat.dispose();
    this.trimMat.dispose();
    this.frameMat.dispose();
    this.metalMat.dispose();
    this.cardboardMat.dispose();
    this.signMat.dispose();
    this.panelMat.dispose();
    this.glowMat.dispose();
  }
}

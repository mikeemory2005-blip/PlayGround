import * as THREE from '../vendor/three.module.js';

const TAU = Math.PI * 2;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function wrapped(size, fn) {
  for (let ox = -size; ox <= size; ox += size) {
    for (let oy = -size; oy <= size; oy += size) {
      fn(ox, oy);
    }
  }
}

function addPixelNoise(ctx, size, rng, amount, alpha = 1) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    d[i + 3] = Math.round(d[i + 3] * alpha);
  }
  ctx.putImageData(img, 0, 0);
}

function paintStain(ctx, size, x, y, r, color, strength, seed) {
  wrapped(size, (ox, oy) => {
    const g = ctx.createRadialGradient(x + ox, y + oy, r * 0.08, x + ox, y + oy, r);
    g.addColorStop(0, `rgba(${color},${strength})`);
    g.addColorStop(0.55, `rgba(${color},${strength * 0.55})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x + ox, y + oy, r, 0, TAU);
    ctx.fill();
  });
}

/* ------------------------------------------------------------------ */
/* wallpaper: mono-yellow, vertical stripes, damp bloom and scuffs     */
/* ------------------------------------------------------------------ */

function paintWallpaper(ctx, size, seed, bump) {
  const rng = mulberry32(seed);
  if (bump) {
    ctx.fillStyle = '#808080';
  } else {
    ctx.fillStyle = '#b6a465';
  }
  ctx.fillRect(0, 0, size, size);

  // vertical wallpaper bands
  const band = size / 8;
  for (let i = 0; i < 8; i++) {
    const x = i * band;
    const g = ctx.createLinearGradient(x, 0, x + band, 0);
    if (bump) {
      g.addColorStop(0, 'rgba(0,0,0,0.07)');
      g.addColorStop(0.12, 'rgba(255,255,255,0.025)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.0)');
      g.addColorStop(0.88, 'rgba(0,0,0,0.06)');
      g.addColorStop(1, 'rgba(255,255,255,0.02)');
    } else {
      g.addColorStop(0, 'rgba(82,68,28,0.11)');
      g.addColorStop(0.1, 'rgba(238,224,164,0.08)');
      g.addColorStop(0.5, 'rgba(120,100,46,0.015)');
      g.addColorStop(0.9, 'rgba(82,68,28,0.08)');
      g.addColorStop(1, 'rgba(238,224,164,0.04)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, band, size);
  }

  // thin seam lines
  ctx.fillStyle = bump ? 'rgba(20,20,20,0.4)' : 'rgba(70,58,24,0.28)';
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(i * band, 0, 1.5, size);
  }

  // mottled aged paper
  for (let i = 0; i < 260; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 3 + rng() * 24;
    const light = rng() > 0.5;
    const alpha = 0.012 + rng() * 0.035;
    ctx.fillStyle = bump
      ? `rgba(${light ? 210 : 40},${light ? 210 : 40},${light ? 210 : 40},${alpha})`
      : light
        ? `rgba(232,218,160,${alpha})`
        : `rgba(96,79,34,${alpha})`;
    wrapped(size, (ox, oy) => {
      ctx.beginPath();
      ctx.ellipse(x + ox, y + oy, r, r * (0.5 + rng() * 0.7), rng() * TAU, 0, TAU);
      ctx.fill();
    });
  }

  // damp blooms / water damage
  const stainCount = 6;
  for (let i = 0; i < stainCount; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 26 + rng() * 88;
    paintStain(ctx, size, x, y, r, bump ? '48,48,48' : '74,57,25', bump ? 0.26 : 0.2, seed + i);
    if (!bump) {
      paintStain(ctx, size, x + (rng() - 0.5) * r, y + (rng() - 0.5) * r, r * 0.45, '45,34,14', 0.16, seed + i);
    }
  }

  // scuffs and small marks
  for (let i = 0; i < 26; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 2 + rng() * 16;
    ctx.strokeStyle = bump
      ? `rgba(30,30,30,${0.1 + rng() * 0.2})`
      : `rgba(62,50,22,${0.08 + rng() * 0.18})`;
    ctx.lineWidth = 0.6 + rng() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rng() - 0.5) * 5);
    ctx.stroke();
  }

  addPixelNoise(ctx, size, rng, bump ? 30 : 15);
}

/* ------------------------------------------------------------------ */
/* carpet: damp, fibrous, stained                                      */
/* ------------------------------------------------------------------ */

function paintCarpet(ctx, size, seed, bump) {
  const rng = mulberry32(seed);
  ctx.fillStyle = bump ? '#7c7c7c' : '#5b4b27';
  ctx.fillRect(0, 0, size, size);

  // broad damp patches
  for (let i = 0; i < 9; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 36 + rng() * 120;
    paintStain(ctx, size, x, y, r, bump ? '35,35,35' : '42,34,16', bump ? 0.3 : 0.26, seed + i * 7);
  }

  // fibers
  for (let i = 0; i < 5200; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 1 + rng() * 6;
    const ang = (rng() - 0.5) * 0.7;
    const light = rng() > 0.48;
    ctx.strokeStyle = bump
      ? `rgba(${light ? 180 : 60},${light ? 180 : 60},${light ? 180 : 60},${0.08 + rng() * 0.2})`
      : light
        ? `rgba(138,117,66,${0.08 + rng() * 0.22})`
        : `rgba(43,34,14,${0.08 + rng() * 0.24})`;
    ctx.lineWidth = 0.6 + rng() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  // crushed / matted areas
  for (let i = 0; i < 16; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 18 + rng() * 52;
    paintStain(ctx, size, x, y, r, bump ? '120,120,120' : '76,62,31', 0.07, seed + i * 3);
  }

  addPixelNoise(ctx, size, rng, bump ? 42 : 22);
}

/* ------------------------------------------------------------------ */
/* acoustic ceiling tiles                                              */
/* ------------------------------------------------------------------ */

function paintCeiling(ctx, size, seed, bump) {
  const rng = mulberry32(seed);
  const tile = size / 2;
  ctx.fillStyle = bump ? '#868686' : '#b9ad8a';
  ctx.fillRect(0, 0, size, size);

  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const ox = tx * tile;
      const oy = ty * tile;
      const dark = rng() > 0.5;
      ctx.fillStyle = bump
        ? `rgba(${dark ? 100 : 150},${dark ? 100 : 150},${dark ? 100 : 150},0.16)`
        : dark
          ? 'rgba(120,108,76,0.12)'
          : 'rgba(214,203,166,0.12)';
      ctx.fillRect(ox, oy, tile, tile);

      // perforation speckle
      for (let i = 0; i < 1200; i++) {
        const x = ox + rng() * tile;
        const y = oy + rng() * tile;
        const r = 0.5 + rng() * 1.8;
        ctx.fillStyle = bump
          ? `rgba(30,30,30,${0.1 + rng() * 0.3})`
          : `rgba(76,67,43,${0.05 + rng() * 0.16})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }

      // water stains on some tiles
      if (rng() > 0.32) {
        const cx = ox + tile * (0.2 + rng() * 0.6);
        const cy = oy + tile * (0.2 + rng() * 0.6);
        paintStain(ctx, size, cx, cy, 28 + rng() * 70, bump ? '45,45,45' : '98,76,35', bump ? 0.24 : 0.2, seed + tx * 3 + ty);
      }

      // occasional broken/dark tile
      if (rng() > 0.86) {
        ctx.fillStyle = bump ? 'rgba(20,20,20,0.4)' : 'rgba(38,32,18,0.35)';
        ctx.fillRect(ox + 4, oy + 4, tile - 8, tile - 8);
      }
    }
  }

  // T-bar grid
  ctx.fillStyle = bump ? 'rgba(20,20,20,0.55)' : 'rgba(77,69,48,0.62)';
  ctx.fillRect(0, 0, size, 5);
  ctx.fillRect(0, tile - 2, size, 5);
  ctx.fillRect(0, 0, 5, size);
  ctx.fillRect(tile - 2, 0, 5, size);
  ctx.fillStyle = bump ? 'rgba(220,220,220,0.18)' : 'rgba(217,206,170,0.22)';
  ctx.fillRect(0, 5, size, 1);
  ctx.fillRect(5, 0, 1, size);

  addPixelNoise(ctx, size, rng, bump ? 30 : 12);
}

/* ------------------------------------------------------------------ */
/* cardboard boxes                                                     */
/* ------------------------------------------------------------------ */

function paintCardboard(ctx, size, seed) {
  const rng = mulberry32(seed);
  ctx.fillStyle = '#8a6c42';
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 6) {
    ctx.fillStyle = `rgba(60,44,22,${0.06 + rng() * 0.08})`;
    ctx.fillRect(0, y, size, 1.5);
  }
  for (let i = 0; i < 500; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.fillStyle = `rgba(${rng() > 0.5 ? '190,158,104' : '58,43,20'},${0.03 + rng() * 0.08})`;
    ctx.fillRect(x, y, 1 + rng() * 5, 1 + rng() * 2);
  }
  // packing tape
  ctx.fillStyle = 'rgba(200,180,130,0.25)';
  ctx.fillRect(size * 0.47, 0, size * 0.08, size);
  paintStain(ctx, size, size * 0.7, size * 0.8, size * 0.25, '50,35,14', 0.18, seed);
  addPixelNoise(ctx, size, rng, 20);
}

/* ------------------------------------------------------------------ */
/* glow sprite                                                         */
/* ------------------------------------------------------------------ */

function paintGlow(ctx, size) {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,246,210,0.95)');
  g.addColorStop(0.12, 'rgba(255,235,170,0.62)');
  g.addColorStop(0.35, 'rgba(255,220,140,0.19)');
  g.addColorStop(0.7, 'rgba(255,205,110,0.04)');
  g.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

/* ------------------------------------------------------------------ */
/* exit sign                                                           */
/* ------------------------------------------------------------------ */

function paintExit(ctx, w, h) {
  ctx.fillStyle = '#060806';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(80,255,150,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  ctx.font = `bold ${Math.floor(h * 0.58)}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(80,255,150,0.9)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#b8ffd1';
  ctx.fillText('EXIT', w / 2, h / 2 + 2);
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#e9fff1';
  ctx.fillText('EXIT', w / 2, h / 2 + 2);

  // arrow
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(184,255,209,0.8)';
  ctx.beginPath();
  ctx.moveTo(w * 0.84, h * 0.5);
  ctx.lineTo(w * 0.91, h * 0.5);
  ctx.lineTo(w * 0.91, h * 0.4);
  ctx.lineTo(w * 0.97, h * 0.54);
  ctx.lineTo(w * 0.91, h * 0.68);
  ctx.lineTo(w * 0.91, h * 0.58);
  ctx.lineTo(w * 0.84, h * 0.58);
  ctx.closePath();
  ctx.fill();
}

/* ------------------------------------------------------------------ */

function tex(c, { srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function createTextures(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const S = 512;

  const wallCanvas = canvas(S);
  paintWallpaper(wallCanvas.getContext('2d'), S, 9137, false);
  const wallBumpCanvas = canvas(S);
  paintWallpaper(wallBumpCanvas.getContext('2d'), S, 9137, true);

  const carpetCanvas = canvas(S);
  paintCarpet(carpetCanvas.getContext('2d'), S, 48121, false);
  const carpetBumpCanvas = canvas(S);
  paintCarpet(carpetBumpCanvas.getContext('2d'), S, 48121, true);

  const ceilCanvas = canvas(S);
  paintCeiling(ceilCanvas.getContext('2d'), S, 7731, false);
  const ceilBumpCanvas = canvas(S);
  paintCeiling(ceilBumpCanvas.getContext('2d'), S, 7731, true);

  const cardboardCanvas = canvas(256);
  paintCardboard(cardboardCanvas.getContext('2d'), 256, 5519);

  const glowCanvas = canvas(128);
  paintGlow(glowCanvas.getContext('2d'), 128);

  const exitCanvas = document.createElement('canvas');
  exitCanvas.width = 256;
  exitCanvas.height = 128;
  paintExit(exitCanvas.getContext('2d'), 256, 128);

  return {
    wallpaper: tex(wallCanvas, { aniso }),
    wallpaperBump: tex(wallBumpCanvas, { srgb: false, aniso }),
    carpet: tex(carpetCanvas, { aniso }),
    carpetBump: tex(carpetBumpCanvas, { srgb: false, aniso }),
    ceiling: tex(ceilCanvas, { aniso }),
    ceilingBump: tex(ceilBumpCanvas, { srgb: false, aniso }),
    cardboard: tex(cardboardCanvas, { aniso }),
    glow: tex(glowCanvas, { aniso: 1 }),
    exit: tex(exitCanvas, { aniso: 1 }),
  };
}

import * as THREE from '../vendor/three.module.js';
import { createTextures } from './textures.js';
import { World, CHUNK, WALL_H } from './world.js';
import { Entity } from './entity.js';
import { AudioEngine } from './audio.js';
import { PostFX } from './post.js';

const $ = (id) => document.getElementById(id);

const WALK_SPEED = 2.7;
const RUN_SPEED = 5.05;
const EYE_HEIGHT = 1.62;
const BASE_FOV = 68;
const ZOOM_LEVELS = [1, 1.8, 2.8, 4.2];
const START_CLOCK = 22 * 3600 + 47 * 60 + 12;

function bootError(err) {
  const box = $('boot-error');
  const text = $('boot-error-text');
  if (box) box.classList.remove('hidden');
  if (text) {
    text.textContent =
      'The camcorder could not start. WebGL2 is required. ' +
      (err && err.message ? `(${err.message})` : '');
  }
  console.error(err);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function lerpAngle(current, target, amount) {
  let diff = target - current;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return current + diff * amount;
}

function fmtTimecode(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor(total / 60) % 60;
  const s = Math.floor(total) % 60;
  const f = Math.floor((total % 1) * 30);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

function fmtClock(seconds) {
  const total = (START_CLOCK + Math.floor(seconds)) % 86400;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function main() {
  const forceTouch = new URLSearchParams(location.search).has('touch');
  const isTouch =
    forceTouch ||
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window;
  document.body.classList.toggle('touch', isTouch);
  const baseFov = isTouch ? 76 : BASE_FOV;

  if (isTouch) {
    const grid = document.querySelector('.controls-grid');
    if (grid) {
      grid.innerHTML =
        '<span><b>LEFT STICK</b> move</span>' +
        '<span><b>DRAG</b> look</span>' +
        '<span><b>ZOOM</b> toggle lens</span>' +
        '<span><b>RUN</b> hold to run</span>' +
        '<span><b>II</b> pause</span>';
    }
  }

  const canvas = $('scene');
  const startBtn = $('start-btn');
  const intro = $('intro');
  const pauseOverlay = $('pause');
  const deathOverlay = $('death');
  const deathStats = $('death-stats');
  const resumeBtn = $('resume-btn');
  const rewindBtn = $('rewind-btn');
  const toastEl = $('toast');
  const battFill = $('batt-fill');
  const battPct = $('batt-pct');
  const timecodeEl = $('timecode');
  const clockEl = $('osd-clock');
  const dateEl = $('osd-date');
  const zoomFill = $('zoom-fill');
  const zoomVal = $('zoom-val');
  const zoomMode = $('zoom-mode');
  const edgeCode = $('edge-code');
  const camLabel = document.querySelector('.cam-label');
  const focusReticle = $('focus-reticle');
  const stickZone = $('stick-zone');
  const stickBase = $('stick-base');
  const stickKnob = $('stick-knob');
  const btnZoom = $('btn-zoom');
  const btnSprint = $('btn-sprint');
  const btnPause = $('btn-pause');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    bootError(err);
    return;
  }

  if (!renderer.capabilities.isWebGL2) {
    bootError(new Error('WebGL2 not available'));
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0b06);
  scene.fog = new THREE.Fog(0x1a160c, 9, 52);

  const camera = new THREE.PerspectiveCamera(
    baseFov,
    window.innerWidth / window.innerHeight,
    0.045,
    120
  );
  camera.rotation.order = 'YXZ';

  const ambient = new THREE.AmbientLight(0x6b5c34, 0.62);
  const hemi = new THREE.HemisphereLight(0x9a8650, 0x120e08, 0.38);
  const camLight = new THREE.PointLight(0xffdfa0, 5.5, 12, 2.0);
  scene.add(ambient, hemi, camLight);

  let textures;
  try {
    textures = createTextures(renderer);
  } catch (err) {
    bootError(err);
    return;
  }

  let world;
  try {
    world = new World(scene, textures, {
      mobile: isTouch,
      seed: (Math.random() * 0xffffffff) >>> 0,
    });
  } catch (err) {
    bootError(err);
    return;
  }

  const audio = new AudioEngine();
  const post = new PostFX(renderer, scene, camera);

  // Camera-position dust that wraps around the player.
  const dustCount = isTouch ? 160 : 340;
  const dustGeo = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  const dustBase = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustBase[i * 3] = Math.random() * 16;
    dustBase[i * 3 + 1] = 0.25 + Math.random() * 2.9;
    dustBase[i * 3 + 2] = Math.random() * 16;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0xffe3a6,
      size: 0.055,
      map: textures.glow,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
  );
  dust.frustumCulled = false;
  scene.add(dust);

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */

  const player = {
    x: CHUNK * 0.5,
    z: CHUNK * 0.5,
    yaw: 0,
    pitch: 0,
  };
  const velocity = new THREE.Vector2();

  let state = 'intro'; // intro | playing | paused | dying | dead
  let elapsed = 0;
  let runTime = 0;
  let battery = 100;
  let batteryWarned = false;
  let stamina = 100;
  let staminaCool = 0;
  let distance = 0;
  let encounters = 0;
  let tape = 1;
  let zoomStep = 0;
  let zoomHeld = false;
  let fovCurrent = BASE_FOV;
  let walkPhase = 0;
  let stepAccum = 0;
  let cameraRoll = 0;
  let toastTimer = 0;
  let hudTimer = 0;
  let deathElapsed = 0;
  let deathShown = false;
  let rollInput = 0;
  let threat = 0;
  let muted = false;
  let escGuard = 0;

  const keys = Object.create(null);
  let stickId = null;
  let stickX = 0;
  let stickY = 0;
  let sprintHeld = false;
  let lookId = null;
  let lookX = 0;
  let lookY = 0;
  let dragLook = false;
  let dragX = 0;
  let dragY = 0;

  const clock = new THREE.Clock();

  function showToast(text, duration = 2.6) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add('show');
    toastTimer = duration;
  }

  function announce(text, chance = 1) {
    if (Math.random() <= chance) showToast(text, 2.4);
  }

  /* ------------------------------------------------------------------ */
  /* entity                                                              */
  /* ------------------------------------------------------------------ */

  const entity = new Entity(scene, world, audio, {
    onFirstSpawn() {
      showToast('YOU ARE NOT ALONE', 3.2);
      audio.sting();
      post.uniforms.uFlash.value = 0.3;
    },
    onSpawn() {
      announce('SOMETHING MOVED', 0.5);
      post.uniforms.uFlash.value = Math.max(post.uniforms.uFlash.value, 0.14);
    },
    onVanish() {
      announce('IT WAS NEVER THERE', 0.45);
      post.uniforms.uFlash.value = 0.22;
    },
    onCatch() {
      beginDeath();
    },
  });
  entity.reset();

  // Small development hook used by the automated browser capture.
  window.__backrooms = {
    get state() {
      return state;
    },
    player,
    velocity,
    world,
    entity,
    camera,
    scene,
    renderer,
    post,
    ambient,
    hemi,
    camLight,
  };

  /* ------------------------------------------------------------------ */
  /* session / UI flow                                                   */
  /* ------------------------------------------------------------------ */

  function setPointerLock() {
    if (isTouch || document.pointerLockElement === canvas) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (err) {
      /* pointer lock can be blocked in embeds; drag-look still works */
    }
  }

  function updateTapeLabel() {
    if (camLabel) camLabel.textContent = `SONY CCD-TRV88 · TAPE ${String(tape).padStart(2, '0')}`;
  }

  function resetSession() {
    world.reseed((Math.random() * 0xffffffff) >>> 0);
    entity.reset();
    player.x = CHUNK * 0.5;
    player.z = CHUNK * 0.5;
    player.yaw = 0;
    player.pitch = 0;
    velocity.set(0, 0);
    stamina = 100;
    staminaCool = 0;
    battery = 100;
    batteryWarned = false;
    runTime = 0;
    distance = 0;
    encounters = 0;
    zoomStep = 0;
    zoomHeld = false;
    fovCurrent = baseFov;
    walkPhase = 0;
    stepAccum = 0;
    cameraRoll = 0;
    rollInput = 0;
    threat = 0;
    deathElapsed = 0;
    deathShown = false;
    stickId = null;
    lookId = null;
    stickX = 0;
    stickY = 0;
    resetStick();
    updateTapeLabel();
    world.update(player.x, player.z, elapsed);
    placeCamera(0);
  }

  function startGame() {
    if (state !== 'intro') return;
    audio.init();
    audio.start();
    audio.uiClick();
    state = 'playing';
    intro.classList.add('fade-out');
    setTimeout(() => intro.classList.add('hidden'), 650);
    document.body.classList.add('playing');
    clock.getDelta();
    showToast('LEVEL 0 — KEEP MOVING', 3.0);
    playStartStatic();
    setPointerLock();
  }

  function playStartStatic() {
    post.uniforms.uFlash.value = 0.45;
    post.uniforms.uGlitch.value = 0.5;
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    clearInputs();
    pauseOverlay.classList.remove('hidden');
    document.body.classList.remove('playing');
    if (document.pointerLockElement) document.exitPointerLock();
    audio.setThreat(0, false);
    audio.uiClick();
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    pauseOverlay.classList.add('hidden');
    document.body.classList.add('playing');
    clock.getDelta();
    audio.resume();
    audio.uiClick();
    setPointerLock();
  }

  function togglePause() {
    if (state === 'playing') pauseGame();
    else if (state === 'paused') resumeGame();
  }

  function beginDeath() {
    if (state !== 'playing') return;
    state = 'dying';
    deathElapsed = 0;
    deathShown = false;
    encounters += 1;
    clearInputs();
    if (document.pointerLockElement) document.exitPointerLock();
    post.uniforms.uGlitch.value = 1;
    post.uniforms.uFlash.value = 0.6;
  }

  function showDeath() {
    if (deathShown) return;
    deathShown = true;
    state = 'dead';
    document.body.classList.remove('playing');
    if (deathStats) {
      deathStats.innerHTML =
        `<div>TIME ON TAPE<b>${fmtDuration(runTime)}</b></div>` +
        `<div>WALKED<b>${Math.round(distance)}m</b></div>` +
        `<div>ENCOUNTERS<b>${encounters}</b></div>`;
    }
    deathOverlay.classList.remove('hidden');
    audio.setThreat(0, false);
  }

  function rewindGame() {
    if (state !== 'dead') return;
    deathOverlay.classList.add('hidden');
    tape += 1;
    resetSession();
    state = 'playing';
    document.body.classList.add('playing');
    clock.getDelta();
    audio.start();
    audio.uiClick();
    showToast(`TAPE ${String(tape).padStart(2, '0')} — THE ROOMS HAVE SHIFTED`, 3.2);
    setPointerLock();
  }

  /* ------------------------------------------------------------------ */
  /* input                                                               */
  /* ------------------------------------------------------------------ */

  function clearInputs() {
    for (const k of Object.keys(keys)) keys[k] = false;
    stickX = 0;
    stickY = 0;
    sprintHeld = false;
    zoomHeld = false;
    dragLook = false;
    lookId = null;
    dragX = 0;
    dragY = 0;
    resetStick();
    btnSprint?.classList.remove('active');
    btnZoom?.classList.remove('active');
  }

  function resetStick() {
    if (stickKnob) stickKnob.style.transform = 'translate(0px, 0px)';
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) {
      if (e.code === 'Space') e.preventDefault();
      return;
    }
    keys[e.code] = true;

    if (e.code === 'KeyZ' && state === 'playing') {
      zoomHeld = true;
      if (zoomStep === 0) zoomStep = 1;
      audio.zoom(true);
    }
    if (e.code === 'KeyM') {
      muted = audio.toggleMute();
      showToast(muted ? 'AUDIO MUTED' : 'AUDIO ON', 1.6);
    }
    if ((e.code === 'Escape' || e.code === 'KeyP') && (state === 'playing' || state === 'paused')) {
      if (e.code === 'Escape' && performance.now() < escGuard) return;
      e.preventDefault();
      togglePause();
    }
    if ((e.code === 'Enter' || e.code === 'Space') && state === 'intro') {
      e.preventDefault();
      startGame();
    }
    if (e.code === 'Space' && state === 'playing') e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'KeyZ') zoomHeld = false;
  });

  window.addEventListener('blur', () => {
    clearInputs();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') pauseGame();
  });

  document.addEventListener('pointerlockchange', () => {
    if (!isTouch && state === 'playing' && document.pointerLockElement !== canvas) {
      escGuard = performance.now() + 300;
      pauseGame();
    }
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    if (e.pointerType === 'mouse') {
      if (e.button === 2) {
        e.preventDefault();
        zoomHeld = true;
        if (zoomStep === 0) zoomStep = 1;
        audio.zoom(true);
        return;
      }
      if (e.button !== 0) return;
      setPointerLock();
      if (!document.pointerLockElement) {
        dragLook = true;
        dragX = e.clientX;
        dragY = e.clientY;
      }
    } else {
      e.preventDefault();
      lookId = e.pointerId;
      lookX = e.clientX;
      lookY = e.clientY;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (state !== 'playing') return;

    if (e.pointerType === 'mouse' && document.pointerLockElement === canvas) {
      player.yaw -= e.movementX * 0.0021;
      player.pitch -= e.movementY * 0.00185;
      player.pitch = clamp(player.pitch, -1.24, 1.24);
      return;
    }

    if (e.pointerType === 'mouse' && dragLook) {
      const dx = e.clientX - dragX;
      const dy = e.clientY - dragY;
      dragX = e.clientX;
      dragY = e.clientY;
      player.yaw -= dx * 0.004;
      player.pitch = clamp(player.pitch - dy * 0.0035, -1.24, 1.24);
      return;
    }

    if (e.pointerId === lookId) {
      const dx = e.clientX - lookX;
      const dy = e.clientY - lookY;
      lookX = e.clientX;
      lookY = e.clientY;
      player.yaw -= dx * 0.0044;
      player.pitch = clamp(player.pitch - dy * 0.004, -1.24, 1.24);
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' && e.button === 2) zoomHeld = false;
    if (e.pointerType === 'mouse') dragLook = false;
    if (e.pointerId === lookId) lookId = null;
  });

  window.addEventListener('pointercancel', (e) => {
    if (e.pointerId === lookId) lookId = null;
    if (e.pointerId === stickId) {
      stickId = null;
      stickX = 0;
      stickY = 0;
      resetStick();
    }
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (state !== 'playing') return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? -1 : 1;
      zoomStep = clamp(zoomStep + dir, 0, ZOOM_LEVELS.length - 1);
      audio.zoom(dir > 0);
    },
    { passive: false }
  );

  /* touch joystick */
  function updateStick(e) {
    const rect = stickBase.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = rect.width * 0.34;
    const len = Math.hypot(dx, dy);
    if (len > max && len > 0.001) {
      dx *= max / len;
      dy *= max / len;
    }
    stickKnob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    stickX = dx / max;
    stickY = -dy / max;
  }

  stickZone?.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    stickId = e.pointerId;
    stickZone.classList.add('active');
    try {
      stickZone.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    updateStick(e);
  });

  stickZone?.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    e.preventDefault();
    updateStick(e);
  });

  function endStick(e) {
    if (e.pointerId !== stickId) return;
    stickId = null;
    stickX = 0;
    stickY = 0;
    stickZone.classList.remove('active');
    resetStick();
  }

  stickZone?.addEventListener('pointerup', endStick);
  stickZone?.addEventListener('pointercancel', endStick);

  function setSprint(on) {
    sprintHeld = on;
    btnSprint?.classList.toggle('active', on);
  }

  btnSprint?.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    try {
      btnSprint.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    setSprint(true);
  });
  btnSprint?.addEventListener('pointerup', () => setSprint(false));
  btnSprint?.addEventListener('pointercancel', () => setSprint(false));
  btnSprint?.addEventListener('pointerleave', () => setSprint(false));

  btnZoom?.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    zoomHeld = !zoomHeld;
    if (zoomHeld && zoomStep === 0 && isTouch) zoomStep = 1;
    btnZoom.classList.toggle('active', zoomHeld);
    audio.zoom(zoomHeld);
  });

  btnPause?.addEventListener('click', (e) => {
    e.preventDefault();
    togglePause();
  });

  startBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    startGame();
  });
  resumeBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    resumeGame();
  });
  rewindBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    rewindGame();
  });

  /* ------------------------------------------------------------------ */
  /* simulation                                                          */
  /* ------------------------------------------------------------------ */

  function placeCamera(dt) {
    const zoomFactor = zoomHeld ? ZOOM_LEVELS[zoomStep] : 1;
    const targetFov = baseFov / zoomFactor;
    fovCurrent = dt > 0 ? damp(fovCurrent, targetFov, 7.5, dt) : targetFov;
    camera.fov = fovCurrent;
    camera.updateProjectionMatrix();

    const speed = Math.hypot(velocity.x, velocity.y);
    const speedFrac = clamp(speed / RUN_SPEED, 0, 1);
    const bob =
      Math.sin(walkPhase * 2.0) * 0.021 * speedFrac +
      Math.sin(walkPhase) * 0.006 * speedFrac;

    const shakeMul = 1 + (zoomFactor - 1) * 0.5;
    const t = elapsed;
    let shakeX =
      (Math.sin(t * 0.31 + 1.7) * 0.0024 + Math.sin(t * 1.07) * 0.0011) * shakeMul;
    let shakeY =
      (Math.sin(t * 0.27 + 0.4) * 0.002 + Math.sin(t * 0.93 + 2.2) * 0.0009) * shakeMul;
    let shakeZ = Math.sin(t * 0.21 + 0.9) * 0.0026 * shakeMul;

    if (entity.active) {
      const d = Math.hypot(entity.position.x - player.x, entity.position.z - player.z);
      const near = clamp(1 - d / 15, 0, 1);
      shakeX += (Math.random() - 0.5) * 0.006 * near * near;
      shakeY += (Math.random() - 0.5) * 0.005 * near * near;
    }

    cameraRoll = damp(cameraRoll, rollInput, 5, dt);
    const rollBob = Math.sin(walkPhase) * 0.007 * speedFrac;

    camera.position.set(player.x, EYE_HEIGHT + bob, player.z);
    camera.rotation.set(
      clamp(player.pitch + shakeY, -1.35, 1.35),
      player.yaw + shakeX,
      cameraRoll + rollBob + shakeZ
    );

    camLight.position.set(player.x, EYE_HEIGHT + 0.2, player.z);
    camLight.intensity = battery <= 0 ? 1.4 : 5.5;
  }

  function updateDust() {
    const attr = dustGeo.getAttribute('position');
    const arr = attr.array;
    const t = elapsed;
    for (let i = 0; i < dustCount; i++) {
      const bx = dustBase[i * 3];
      const by = dustBase[i * 3 + 1];
      const bz = dustBase[i * 3 + 2];
      let x = camera.position.x + ((bx - camera.position.x + 8) % 16 + 16) % 16 - 8;
      let z = camera.position.z + ((bz - camera.position.z + 8) % 16 + 16) % 16 - 8;
      let y = 0.18 + ((by + t * 0.035) % 3.0);
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }
    attr.needsUpdate = true;
  }

  function updatePlayer(dt) {
    let fwd =
      (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + stickY;
    let strafe =
      (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + stickX;
    const len = Math.hypot(fwd, strafe);
    if (len > 1) {
      fwd /= len;
      strafe /= len;
    }

    const wantsSprint =
      (keys.ShiftLeft || keys.ShiftRight || sprintHeld) && len > 0.15 && stamina > 0.5;
    if (wantsSprint) {
      stamina = Math.max(0, stamina - 20.5 * dt);
      staminaCool = 1.15;
    } else {
      staminaCool = Math.max(0, staminaCool - dt);
      if (staminaCool <= 0) stamina = Math.min(100, stamina + 12.5 * dt);
    }

    const speed = wantsSprint ? RUN_SPEED : WALK_SPEED;
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw);
    const rz = -Math.sin(player.yaw);
    const targetX = (fx * fwd + rx * strafe) * speed;
    const targetZ = (fz * fwd + rz * strafe) * speed;
    const accel = len > 0.05 ? 10.5 : 8;
    const k = 1 - Math.exp(-accel * dt);
    velocity.x += (targetX - velocity.x) * k;
    velocity.y += (targetZ - velocity.y) * k;

    const beforeX = player.x;
    const beforeZ = player.z;
    const tmp = { x: player.x + velocity.x * dt, z: player.z + velocity.y * dt };
    world.resolveCircle(tmp, 0.32);
    player.x = tmp.x;
    player.z = tmp.z;

    const moved = Math.hypot(player.x - beforeX, player.z - beforeZ);
    distance += moved;
    stepAccum += moved;
    const stride = wantsSprint ? 1.28 : 1.72;
    if (stepAccum > stride) {
      stepAccum = 0;
      audio.footstep(wantsSprint);
    }

    if (moved > 0.0001) {
      walkPhase += moved * (wantsSprint ? 2.9 : 2.35);
    } else {
      walkPhase += dt * 0.6;
    }

    rollInput = -strafe * 0.014;
    return { wantsSprint, moving: len > 0.05 };
  }

  function updateBattery(dt) {
    const drain = 0.055 + (zoomHeld ? 0.09 : 0);
    battery = Math.max(0, battery - drain * dt);
    if (battery < 18 && !batteryWarned) {
      batteryWarned = true;
      showToast('BATTERY LOW', 2.4);
    }
  }

  function updateThreat(dt) {
    if (!entity.active) {
      threat = damp(threat, 0, 2.2, dt);
      return;
    }
    const d = Math.hypot(entity.position.x - player.x, entity.position.z - player.z);
    let target = clamp(1 - d / 24, 0, 1);
    if (entity.hunting) target = Math.min(1, target + 0.18);
    threat = damp(threat, target, 2.2, dt);
  }

  function updatePost(dt) {
    const targetGlitch =
      (state === 'dying' ? 0.75 : 0) +
      (state === 'dead' ? 0.35 : 0) +
      (entity.hunting ? 0.2 : 0) +
      threat * 0.28 +
      (battery < 18 ? 0.06 : 0) +
      0.025;
    post.uniforms.uGlitch.value = damp(post.uniforms.uGlitch.value, targetGlitch, 3.5, dt);

    const targetStatic =
      0.045 +
      threat * 0.16 +
      (battery < 12 ? 0.09 : 0) +
      (state === 'dying' || state === 'dead' ? 0.26 : 0);
    post.uniforms.uStatic.value = damp(post.uniforms.uStatic.value, targetStatic, 3, dt);
    post.uniforms.uFlash.value *= Math.exp(-dt * 6);
    post.uniforms.uTime.value = elapsed;
  }

  function updateHUD(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toastEl.classList.remove('show');
    }

    hudTimer += dt;
    if (hudTimer < 0.06) return;
    hudTimer = 0;

    timecodeEl.textContent = fmtTimecode(runTime);
    clockEl.textContent = fmtClock(runTime);
    dateEl.textContent = 'AUG 14 1996';

    const pct = Math.round(battery);
    battFill.style.width = `${pct}%`;
    battFill.style.background = battery < 18 ? '#d63a2f' : 'var(--cream)';
    battPct.textContent = String(pct);

    const mag = zoomHeld ? ZOOM_LEVELS[zoomStep] : 1;
    zoomVal.textContent = `${mag.toFixed(1)}×`;
    zoomFill.style.width = `${((mag - 1) / (ZOOM_LEVELS[ZOOM_LEVELS.length - 1] - 1)) * 100}%`;
    zoomMode.textContent = zoomStep > 0 ? 'MANUAL' : 'AUTO';
    focusReticle.style.opacity = zoomHeld ? '0.8' : '0';

    const code = (
      ((Math.floor(elapsed * 6) * 2654435761) ^
        (Math.floor(player.x * 17) + Math.floor(player.z * 43))) >>>
      0
    )
      .toString(16)
      .slice(0, 4)
      .padStart(4, '0');
    edgeCode.textContent = `0x${code}`;
  }

  function updateCameraDeath(dt) {
    deathElapsed += dt;
    const dx = entity.position.x - player.x;
    const dz = entity.position.z - player.z;
    const dist = Math.hypot(dx, dz) || 0.6;

    const targetYaw = Math.atan2(-dx, -dz);
    const targetPitch = Math.atan2(2.45 - EYE_HEIGHT, dist);
    const k = 1 - Math.exp(-dt * 7);
    player.yaw = lerpAngle(player.yaw, targetYaw, k);
    player.pitch = damp(player.pitch, targetPitch, 7, dt);

    const shake = 0.02 + Math.min(0.05, deathElapsed * 0.02);
    camera.position.set(player.x, EYE_HEIGHT, player.z);
    camera.rotation.set(
      player.pitch + (Math.random() - 0.5) * shake,
      player.yaw + (Math.random() - 0.5) * shake,
      (Math.random() - 0.5) * shake * 1.6
    );
    camera.fov = damp(camera.fov, 52, 3, dt);
    camera.updateProjectionMatrix();
    camLight.position.set(player.x, EYE_HEIGHT + 0.2, player.z);

    if (deathElapsed > 2.35) showDeath();
  }

  /* ------------------------------------------------------------------ */
  /* frame                                                               */
  /* ------------------------------------------------------------------ */

  let last = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(0.05, Math.max(0, rawDt));

    if (state === 'playing') {
      elapsed += dt;
      runTime += dt;
      updatePlayer(dt);
      world.update(player.x, player.z, elapsed);
      entity.update(dt, { x: player.x, z: player.z, yaw: player.yaw }, world, audio);
      if (state !== 'playing') {
        // The entity caught us during its update.
        updatePost(dt);
        post.render();
        return;
      }
      updateThreat(dt);
      audio.setThreat(threat, entity.hunting);
      audio.update(dt, { threat, active: true });
      placeCamera(dt);
      updateDust();
      updateBattery(dt);
      updatePost(dt);
      updateHUD(dt);
    } else if (state === 'dying') {
      elapsed += dt;
      runTime += dt;
      world.update(player.x, player.z, elapsed);
      entity.update(dt, { x: player.x, z: player.z, yaw: player.yaw }, world, audio);
      updateThreat(dt);
      audio.setThreat(threat, true);
      audio.update(dt, { threat: Math.max(threat, 0.8), active: true });
      updateCameraDeath(dt);
      updatePost(dt);
      updateHUD(dt);
    } else if (state === 'paused') {
      updatePost(dt * 0.25);
    } else if (state === 'intro') {
      elapsed += dt;
      world.update(player.x, player.z, elapsed);
      placeCamera(0);
      updateDust();
      updatePost(dt);
    } else {
      // dead: keep the last frame alive with heavy tape noise
      elapsed += dt;
      updatePost(dt);
    }

    post.render();
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    post.setSize();
  }

  window.addEventListener('resize', onResize);

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */

  startBtn.disabled = true;
  startBtn.textContent = 'LOADING';
  updateTapeLabel();
  resetSession();
  onResize();
  post.uniforms.uStatic.value = 0.22;
  requestAnimationFrame(frame);

  startBtn.disabled = false;
  startBtn.textContent = 'START';
  startBtn.focus({ preventScroll: true });
}

try {
  main();
} catch (err) {
  bootError(err);
}

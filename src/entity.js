import * as THREE from '../vendor/three.module.js';

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function yawToFace(dx, dz) {
  // model forward is -Z
  return Math.atan2(-dx, -dz);
}

export class Entity {
  constructor(scene, world, audio, callbacks = {}) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.callbacks = callbacks;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);

    this.position = new THREE.Vector3(0, -100, 0);
    this.group.position.copy(this.position);

    this.active = false;
    this.attacking = false;
    this.hunting = false;
    this.state = 'dormant';
    this.spawnTimer = 9.5;
    this.stalkTime = 0;
    this.huntTime = 0;
    this.seenTime = 0;
    this.teleportTimer = 11;
    this.stuckTime = 0;
    this.footstepTimer = 0;
    this.walkPhase = 0;
    this.attackTime = 0;
    this.awareness = 0;
    this.firstSpawn = true;
    this.strafeSign = Math.random() > 0.5 ? 1 : -1;
    this.desiredDist = 14;

    this.buildBody();
  }

  buildBody() {
    const skin = new THREE.MeshStandardMaterial({
      color: 0x060606,
      roughness: 0.78,
      metalness: 0.04,
    });
    const skin2 = new THREE.MeshStandardMaterial({
      color: 0x0a0a09,
      roughness: 0.62,
      metalness: 0.08,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x4a4737, toneMapped: false });
    this.skinMat = skin;

    this.body = new THREE.Group();
    this.group.add(this.body);

    this.hips = new THREE.Group();
    this.hips.position.y = 1.2;
    this.body.add(this.hips);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.86, 4, 9), skin);
    torso.position.y = 0.46;
    torso.scale.set(1.0, 1.0, 0.7);
    this.hips.add(torso);

    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.34, 4, 9), skin2);
    chest.position.y = 0.82;
    chest.scale.set(1.0, 1.0, 0.66);
    this.hips.add(chest);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.2, 8), skin);
    neck.position.y = 1.14;
    this.hips.add(neck);

    this.head = new THREE.Group();
    this.head.position.y = 1.31;
    this.hips.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin);
    skull.scale.set(0.82, 1.24, 0.92);
    skull.position.y = 0.06;
    this.head.add(skull);

    const eyeGeo = new THREE.SphereGeometry(0.013, 6, 5);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.062, 0.09, -0.166);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.062, 0.09, -0.166);
    this.head.add(eyeL, eyeR);

    // long, thin arms
    this.armL = this.makeArm(-0.3, 1.0, 0.24);
    this.armR = this.makeArm(0.3, 1.0, 0.24);
    this.hips.add(this.armL, this.armR);

    // legs
    this.legL = this.makeLeg(-0.13);
    this.legR = this.makeLeg(0.13);
    this.hips.add(this.legL, this.legR);

    // low, ragged hem / shadow around the feet
    const hem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.62, 0.12, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x040404, roughness: 1, metalness: 0, side: THREE.DoubleSide })
    );
    hem.position.y = 0.06;
    this.body.add(hem);
  }

  makeArm(x, y, shoulderTilt) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.rotation.z = shoulderTilt;

    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.46, 4, 7), this.skinMat);
    upper.position.y = -0.33;
    pivot.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.64;
    pivot.add(elbow);

    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.48, 4, 7), upper.material);
    fore.position.y = -0.32;
    elbow.add(fore);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 6), upper.material);
    hand.scale.set(0.7, 1.5, 0.55);
    hand.position.y = -0.63;
    elbow.add(hand);

    pivot.userData.elbow = elbow;
    return pivot;
  }

  makeLeg(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.0, 0);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.46, 4, 7), this.skinMat);
    thigh.position.y = -0.34;
    pivot.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.66;
    pivot.add(knee);

    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.46, 4, 7), thigh.material);
    calf.position.y = -0.32;
    knee.add(calf);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.34), thigh.material);
    foot.position.set(0, -0.61, -0.08);
    knee.add(foot);

    pivot.userData.knee = knee;
    return pivot;
  }

  /* ---------------------------------------------------------------- */

  reset() {
    this.active = false;
    this.attacking = false;
    this.hunting = false;
    this.state = 'dormant';
    this.spawnTimer = 9.5;
    this.stalkTime = 0;
    this.huntTime = 0;
    this.seenTime = 0;
    this.teleportTimer = 11;
    this.stuckTime = 0;
    this.awareness = 0;
    this.firstSpawn = true;
    this.group.visible = false;
    this.group.position.set(0, -100, 0);
    this.group.scale.setScalar(1);
    this.group.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.position.set(0, -100, 0);
  }

  spawn(player, forceHunt = false) {
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const min = this.awareness > 1 ? 11 : 15;
    const max = this.awareness > 1 ? 19 : 27;

    let p = this.world.findOpenPosition(player.x, player.z, min, max, {
      behind: true,
      forwardX,
      forwardZ,
      hidden: false,
    });
    if (!p) p = this.world.findOpenPosition(player.x, player.z, 8, 18, {});
    if (!p) return false;

    this.position.set(p.x, 0, p.z);
    this.group.position.copy(this.position);
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.active = true;
    this.attacking = false;
    this.hunting = forceHunt || this.awareness >= 3;
    this.state = this.hunting ? 'hunt' : 'stalk';
    this.stalkTime = 0;
    this.huntTime = 0;
    this.seenTime = 0;
    this.teleportTimer = 8 + Math.random() * 6;
    this.stuckTime = 0;
    this.footstepTimer = 0;
    this.walkPhase = Math.random() * 10;
    this.desiredDist = 14 - Math.min(6, this.awareness * 1.6);
    this.strafeSign = Math.random() > 0.5 ? 1 : -1;

    this.audio?.entitySpawn(this.distanceTo(player));
    if (this.firstSpawn) {
      this.firstSpawn = false;
      this.callbacks.onFirstSpawn?.();
    } else {
      this.callbacks.onSpawn?.();
    }
    return true;
  }

  vanish() {
    this.active = false;
    this.group.visible = false;
    this.state = 'dormant';
    this.spawnTimer = 5.5 + Math.random() * 6.5;
    this.awareness = Math.min(6, this.awareness + 1);
    this.seenTime = 0;
    this.audio?.entityVanish();
    this.callbacks.onVanish?.();
  }

  catchPlayer() {
    if (this.attacking) return;
    this.attacking = true;
    this.active = false;
    this.state = 'attack';
    this.attackTime = 0;
    this.group.visible = true;
    this.audio?.scream();
    this.callbacks.onCatch?.();
  }

  distanceTo(player) {
    return Math.hypot(player.x - this.position.x, player.z - this.position.z);
  }

  panTo(player) {
    const dx = this.position.x - player.x;
    const dz = this.position.z - player.z;
    const len = Math.hypot(dx, dz) || 1;
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);
    const side = (dx * rightX + dz * rightZ) / len;
    return clamp(side * 0.85, -1, 1);
  }

  update(dt, player, world, audio) {
    if (this.attacking) {
      this.updateAttack(dt, player);
      return;
    }

    if (!this.active) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && world.chunks.size > 0) {
        this.spawn(player, this.awareness >= 3);
      }
      return;
    }

    const dx = player.x - this.position.x;
    const dz = player.z - this.position.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist;
    const nz = dz / dist;
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const dot = (dx * forwardX + dz * forwardZ) / dist;
    const los = world.hasLineOfSight(player.x, player.z, this.position.x, this.position.z);
    const visible = los && dot > 0.48 && dist < 34;

    this.stalkTime += dt;
    this.teleportTimer -= dt;

    if (this.hunting) {
      this.huntTime += dt;
      this.state = 'hunt';
    } else {
      this.state = visible ? 'freeze' : 'stalk';
    }

    let speed = 0;
    let targetX = player.x;
    let targetZ = player.z;

    if (!this.hunting) {
      this.desiredDist = Math.max(6.5, 14 - this.stalkTime * 0.11 - this.awareness * 1.4);

      if (visible) {
        this.seenTime += dt;
        speed = 0;
        if (this.seenTime > 2.5 && this.stalkTime > 3.0) {
          this.vanish();
          return;
        }
      } else {
        this.seenTime = Math.max(0, this.seenTime - dt * 0.9);
        speed = 1.45 + this.awareness * 0.16;
        const behindX = player.x - forwardX * this.desiredDist;
        const behindZ = player.z - forwardZ * this.desiredDist;
        if (dist > this.desiredDist + 4.5) {
          targetX = player.x;
          targetZ = player.z;
        } else if (world.isFree(behindX, behindZ, 0.7)) {
          const sway = Math.sin(this.stalkTime * 0.7 + this.walkPhase) * 2.2;
          targetX = behindX + forwardZ * sway * this.strafeSign;
          targetZ = behindZ - forwardX * sway * this.strafeSign;
        } else {
          targetX = player.x;
          targetZ = player.z;
        }
      }

      if (dist < 5.6) this.hunting = true;
      if (this.stalkTime > 52) this.hunting = true;
      if (this.awareness >= 3) this.hunting = true;

      // occasional repositioning when it is out of sight
      if (this.teleportTimer <= 0 && !visible && dist > 9) {
        const p = world.findOpenPosition(player.x, player.z, 9, 17, {
          behind: true,
          forwardX,
          forwardZ,
          hidden: true,
        });
        if (p) {
          this.position.set(p.x, 0, p.z);
          this.group.position.copy(this.position);
          audio?.entityGlitch();
          this.teleportTimer = 10 + Math.random() * 8;
        } else {
          this.teleportTimer = 4;
        }
      }
    } else {
      // hunting
      speed = 3.05 + Math.min(1.35, this.huntTime * 0.028) + this.awareness * 0.08;
      targetX = player.x;
      targetZ = player.z;

      if (dist < 2.2) speed *= 1.45;
      if (dist < 1.25) {
        this.catchPlayer();
        return;
      }

      // if it loses you for a while, cut you off from behind
      if (this.teleportTimer <= 0 && !visible && dist > 11) {
        const p = world.findOpenPosition(player.x, player.z, 8, 14, {
          behind: true,
          forwardX,
          forwardZ,
          hidden: true,
        });
        if (p) {
          this.position.set(p.x, 0, p.z);
          this.group.position.copy(this.position);
          audio?.entityGlitch();
          this.teleportTimer = 6 + Math.random() * 5;
        } else {
          this.teleportTimer = 3.5;
        }
      }
    }

    // steer toward target
    const tdx = targetX - this.position.x;
    const tdz = targetZ - this.position.z;
    const tlen = Math.hypot(tdx, tdz) || 1;
    let dirX = tdx / tlen;
    let dirZ = tdz / tlen;

    if (speed > 0.01) {
      const step = speed * dt;
      const beforeX = this.position.x;
      const beforeZ = this.position.z;

      // try direct, then fan out around walls
      const angles = [0, 0.45, -0.45, 0.9, -0.9, 1.45, -1.45, 2.0, -2.0];
      let moved = false;
      for (const a of angles) {
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const mx = dirX * ca - dirZ * sa;
        const mz = dirX * sa + dirZ * ca;
        const testX = this.position.x + mx * step;
        const testZ = this.position.z + mz * step;
        if (world.isFree(testX, testZ, 0.38)) {
          this.position.x = testX;
          this.position.z = testZ;
          moved = true;
          break;
        }
      }
      if (!moved) {
        // slide along the nearest wall by trying a tiny step
        this.position.x += dirX * step * 0.2;
        this.position.z += dirZ * step * 0.2;
        world.resolveCircle(this.position, 0.38);
      }

      const movedDist = Math.hypot(this.position.x - beforeX, this.position.z - beforeZ);
      if (movedDist < step * 0.22) this.stuckTime += dt;
      else this.stuckTime = Math.max(0, this.stuckTime - dt * 0.5);

      this.walkPhase += dt * (2.8 + speed * 1.5);
      const bob = Math.abs(Math.sin(this.walkPhase)) * 0.035;
      this.group.position.set(this.position.x, bob, this.position.z);

      const faceDx = this.position.x - beforeX;
      const faceDz = this.position.z - beforeZ;
      if (Math.abs(faceDx) + Math.abs(faceDz) > 0.0001) {
        this.group.rotation.y = yawToFace(faceDx, faceDz);
      }

      const swing = Math.sin(this.walkPhase) * (this.hunting ? 0.75 : 0.38);
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.armL.rotation.x = -swing * 0.75;
      this.armR.rotation.x = swing * 0.75;
      this.armL.userData.elbow.rotation.x = -0.25 + Math.max(0, -swing) * 0.5;
      this.armR.userData.elbow.rotation.x = -0.25 + Math.max(0, swing) * 0.5;
      this.legL.userData.knee.rotation.x = Math.max(0, -swing) * 0.5;
      this.legR.userData.knee.rotation.x = Math.max(0, swing) * 0.5;

      this.head.rotation.z = Math.sin(this.walkPhase * 0.53) * 0.06;
      this.head.rotation.x = 0.06 + Math.sin(this.walkPhase * 0.31) * 0.04;

      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.footstepTimer = this.hunting ? 0.31 : 0.62;
        audio?.entityStep(clamp(1 - dist / 26, 0.15, 1), this.panTo(player), this.hunting);
      }

      if (this.stuckTime > 1.35) {
        this.stuckTime = 0;
        const p = world.findOpenPosition(player.x, player.z, 8, 16, {
          behind: true,
          forwardX,
          forwardZ,
          hidden: true,
        });
        if (p) {
          this.position.set(p.x, 0, p.z);
          this.group.position.copy(this.position);
          audio?.entityGlitch();
          this.teleportTimer = 7 + Math.random() * 5;
        }
      }
    } else {
      // frozen in your sight
      const faceYaw = yawToFace(dx, dz);
      let diff = faceYaw - this.group.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.group.rotation.y += diff * Math.min(1, dt * 2.0);
      this.group.position.set(this.position.x, 0, this.position.z);

      const t = performance.now() * 0.001;
      this.armL.rotation.x = damp(this.armL.rotation.x, -0.08, 2, dt);
      this.armR.rotation.x = damp(this.armR.rotation.x, -0.08, 2, dt);
      this.legL.rotation.x = damp(this.legL.rotation.x, 0, 3, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, 0, 3, dt);
      this.head.rotation.z = Math.sin(t * 0.8) * 0.09;
      this.head.rotation.x = 0.12;
    }

    // a slight lean when hunting
    const leanTarget = this.hunting ? 0.16 : 0.04;
    this.body.rotation.x = damp(this.body.rotation.x, leanTarget, 2, dt);
    this.body.position.y = damp(this.body.position.y, this.hunting ? 0.02 : 0, 2, dt);
  }

  updateAttack(dt, player) {
    this.attackTime += dt;
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const targetX = player.x + forwardX * 0.92;
    const targetZ = player.z + forwardZ * 0.92;
    const k = 1 - Math.exp(-dt * 9.0);
    this.position.x += (targetX - this.position.x) * k;
    this.position.z += (targetZ - this.position.z) * k;
    this.group.position.set(this.position.x, -0.5, this.position.z);
    this.group.rotation.y = yawToFace(player.x - this.position.x, player.z - this.position.z);
    this.group.scale.setScalar(1 + Math.min(0.16, this.attackTime * 0.35));

    const flail = Math.sin(this.attackTime * 35) * 0.5;
    this.armL.rotation.x = -1.5 + flail;
    this.armR.rotation.x = -1.5 - flail;
    this.legL.rotation.x = flail * 0.4;
    this.legR.rotation.x = -flail * 0.4;
    this.head.rotation.x = -0.25 + Math.sin(this.attackTime * 22) * 0.12;
    this.body.rotation.x = 0.35;
  }
}

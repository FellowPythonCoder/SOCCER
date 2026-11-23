// The AI striker. A simple forward-kinematic rig whose pose comes straight from
// the shooter's state machine: run cycle while approaching, a wind-up and a
// full kicking arc at strike time.

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

function seg(a, b, radiusA, radiusB, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radiusB, radiusA, 1, 10), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.a = a;
  m.userData.b = b;
  return m;
}

function align(mesh, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  mesh.position.set(a.x + dx / 2, a.y + dy / 2, a.z + dz / 2);
  mesh.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx / len, dy / len, dz / len));
  mesh.scale.set(1, len, 1);
}

export class ShooterMesh {
  constructor() {
    this.group = new THREE.Group();
    this.mat = {
      shirt: new THREE.MeshStandardMaterial({ color: 0xf24d6a, roughness: 0.6 }),
      shirtDark: new THREE.MeshStandardMaterial({ color: 0xc22a45, roughness: 0.65 }),
      shorts: new THREE.MeshStandardMaterial({ color: 0xf7f9ff, roughness: 0.7 }),
      skin: new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.7 }),
      sock: new THREE.MeshStandardMaterial({ color: 0xf24d6a, roughness: 0.85 }),
      boot: new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.35, metalness: 0.2 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x100c0a, roughness: 0.95 }),
    };
    this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 14), this.mat.shirt);
    this.torso.castShadow = true;
    this.group.add(this.torso);
    this.hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.1, 6, 12), this.mat.shorts);
    this.hips.castShadow = true;
    this.group.add(this.hips);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), this.mat.skin);
    this.head.castShadow = true;
    this.group.add(this.head);
    this.hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), this.mat.hair);
    this.group.add(this.hair);
    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.1, 8), this.mat.skin);
    this.group.add(this.neck);

    this.parts = {};
    const mk = (name, ra, rb, mat) => {
      const m = seg({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, ra, rb, mat);
      this.parts[name] = m;
      this.group.add(m);
      return m;
    };
    for (const s of ['L', 'R']) {
      mk(`uarm${s}`, 0.06, 0.05, this.mat.shirt);
      mk(`farm${s}`, 0.048, 0.04, this.mat.skin);
      mk(`thigh${s}`, 0.1, 0.075, this.mat.shorts);
      mk(`shin${s}`, 0.07, 0.05, this.mat.sock);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.27), this.mat.boot);
      boot.castShadow = true;
      this.parts[`boot${s}`] = boot;
      this.group.add(boot);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), this.mat.skin);
      this.parts[`hand${s}`] = hand;
      this.group.add(hand);
    }
    this.time = 0;
  }

  // shooter: sim/shooter.js instance
  update(shooter, dt, ball) {
    this.time += dt;
    const s = shooter;
    const facing = s.facing;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const rx = Math.cos(facing);
    const rz = -Math.sin(facing);
    const pose = s.pose();
    const speed = Math.hypot(s.vel.x, s.vel.z);
    const cycle = this.time * (4 + speed * 1.3) * Math.PI * 2;

    const origin = { x: s.pos.x, y: 0, z: s.pos.z };
    const lean = pose.lean;
    const hipY = 0.92 - Math.min(0.12, speed * 0.015) - Math.abs(Math.sin(cycle)) * 0.02 * Math.min(1, speed);
    const pelvis = { x: origin.x - fx * lean * 0.2, y: hipY, z: origin.z - fz * lean * 0.2 };
    const chest = {
      x: pelvis.x + fx * lean * 0.55,
      y: hipY + 0.42,
      z: pelvis.z + fz * lean * 0.55,
    };
    const head = { x: chest.x + fx * 0.06, y: chest.y + 0.26, z: chest.z + fz * 0.06 };

    // torso
    align(this.torso, pelvis, chest);
    this.torso.scale.set(1, 0.34 / 0.42, 1);
    const hipMid = { x: pelvis.x, y: pelvis.y + 0.02, z: pelvis.z };
    align(this.hips, pelvis, { x: hipMid.x, y: hipMid.y - 0.1, z: hipMid.z });
    align(this.neck, chest, head);
    this.head.position.set(head.x, head.y, head.z);
    this.hair.position.copy(this.head.position);
    this.hair.position.y += 0.012;

    // shoulders
    const shL = { x: chest.x - rx * 0.19, y: chest.y + 0.03, z: chest.z - rz * 0.19 };
    const shR = { x: chest.x + rx * 0.19, y: chest.y + 0.03, z: chest.z + rz * 0.19 };

    // arms swing opposite the legs while running
    for (const [side, sh, sx] of [['L', shL, -1], ['R', shR, 1]]) {
      let swing = Math.sin(cycle + (side === 'L' ? 0 : Math.PI)) * 0.5 * Math.min(1, speed / 3);
      if (side === 'L') swing = -swing;
      const out = 0.16 + Math.abs(swing) * 0.1;
      const elbow = {
        x: sh.x + fx * swing * 0.3 + rx * sx * out,
        y: sh.y - 0.28,
        z: sh.z + fz * swing * 0.3 + rz * sx * out,
      };
      const hand = {
        x: elbow.x + fx * (swing * 0.22 + 0.06),
        y: elbow.y - 0.24,
        z: elbow.z + fz * (swing * 0.22 + 0.06),
      };
      align(this.parts[`uarm${side}`], sh, elbow);
      align(this.parts[`farm${side}`], elbow, hand);
      this.parts[`hand${side}`].position.set(hand.x, hand.y, hand.z);
    }

    // legs: stance leg planted, kicking leg swings through the ball
    const kick = pose.kick; // negative in wind-up, 0..1 at strike
    for (const [side, sx] of [['L', -1], ['R', 1]]) {
      const hip = { x: pelvis.x + rx * sx * 0.1, y: pelvis.y, z: pelvis.z + rz * sx * 0.1 };
      let footX;
      let footZ;
      let footY;
      const isKick = s.shot?.kickLeg === side;
      if (isKick && (s.state === 'windup' || s.state === 'strike' || s.state === 'follow')) {
        const back = Math.min(0, kick);
        const through = Math.max(0, Math.min(1.4, kick));
        const fp = s.footPosition();
        footX = fp.x;
        footY = fp.y;
        footZ = fp.z;
      } else {
        const swing = Math.sin(cycle + (side === 'L' ? 0 : Math.PI)) * 0.34 * Math.min(1, speed / 3);
        footX = origin.x + fx * swing + rx * sx * 0.13;
        footY = 0.07 + Math.max(0, Math.sin(cycle + (side === 'L' ? 0 : Math.PI))) * 0.08 * Math.min(1, speed / 3);
        footZ = origin.z + fz * swing + rz * sx * 0.13;
      }
      const knee = {
        x: (hip.x + footX) / 2 + fx * 0.06,
        y: (hip.y + footY) / 2 + 0.04,
        z: (hip.z + footZ) / 2 + fz * 0.06,
      };
      align(this.parts[`thigh${side}`], hip, knee);
      align(this.parts[`shin${side}`], knee, { x: footX, y: footY + 0.04, z: footZ });
      const boot = this.parts[`boot${side}`];
      boot.position.set(footX, Math.max(0.05, footY), footZ);
      boot.rotation.set(0, facing, 0);
    }
  }
}

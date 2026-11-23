// Renders the ragdoll as a real player. Every frame the mesh is rebuilt from
// the simulator's particle positions — the geometry IS the physics.

import * as THREE from 'three';
import { KEEPER } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0);

function limb(a, b, radiusA, radiusB, mat, radial = 10) {
  // tapered capsule between two world points
  const geo = new THREE.CylinderGeometry(radiusB, radiusA, 1, radial, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.a = a;
  mesh.userData.b = b;
  return mesh;
}

function ball3(p, r, mat, seg = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.p = p;
  return m;
}

// Orient a segment mesh between two points and scale its length.
function alignSegment(mesh, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  mesh.position.set(a.x + dx / 2, a.y + dy / 2, a.z + dz / 2);
  mesh.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx / len, dy / len, dz / len));
  mesh.scale.set(1, len, 1);
}

export class KeeperMesh {
  constructor(ragdoll) {
    this.ragdoll = ragdoll;
    this.group = new THREE.Group();

    this.mat = {
      kit: new THREE.MeshStandardMaterial({ color: 0x25e08a, roughness: 0.55, metalness: 0.05 }),
      kitDark: new THREE.MeshStandardMaterial({ color: 0x11a86a, roughness: 0.6 }),
      shorts: new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.7 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xc98e6b, roughness: 0.68 }),
      glove: new THREE.MeshStandardMaterial({ color: 0xf5f7ff, roughness: 0.42, metalness: 0.08 }),
      sock: new THREE.MeshStandardMaterial({ color: 0x0f1a14, roughness: 0.85 }),
      boot: new THREE.MeshStandardMaterial({ color: 0xf2f2f5, roughness: 0.35, metalness: 0.15 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x22160f, roughness: 0.9 }),
    };

    const P = this.ragdoll.parts;
    this.meshes = {};

    // torso: a lathe-ish shape scaled between pelvis and chest
    this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.24, 6, 14), this.mat.kit);
    this.torso.castShadow = true;
    this.torso.receiveShadow = true;
    this.group.add(this.torso);

    this.hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.1, 6, 12), this.mat.shorts);
    this.hips.rotation.z = Math.PI / 2;
    this.hips.castShadow = true;
    this.group.add(this.hips);

    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.12, 10), this.mat.skin);
    this.neck.castShadow = true;
    this.group.add(this.neck);

    this.head = new THREE.Mesh(new THREE.SphereGeometry(KEEPER.headRadius, 20, 16), this.mat.skin);
    this.head.scale.set(0.92, 1.06, 1);
    this.head.castShadow = true;
    this.group.add(this.head);

    // hair cap
    this.hair = new THREE.Mesh(new THREE.SphereGeometry(KEEPER.headRadius * 1.02, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), this.mat.hair);
    this.hair.castShadow = true;
    this.group.add(this.hair);

    // limbs
    this.armL = [limb('chest', 'shL', 0.075, 0.07, this.mat.kit), limb('shL', 'elL', 0.062, 0.055, this.mat.kit), limb('elL', 'haL', 0.05, 0.042, this.mat.skin)];
    this.armR = [limb('chest', 'shR', 0.075, 0.07, this.mat.kit), limb('shR', 'elR', 0.062, 0.055, this.mat.kit), limb('elR', 'haR', 0.05, 0.042, this.mat.skin)];
    // shoulder pads make the silhouette read as a keeper
    this.shoulders = [
      new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), this.mat.kitDark),
      new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), this.mat.kitDark),
    ];
    this.shoulders.forEach((m) => { m.castShadow = true; this.group.add(m); });

    this.legL = [limb('hipL', 'knL', 0.095, 0.078, this.mat.shorts), limb('knL', 'ftL', 0.068, 0.05, this.mat.sock)];
    this.legR = [limb('hipR', 'knR', 0.095, 0.078, this.mat.shorts), limb('knR', 'ftR', 0.068, 0.05, this.mat.sock)];

    for (const m of [...this.armL, ...this.armR, ...this.legL, ...this.legR]) this.group.add(m);

    // gloves
    this.gloveL = ball3('haL', 0.105, this.mat.glove);
    this.gloveR = ball3('haR', 0.105, this.mat.glove);
    this.group.add(this.gloveL, this.gloveR);

    // boots: flattened boxes oriented along the foot direction
    this.bootL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.26), this.mat.boot);
    this.bootR = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.26), this.mat.boot);
    for (const b of [this.bootL, this.bootR]) { b.castShadow = true; this.group.add(b); }
  }

  update() {
    const P = this.ragdoll.parts;
    const p = (n) => P[n].p;

    alignSegment(this.neck, p('chest'), p('head'));
    this.head.position.set(p('head').x, p('head').y, p('head').z);
    this.hair.position.copy(this.head.position);
    this.hair.position.y += 0.012;

    // torso bridge: pelvis -> chest, with the capsule volume in between
    alignSegment(this.torso, p('pelvis'), p('chest'));
    // chest is 0.34 above pelvis in rest, capsule body length 0.24 => scale length
    const d = dist(p('pelvis'), p('chest'));
    this.torso.scale.set(1, d / 0.34, 1);

    // hips: pelvis -> midpoint of hip joints
    const hipMid = mid(p('hipL'), p('hipR'));
    alignSegment(this.hips, p('pelvis'), hipMid);

    for (const [side, arm] of [['L', this.armL], ['R', this.armR]]) {
      alignSegment(arm[0], p('chest'), p(`sh${side}`));
      alignSegment(arm[1], p(`sh${side}`), p(`el${side}`));
      alignSegment(arm[2], p(`el${side}`), p(`ha${side}`));
    }
    this.shoulders[0].position.set(p('shL').x, p('shL').y, p('shL').z);
    this.shoulders[1].position.set(p('shR').x, p('shR').y, p('shR').z);
    this.gloveL.position.set(p('haL').x, p('haL').y, p('haL').z);
    this.gloveR.position.set(p('haR').x, p('haR').y, p('haR').z);

    for (const [side, leg] of [['L', this.legL], ['R', this.legR]]) {
      alignSegment(leg[0], p(`hip${side}`), p(`kn${side}`));
      alignSegment(leg[1], p(`kn${side}`), p(`ft${side}`));
    }

    // boots: point them along the shin, flattened
    for (const [side, boot] of [['L', this.bootL], ['R', this.bootR]]) {
      const kn = p(`kn${side}`);
      const ft = p(`ft${side}`);
      boot.position.set(ft.x, ft.y - 0.03, ft.z);
      const dx = ft.x - kn.x;
      const dz = ft.z - kn.z;
      boot.rotation.set(0, Math.atan2(dx, dz), 0);
    }
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

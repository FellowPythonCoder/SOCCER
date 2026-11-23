// Position-based-dynamics ragdoll.
//
// There is no animation clip anywhere in this project. The keeper is a set of
// point masses (pelvis, chest, head, shoulders, elbows, hands, hips, knees,
// feet) bound by distance constraints. Gravity, inertia, ground contact and
// muscle torques do the rest. A "dive" is simply an impulse applied to the
// mass distribution: pelvis velocity + a rigid-body angular velocity seeded
// from the up-vector onto the dive axis, after which the simulation takes over.

import { KEEPER } from '../config.js';

const G = -9.81;

export const P = {
  pelvis: 'pelvis',
  chest: 'chest',
  head: 'head',
  shL: 'shL', elL: 'elL', haL: 'haL',
  shR: 'shR', elR: 'elR', haR: 'haR',
  hipL: 'hipL', knL: 'knL', ftL: 'ftL',
  hipR: 'hipR', knR: 'knR', ftR: 'ftR',
};

// Collision radii (metres) used for ball contact. Hands get a slightly larger
// sphere: the glove reaches a bit further than the wrist.
export const RADII = {
  pelvis: 0.15,
  chest: 0.17,
  head: 0.12,
  shL: 0.09, elL: 0.075, haL: 0.105,
  shR: 0.09, elR: 0.075, haR: 0.105,
  hipL: 0.1, knL: 0.085, ftL: 0.09,
  hipR: 0.1, knR: 0.085, ftR: 0.09,
};

const H = KEEPER.hipHeight;
const SW = KEEPER.shoulderWidth;
const HW = KEEPER.hipWidth;
const T = KEEPER.thigh;
const S = KEEPER.shin;

// Default skeleton in its rest (standing) pose, hips at KEEPER.hipHeight.
export function restPose() {
  return {
    pelvis: [0, H, 0],
    chest: [0, H + 0.34, 0],
    head: [0, H + 0.34 + KEEPER.neck + 0.16, 0],
    shL: [-SW, H + 0.44, 0], elL: [-SW * 1.1, H + 0.14, 0.03], haL: [-SW * 1.15, H - 0.13, 0.06],
    shR: [SW, H + 0.44, 0], elR: [SW * 1.1, H + 0.14, 0.03], haR: [SW * 1.15, H - 0.13, 0.06],
    hipL: [-HW, H, 0], knL: [-HW, H - T, 0], ftL: [-HW, 0.02, 0.0],
    hipR: [HW, H, 0], knR: [HW, H - T, 0], ftR: [HW, 0.02, 0.0],
  };
}

// Distance constraints. `k` = stiffness. `max` = optional hard joint limit.
const BONE_DEFS = [
  ['pelvis', 'chest', 1], ['chest', 'head', 1], ['pelvis', 'head', 0.55],
  ['chest', 'shL', 1], ['chest', 'shR', 1], ['shL', 'shR', 1],
  ['shL', 'elL', 1], ['elL', 'haL', 1], ['shR', 'elR', 1], ['elR', 'haR', 1],
  ['pelvis', 'hipL', 1], ['pelvis', 'hipR', 1], ['hipL', 'hipR', 1],
  ['hipL', 'knL', 1], ['knL', 'ftL', 1], ['hipR', 'knR', 1], ['knR', 'ftR', 1],
  ['chest', 'hipL', 0.9], ['chest', 'hipR', 0.9],
  // "soft tissue" braces that stop the torso folding in half
  ['chest', 'knL', 0.12], ['chest', 'knR', 0.12],
  ['head', 'shL', 0.5], ['head', 'shR', 0.5],
  ['haL', 'haR', 0.25], ['ftL', 'ftR', 0.2],
  ['haL', 'pelvis', 0.18], ['haR', 'pelvis', 0.18],
];

export class Ragdoll {
  constructor(origin = { x: 0, z: 0 }) {
    this.parts = {};
    this.bones = [];
    this.time = 0;
    const rest = restPose();
    for (const name of Object.keys(P)) this.parts[name] = null;
    // create particles
    for (const [name, [x, y, z]] of Object.entries(rest)) {
      this.parts[name] = {
        name,
        p: { x: origin.x + x, y, z: origin.z + z },
        prev: { x: origin.x + x, y, z: origin.z + z },
        v: { x: 0, y: 0, z: 0 },
        invMass: invMassFor(name),
        radius: RADII[name],
        grounded: false,
        free: true, // free = ragdoll dynamics; false = kinematic target
        target: null,
      };
    }
    for (const [a, b, k] of BONE_DEFS) {
      const pa = this.parts[a];
      const pb = this.parts[b];
      this.bones.push({
        a,
        b,
        k,
        length: dist3(pa.p, pb.p),
        min: 0,
        max: Infinity,
        restLength: dist3(pa.p, pb.p),
      });
    }
    this.root = this.parts.pelvis;
    this.mode = 'stand'; // stand | dive | limp | recover
  }

  part(name) { return this.parts[name]; }

  // Shift the entire ragdoll (used on reset / respawn).
  teleport(x, z, facing = 0) {
    const rest = restPose();
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    for (const [name, [rx, ry, rz]] of Object.entries(rest)) {
      const wx = rx * c + rz * s;
      const wz = -rx * s + rz * c;
      const q = this.parts[name];
      q.p.x = x + wx;
      q.p.y = ry;
      q.p.z = z + wz;
      q.prev.x = q.p.x;
      q.prev.y = q.p.y;
      q.prev.z = q.p.z;
      q.v.x = 0; q.v.y = 0; q.v.z = 0;
      q.free = true;
      q.grounded = false;
    }
    for (const b of this.bones) {
      b.length = dist3(this.parts[b.a].p, this.parts[b.b].p);
    }
    this.mode = 'stand';
  }

  // Seed a dive: rigid-body impulse about the pelvis.
  applyDiveImpulse({ pelvisVel, axis: rawAxis, spinTime = 0.33, extra = 1 }) {
    const p = this.parts.pelvis.p;
    // Accept either {x,y,z} or [x,y,z] so a malformed plan can never poison the
    // solver with NaN.
    const to = Array.isArray(rawAxis)
      ? { x: rawAxis[0], y: rawAxis[1], z: rawAxis[2] }
      : { x: rawAxis.x, y: rawAxis.y, z: rawAxis.z };
    const len = Math.hypot(to.x, to.y, to.z);
    if (!Number.isFinite(len) || len < 1e-6) return;
    to.x /= len; to.y /= len; to.z /= len;
    // rotation taking +Y onto `axis`
    const from = { x: 0, y: 1, z: 0 };
    const axisRot = cross3(from, to); // rotation axis
    const sinA = Math.hypot(axisRot.x, axisRot.y, axisRot.z);
    const cosA = from.x * to.x + from.y * to.y + from.z * to.z;
    const angle = Math.atan2(sinA, cosA);
    const n = sinA > 1e-5
      ? { x: axisRot.x / sinA, y: axisRot.y / sinA, z: axisRot.z / sinA }
      : { x: 0, y: 0, z: 0 };
    const omega = (angle / Math.max(0.16, spinTime)) * 0.85 * extra;
    const w = { x: n.x * omega, y: n.y * omega, z: n.z * omega };
    for (const part of Object.values(this.parts)) {
      const r = { x: part.p.x - p.x, y: part.p.y - p.y, z: part.p.z - p.z };
      const vrot = cross3(w, r);
      part.v.x = pelvisVel.x + vrot.x;
      part.v.y = pelvisVel.y + vrot.y;
      part.v.z = pelvisVel.z + vrot.z;
      // small outward "stretch" so limbs extend into the dive
      part.free = true;
    }
    this.mode = 'dive';
    this.omega = w;
  }

  // PD-style muscle: pull a pair of particles toward `desired` separation.
  setBoneTarget(a, b, length, stiffness = 0.6) {
    const bone = this.bones.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (!bone) return;
    bone.length = bone.length + (length - bone.length) * stiffness;
  }

  step(dt, opts = {}) {
    const gravity = opts.rigid ? 0 : opts.gravity ?? G;
    const damping = opts.damping ?? 0.9975;
    const groundY = opts.groundY ?? 0;
    const friction = opts.friction ?? 0.34;
    this.time += dt;
    const parts = Object.values(this.parts);

    // 1. integrate forces
    for (const part of parts) {
      part.prev.x = part.p.x;
      part.prev.y = part.p.y;
      part.prev.z = part.p.z;
      if (part.free) {
        part.v.y += gravity * dt;
        part.v.x *= damping;
        part.v.y *= damping;
        part.v.z *= damping;
        part.p.x += part.v.x * dt;
        part.p.y += part.v.y * dt;
        part.p.z += part.v.z * dt;
      }
    }

    // 2. solve constraints (Gauss-Seidel)
    const iters = opts.iterations ?? 5;
    for (let it = 0; it < iters; it++) {
      for (const bone of this.bones) {
        const a = this.parts[bone.a];
        const b = this.parts[bone.b];
        let dx = b.p.x - a.p.x;
        let dy = b.p.y - a.p.y;
        let dz = b.p.z - a.p.z;
        let d = Math.hypot(dx, dy, dz);
        if (d < 1e-6) continue;
        const target = bone.length;
        const diff = (d - target) / d;
        const wa = a.invMass;
        const wb = b.invMass;
        const wsum = wa + wb;
        if (wsum <= 0) continue;
        const k = bone.k;
        const corrX = dx * diff * k;
        const corrY = dy * diff * k;
        const corrZ = dz * diff * k;
        if (a.free) {
          a.p.x += corrX * (wa / wsum);
          a.p.y += corrY * (wa / wsum);
          a.p.z += corrZ * (wa / wsum);
        }
        if (b.free) {
          b.p.x -= corrX * (wb / wsum);
          b.p.y -= corrY * (wb / wsum);
          b.p.z -= corrZ * (wb / wsum);
        }
      }
      // kinematic parts get snapped to their targets each iteration
      for (const part of parts) {
        if (!part.free && part.target) {
          part.p.x = part.target.x;
          part.p.y = part.target.y;
          part.p.z = part.target.z;
        }
      }
    }

    // 3. ground contact + friction (skipped while the keeper is pushing off /
    //    airborne on the launch frame — the turf is providing the reaction)
    for (const part of parts) {
      // Feet are pinned by the stance controller while standing; the ground
      // solver must not fight it or the legs get shoved through the torso.
      if (opts.skipParts && opts.skipParts.has(part.name)) {
        part.grounded = false;
        continue;
      }
      if (opts.suppressGround) { part.grounded = false; continue; }
      // `airborne` lists parts allowed to touch the ground while the rest of
      // the body is in flight (the keeper is horizontal, only his hip/chest
      // can scrape the turf).
      if (opts.airborne && !opts.airborne.has(part.name)) {
        part.grounded = false;
        continue;
      }
      if (part.p.y < part.radius + groundY) {
        part.p.y = part.radius + groundY;
        const vx = (part.p.x - part.prev.x) / dt;
        const vz = (part.p.z - part.prev.z) / dt;
        // tangential friction: resist sliding proportional to normal force
        part.p.x -= vx * friction * dt;
        part.p.z -= vz * friction * dt;
        part.prev.y = part.p.y + Math.max(0, -(part.p.y - part.prev.y)) * 0.1;
        part.grounded = true;
      } else {
        part.grounded = false;
      }
      // never let the head/body sink through the turf
      if (part.p.y < 0.02) part.p.y = 0.02;
    }

    // 4. derive velocities
    for (const part of parts) {
      if (!part.free) {
        part.v.x = (part.p.x - part.prev.x) / dt;
        part.v.y = (part.p.y - part.prev.y) / dt;
        part.v.z = (part.p.z - part.prev.z) / dt;
        continue;
      }
      part.v.x = (part.p.x - part.prev.x) / dt;
      part.v.y = (part.p.y - part.prev.y) / dt;
      part.v.z = (part.p.z - part.prev.z) / dt;
      // hard speed clamp keeps the solver sane on big impulses
      const sp = Math.hypot(part.v.x, part.v.y, part.v.z);
      const maxSp = 22;
      if (sp > maxSp) {
        const s = maxSp / sp;
        part.v.x *= s; part.v.y *= s; part.v.z *= s;
      }
    }
  }

  centroid() {
    let x = 0, y = 0, z = 0, n = 0;
    for (const part of Object.values(this.parts)) {
      x += part.p.x; y += part.p.y; z += part.p.z; n++;
    }
    return { x: x / n, y: y / n, z: z / n };
  }

  // Collision spheres for ball interaction. `ext` lets the hands count extra
  // reach while the arm is extending.
  collisionSpheres() {
    const out = [];
    for (const part of Object.values(this.parts)) {
      out.push({ name: part.name, c: part.p, r: part.radius, part });
    }
    return out;
  }

  // Approximate total height (for debugging / stats).
  height() {
    let min = Infinity, max = -Infinity;
    for (const part of Object.values(this.parts)) {
      min = Math.min(min, part.p.y);
      max = Math.max(max, part.p.y);
    }
    return max - min;
  }
}

function invMassFor(name) {
  // arbitrary but plausible distribution: torso heavy, hands light
  const m = {
    pelvis: 14, chest: 22, head: 6,
    shL: 3, elL: 2, haL: 1.2, shR: 3, elR: 2, haR: 1.2,
    hipL: 8, knL: 5, ftL: 3.5, hipR: 8, knR: 5, ftR: 3.5,
  }[name] ?? 4;
  return 1 / m;
}

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const cross3 = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

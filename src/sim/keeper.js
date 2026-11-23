// Goalkeeper controller.
//
// The keeper is a real ragdoll (see sim/ragdoll.js). This file is the "nervous
// system": it turns WASD input and dive plans into muscle targets applied to
// the ragdoll every tick. Nothing here is a canned animation — the gait is a
// foot-planting cycle whose stance feet are pinned in world space, and the
// dive is a rigid-body impulse plus a target-driven reach that the physics
// solver has to actually achieve.

import { KEEPER, BALL } from '../config.js';
import { Ragdoll } from '../sim/ragdoll.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const H = KEEPER.hipHeight;
const LEG_JOINTS = new Set(['ftL', 'ftR', 'knL', 'knR', 'hipL', 'hipR']);

export class Keeper {
  constructor(scene) {
    this.ragdoll = new Ragdoll({ x: 0, z: 1.1 });
    this.scene = scene;
    this.mode = 'ready'; // ready | dive | limp | recover | catch
    this.vel = { x: 0, z: 0 };
    this.input = { x: 0, z: 0 };
    this.pos = { x: 0, z: 1.1 };
    this.gaitPhase = 0;
    this.speed = 0;
    this.lean = { x: 0, z: 0 };
    this.plan = null;
    this.diveTime = 0;
    this.diveCooldown = 0;
    this.lastTouch = null;
    this.catchBall = null;
    this.catchOffset = null;
    this.recoverTime = 0;
    this.aimYaw = 0;
    this.feet = {
      L: { planted: true, plant: { x: -0.22, y: 0, z: 0 }, swingT: 0, from: null, to: null, lift: 0 },
      R: { planted: true, plant: { x: 0.22, y: 0, z: 0 }, swingT: 0, from: null, to: null, lift: 0 },
    };
    this.stats = { dives: 0, frames: 0 };
    this.reset(0, 1.1);
  }

  reset(x = 0, z = 1.1) {
    this.pos = { x, z };
    this.vel = { x: 0, z: 0 };
    this.input = { x: 0, z: 0 };
    this.mode = 'ready';
    this.plan = null;
    this.diveTime = 0;
    this.diveCooldown = 0;
    this.catchBall = null;
    this.catchOffset = null;
    this.gaitPhase = 0;
    this.lean = { x: 0, z: 0 };
    this.ragdoll.teleport(x, z, 0);
    this.feet.L.plant = { x: x - 0.22, y: 0, z };
    this.feet.R.plant = { x: x + 0.22, y: 0, z };
    this.feet.L.planted = true;
    this.feet.R.planted = true;
    this.feet.L.swingT = 0;
    this.feet.R.swingT = 0;
  }

  setInput(x, z) {
    const l = Math.hypot(x, z);
    this.input.x = l > 1 ? x / l : x;
    this.input.z = l > 1 ? z / l : z;
  }

  get pelvis() { return this.ragdoll.parts.pelvis.p; }
  get chest() { return this.ragdoll.parts.chest.p; }

  // ---------------------------------------------------------------- dive
  startDive(plan) {
    if (this.mode === 'dive' || this.diveCooldown > 0) return false;
    if (!plan || !plan.axis || !isFiniteVec(plan.axis) || !isFiniteVec(plan.pelvisTarget) || !isFiniteVec(plan.launchVel)) {
      this.diveCooldown = 0.25;
      return false;
    }
    this.plan = plan;
    this.mode = 'dive';
    this.diveTime = 0;
    this.stats.dives++;
    // Push off the turf: the impulse is applied to the whole mass distribution
    // so the ragdoll genuinely rotates and flies.
    const v = vec3(plan.launchVel);
    // Vertical push chosen so the hips follow a believable ballistic arc from
    // their current height to the planned dive height over the contact time.
    const tArc = clamp(plan.tContact * 0.85, 0.18, 0.9);
    const startY = this.ragdoll.parts.pelvis.p.y;
    const lift = clamp(
      (plan.pelvisTarget.y - startY) / tArc + 0.5 * 9.81 * tArc,
      plan.profile === 'jump' ? 2.6 : -1.2,
      5.2,
    );
    this.pushVel = { x: v.x, y: lift, z: v.z };
    this.pushTime = plan.profile === 'jump' ? 0.16 : 0.13;
    const spinTime = plan.profile === 'jump' ? 0.5 : 0.3 + plan.urgency * 0.12;
    this.ragdoll.applyDiveImpulse({
      pelvisVel: { x: v.x, y: lift, z: v.z },
      axis: plan.axis,
      spinTime,
      extra: 0.9 + plan.urgency * 0.5,
    });
    return true;
  }

  releaseDive() {
    if (this.mode !== 'dive') return;
    this.mode = 'limp';
    this.ragdoll.mode = 'limp';
    this.diveCooldown = 0.55;
  }

  // ---------------------------------------------------------------- update
  update(dt, ball, opts = {}) {
    this.stats.frames++;
    this.diveCooldown = Math.max(0, this.diveCooldown - dt);
    switch (this.mode) {
      case 'ready':
      case 'walk':
        this.updateLocomotion(dt, ball);
        break;
      case 'dive':
        this.updateDive(dt, ball);
        break;
      case 'limp':
        this.updateLimp(dt);
        break;
      case 'recover':
        this.updateRecover(dt);
        break;
      default:
        this.updateLocomotion(dt, ball);
    }
    // While diving, the body is in the air: only the torso can scrape the turf.
    // Letting the trailing studs bite mid-dive would brake the launch.
    const suppressGround = this.mode === 'dive' && this.diveTime <= this.pushTime;
    const airborne = this.mode === 'dive' && this.diveTime < 0.55;
    this.ragdoll.step(dt, {
      iterations: 6,
      damping: 0.995,
      suppressGround,
      rigid: this.mode === 'dive' && this.diveTime <= this.pushTime,
      // standing feet are pinned in place by the stance controller
      skipParts: this.mode === 'ready' || this.mode === 'walk'
        ? LEG_JOINTS
        : null,
      airborne: airborne ? new Set(['pelvis', 'chest', 'head', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR']) : null,
    });
    this.syncPos();
  }

  // While standing/walking the controller owns the position and the ragdoll
  // follows it. Once the body is airborne (dive) or limp, physics owns it and
  // the controller reads back from the pelvis — that is why a dive carries you
  // somewhere the controller never asked for, which is exactly right.
  syncPos() {
    if (this.mode === 'dive' || this.mode === 'limp' || this.mode === 'recover') {
      this.pos.x = this.ragdoll.parts.pelvis.p.x;
      this.pos.z = this.ragdoll.parts.pelvis.p.z;
    }
  }

  // ---- locomotion: momentum + foot planting + balance ---------------------
  updateLocomotion(dt, ball) {
    const accel = KEEPER.accel;
    const target = { x: this.input.x * KEEPER.maxSpeed, z: this.input.z * KEEPER.maxSpeed };
    const dx = target.x - this.vel.x;
    const dz = target.z - this.vel.z;
    const dLen = Math.hypot(dx, dz);
    if (dLen > 1e-4) {
      const a = Math.min(accel, dLen / dt);
      this.vel.x += (dx / dLen) * a * dt;
      this.vel.z += (dz / dLen) * a * dt;
    }
    // momentum: only bleed off speed via ground friction when not accelerating
    if (Math.hypot(this.input.x, this.input.z) < 0.05) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      const drop = Math.min(sp, KEEPER.decel * dt);
      if (sp > 1e-4) {
        this.vel.x -= (this.vel.x / sp) * drop;
        this.vel.z -= (this.vel.z / sp) * drop;
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // stay in the handling area
    if (this.pos.x < -KEEPER.roamX) { this.pos.x = -KEEPER.roamX; this.vel.x = Math.max(0, this.vel.x); }
    if (this.pos.x > KEEPER.roamX) { this.pos.x = KEEPER.roamX; this.vel.x = Math.min(0, this.vel.x); }
    if (this.pos.z < 0.42) { this.pos.z = 0.42; this.vel.z = Math.max(0, this.vel.z); }
    if (this.pos.z > KEEPER.roamZ) { this.pos.z = KEEPER.roamZ; this.vel.z = Math.min(0, this.vel.z); }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.mode = this.speed > 0.35 ? 'walk' : 'ready';
    this.lean.x += ((this.vel.x * 0.045) - this.lean.x) * Math.min(1, dt * 10);
    this.lean.z += ((this.vel.z * 0.045) - this.lean.z) * Math.min(1, dt * 10);

    // goal-side bias: keeper shades toward the ball's angle
    if (ball) {
      // Square up to the ball: keepers open their body toward the shooter and
      // shade the near post. This is visible in the shoulders and the stance.
      const wantYaw = clamp(Math.atan2(ball.p.x - this.pos.x, Math.max(0.8, ball.p.z - this.pos.z)), -0.85, 0.85);
      this.aimYaw = lerp(this.aimYaw, wantYaw, Math.min(1, dt * 5));
    }

    this.updateGait(dt);
    this.applyStanceTargets(dt);
  }

  updateGait(dt) {
    const sp = this.speed;
    const stride = clamp(0.55 + sp * 0.11, 0.55, 1.05);
    // gait advances with distance travelled -> no foot sliding
    this.gaitPhase += (sp / stride) * dt * 0.62;
    if (sp < 0.3) {
      // idle: settle both feet under the hips
      for (const side of ['L', 'R']) {
        const f = this.feet[side];
        const off = side === 'L' ? -0.26 : 0.26;
        f.planted = true;
        f.plant.x = lerp(f.plant.x, this.pos.x + off, Math.min(1, dt * 6));
        f.plant.z = lerp(f.plant.z, this.pos.z + 0.04, Math.min(1, dt * 6));
        f.lift = 0;
      }
      return;
    }
    const dir = { x: this.vel.x / (sp || 1), z: this.vel.z / (sp || 1) };
    for (const side of ['L', 'R']) {
      const f = this.feet[side];
      const phase = (this.gaitPhase + (side === 'L' ? 0 : 0.5)) % 1;
      const stance = phase < 0.58;
      if (stance) {
        if (!f.planted) {
          f.planted = true;
          f.plant.x = f.to.x;
          f.plant.z = f.to.z;
        }
        f.lift = 0;
      } else {
        if (f.planted) {
          f.planted = false;
          f.from = { ...f.plant };
          const lead = stride * (0.55 + sp * 0.045);
          const lateral = side === 'L' ? -0.22 : 0.22;
          f.to = {
            x: this.pos.x + (side === 'L' ? -lateral : lateral) + dir.x * lead,
            z: this.pos.z + dir.z * lead + (side === 'L' ? -0.03 : 0.03),
          };
          f.swingT = 0;
        }
        f.swingT += dt * (2.2 + sp * 0.55);
        const p = clamp(f.swingT, 0, 1);
        f.lift = Math.sin(p * Math.PI) * (0.11 + sp * 0.035);
        if (p >= 1) {
          f.planted = true;
          f.plant.x = f.to.x;
          f.plant.z = f.to.z;
          f.lift = 0;
        }
      }
    }
  }

  // Build the standing/walking target pose (world space) and drive the ragdoll.
  //
  // Feet first: a planted foot is pinned to the turf by a hard constraint, a
  // swinging foot is driven toward its landing spot. Everything above the feet
  // is then solved by inverse kinematics so the knees, hips, chest and head all
  // follow from the feet up — which is what stops the body from floating and
  // the legs from dragging.
  applyStanceTargets(dt) {
    const parts = this.ragdoll.parts;
    const sp = this.speed;
    const crouch = 0.05 + Math.min(0.09, sp * 0.016);
    const bob = Math.abs(Math.sin(this.gaitPhase * Math.PI * 2)) * 0.03 * Math.min(1, sp / 3);
    const hipY = H - crouch - bob;
    const pelvisX = this.pos.x + this.lean.x * 0.3;
    const pelvisZ = this.pos.z + this.lean.z * 0.3;
    const cy = Math.cos(this.aimYaw);
    const sy = Math.sin(this.aimYaw);

    // ---- 1. feet -------------------------------------------------------
    for (const [side, sx] of [['L', -1], ['R', 1]]) {
      const f = this.feet[side];
      const part = parts[`ft${side}`];
      if (f.planted) {
        // Hard pin: the studs do not slide, and that is what pushes the body.
        placeJoint(part, f.plant.x, 0.065, f.plant.z + 0.045, dt);
      } else {
        const t = clamp(f.swingT, 0, 1);
        const e = t * t * (3 - 2 * t);
        const x = lerp(f.from.x, f.to.x, e);
        const z = lerp(f.from.z, f.to.z, e);
        const lift = Math.sin(t * Math.PI) * (0.1 + Math.min(0.09, sp * 0.03));
        driveTo(part, x, 0.065 + lift, z + 0.045, 30, 9, dt);
      }
    }

    // ---- 2. hips and knees from the feet up ----------------------------
    for (const [side, sx] of [['L', -1], ['R', 1]]) {
      // IK targets use the *intended* foot position, not the lagging actual one,
      // otherwise the knee chases its own tail.
      const f = this.feet[side];
      const foot = f.planted
        ? { x: f.plant.x, y: 0.065, z: f.plant.z + 0.045 }
        : { x: lerp(f.from.x, f.to.x, clamp(f.swingT, 0, 1)), y: 0.13, z: lerp(f.from.z, f.to.z, clamp(f.swingT, 0, 1)) };
      const hipW = { x: pelvisX + sx * KEEPER.hipWidth * 0.84, y: hipY - 0.02, z: pelvisZ + 0.01 };
      placeJoint(parts[`hip${side}`], hipW.x, hipW.y, hipW.z, dt);
      // two-bone IK: where must the knee sit to join hip to ankle? The natural
      // standing pose is nearly straight, so the bend gets a tiny forward bias.
      const knee = twoBone(hipW, foot, KEEPER.thigh, KEEPER.shin, { x: sx * 0.1, y: 0, z: 1 });
      placeJoint(parts[`kn${side}`], knee.x, Math.max(0.16, knee.y), knee.z, dt);
    }

    // ---- 3. spine and head ---------------------------------------------
    driveTo(parts.pelvis, pelvisX, hipY, pelvisZ, 70, 12, dt);
    const leanF = Math.min(0.18, sp * 0.028);
    const chestX = pelvisX + Math.sin(this.aimYaw) * 0.03 + this.vel.x * 0.012;
    const chestZ = pelvisZ + Math.cos(this.aimYaw) * 0.01 + leanF + this.vel.z * 0.012;
    driveTo(parts.chest, chestX, hipY + 0.35 - leanF * 0.35, chestZ, 70, 12, dt);
    driveTo(parts.head, chestX + Math.sin(this.aimYaw) * 0.04, hipY + 0.35 + KEEPER.neck + 0.16 - leanF * 0.5, chestZ + 0.02, 60, 11, dt);

    // ---- 4. arms: keeper's set position, gloves out in front -----------
    for (const [side, sx] of [['L', -1], ['R', 1]]) {
      const lx = sx * KEEPER.shoulderWidth;
      const shX = chestX + lx * cy;
      const shZ = chestZ - lx * sy;
      driveTo(parts[`sh${side}`], shX, hipY + 0.43 - leanF * 0.3, shZ, 70, 12, dt);
      // elbows out and slightly forward, hands at hip height in front
      const swing = Math.sin(this.gaitPhase * Math.PI * 2 + (side === 'L' ? 0 : Math.PI)) * 0.08 * Math.min(1, sp / 3);
      const elX = shX + sx * 0.15;
      const elZ = shZ + 0.1 + swing;
      driveTo(parts[`el${side}`], elX, hipY + 0.19, elZ, 55, 11, dt);
      driveTo(parts[`ha${side}`], elX + sx * 0.1, hipY + 0.01, elZ + 0.19, 45, 10, dt);
    }
    this.ragdoll.mode = 'stand';
  }

  // ---- dive: drive the whole body along the dive axis, reach with the arms --
  //
  // The body is commanded as ONE consistent rigid pose (built in the pelvis
  // frame from the dive axis), so no limb fights another and the launch
  // momentum survives. The arms are then overlaid on top of that pose so the
  // glove reaches for the actual predicted ball position.
  updateDive(dt, ball) {
    const plan = this.plan;
    if (!plan) return;
    this.diveTime += dt;
    const parts = this.ragdoll.parts;
    const axis = vec3(plan.axis);
    const reaching = plan.arm;
    const launching = this.diveTime < this.pushTime;

    // --- hips: ballistic launch, then PD toward the interception stance.
    const pelvis = parts.pelvis.p;
    if (launching) {
      // Push-off: plant leg extends and the whole mass leaves the turf together,
      // as a rigid missile. There is no gravity and no muscle here — this is the
      // ground reaction doing its work over a handful of frames.
      const w = this.ragdoll.omega ?? { x: 0, y: 0, z: 0 };
      for (const part of Object.values(parts)) {
        const r = { x: part.p.x - pelvis.x, y: part.p.y - pelvis.y, z: part.p.z - pelvis.z };
        part.v.x = this.pushVel.x * 1.05 + (w.y * r.z - w.z * r.y);
        part.v.y = this.pushVel.y + (w.z * r.x - w.x * r.z);
        part.v.z = this.pushVel.z * 1.05 + (w.x * r.y - w.y * r.x);
        part.p.x += part.v.x * dt;
        part.p.y += part.v.y * dt;
        part.p.z += part.v.z * dt;
      }
      return; // rigid launch frame: skip muscle + constraint work entirely
    }
    const tg = vec3(plan.pelvisTarget);
    // A body cannot sink through the turf: the lowest the hips may go is a
    // torso-radius off the deck (about 0.2 m — think of a keeper sprawling).
    const floorY = 0.2;
    if (tg.y < floorY) tg.y = floorY;
    // the actuator only pulls downward until the hips reach the floor, so the
    // dive lands on the turf and slides rather than levitating
    const act = diveActuator(parts.pelvis, tg, dt, { kp: 42, kd: 10, maxAccel: 22 });
    parts.pelvis.v.x += act.x;
    parts.pelvis.v.y += act.y;
    parts.pelvis.v.z += act.z;

    // --- rigid body frame: up = dive axis, side = horizontal perpendicular.
    const up = axis;
    const side = horizontalPerp(up);
    const fwd = {
      x: side.y * up.z - side.z * up.y,
      y: side.z * up.x - side.x * up.z,
      z: side.x * up.y - side.y * up.x,
    };
    // target pose in pelvis-local (up, side, fwd) coordinates
    const local = this.divePoseLocal(plan);
    const toWorld = (l) => ({
      x: pelvis.x + up.x * l[1] + side.x * l[0] + fwd.x * l[2],
      y: pelvis.y + up.y * l[1] + side.y * l[0] + fwd.y * l[2],
      z: pelvis.z + up.z * l[1] + side.z * l[0] + fwd.z * l[2],
    });

    // During a dive the torso is the driver: make the core very heavy so limb
    // springs cannot drag the launch off course (real torso/limb mass ratio).
    for (const n of ['pelvis', 'chest', 'head']) parts[n].invMass = 1 / 400;
    const softness = launching ? 0.45 : 1;
    for (const [name, l] of Object.entries(local)) {
      if (name === 'pelvis') continue;
      if (name.startsWith('ha') || name.startsWith('el')) continue; // arms handled below
      const world = toWorld(l);
      applyTargetSpring(parts[name], world, 150 * softness, dt, 16);
    }

    // --- arms: reach for where the ball is *going to be* when the glove gets
    // there. The arm cannot exceed its own length, so the target is clamped to
    // the actual shoulder position; if the body fell short the glove falls
    // short too, which is exactly what a desperate dive looks like.
    const track = this.trackBallTarget(plan, ball);
    const reachSides = reaching === 'both' ? ['L', 'R'] : [reaching === 'left' ? 'L' : 'R'];
    for (const sideName of reachSides) {
      const sx = sx0(sideName);
      const sh = parts[`sh${sideName}`].p;
      const want = this.armTarget(sh, track, sideName);
      // elbows bow out and up so the arm reads as extended, not straight-armed
      const mid = {
        x: lerp(sh.x, want.x, 0.55) + side.x * sx * 0.05,
        y: lerp(sh.y, want.y, 0.55) + side.y * sx * 0.05 + 0.05,
        z: lerp(sh.z, want.z, 0.55) + side.z * sx * 0.05,
      };
      applyTargetSpring(parts[`ha${sideName}`], want, 230, dt, 26);
      applyTargetSpring(parts[`el${sideName}`], mid, 150, dt, 20);
    }
    for (const sideName of ['L', 'R']) {
      if (reachSides.includes(sideName)) continue;
      const sx = sx0(sideName);
      const tuck = toWorld([sx * 0.14, 0.05, 0.2]);
      applyTargetSpring(parts[`ha${sideName}`], tuck, 70, dt, 12);
      applyTargetSpring(parts[`el${sideName}`], {
        x: lerp(parts.chest.p.x, tuck.x, 0.7),
        y: lerp(parts.chest.p.y, tuck.y, 0.7),
        z: lerp(parts.chest.p.z, tuck.z, 0.7),
      }, 60, dt, 10);
    }

    // --- timing: hold the pose until the commit window ends, then go limp so
    // the ragdoll crashes, skids and rolls on its own.
    if (this.diveTime > plan.commitTime) {
      this.mode = 'limp';
      this.diveCooldown = 0.5;
    }
    if (ball && (ball.p.z < -0.4 || ball.resting)) this.mode = 'limp';
    if (this.mode !== 'dive') restoreMass(parts);
  }

  // Where should the glove aim right now? Look up the ball's predicted position
  // for the moment the hand would arrive, so the keeper adjusts mid-air like a
  // real athlete tracking a shot.
  trackBallTarget(plan, ball) {
    const path = plan.ballPath;
    const now = this.diveTime;
    const arrival = now + 0.1; // gloves take a moment to arrive
    if (path && path.length) {
      let best = null;
      for (const s of path) {
        if (s.t < arrival - 0.09) continue;
        const d = Math.abs(s.t - arrival);
        if (!best || d < best.d) best = { d, s };
        if (s.t > arrival + 0.25) break;
      }
      if (best) return { x: best.s.x, y: best.s.y, z: best.s.z };
    }
    return plan.handTarget;
  }

  // Clamp a desired glove position to what the arm can actually reach from the
  // current shoulder joint.
  armTarget(shoulder, want, sideName) {
    const maxReach = KEEPER.upperArm + KEEPER.foreArm + KEEPER.hand;
    const dx = want.x - shoulder.x;
    const dy = want.y - shoulder.y;
    const dz = want.z - shoulder.z;
    const d = Math.hypot(dx, dy, dz);
    const r = Math.min(maxReach, d);
    const k = d > 1e-5 ? r / d : 0;
    return {
      x: shoulder.x + dx * k,
      y: Math.max(0.1, shoulder.y + dy * k),
      z: shoulder.z + dz * k,
    };
  }

  // Target pose for the whole body in pelvis-local (right, up, forward) coords.
  // The shape depends on the dive type, so a low dive tucks and a high dive
  // stretches, and the whole thing is consistent with the planned axis.
  divePoseLocal(plan) {
    const t = clamp(this.diveTime / 0.22, 0, 1);
    const e = 1 - Math.pow(1 - t, 2);
    const reach = plan.profile === 'jump' ? 0.92 : 1;
    const tuck = plan.profile.startsWith('low') ? 0.75 : 1.0;
    const H = KEEPER.hipHeight;
const LEG_JOINTS = new Set(['ftL', 'ftR', 'knL', 'knR', 'hipL', 'hipR']);
    return {
      pelvis: [0, 0, 0],
      chest: [0, 0.3 * reach, 0],
      head: [0, (0.3 + KEEPER.neck + 0.16) * reach, 0.02],
      shL: [-KEEPER.shoulderWidth, 0.38, 0.02],
      shR: [KEEPER.shoulderWidth, 0.38, 0.02],
      elL: [-KEEPER.shoulderWidth * 1.2, 0.14, 0.06],
      elR: [KEEPER.shoulderWidth * 1.2, 0.14, 0.06],
      haL: [-KEEPER.shoulderWidth * 1.3, -0.12, 0.1],
      haR: [KEEPER.shoulderWidth * 1.3, -0.12, 0.1],
      hipL: [-KEEPER.hipWidth * 0.9, -0.04, 0],
      hipR: [KEEPER.hipWidth * 0.9, -0.04, 0],
      knL: [-KEEPER.hipWidth * 0.95, -0.04 - KEEPER.thigh * tuck * e, KEEPER.thigh * 0.35 * e],
      knR: [KEEPER.hipWidth * 0.95, -0.04 - KEEPER.thigh * tuck * e, KEEPER.thigh * 0.35 * e],
      ftL: [-KEEPER.hipWidth * 0.98, -0.06 - (KEEPER.thigh + KEEPER.shin) * tuck * e, KEEPER.thigh * 0.55 * e],
      ftR: [KEEPER.hipWidth * 0.98, -0.06 - (KEEPER.thigh + KEEPER.shin) * tuck * e, KEEPER.thigh * 0.55 * e],
    };
  }

  updateLimp(dt) {
    // Ragdoll fully free: gravity, ground and joint constraints only.
    for (const part of Object.values(this.ragdoll.parts)) part.free = true;
    this.mode = 'limp';
    this.limpTime = (this.limpTime ?? 0) + dt;
    const moving = Object.values(this.ragdoll.parts).some(
      (p) => Math.hypot(p.v.x, p.v.y, p.v.z) > 0.4,
    );
    if ((this.limpTime > 0.85 && !moving) || this.limpTime > 2.2) {
      this.mode = 'recover';
      this.recoverTime = 0;
      this.limpTime = 0;
      this.recoverStart = {};
      for (const [name, part] of Object.entries(this.ragdoll.parts)) {
        this.recoverStart[name] = { ...part.p };
      }
    }
  }

  updateRecover(dt) {
    this.recoverTime += dt;
    const t = clamp(this.recoverTime / 0.7, 0, 1);
    const e = t * t * (3 - 2 * t);
    const rest = this.standingPoseWorld();
    for (const [name, target] of Object.entries(rest)) {
      const part = this.ragdoll.parts[name];
      const start = this.recoverStart[name];
      const blended = {
        x: lerp(start.x, target.x, e),
        y: lerp(start.y, target.y, e),
        z: lerp(start.z, target.z, e),
      };
      // a fast teleport-ish blend, but still collides with the ground
      part.p.x = blended.x;
      part.p.y = Math.max(part.radius, blended.y);
      part.p.z = blended.z;
      part.prev.x = part.p.x;
      part.prev.y = part.p.y;
      part.prev.z = part.p.z;
      part.v.x = 0; part.v.y = 0; part.v.z = 0;
    }
    // reposition the controller root to match
    this.pos.x = this.ragdoll.parts.pelvis.p.x;
    this.pos.z = this.ragdoll.parts.pelvis.p.z;
    this.vel.x = 0;
    this.vel.z = 0;
    for (const side of ['L', 'R']) {
      this.feet[side].plant.x = this.ragdoll.parts[`ft${side}`].p.x;
      this.feet[side].plant.z = this.ragdoll.parts[`ft${side}`].p.z;
      this.feet[side].planted = true;
    }
    if (t >= 1) {
      this.mode = 'ready';
      this.plan = null;
      this.recoverTime = 0;
    }
  }

  standingPoseWorld() {
    const p = this.pos;
    const out = {};
    const cy = Math.cos(this.aimYaw);
    const sy = Math.sin(this.aimYaw);
    const local = {
      pelvis: [0, H - 0.06, 0],
      chest: [0, H + 0.3, 0.02],
      head: [0, H + 0.3 + KEEPER.neck + 0.17, 0.04],
      shL: [-KEEPER.shoulderWidth, H + 0.38, 0.015],
      shR: [KEEPER.shoulderWidth, H + 0.38, 0.015],
      elL: [-(KEEPER.shoulderWidth + 0.16), H + 0.14, 0.12],
      elR: [KEEPER.shoulderWidth + 0.16, H + 0.14, 0.12],
      haL: [-(KEEPER.shoulderWidth + 0.3), H - 0.04, 0.3],
      haR: [KEEPER.shoulderWidth + 0.3, H - 0.04, 0.3],
      hipL: [-KEEPER.hipWidth * 0.85, H - 0.08, 0.01],
      hipR: [KEEPER.hipWidth * 0.85, H - 0.08, 0.01],
      knL: [-0.2, 0.47, 0.12],
      knR: [0.2, 0.47, 0.12],
      ftL: [-0.24, 0.06, 0.26],
      ftR: [0.24, 0.06, 0.26],
    };
    for (const [name, [x, y, z]] of Object.entries(local)) {
      out[name] = { x: p.x + x * cy + z * sy, y, z: p.z - x * sy + z * cy };
    }
    return out;
  }

  // Ball contact spheres, in world space.
  spheres() {
    return Object.values(this.ragdoll.parts).map((p) => ({
      name: p.name,
      x: p.p.x,
      y: p.p.y,
      z: p.p.z,
      r: p.name.startsWith('ha') ? p.radius + 0.012 : p.radius,
      part: p,
    }));
  }

  // A dive is only possible when planted or already moving — never while limp.
  canDive() {
    return this.mode !== 'limp' && this.mode !== 'recover' && this.diveCooldown <= 0;
  }
}

// Critically-damped PD actuator used for every limb target. Moves the part by
// changing its velocity (so momentum, collisions and constraints still apply)
// and never teleports it.
// Accept {x,y,z} or [x,y,z] and always return an object.
function vec3(v) {
  if (!v) return { x: 0, y: 0, z: 0 };
  if (Array.isArray(v)) return { x: v[0], y: v[1], z: v[2] };
  return v;
}

function isFiniteVec(v) {
  if (!v) return false;
  if (Array.isArray(v)) return v.length >= 3 && v.slice(0, 3).every((n) => Number.isFinite(n));
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

// Servo a particle toward a world point: PD on velocity, with the acceleration
// capped so the motion stays human rather than teleporting.
function driveTo(part, x, y, z, kp = 50, maxSpeed = 12, dt = 1 / 60) {
  const dx = x - part.p.x;
  const dy = y - part.p.y;
  const dz = z - part.p.z;
  const kd = Math.sqrt(kp) * 1.5;
  const ax = dx * kp - part.v.x * kd;
  const ay = dy * kp - part.v.y * kd;
  const az = dz * kp - part.v.z * kd;
  const aLen = Math.hypot(ax, ay, az) || 1e-6;
  const cap = 1400;
  const s = aLen > cap ? cap / aLen : 1;
  part.v.x += ax * s * dt;
  part.v.y += ay * s * dt;
  part.v.z += az * s * dt;
  const sp = Math.hypot(part.v.x, part.v.y, part.v.z);
  if (sp > maxSpeed) {
    const k = maxSpeed / sp;
    part.v.x *= k; part.v.y *= k; part.v.z *= k;
  }
}

// A leg joint under muscle control is *placed*: the impedance is high enough
// that the joint holds its commanded position against gravity and against the
// other limbs. The torso and arms stay servo-driven, so the body still has to
// physically follow the legs rather than being teleported.
function placeJoint(part, x, y, z, dt) {
  const k = 1 - Math.exp(-38 * dt);
  const ox = part.p.x;
  const oy = part.p.y;
  const oz = part.p.z;
  part.p.x = ox + (x - ox) * k;
  part.p.y = oy + (y - oy) * k;
  part.p.z = oz + (z - oz) * k;
  // velocity implied by the move, so the solver and collisions see momentum
  part.v.x = (part.p.x - ox) / dt;
  part.v.y = (part.p.y - oy) / dt;
  part.v.z = (part.p.z - oz) / dt;
}

// Two-bone IK: position of the joint (knee) given root (hip), end (ankle),
// the two segment lengths and the direction the joint should bend toward.
function twoBone(root, end, l1, l2, bendDir) {
  const dx = end.x - root.x;
  const dy = end.y - root.y;
  const dz = end.z - root.z;
  let dist = Math.hypot(dx, dy, dz);
  dist = Math.max(1e-3, Math.min(dist, l1 + l2 - 1e-3));
  const ux = dx / (dist || 1);
  const uy = dy / (dist || 1);
  const uz = dz / (dist || 1);
  // distance along the root->end line to the foot of the perpendicular
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // perpendicular direction, biased by bendDir
  let px = bendDir.x - ux * (bendDir.x * ux + bendDir.y * uy + bendDir.z * uz);
  let py = bendDir.y - uy * (bendDir.x * ux + bendDir.y * uy + bendDir.z * uz);
  let pz = bendDir.z - uz * (bendDir.x * ux + bendDir.y * uy + bendDir.z * uz);
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  return {
    x: root.x + ux * a + px * h,
    y: root.y + uy * a + py * h,
    z: root.z + uz * a + pz * h,
  };
}

function restoreMass(parts) {
  parts.pelvis.invMass = 1 / 14;
  parts.chest.invMass = 1 / 22;
  parts.head.invMass = 1 / 6;
}

function applyTargetSpring(part, target, kp, dt, maxSpeed = 14) {
  const dx = target.x - part.p.x;
  const dy = target.y - part.p.y;
  const dz = target.z - part.p.z;
  const kd = Math.sqrt(kp) * 1.6;
  const ax = dx * kp - part.v.x * kd;
  const ay = dy * kp - part.v.y * kd;
  const az = dz * kp - part.v.z * kd;
  const aLen = Math.hypot(ax, ay, az);
  const cap = 900;
  const s = aLen > cap ? cap / aLen : 1;
  part.v.x += ax * s * dt;
  part.v.y += ay * s * dt;
  part.v.z += az * s * dt;
  const sp = Math.hypot(part.v.x, part.v.y, part.v.z);
  if (sp > maxSpeed) {
    const k = maxSpeed / sp;
    part.v.x *= k; part.v.y *= k; part.v.z *= k;
  }
}

// PD actuator for the hips during a dive (returns velocity deltas).
function diveActuator(part, target, dt, { kp = 70, kd = 15, maxAccel = 34 }) {
  const ax = clamp((target.x - part.p.x) * kp - part.v.x * kd, -maxAccel, maxAccel) * dt;
  const ay = clamp((target.y - part.p.y) * kp - part.v.y * kd, -maxAccel, maxAccel) * dt;
  const az = clamp((target.z - part.p.z) * kp - part.v.z * kd, -maxAccel, maxAccel) * dt;
  return { x: ax, y: ay, z: az };
}

// A unit vector roughly perpendicular to `up` in the horizontal plane.
function horizontalPerp(up) {
  const l = Math.hypot(up.z, up.x);
  if (l < 1e-4) return { x: 1, y: 0, z: 0 };
  return { x: -up.z / l, y: 0, z: up.x / l };
}


const sx0 = (side) => (side === 'L' ? -1 : 1);
const chestWorld = (parts) => parts.chest.p;


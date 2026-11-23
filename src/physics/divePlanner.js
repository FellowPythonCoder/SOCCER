// Automatic dive planner.
//
// Given the keeper's current body state and the live ball state, this module
// answers a single question: "if I launch my body right now, in which
// direction, with which arm, and how hard, do I maximise the chance of
// intercepting the ball?"
//
// It is pure maths (no rendering, no engine) so the exact code that drives the
// ragdoll can be unit-tested in Node.
//
// Model
// -----
// For every candidate dive profile (side, height band, forward/sideways) we
// ask: *could a human body get its hands to this point on the ball's flight
// path, in the time available?* Reachability is limited by three physical
// facts, and nothing else:
//
//   1. the hips can only cover so much ground in `t` seconds (acceleration
//      then a top speed — you cannot outrun your own dive),
//   2. the hips have to be at a plausible height for that kind of dive,
//   3. the arms can only stretch so far from the hips.
//
// The (profile, contact-time) pair whose required hip position is cheapest to
// reach wins. That hip position becomes the target the ragdoll is driven to,
// so plan and execution describe the same motion.

import { KEEPER, PITCH, BALL } from '../config.js';
import { predictPath, predictCrossing } from './ball.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function norm(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

// Arm span from the shoulder joint to the middle of the glove.
export const ARM_REACH = KEEPER.upperArm + KEEPER.foreArm + KEEPER.hand;
// Effective hand centre offset from the pelvis along the dive axis: shoulders
// sit above the pelvis, so a sideways body puts the arm out on that side.
const SHOULDER_LIFT = 0.34;

// Dive launch physics for the *hips*.
const HIP_TOP_SPEED = 6.2; // m/s after the push-off
const HIP_ACCEL = 34; // m/s^2 from the plant leg
const MAX_DIVE_TIME = 1.9;

// How far the hips can travel in `t` seconds given an initial velocity along
// the dive direction.
export function hipTravel(t, v0 = 0, accel = HIP_ACCEL, top = HIP_TOP_SPEED) {
  if (t <= 0) return 0;
  const v0c = clamp(v0, 0, top);
  const tAccel = Math.min(t, Math.max(0, top - v0c) / accel);
  const d = v0c * tAccel + 0.5 * accel * tAccel * tAccel + top * (t - tAccel);
  return d;
}

// Dive profiles. `axis` is the direction the body's up-vector rotates into
// (world space; +z is toward the shooter, goal line is z = 0).
//   hips  : the hip height this dive settles at
//   reach : multiplier on arm extension
//   cost  : how much extra effort/risk this dive carries
export const DIVE_PROFILES = [
  { type: 'dive-left', axis: [-1, 0.16, 0.06], hips: 0.85, reach: 1.0, cost: 0.0, rot: 'side' },
  { type: 'dive-right', axis: [1, 0.16, 0.06], hips: 0.85, reach: 1.0, cost: 0.0, rot: 'side' },
  { type: 'low-left', axis: [-0.96, -0.13, 0.14], hips: 0.4, reach: 1.0, cost: 0.05, rot: 'low' },
  { type: 'low-right', axis: [0.96, -0.13, 0.14], hips: 0.4, reach: 1.0, cost: 0.05, rot: 'low' },
  { type: 'high-left', axis: [-0.72, 0.68, 0.08], hips: 1.24, reach: 1.0, cost: 0.08, rot: 'high' },
  { type: 'high-right', axis: [0.72, 0.68, 0.08], hips: 1.24, reach: 1.0, cost: 0.08, rot: 'high' },
  { type: 'forward-low', axis: [0, -0.32, 0.95], hips: 0.55, reach: 0.92, cost: 0.1, rot: 'forward' },
  { type: 'forward-high', axis: [0, 0.34, 0.94], hips: 1.0, reach: 0.9, cost: 0.14, rot: 'forward' },
  { type: 'jump', axis: [0, 0.97, 0.2], hips: 1.58, reach: 0.85, cost: 0.16, rot: 'jump' },
  { type: 'block', axis: [0, 0.42, 0.9], hips: 1.0, reach: 0.5, cost: -0.06, rot: 'block' },
  { type: 'stand', axis: [0, 0.94, 0.34], hips: 1.08, reach: 0.85, cost: -0.05, rot: 'stand' },
];

// Hip height as a function of time into the dive, for a given profile.
export function hipHeightAt(t, startHips, targetHips, profileType) {
  if (profileType === 'jump') {
    // ballistic-ish rise, peaking around 0.45 s
    const tau = clamp(t / 0.55, 0, 1);
    return startHips + (targetHips - startHips) * Math.sin(tau * Math.PI * 0.5);
  }
  const tau = clamp(t / 0.34, 0, 1);
  const e = 1 - Math.pow(1 - tau, 2.2);
  return startHips + (targetHips - startHips) * e;
}

// Evaluate one profile against the ball's flight path.
//
// A dive is only physically possible if the hips can travel far enough ALONG
// the dive direction, in the time available. The hips cannot travel backwards
// (you cannot dive away from where you are already leaning) and they cannot
// exceed their launch speed. Whatever the hips cannot cover is a shortfall the
// arm cannot make up, because the arm is already assumed fully extended.
export function evaluateProfile(profile, ctx, path) {
  const axis = norm(profile.axis[0], profile.axis[1], profile.axis[2]);
  const planar = Math.hypot(axis.x, axis.z);
  const ax = planar > 1e-4 ? { x: axis.x / planar, z: axis.z / planar } : { x: 0, z: 0 };
  const handRadius = KEEPER.handsReach + BALL.radius;
  const ext = ARM_REACH * profile.reach;
  const v0 = Math.max(0, ctx.vel.x * ax.x + ctx.vel.z * ax.z);
  let best = null;

  for (const s of path) {
    const t = s.t;
    if (t > MAX_DIVE_TIME) break;

    // Ideal hips: directly behind the ball along the dive axis, with the arm
    // fully extended.
    const idealX = s.x - axis.x * ext;
    const idealZ = s.z - axis.z * ext;
    // How far along the dive axis must the hips move? (negative = would have to
    // retreat, which a dive cannot do)
    const dAlong = (idealX - ctx.root.x) * ax.x + (idealZ - ctx.root.z) * ax.z;
    // Lateral offset perpendicular to the dive axis: the arm can sweep a little,
    // but a dive has committed to a line.
    const perpX = -ax.z;
    const perpZ = ax.x;
    const dPerp = (idealX - ctx.root.x) * perpX + (idealZ - ctx.root.z) * perpZ;
    const perpErr = Math.max(0, Math.abs(dPerp) - 0.3) * 0.7;

    const canTravel = hipTravel(t, v0);
    // Retreat is not a dive.
    const retreatErr = dAlong < -0.05 ? Math.min(3, -dAlong * 1.8) : 0;
    const alongPos = Math.max(0, dAlong);
    const distErr = Math.max(0, alongPos - canTravel);
    // Height the hips can plausibly hold at this instant.
    const hY = hipHeightAt(t, ctx.hips, profile.hips, profile.type);
    const heightErr = Math.max(0, Math.abs(s.y - (hY + axis.y * ext)) - 0.45);
    // Contact point behind / past the keeper is worthless.
    const behind = s.z < 0.05 ? (0.05 - s.z) * 1.6 : 0;
    // Wasteful hip travel costs energy and time: prefer the shortest dive that
    // does the job. This is what stops a keeper diving away from a ball that is
    // coming straight at him.
    const waste = Math.max(0, alongPos - 0.1) * 0.34;
    // Deep commitment (throwing the body along the floor) is riskier.
    const commitCost = planar * 0.09;

    const err = distErr + retreatErr + perpErr + heightErr + behind;
    const score = err * 1.0 + waste + commitCost * (err > 0.05 ? 0.4 : 1) + t * 0.1 + profile.cost;

    if (!best || score < best.score) {
      // Hips placed as far along the dive as the legs allow.
      const trav = Math.min(Math.max(0, dAlong), canTravel);
      best = {
        score,
        err,
        distErr,
        retreatErr,
        perpErr,
        heightErr,
        t,
        alongPos,
        travel: trav,
        hipPos: {
          x: ctx.root.x + ax.x * trav,
          y: hipHeightAt(t, ctx.hips, profile.hips, profile.type),
          z: ctx.root.z + ax.z * trav,
        },
        axis,
      };
    }
  }
  if (!best) return null;

  return {
    profile,
    ...best,
    shortfall: best.err,
    surplus: handRadius + 0.18 - best.err,
    reachable: best.err <= 0.08,
    tContact: best.t,
    hipsAtContact: best.hipPos.y,
    ext,
    handRadius,
  };
}

// Rank the whole plan space and report just how savable a shot is, betting on
// an *optimistic* rise (a keeper who commits to a dive will get his hips up).
export function bestPlanFor(root, ball, hips = KEEPER.hipHeight) {
  const ctx = { root: { x: root.x, z: root.z }, hips, vel: { x: 0, z: 0 } };
  const path = predictPath(ball, MAX_DIVE_TIME, 1 / 90);
  if (!path.length) return null;
  let best = null;
  for (const p of DIVE_PROFILES) {
    const ev = evaluateProfile(p, ctx, path);
    if (ev && (!best || ev.score < best.score)) best = ev;
  }
  return best;
}

// ---- factory used by diveSearch.js --------------------------------------
//
// `rank` gives a cheap analytic ordering of candidates (so the expensive
// rehearsal only runs on plausible ones); `build` turns a candidate into the
// concrete hip/glove targets the ragdoll will be driven to.
export function planFactory() {
  return {
    rank(ctx, ball, candidates) {
      const path = predictPath(ball, MAX_DIVE_TIME, 1 / 90);
      return candidates
        .map((cand) => {
          const ev = evaluateProfile(cand, ctx, path);
          return { cand, score: ev ? ev.score : 99 };
        })
        .sort((a, b) => a.score - b.score)
        .map((r) => r.cand);
    },
    build(ctx, ball, cand, path) {
      const ev = evaluateProfile(cand, ctx, path ?? predictPath(ball, MAX_DIVE_TIME, 1 / 90));
      if (!ev) return null;
      return planFromEvaluation(ev, ctx, cand);
    },
  };
}

// Turn an evaluation into a concrete, executable plan.
function planFromEvaluation(best, ctx, cand) {
  const axis = best.axis;
  const ext = ARM_REACH * (cand?.reach ?? best.profile.reach);
  const hips = best.hipPos ?? {
    x: ctx.root.x + axis.x * (best.travel ?? 0),
    y: best.hipsAtContact ?? ctx.hips,
    z: ctx.root.z + axis.z * (best.travel ?? 0),
  };
  const pelvisTarget = {
    x: clamp(hips.x, -KEEPER.roamX, KEEPER.roamX),
    y: clamp(hips.y, 0.3, 1.72),
    z: clamp(hips.z, 0.22, KEEPER.roamZ),
  };
  const handTarget = {
    x: pelvisTarget.x + axis.x * ext,
    y: clamp(pelvisTarget.y + axis.y * ext + 0.08, 0.12, 2.6),
    z: pelvisTarget.z + axis.z * ext,
  };
  const arm = Math.abs(axis.x) < 0.22 ? 'both' : axis.x > 0 ? 'left' : 'right';
  const ddx = pelvisTarget.x - ctx.root.x;
  const ddz = pelvisTarget.z - ctx.root.z;
  const dd = Math.hypot(ddx, ddz);
  const v0 = Math.max(0, (ctx.vel?.x ?? 0) * (dd > 1e-6 ? ddx / dd : 0) + (ctx.vel?.z ?? 0) * (dd > 1e-6 ? ddz / dd : 0));
  const tContact = clamp(best.tContact ?? best.t, 0.06, MAX_DIVE_TIME);
  const launchSpeed = clamp(v0 + dd / Math.max(0.16, tContact * 0.8), 0, HIP_TOP_SPEED);
  return {
    profile: best.profile.type ?? cand?.type,
    axis,
    arm,
    roll: clamp(Math.atan2(axis.x, Math.max(0.001, Math.abs(axis.y) + 0.05)) * 0.9, -1.5, 1.5),
    yaw: clamp(Math.atan2(-axis.x * 0.4, 1), -0.55, 0.55),
    tContact,
    handTarget,
    pelvisTarget,
    targetHipsHeight: pelvisTarget.y,
    launchVel: dd > 1e-4 ? { x: (ddx / dd) * launchSpeed, y: 0, z: (ddz / dd) * launchSpeed } : { x: 0, y: 0, z: 0 },
    reachable: best.reachable,
    surplus: best.surplus,
    error: best.err,
    shortfall: best.shortfall,
    urgency: clamp(best.err / 0.9, 0, 1),
    confidence: clamp(1 - best.err / 1.1, 0, 1),
    commitTime: clamp(tContact + 0.32, 0.45, 1.5),
    goalCrossing: null,
    ballPath: [],
  };
}

// How difficult is this shot for a keeper standing at `root`? 0 = trivial,
// 1 = practically unsavable. Used by the AI shooter to keep the game fair.
export function shotDifficulty(root, ball) {
  const ev = bestPlanFor(root, ball);
  if (!ev) return 1;
  // Any shortfall bigger than ~0.4 m is a goal at this level of precision.
  return clamp(ev.err / 0.4, 0, 1);
}

// Main entry point.
// ctx: { root:{x,z}, hips:number, vel:{x,z} }
export function planDive(ctx, ball, opts = {}) {
  const roamX = opts.roam?.x ?? KEEPER.roamX;
  const roamZ = opts.roam?.z ?? KEEPER.roamZ;
  const path = predictPath(ball, MAX_DIVE_TIME, 1 / 90);
  const crossing = predictCrossing(ball, 0, 3, 1 / 180);
  if (!path.length) return null;

  const candidates = DIVE_PROFILES.map((p) => evaluateProfile(p, ctx, path)).filter(Boolean);
  if (!candidates.length) return null;
  // lowest cost/error wins
  candidates.sort((a, b) => a.score - b.score);
  // Prefer an option that actually gets a glove on the ball, then the cheapest.
  const reachable = candidates.filter((c) => c.reachable)[0];
  const best = reachable ?? candidates[0];
  const axis = best.axis;

  // ---- commit to a body shape -------------------------------------------
  // The hips go just short of the ideal point so the ARMS, not the torso, meet
  // the ball. Clamped into the area the keeper is allowed to work in.
  const ideal = best.hipPos;
  let pelvisTarget = {
    x: clamp(ideal.x, -roamX, roamX),
    y: clamp(best.hipsAtContact, 0.3, 1.72),
    z: clamp(ideal.z, 0.22, roamZ),
  };
  // Never ask the hips to teleport further than the legs can carry them.
  const maxTravel = hipTravel(best.tContact, 0);
  const ddx = pelvisTarget.x - ctx.root.x;
  const ddz = pelvisTarget.z - ctx.root.z;
  const dd = Math.hypot(ddx, ddz);
  if (dd > maxTravel && dd > 1e-6) {
    const s = maxTravel / dd;
    pelvisTarget.x = ctx.root.x + ddx * s;
    pelvisTarget.z = ctx.root.z + ddz * s;
  }

  // Glove target: as close to the ball as the arm can physically get.
  const gloveReach = ARM_REACH * best.profile.reach;
  const handTarget = {
    x: pelvisTarget.x + axis.x * gloveReach,
    y: clamp(pelvisTarget.y + axis.y * gloveReach + 0.08, 0.12, 2.6),
    z: pelvisTarget.z + axis.z * gloveReach,
  };

  // Which arm reaches: the one on the side the body is falling toward.
  const arm = Math.abs(axis.x) < 0.22 ? 'both' : axis.x > 0 ? 'left' : 'right';
  // Body roll needed to bring that shoulder down/around toward the ball.
  const roll = clamp(Math.atan2(axis.x, Math.max(0.001, Math.abs(axis.y) + 0.05)) * 0.9, -1.5, 1.5);
  const yaw = clamp(Math.atan2(-axis.x * 0.4, 1), -0.55, 0.55);

  const tContact = clamp(best.tContact, 0.05, MAX_DIVE_TIME);
  // momentum the keeper already carries into the dive, projected on the axis
  const carry = ctx.vel.x * axis.x + ctx.vel.z * axis.z;
  const launchSpeed = clamp(Math.max(0, carry) + (dd / Math.max(0.14, tContact * 0.72)), 0, HIP_TOP_SPEED * 1.08);

  return {
    profile: best.profile.type,
    axis,
    arm,
    roll,
    yaw,
    tContact,
    handTarget,
    pelvisTarget,
    targetHipsHeight: best.hipsAtContact,
    launchVel: {
      x: dd > 1e-4 ? (ddx / dd) * launchSpeed : 0,
      y: 0,
      z: dd > 1e-4 ? (ddz / dd) * launchSpeed : 0,
    },
    reachable: best.reachable,
    surplus: best.surplus,
    error: best.err,
    shortfall: best.shortfall,
    urgency: clamp(best.err / 0.9, 0, 1),
    confidence: clamp(1 - best.err / 1.1, 0, 1),
    commitTime: clamp(tContact + 0.32, 0.45, 1.5),
    closingSpeed: Math.hypot(ball.v.x, ball.v.y, ball.v.z),
    goalCrossing: crossing,
    ballPath: path,
  };
}

// Reflex block: the ball is already too close to dive. The keeper throws both
// arms out and braces — what a real keeper does from two metres.
export function planReflex(ctx, ball) {
  const dirX = ball.p.x - ctx.root.x;
  const dirZ = ball.p.z - ctx.root.z;
  const l = Math.hypot(dirX, dirZ) || 1;
  return {
    profile: 'reflex',
    axis: norm(dirX / l * 0.5, 0.72, dirZ / l * 0.5),
    arm: 'both',
    roll: 0,
    yaw: 0,
    tContact: 0.16,
    handTarget: { x: ball.p.x, y: ball.p.y, z: ball.p.z },
    pelvisTarget: {
      x: clamp(ctx.root.x + (dirX / l) * 0.22, -KEEPER.roamX, KEEPER.roamX),
      y: Math.max(0.5, ctx.hips - 0.08),
      z: clamp(ctx.root.z + (dirZ / l) * 0.22, 0.25, KEEPER.roamZ),
    },
    targetHipsHeight: Math.max(0.62, ctx.hips - 0.12),
    launchVel: { x: (dirX / l) * 0.5, y: 0.4, z: (dirZ / l) * 0.5 },
    reachable: false,
    surplus: -1,
    error: 9,
    shortfall: 9,
    urgency: 1,
    confidence: 0.08,
    commitTime: 0.55,
    reflex: true,
    goalCrossing: null,
    ballPath: [],
  };
}

// Between shots: stand on the angle bisector, a little off the line.
export function readySpot(ball, goalCenter = { x: 0, z: 0 }) {
  const bz = Math.max(0.5, ball.p.z);
  const ang = Math.atan2(ball.p.x - goalCenter.x, bz);
  return {
    x: clamp(goalCenter.x + Math.sin(ang) * 1.0, -KEEPER.roamX * 0.55, KEEPER.roamX * 0.55),
    z: clamp(goalCenter.z + Math.cos(ang) * 1.0, 0.55, KEEPER.roamZ * 0.4),
  };
}

export function crossingIsOnTarget(crossing, margin = 0) {
  if (!crossing) return false;
  const halfW = PITCH.goalWidth / 2;
  return Math.abs(crossing.p.x) < halfW + margin && crossing.p.y < PITCH.goalHeight + margin && crossing.p.y > -0.1;
}

// Dive search by simulation.
//
// The pure-math planner in divePlanner.js reasons about what a human body
// *should* be able to do. This module goes one better: for every candidate
// dive it instantiates a throw-away copy of the keeper's ragdoll, plays the
// dive forward through the real solver, and scores how close the gloves and
// body actually came to the ball. The dive the AI commits to is therefore a
// dive that has literally been rehearsed, which is what makes the automatic
// dive feel authoritative instead of approximate.

import { KEEPER, BALL } from '../config.js';
import { Keeper } from '../sim/keeper.js';
import { predictPath } from './ball.js';
import { DIVE_PROFILES, ARM_REACH, norm } from './divePlanner.js';

const SIM_DT = 1 / 60;
const SIM_STEPS = 26; // ~0.43 s of rehearsed flight, at a real-time step

// Candidate shapes: the base profiles plus small variations in how hard the
// keeper commits, so the search can find e.g. "less far, more up".
const SHAPE_VARIANTS = [0.78, 0.9, 1.0, 1.12];

// Candidates keep `axis` as a plain [x, y, z] triple: the planner's evaluator
// expects that shape, while `axisVec` is the normalised vector for the ragdoll.
function makeCandidate(profile, scale, reach) {
  const axisVec = norm(profile.axis[0], profile.axis[1] * scale.y, profile.axis[2]);
  return {
    type: profile.type,
    axis: [axisVec.x, axisVec.y, axisVec.z],
    axisVec,
    hips: profile.hips,
    reach,
    cost: profile.cost,
    base: profile,
  };
}

// Build a full dive plan for a candidate from the synthetic planner, then run
// it through a fresh ragdoll and see where the body actually ends up.
export function simulateCandidate(candidate, start, ball, planRef, opts = {}) {
  const keeper = new Keeper(null);
  keeper.reset(start.x, start.z);
  keeper.vel = { x: start.vel?.x ?? 0, z: start.vel?.z ?? 0 };
  // The synthetic plan supplies targets; the candidate supplies the shape.
  // The candidate's shape drives the hip height; the analytic plan supplies the
  // intended contact point, which the rehearsal then refines.
  const plan = {
    ...planRef,
    profile: candidate.type,
    axis: candidate.axisVec ?? candidate.axis,
    commitTime: Math.max(0.5, planRef.tContact + 0.3),
    targetHipsHeight: candidate.hips,
  };
  keeper.startDive(plan);
  const ballCopy = {
    p: { ...ball.p },
    v: { ...ball.v },
    w: { ...ball.w },
    resting: false,
  };
  let bestErr = Infinity;
  let bestPoint = null;
  let bestT = 0;
  let contactPart = null;
  for (let i = 0; i < SIM_STEPS; i++) {
    keeper.update(SIM_DT, ballCopy, {});
    if (keeper.mode !== 'dive') break;
    // advance the ball analytically along the same clock
    stepBallLite(ballCopy, SIM_DT);
    for (const part of Object.values(keeper.ragdoll.parts)) {
      const d = Math.hypot(part.p.x - ballCopy.p.x, part.p.y - ballCopy.p.y, part.p.z - ballCopy.p.z);
      const surface = d - (part.radius + BALL.radius);
      if (surface < bestErr) {
        bestErr = surface;
        bestPoint = { ...ballCopy.p };
        bestT = (i + 1) * SIM_DT;
        contactPart = part.name;
      }
    }
    if (ballCopy.p.z < -0.35) break;
  }
  return { bestErr, bestPoint, bestT, contactPart, keeper, plan };
}

function stepBallLite(b, dt) {
  // same integrator as physics/ball.stepBall, inlined to avoid the import cycle
  const speed = Math.hypot(b.v.x, b.v.y, b.v.z);
  let ax = 0;
  let ay = -9.81;
  let az = 0;
  if (speed > 1e-4) {
    const k = 0.0062 * speed;
    ax -= k * b.v.x;
    ay -= k * b.v.y;
    az -= k * b.v.z;
    ax += 0.0032 * (b.w.y * b.v.z - b.w.z * b.v.y);
    ay += 0.0032 * (b.w.z * b.v.x - b.w.x * b.v.z);
    az += 0.0032 * (b.w.x * b.v.y - b.w.y * b.v.x);
  }
  b.v.x += ax * dt;
  b.v.y += ay * dt;
  b.v.z += az * dt;
  b.p.x += b.v.x * dt;
  b.p.y += b.v.y * dt;
  b.p.z += b.v.z * dt;
  if (b.p.y < BALL.radius) {
    b.p.y = BALL.radius;
    b.v.y = Math.abs(b.v.y) * 0.5;
  }
}

// Main entry: given the keeper state and the ball, rehearse every candidate and
// return the best one, with a full plan ready to hand to the ragdoll.
// A footballer's imperfect read of the shot: shift the predicted arrival point
// laterally and vertically by an amount drawn from the perception error.
function blurBall(ball, amount, useful) {
  const last = useful[useful.length - 1];
  const first = useful[0];
  const span = Math.max(0.15, last.t - first.t);
  const lead = 0.45;
  const idx = useful.findIndex((s) => s.t >= first.t + span * lead);
  const aim = useful[Math.max(0, idx)];
  const jitterX = (Math.random() - 0.5) * 2 * amount * 0.55;
  const jitterY = (Math.random() - 0.5) * 2 * amount * 0.4;
  // re-aim the ball at (aim + jitter) keeping its current speed and spin
  const out = {
    p: { ...ball.p },
    v: { ...ball.v },
    w: { ...ball.w },
    resting: false,
  };
  const dt = Math.max(0.06, aim.t);
  out.v.x = (aim.x + jitterX - ball.p.x) / dt;
  out.v.y = (aim.y + jitterY - ball.p.y) / dt + 0.5 * 9.81 * dt;
  out.v.z = (aim.z - ball.p.z) / dt;
  return out;
}

// Minimal plan if the analytic builder cannot produce one (e.g. the ball is
// already past the keeper): just launch along the candidate axis.
function buildFallback(cand, ctx) {
  const axis = cand.axis;
  const travel = 2.0;
  const pelvisTarget = {
    x: Math.max(-KEEPER.roamX, Math.min(KEEPER.roamX, ctx.root.x + axis.x * travel)),
    y: Math.max(0.3, Math.min(1.7, cand.hips)),
    z: Math.max(0.22, Math.min(KEEPER.roamZ, ctx.root.z + axis.z * travel)),
  };
  return {
    profile: cand.type,
    axis,
    arm: Math.abs(axis.x) < 0.22 ? 'both' : axis.x > 0 ? 'left' : 'right',
    tContact: 0.3,
    commitTime: 0.6,
    pelvisTarget,
    targetHipsHeight: pelvisTarget.y,
    handTarget: {
      x: pelvisTarget.x + axis.x * ARM_REACH,
      y: Math.max(0.12, pelvisTarget.y + axis.y * ARM_REACH + 0.08),
      z: pelvisTarget.z + axis.z * ARM_REACH,
    },
    launchVel: { x: axis.x * 5, y: 0, z: axis.z * 5 },
    urgency: 0.4,
  };
}

export function searchBestDive(ctx, ball, planFactory, opts = {}) {
  const budget = opts.budget ?? 12;
  // The keeper reads the shot perfectly, but a real keeper's read is imperfect
  // and he only gets a glimpse. `perception` (0..1) blurs the target point so
  // the reheard dive goes slightly to the wrong place, exactly like a keeper
  // committing half a beat early.
  const perception = opts.perception ?? 1;
  const path = predictPath(ball, 1.4, 1 / 90);

  // Where is the ball going to be, frame by frame? Only consider contact points
  // that are in front of the keeper and inside a savable window.
  const useful = path.filter((s) => s.z > -0.05 && s.z < 3.2 && s.t < 0.65);
  if (!useful.length) return null;

  const candidates = [];
  for (const profile of DIVE_PROFILES) {
    // two commitment levels per shape is enough; the cheap ranker picks the best
    for (const scale of [0.9, 1.1]) {
      candidates.push(makeCandidate(profile, { y: scale }, 1));
    }
  }

  // Cheap pre-ranking with the analytic planner keeps us inside the budget.
  const ranked = planFactory.rank(ctx, ball, candidates);
  const shortlist = ranked.slice(0, budget);

  // Blur the ball: pick a random plausible landing point near the true one.
  const probedBall = perception < 1 ? blurBall(ball, (1 - perception), useful) : ball;

  let best = null;
  for (const cand of shortlist) {
    let planRef;
    try {
      planRef = planFactory.build(ctx, probedBall, cand, path);
    } catch (e) {
      planRef = buildFallback(cand, ctx);
    }
    if (!planRef) planRef = buildFallback(cand, ctx);
    const result = simulateCandidate(cand, { ...ctx.root, vel: ctx.vel }, probedBall, planRef, opts);
    // score: did the body actually get to the ball, and how cheap was the dive?
    // A rehearsal that went NaN or never touched anything scores terribly.
    const err = Number.isFinite(result.bestErr) ? result.bestErr : 9;
    result.bestErr = err;
    const score = err + cand.cost * 0.3;
    if (!best || score < best.score) {
      best = { score, ...result, candidate: cand };
    }
  }
  if (!best) return null;
  // Hand back the rehearsed plan, but with the contact time taken from what
  // actually happened in the rehearsal.
  const plan = {
    ...best.plan,
    tContact: Math.max(0.08, best.bestT),
    commitTime: Math.min(1.5, Math.max(0.45, best.bestT + 0.3)),
    rehearsedError: best.bestErr,
    rehearsedPart: best.contactPart,
    reachable: best.bestErr < 0.1,
    confidence: Math.max(0.05, Math.min(1, 1 - best.bestErr / 1.2)),
    urgency: Math.max(0, Math.min(1, best.bestErr / 0.8)),
    intercepted: best.bestErr < 0,
    search: {
      evaluated: shortlist.length,
      bestError: best.bestErr,
      part: best.contactPart,
    },
  };
  return plan;
}

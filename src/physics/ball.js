// Aerodynamic ball flight with drag + Magnus lift, plus analytic prediction.
// Pure maths (no three.js) so it can be unit-tested in Node.

import { BALL, PITCH } from '../config.js';

const G = BALL.gravity;

export function createBallState(pos = { x: 0, y: BALL.radius, z: PITCH.penaltySpotZ }, vel = { x: 0, y: 0, z: 0 }) {
  return {
    p: { x: pos.x, y: pos.y, z: pos.z },
    v: { x: vel.x, y: vel.y, z: vel.z },
    w: { x: 0, y: 0, z: 0 }, // angular velocity (spin)
    resting: false,
    spin: 0,
  };
}

// One integration step of the ball under gravity, quadratic drag and Magnus.
// Spin decays slowly (air resistance on a spinning sphere is small).
export function stepBall(ball, dt, opts = {}) {
  const drag = opts.drag ?? BALL.dragK;
  const magnus = opts.magnus ?? BALL.magnusK;
  const { p, v, w } = ball;
  const speed = Math.hypot(v.x, v.y, v.z);
  let ax = 0;
  let ay = -G;
  let az = 0;
  if (speed > 1e-4) {
    const k = drag * speed;
    ax -= k * v.x;
    ay -= k * v.y;
    az -= k * v.z;
    const mx = w.y * v.z - w.z * v.y;
    const my = w.z * v.x - w.x * v.z;
    const mz = w.x * v.y - w.y * v.x;
    ax += magnus * mx;
    ay += magnus * my;
    az += magnus * mz;
  }
  v.x += ax * dt;
  v.y += ay * dt;
  v.z += az * dt;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;
  const spinDecay = Math.exp(-0.35 * dt);
  w.x *= spinDecay;
  w.y *= spinDecay;
  w.z *= spinDecay;
  ball.spin = Math.hypot(w.x, w.y, w.z);
  if (p.y <= BALL.radius) {
    p.y = BALL.radius;
    if (v.y < 0) {
      v.y = -v.y * BALL.restFloor;
      v.x *= 0.86;
      v.z *= 0.86;
      if (Math.abs(v.y) < 0.55) v.y = 0;
    }
    // rolling friction
    const f = Math.exp(-1.35 * dt);
    v.x *= f;
    v.z *= f;
    if (Math.hypot(v.x, v.z) < 0.15) {
      v.x = 0;
      v.z = 0;
      ball.resting = true;
    }
  }
  return ball;
}

// Cone of possible future trajectories, sampled by perturbing the current
// velocity slightly. Used by the keeper AI to reason about uncertainty.
export function sampleTrajectoryCone(ball, horizon = 1.6, samples = 2) {
  const out = [];
  const base = Math.hypot(ball.v.x, ball.v.y, ball.v.z) || 1;
  const step = 0.02 * samples;
  for (let i = -1; i <= 1; i += 0.5) {
    const b = structuredClone(ball);
    const n = { x: 0, y: 1, z: 0 };
    const t = { x: b.v.z / base, y: 0, z: -b.v.x / base };
    const s = i * step;
    b.v.x += t.x * s * base + n.x * s * base * 0.4;
    b.v.y += n.y * s * base * 0.4;
    b.v.z += t.z * s * base + n.z * s * base * 0.4;
    out.push(predictAtPlaneY(b, horizon));
  }
  return out;
}

// Integrate a copy of the ball until it crosses z (goal plane) or a timeout.
// Returns the crossing point plus timing information. Null if it never gets
// there within `maxTime`.
export function predictCrossing(ball, planeZ = PITCH.grassLineZ, maxTime = 4, dt = 1 / 240, opts = {}) {
  const b = {
    p: { ...ball.p },
    v: { ...ball.v },
    w: { ...ball.w },
    resting: false,
    spin: 0,
  };
  const steps = Math.round(maxTime / dt);
  let prev = { x: b.p.x, y: b.p.y, z: b.p.z };
  let t = 0;
  for (let i = 0; i < steps; i++) {
    stepBall(b, dt, opts);
    t += dt;
    const d0 = prev.z - planeZ;
    const d1 = b.p.z - planeZ;
    if (d0 * d1 <= 0 && Math.abs(d0 - d1) > 1e-9) {
      const f = d0 / (d0 - d1);
      return {
        t: t - dt + dt * f,
        p: {
          x: prev.x + (b.p.x - prev.x) * f,
          y: prev.y + (b.p.y - prev.y) * f,
          z: planeZ,
        },
        v: { ...b.v },
        incoming: d0 > 0,
      };
    }
    prev = { x: b.p.x, y: b.p.y, z: b.p.z };
  }
  return null;
}

// Predicted trajectory sampled at fixed time steps — used for the aim guide and
// for the keeper's "sees it late" reaction model.
export function predictPath(ball, maxTime = 2.4, dt = 1 / 60) {
  const b = { p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w }, resting: false, spin: 0 };
  const samples = [];
  const steps = Math.round(maxTime / dt);
  for (let i = 0; i < steps; i++) {
    stepBall(b, dt);
    samples.push({ t: (i + 1) * dt, x: b.p.x, y: b.p.y, z: b.p.z });
    if (b.p.y <= BALL.radius + 1e-3 && b.p.z < 0.4) break;
  }
  return samples;
}

// When/where does the ball pass a plane at constant y? (for high shots)
function predictAtPlaneY(ball, maxTime) {
  return predictCrossing(ball, PITCH.grassLineZ, maxTime);
}

// Where is the ball a given number of seconds from now?
export function ballAtTime(ball, seconds, dt = 1 / 240) {
  const b = { p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w }, resting: false, spin: 0 };
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) stepBall(b, dt);
  return b;
}

// Build a launch velocity that reaches `target` at the goal plane with the
// desired flight time, compensating drag/curve approximately by iterating.
export function solveLaunchVelocity(from, target, flightTime, spin = { x: 0, y: 0, z: 0 }) {
  // initial guess ignoring drag
  let vx = (target.x - from.x) / flightTime;
  let vz = (target.z - from.z) / flightTime;
  let vy = (target.y - from.y) / flightTime + 0.5 * G * flightTime;
  const guess = { x: vx, y: vy, z: vz };
  let best = { ...guess };
  let bestErr = Infinity;
  const test = { p: { ...from }, v: { ...guess }, w: { ...spin }, resting: false, spin: 0 };
  const dt = 1 / 240;
  let b = { p: { ...test.p }, v: { ...test.v }, w: { ...test.w }, resting: false, spin: 0 };
  let prevZ = b.p.z;
  let prevX = b.p.x;
  let prevY = b.p.y;
  let t = 0;
  for (let i = 0; i < 400; i++) {
    stepBall(b, dt);
    t += dt;
    if ((prevZ > 0 && b.p.z <= 0) || (prevZ < 0 && b.p.z >= 0)) {
      const d = (0 - prevZ) / (b.p.z - prevZ || 1e-6);
      const p = {
        x: prevX + (b.p.x - prevX) * d,
        y: prevY + (b.p.y - prevY) * d,
      };
      const err = Math.hypot(p.x - target.x, p.y - target.y) + Math.abs(t - flightTime) * 0.3;
      if (err < bestErr) {
        bestErr = err;
        best = { ...guess };
      }
      // correct aim and retry (2 iterations of proportional correction)
      guess.x += (target.x - p.x) * 0.9;
      guess.y += (target.y - p.y) * 0.9;
      guess.z += (flightTime - t) * 6;
      b = { p: { ...test.p }, v: { ...guess }, w: { ...test.w }, resting: false, spin: 0 };
      prevZ = b.p.z;
      prevX = b.p.x;
      prevY = b.p.y;
      t = 0;
    } else {
      prevZ = b.p.z;
      prevX = b.p.x;
      prevY = b.p.y;
    }
  }
  return best;
}

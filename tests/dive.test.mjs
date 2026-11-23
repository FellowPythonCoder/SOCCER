import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keeper } from '../src/sim/keeper.js';
import { KEEPER, BALL, PITCH } from '../src/config.js';
import { createBallState, predictCrossing, solveLaunchVelocity } from '../src/physics/ball.js';
import { searchBestDive } from '../src/physics/diveSearch.js';
import { planFactory, planDive, DIVE_PROFILES } from '../src/physics/divePlanner.js';

const ctxOf = (x = 0, z = 1.1) => ({ root: { x, z }, hips: KEEPER.hipHeight, vel: { x: 0, z: 0 } });

// Actually play a rehearsed dive in a live keeper and report how close the body
// came to the ball.
function playDive(plan, ball, start = { x: 0, z: 1.1 }) {
  const k = new Keeper();
  k.reset(start.x, start.z);
  k.startDive(plan);
  const b = { p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w }, resting: false };
  let best = Infinity;
  for (let i = 0; i < 70; i++) {
    k.update(1 / 120, b, {});
    for (let s = 0; s < 4; s++) step(b, 1 / 480);
    for (const part of Object.values(k.ragdoll.parts)) {
      const d = Math.hypot(part.p.x - b.p.x, part.p.y - b.p.y, part.p.z - b.p.z) - (part.radius + BALL.radius);
      if (d < best) best = d;
    }
  }
  return best;
}

function step(b, dt) {
  const speed = Math.hypot(b.v.x, b.v.y, b.v.z);
  let ax = 0, ay = -9.81, az = 0;
  if (speed > 1e-4) {
    const k = 0.0062 * speed;
    ax -= k * b.v.x; ay -= k * b.v.y; az -= k * b.v.z;
    ax += 0.0032 * (b.w.y * b.v.z - b.w.z * b.v.y);
    ay += 0.0032 * (b.w.z * b.v.x - b.w.x * b.v.z);
    az += 0.0032 * (b.w.x * b.v.y - b.w.y * b.v.x);
  }
  b.v.x += ax * dt; b.v.y += ay * dt; b.v.z += az * dt;
  b.p.x += b.v.x * dt; b.p.y += b.v.y * dt; b.p.z += b.v.z * dt;
  if (b.p.y < BALL.radius) { b.p.y = BALL.radius; b.v.y = Math.abs(b.v.y) * 0.5; }
}

test('the rehearsed dive really does intercept the ball', () => {
  const shots = [
    { x: 0, v: { x: 6.5, y: 2.2, z: -24 } },
    { x: 0, v: { x: -7.5, y: 2.6, z: -22 } },
    { x: 0, v: { x: 2.0, y: 1.4, z: -20 } },
    { x: 0, v: { x: -1.0, y: 3.0, z: -18 } },
  ];
  for (const shot of shots) {
    const ball = createBallState({ x: shot.x, y: BALL.radius, z: 9 }, shot.v);
    const ctx = ctxOf();
    const plan = searchBestDive(ctx, ball, planFactory());
    assert.ok(plan, 'search must return a plan');
    const err = playDive(plan, ball);
    assert.ok(err < 0.45, `rehearsed dive missed by ${err.toFixed(2)} m for ${JSON.stringify(shot.v)}`);
  }
});

test('the search picks left for a left shot and right for a right shot', () => {
  for (const side of [-1, 1]) {
    const ball = createBallState({ x: 0, y: BALL.radius, z: 9 }, { x: side * 8.5, y: 2.4, z: -24 });
    const plan = searchBestDive(ctxOf(), ball, planFactory());
    assert.ok(plan, 'must plan');
    const lateral = plan.pelvisTarget.x - 0;
    assert.ok(Math.sign(lateral) === side || Math.abs(lateral) < 0.15,
      `dived to x=${lateral.toFixed(2)} for a shot to x=${side * 4.5}`);
  }
});

test('a straight shot at the keeper does not trigger a wild dive', () => {
  // aimed to arrive on the goal line at the keeper's midriff
  const from = { x: 0, y: BALL.radius, z: 9 };
  const v = solveLaunchVelocity(from, { x: 0.1, y: 0.9, z: 0 }, 0.42, { x: 0, y: 0, z: 0 });
  const ball = createBallState(from, v);
  const plan = searchBestDive(ctxOf(), ball, planFactory());
  assert.ok(plan, 'must plan');
  assert.ok(Math.abs(plan.pelvisTarget.x) < 1.1, `should stay central, went to ${plan.pelvisTarget.x.toFixed(2)}`);
});

test('all dive profiles execute without NaN in the live keeper', () => {
  const ball = createBallState({ x: 0, y: BALL.radius, z: 9 }, { x: 4, y: 2, z: -22 });
  for (const profile of DIVE_PROFILES) {
    const k = new Keeper();
    k.reset(0, 1.1);
    const plan = {
      profile: profile.type,
      axis: { x: profile.axis[0], y: profile.axis[1], z: profile.axis[2] },
      arm: 'both',
      tContact: 0.3,
      handTarget: { x: profile.axis[0] * 1.4, y: 0.8, z: 1.4 },
      pelvisTarget: { x: profile.axis[0] * 1.2, y: Math.max(0.35, profile.hips), z: 1.2 },
      launchVel: { x: profile.axis[0] * 5, y: 0, z: 0.4 },
      commitTime: 0.6,
      urgency: 0.3,
    };
    k.startDive(plan);
    for (let i = 0; i < 90; i++) k.update(1 / 120, ball, {});
    for (const part of Object.values(k.ragdoll.parts)) {
      assert.ok(Number.isFinite(part.p.x) && Number.isFinite(part.p.y) && Number.isFinite(part.p.z),
        `${profile.type}: ${part.name} NaN`);
      assert.ok(part.p.y > -0.2, `${profile.type}: ${part.name} below ground`);
    }
  }
});

test('the keeper gets back on his feet after a dive', () => {
  const ball = createBallState({ x: 0, y: BALL.radius, z: 9 }, { x: 5, y: 2, z: -22 });
  const plan = searchBestDive(ctxOf(), ball, planFactory());
  const k = new Keeper();
  k.reset(0, 1.1);
  k.startDive(plan);
  let returned = false;
  for (let i = 0; i < 120 * 8; i++) {
    k.update(1 / 120, ball, {});
    if (i > 60 && (k.mode === 'ready' || k.mode === 'walk')) { returned = true; break; }
  }
  assert.ok(returned, `keeper stuck in ${k.mode}`);
  assert.ok(k.ragdoll.height() > 1.2, `keeper stayed on the floor: height ${k.ragdoll.height()}`);
});

test('dive cost stays inside a frame budget', () => {
  const ball = createBallState({ x: 0, y: BALL.radius, z: 9 }, { x: 3, y: 2, z: -23 });
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) searchBestDive(ctxOf(), ball, planFactory());
  const avg = (performance.now() - t0) / 5;
  assert.ok(avg < 60, `dive search averaged ${avg.toFixed(1)}ms`);
});

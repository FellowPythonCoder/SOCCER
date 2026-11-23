import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBallState, stepBall, predictCrossing, solveLaunchVelocity } from '../src/physics/ball.js';
import { DIVE_PROFILES, evaluateProfile, planDive, hipTravel } from '../src/physics/divePlanner.js';
import { BALL, PITCH, KEEPER } from '../src/config.js';

test('ball obeys gravity', () => {
  const b = createBallState({ x: 0, y: 5, z: 10 }, { x: 0, y: 0, z: 0 });
  for (let i = 0; i < 60; i++) stepBall(b, 1 / 120);
  assert.ok(b.p.y < 5, 'ball should fall');
  assert.ok(Math.abs(b.p.z - 10) < 1e-6, 'no lateral drift without velocity');
});

test('drag slows a fast ball by a realistic amount', () => {
  // a 30 m/s strike loses roughly 20-35% of its speed over the first second
  const b = createBallState({ x: 0, y: 2, z: 40 }, { x: 0, y: 0, z: -30 });
  for (let i = 0; i < 120; i++) stepBall(b, 1 / 120);
  const lost = 1 - Math.abs(b.v.z) / 30;
  assert.ok(lost > 0.15 && lost < 0.4, `lost ${(lost * 100).toFixed(0)}% of speed`);
});

test('magnus effect curves the ball', () => {
  const straight = createBallState({ x: 0, y: 1, z: 20 }, { x: 0, y: 0, z: -25 });
  const curled = createBallState({ x: 0, y: 1, z: 20 }, { x: 0, y: 0, z: -25 });
  curled.w = { x: 0, y: 70, z: 0 };
  for (let i = 0; i < 100; i++) { stepBall(straight, 1 / 120); stepBall(curled, 1 / 120); }
  assert.ok(Math.abs(curled.p.x) > 0.15, `spin should divert the ball sideways (got ${curled.p.x})`);
});

test('predictCrossing finds the goal plane', () => {
  const b = createBallState({ x: 1, y: 0.5, z: 11 }, { x: 0.8, y: 1.6, z: -22 });
  const c = predictCrossing(b, 0, 3);
  assert.ok(c, 'should cross');
  assert.ok(Math.abs(c.p.z) < 1e-6);
  assert.ok(c.t > 0.3 && c.t < 0.9, `timing sensible (${c.t})`);
  assert.ok(c.p.y >= BALL.radius - 1e-6, 'not beneath the turf');
});

test('launch solver hits its target', () => {
  for (const [tx, ty, t] of [[3.0, 1.2, 0.55], [-2.4, 0.4, 0.7], [0, 2.0, 0.62]]) {
    const from = { x: 0, y: BALL.radius, z: 11 };
    const v = solveLaunchVelocity(from, { x: tx, y: ty, z: 0 }, t, { x: 0, y: 0, z: 0 });
    const b = createBallState(from, v);
    const c = predictCrossing(b, 0, 3);
    assert.ok(c, 'ball must reach the goal line');
    assert.ok(Math.hypot(c.p.x - tx, c.p.y - ty) < 0.28,
      `landed ${c.p.x.toFixed(2)},${c.p.y.toFixed(2)} for target ${tx},${ty}`);
  }
});

test('hip travel is monotonic and physically bounded', () => {
  let prev = 0;
  for (let t = 0.05; t < 1.2; t += 0.05) {
    const d = hipTravel(t);
    assert.ok(d >= prev - 1e-9, 'never goes backwards');
    assert.ok(d < 6.5 * t + 0.25, 'bounded by launch speed');
    prev = d;
  }
  assert.equal(hipTravel(0), 0);
});

test('dive profiles all produce sane evaluations', () => {
  const ball = createBallState({ x: 0, y: BALL.radius, z: 11 }, { x: 3.5, y: 1.8, z: -24 });
  const ctx = { root: { x: 0, z: 1.1 }, hips: KEEPER.hipHeight, vel: { x: 0, z: 0 } };
  const path = Array.from({ length: 60 }, (_, i) => ({
    t: (i + 1) / 90,
    ...(() => {
      const dt = 1 / 90;
      const t = (i + 1) * dt;
      return { x: 3.5 * t, y: 0.11 + 1.8 * t - 4.9 * t * t, z: 11 - 24 * t };
    })(),
  })).filter((s) => s.y > 0 && s.z > -0.2);
  for (const p of DIVE_PROFILES) {
    const ev = evaluateProfile(p, ctx, path);
    assert.ok(ev, `${p.type} must evaluate`);
    assert.ok(Number.isFinite(ev.score), `${p.type} score finite`);
    assert.ok(ev.hipPos && Number.isFinite(ev.hipPos.x), `${p.type} hips finite`);
    assert.ok(ev.t <= 1.9, `${p.type} within dive window`);
  }
});

test('dive planner chooses the correct side', () => {
  const ctx = { root: { x: 0, z: 1.1 }, hips: KEEPER.hipHeight, vel: { x: 0, z: 0 } };
  for (const side of [-1, 1]) {
    const ball = createBallState({ x: 0, y: BALL.radius, z: 11 }, { x: side * 9, y: 2.4, z: -26 });
    const plan = planDive(ctx, ball);
    assert.ok(plan, 'must produce a plan');
    assert.equal(Math.sign(plan.axis.x), side,
      `should dive toward x=${side * 9} but chose ${plan.profile}`);
    assert.ok(Math.sign(plan.launchVel.x) === side || Math.abs(plan.launchVel.x) < 0.2,
      'launch direction must match');
  }
});

test('dive planner stays honest about impossible shots', () => {
  const ctx = { root: { x: 0, z: 1.1 }, hips: KEEPER.hipHeight, vel: { x: 0, z: 0 } };
  // an absolute rocket into the far top corner from close range
  const ball = createBallState({ x: 0, y: BALL.radius, z: 11 }, { x: 14, y: 3.2, z: -44 });
  const plan = planDive(ctx, ball);
  assert.ok(plan, 'still produces a plan');
  assert.equal(plan.reachable, false, 'and admits it is out of reach');
  assert.ok(plan.error > 0.3, 'with a real shortfall');
});

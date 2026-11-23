import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASE } from '../src/sim/game.js';
import { Keeper } from '../src/sim/keeper.js';
import { KEEPER, PITCH, BALL } from '../src/config.js';

const dt = 1 / 120;

test('game reaches every phase and resolves each shot', () => {
  const g = new Game({});
  g.setDifficulty('pro');
  const seen = new Set();
  let results = 0;
  let last = -1;
  for (let i = 0; i < 120 * 120; i++) {
    g.update(dt);
    seen.add(g.phase);
    if (g.phase === PHASE.resolved && g.lastResult && g.lastResult.time !== last) {
      last = g.lastResult.time;
      results++;
      assert.ok(['goal', 'save', 'catch', 'miss'].includes(g.lastResult.kind), g.lastResult.kind);
    }
  }
  assert.ok(seen.has(PHASE.kickoff) && seen.has(PHASE.live) && seen.has(PHASE.resolved), [...seen].join(','));
  assert.ok(results >= 6, `resolved ${results} shots`);
});

test('keeper never leaves his working area', () => {
  const k = new Keeper();
  k.reset(0, 1.1);
  const ball = { p: { x: 0, y: 0.11, z: 11 }, v: { x: 0, y: 0, z: 0 } };
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (const [x, z] of dirs) {
    k.setInput(x, z);
    for (let i = 0; i < 240; i++) {
      k.update(dt, ball);
      assert.ok(Math.abs(k.pos.x) <= KEEPER.roamX + 0.05, `x escaped: ${k.pos.x}`);
      assert.ok(k.pos.z >= 0.35 && k.pos.z <= KEEPER.roamZ + 0.2, `z escaped: ${k.pos.z}`);
    }
  }
});

test('movement has momentum: the keeper coasts after input is released', () => {
  const k = new Keeper();
  k.reset(0, 1.1);
  const ball = { p: { x: 0, y: 0.11, z: 11 }, v: { x: 0, y: 0, z: 0 } };
  k.setInput(1, 0);
  for (let i = 0; i < 60; i++) k.update(dt, ball);
  const before = k.pos.x;
  k.setInput(0, 0);
  for (let i = 0; i < 40; i++) k.update(dt, ball);
  assert.ok(k.pos.x > before + 0.05, 'should carry forward after release');
  assert.ok(k.pos.x < before + 1.2, 'and decelerate rather than glide forever');
});

test('a dive is impossible while already diving, and one per shot', () => {
  const g = new Game({});
  for (let i = 0; i < 120 * 20 && g.phase !== PHASE.live; i++) g.update(dt);
  for (let i = 0; i < 120 * 6 && g.ballFrozen; i++) g.update(dt);
  // fake a ball coming at goal
  g.ball = { p: { x: 0, y: BALL.radius, z: 8 }, v: { x: 4, y: 1.5, z: -18 }, w: { x: 0, y: 0, z: 0 }, resting: false };
  g.ballFrozen = false;
  const first = g.dive();
  assert.ok(first, 'first dive should trigger');
  assert.equal(g.dive(), null, 'second dive in the same shot must be refused');
});

test('goalkeeper contact is registered as a touch', () => {
  const g = new Game({});
  // aim straight at the keeper's chest from short range
  const k = g.keeper;
  k.reset(0, 1.1);
  g.ball = {
    p: { x: 0, y: 1.2, z: 2.2 },
    v: { x: 0, y: 0, z: -16 },
    w: { x: 0, y: 0, z: 0 },
    resting: false,
  };
  g.ballFrozen = false;
  g.shotInfo = { kind: 'test', speed: 16 };
  g.ballShotAt = g.time;
  g.phase = PHASE.live;
  let touched = false;
  for (let i = 0; i < 60 && !touched; i++) {
    g.update(dt);
    touched = g.keeperTouchedBall;
  }
  assert.ok(touched, 'ball must collide with the keeper');
  assert.ok(g.contact.touches.length > 0);
});

test('a shot wide of the goal is judged a miss', () => {
  const g = new Game({});
  g.keeper.reset(0, 1.1);
  g.ball = {
    p: { x: 12, y: 2.5, z: 6 },
    v: { x: 9, y: 2, z: -15 },
    w: { x: 0, y: 0, z: 0 },
    resting: false,
  };
  g.ballFrozen = false;
  g.shotInfo = { kind: 'test', speed: 20 };
  g.ballShotAt = g.time;
  g.phase = PHASE.live;
  let res = null;
  for (let i = 0; i < 120 * 8 && !res; i++) {
    g.update(dt);
    if (g.phase === PHASE.resolved) res = g.lastResult;
  }
  assert.ok(res, 'shot must resolve');
  assert.equal(res.kind, 'miss');
});

test('the ball never tunnels through the goal frame', () => {
  const g = new Game({});
  for (let trial = 0; trial < 12; trial++) {
    g.nextShot(0);
    for (let i = 0; i < 400; i++) {
      g.update(dt);
      if (g.phase === PHASE.resolved) break;
    }
    if (g.lastResult?.kind === 'goal') {
      // the ball must be behind the line but inside the frame
      assert.ok(Math.abs(g.ball.p.x) <= PITCH.halfPostX + 0.15, `goal from x=${g.ball.p.x}`);
      assert.ok(g.ball.p.y <= PITCH.crossbarY + 0.15, `goal from y=${g.ball.p.y}`);
    }
  }
  assert.ok(true);
});

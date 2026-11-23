import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, auditScene } from './harness.mjs';

installDom();
const THREE = await import('three');
const { createStage } = await import('../src/render/scene.js');
const { KeeperMesh } = await import('../src/render/keeperMesh.js');
const { ShooterMesh } = await import('../src/render/shooterMesh.js');
const { BallView, Effects } = await import('../src/render/ballView.js');
const { Game } = await import('../src/sim/game.js');

const renderer = new THREE.WebGLRenderer({ antialias: false });
const stage = createStage(renderer);
const game = new Game();
const keeperMesh = new KeeperMesh(game.keeper.ragdoll);
const shooterMesh = new ShooterMesh();
const ballView = new BallView(stage.scene);
const effects = new Effects(stage.scene);
stage.scene.add(keeperMesh.group, shooterMesh.group);

test('stage builds without NaN geometry', () => {
  const problems = auditScene(stage.scene, THREE);
  assert.deepEqual(problems, []);
});

test('simulation + meshes stay finite over a full match of shots', () => {
  const dt = 1 / 60;
  let shots = 0;
  let lastResultTime = -1;
  for (let i = 0; i < 60 * 120 && shots < 8; i++) {
    if (game.phase === 'live' && !game.ballFrozen && game.ball.v.z < -3 && !game.diveUsed) {
      game.dive();
    }
    game.update(dt);
    keeperMesh.update();
    shooterMesh.update(game.shooter, dt, game.ball);
    ballView.update(game.ball, dt);
    effects.update(dt);
    if (game.phase === 'resolved' && game.lastResult && game.lastResult.time !== lastResultTime) {
      lastResultTime = game.lastResult.time;
      shots++;
    }
  }
  assert.ok(shots >= 5, `expected several resolved shots, got ${shots}`);
  const problems = auditScene(stage.scene, THREE);
  assert.deepEqual(problems.slice(0, 5), []);
  const P = game.keeper.ragdoll.parts;
  for (const part of Object.values(P)) {
    assert.ok(Number.isFinite(part.p.x) && Number.isFinite(part.p.y) && Number.isFinite(part.p.z),
      `part ${part.name} went NaN`);
    assert.ok(part.p.y > -0.5, `part ${part.name} fell through the floor: ${part.p.y}`);
  }
  assert.ok(Number.isFinite(game.ball.p.x) && Number.isFinite(game.ball.p.y), 'ball NaN');
});

test('ball view resets cleanly', () => {
  ballView.reset(game.ball);
  assert.ok(Number.isFinite(ballView.mesh.position.x));
});

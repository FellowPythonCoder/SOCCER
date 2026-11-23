// Renders a pseudo-3D view of the goal + keeper + shooter using the software
// rasteriser, so the composition of a real shot can be inspected.
import { Canvas, camera, drawRagdoll, writePng } from './raster.mjs';
import { Game } from '../src/sim/game.js';
import { PITCH } from '../src/config.js';

const W = 900, H = 560, F = 700;
const g = new Game({});
g.setDifficulty('pro');
const frames = [];
let captured = 0;
let shotPhase = 'idle';
for (let i = 0; i < 120 * 14 && captured < 6; i++) {
  if (g.phase === 'live' && !g.ballFrozen && g.ball.v.z < -3 && !g.diveUsed) {
    // dive as a competent player would, a fraction of a second before arrival
    const dist = Math.abs(g.ball.p.z / (g.ball.v.z || -1));
    if (dist < 0.34 && dist > 0.15) { g.dive(); shotPhase = 'dive'; }
  }
  g.update(1 / 120);
  if (i % 6 === 0) {
    frames.push({
      ball: { ...g.ball.p },
      parts: Object.fromEntries(Object.entries(g.keeper.ragdoll.parts).map(([n, v]) => [n, { p: { ...v.p } }])),
      shooter: { pos: { ...g.shooter.pos }, facing: g.shooter.facing, legPhase: g.shooter.legPhase, state: g.shooter.state },
      phase: g.phase,
      result: g.lastResult?.kind,
    });
  }
}

const cam = camera({ x: 0.6, y: 3.6, z: 6.4 }, { x: 0, y: 1.05, z: 2.6 }, F, W, H);
const picks = [0.35, 0.52, 0.60, 0.66, 0.74, 0.86].map((f) => frames[Math.floor(frames.length * f)]).filter(Boolean);
const big = new Canvas(W * 3, H * 2, [6, 12, 18]);

function drawGoal(c) {
  const half = PITCH.goalWidth / 2, h = PITCH.goalHeight, d = PITCH.goalDepth;
  const postC = [235, 242, 250];
  for (let side of [-1, 1]) {
    c.capsule(cam, { x: side * half, y: 0, z: 0 }, { x: side * half, y: h, z: 0 }, 0.06, 0.06, postC);
  }
  c.capsule(cam, { x: -half, y: h, z: 0 }, { x: half, y: h, z: 0 }, 0.06, 0.06, postC);
  // net mesh
  for (let x = -half; x <= half; x += 0.4) {
    c.line(cam, { x, y: 0, z: -d }, { x, y: h, z: -d }, [120, 160, 190], 0.28);
  }
  for (let y = 0; y <= h; y += 0.3) {
    c.line(cam, { x: -half, y, z: -d }, { x: half, y, z: -d }, [120, 160, 190], 0.22);
    c.line(cam, { x: -half, y, z: 0 }, { x: -half, y, z: -d }, [110, 150, 180], 0.16);
    c.line(cam, { x: half, y, z: 0 }, { x: half, y, z: -d }, [110, 150, 180], 0.16);
  }
}

function drawStriker(c, s) {
  const f = s.facing, fx = Math.sin(f), fz = Math.cos(f);
  const base = { x: s.pos.x, y: 0, z: s.pos.z };
  const pel = { x: base.x, y: 0.95, z: base.z };
  const chest = { x: base.x + fx * 0.06, y: 1.36, z: base.z + fz * 0.06 };
  const head = { x: chest.x + fx * 0.05, y: 1.6, z: chest.z + fz * 0.05 };
  const shirt = [235, 60, 90];
  c.capsule(cam, pel, chest, 0.17, 0.17, shirt);
  c.sphere(cam, head, 0.115, [170, 120, 90]);
  for (const sx of [-1, 1]) {
    const sh = { x: chest.x + sx * 0.19 * Math.cos(f), y: 1.33, z: chest.z - sx * 0.19 * Math.sin(f) };
    const hand = { x: sh.x + fx * 0.08 + sx * 0.14, y: 0.92, z: sh.z + fz * 0.08 };
    c.capsule(cam, sh, hand, 0.06, 0.05, shirt);
    const hip = { x: pel.x + sx * 0.1 * Math.cos(f), y: 0.9, z: pel.z - sx * 0.1 * Math.sin(f) };
    const kick = s.legPhase;
    const foot = {
      x: hip.x + fx * (0.12 + Math.max(0, kick) * 0.6),
      y: 0.08 + Math.max(0, kick) * 0.5,
      z: hip.z + fz * (0.12 + Math.max(0, kick) * 0.6),
    };
    c.capsule(cam, hip, foot, 0.09, 0.06, [235, 240, 250]);
  }
}

picks.forEach((fr, i) => {
  const sub = new Canvas(W, H, [10, 20, 26]);
  // turf
  sub.plane(cam, 0, 14, [32, 74, 52]);
  drawGoal(sub);
  drawStriker(sub, fr.shooter);
  drawRagdoll(sub, cam, fr.parts);
  sub.sphere(cam, fr.ball, 0.11, [252, 252, 252]);
  const ox = (i % 3) * W, oy = Math.floor(i / 3) * H;
  for (let y = 0; y < H; y++) sub.buf.copy(big.buf, ((oy + y) * big.w + ox) * 3, y * sub.w * 3, (y + 1) * sub.w * 3);
  console.log(`frame ${i}: phase=${fr.phase} result=${fr.result ?? '-'} ball z=${fr.ball.z.toFixed(1)} y=${fr.ball.y.toFixed(2)}`);
});
writePng('/home/user/SOCCER/snaps/scene.png', big.w, big.h, big.buf);
console.log('wrote scene.png');

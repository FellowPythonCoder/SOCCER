import { Canvas, camera, drawRagdoll, writePng } from './raster.mjs';
import { Keeper } from '../src/sim/keeper.js';
import { searchBestDive } from '../src/physics/diveSearch.js';
import { planFactory } from '../src/physics/divePlanner.js';
import { createBallState, solveLaunchVelocity } from '../src/physics/ball.js';

// A realistic strike: aimed at a point on the goal line with a given flight time.
function shotAt(target, flight, from = { x: 0, y: 0.11, z: 9 }) {
  const v = solveLaunchVelocity(from, target, flight, { x: 0, y: 0, z: 0 });
  return createBallState(from, v);
}
import { Ragdoll } from '../src/sim/ragdoll.js';

const W = 640, H = 400, FOCAL = 520;
const out = [];
function sheet(name, entries) {
  // entries: {label, draw(canvas,cam)}
  const cols = 3;
  const cw = W, ch = H;
  const rows = Math.ceil(entries.length / cols);
  const big = new Canvas(cw * cols, ch * rows, [8, 14, 20]);
  const groundCam = camera({ x: 0, y: 2.6, z: 8 }, { x: 0, y: 0.9, z: 0.5 }, FOCAL, cw, ch);
  entries.forEach((e, i) => {
    const sub = new Canvas(cw, ch, [12, 22, 28]);
    sub.plane(groundCam, 0, 8, [34, 78, 56]);
    e.draw(sub);
    const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
    for (let y = 0; y < ch; y++) sub.buf.copy(big.buf, ((oy + y) * big.w + ox) * 3, y * sub.w * 3, (y + 1) * sub.w * 3);
  });
  writePng(`/home/user/SOCCER/snaps/${name}.png`, big.w, big.h, big.buf);
  console.log('wrote', name, big.w, big.h);
}

const camSide = camera({ x: 6.5, y: 2.4, z: 2.0 }, { x: 0, y: 0.9, z: 1.0 }, FOCAL, W, H);
const camFront = camera({ x: 0, y: 2.2, z: 7.5 }, { x: 0, y: 1.0, z: 0.8 }, FOCAL, W, H);

// 1. standing pose in several frames of a walk
const entries = [];
{
  const k = new Keeper(); k.reset(0, 1.1);
  const ball = { p: { x: 0, y: 0.11, z: 11 }, v: { x: 0, y: 0, z: 0 } };
  // snapshot the pose: the keeper keeps moving, so live references would all
  // end up rendering the final frame.
  const snap = () => Object.fromEntries(
    Object.entries(k.ragdoll.parts).map(([n, v]) => [n, { p: { ...v.p } }]),
  );
  for (let i = 0; i < 40; i++) k.update(1 / 120, ball);
  const poses = [snap()];
  k.setInput(-1, 0);
  for (let i = 0; i < 70; i++) { k.update(1 / 120, ball); if (i === 30) poses.push(snap()); }
  for (let i = 0; i < 14; i++) { k.update(1 / 120, ball); poses.push(snap()); }
  for (const parts of poses.slice(0, 5)) {
    entries.push({ draw: (c) => drawRagdoll(c, camFront, parts) });
  }
}
sheet('walk', entries);

// 2. dive sequences
for (const [name, target, flight, cam] of [
  ['dive-right', { x: 3.0, y: 1.0, z: 0 }, 0.52, camFront],
  ['dive-left', { x: -3.0, y: 1.0, z: 0 }, 0.52, camFront],
  ['low-dive', { x: -2.9, y: 0.3, z: 0 }, 0.55, camFront],
  ['high-dive', { x: 2.2, y: 2.0, z: 0 }, 0.5, camFront],
]) {
  const ball = shotAt(target, flight);
  const plan = searchBestDive({ root: { x: 0, z: 1.1 }, hips: 0.95, vel: { x: 0, z: 0 } }, ball, planFactory());
  const k = new Keeper(); k.reset(0, 1.1); k.startDive(plan);
  const b = { p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w } };
  const frames = [];
  for (let i = 0; i < 60; i++) {
    k.update(1 / 120, b, {});
    if ([3, 12, 24, 36, 48].includes(i)) {
      const snapshot = Object.fromEntries(Object.entries(k.ragdoll.parts).map(([n, v]) => [n, { p: { ...v.p } }]));
      frames.push({ t: i / 120, parts: snapshot, ball: { ...b.p } });
    }
    // advance ball
    for (let s = 0; s < 4; s++) {
      b.v.y -= 9.81 / 480; b.p.x += b.v.x / 480; b.p.y += b.v.y / 480; b.p.z += b.v.z / 480;
      if (b.p.y < 0.11) { b.p.y = 0.11; b.v.y = Math.abs(b.v.y) * 0.5; }
    }
  }
  const entries2 = frames.map((f) => ({
    label: `${name} ${f.t.toFixed(2)}`,
    draw: (c) => {
      c.sphere(cam, f.ball, 0.11, [250, 250, 250]);
      drawRagdoll(c, cam, f.parts);
    },
  }));
  sheet(name, entries2);
}

// 3. mid-air inspection from the side
{
  const ball = shotAt({ x: 3.0, y: 1.1, z: 0 }, 0.52);
  const plan = searchBestDive({ root: { x: 0, z: 1.1 }, hips: 0.95, vel: { x: 0, z: 0 } }, ball, planFactory());
  const k = new Keeper(); k.reset(0, 1.1); k.startDive(plan);
  const b = { p: { ...ball.p }, v: { ...ball.v }, w: { ...ball.w } };
  const es = [];
  for (let i = 0; i < 60; i++) {
    k.update(1 / 120, b, {});
    if ([6, 18, 30, 42].includes(i)) {
      const snapshot = Object.fromEntries(Object.entries(k.ragdoll.parts).map(([n, v]) => [n, { p: { ...v.p } }]));
      es.push({ parts: snapshot, ball: { ...b.p } });
    }
    for (let s = 0; s < 4; s++) { b.v.y -= 9.81 / 480; b.p.x += b.v.x / 480; b.p.y += b.v.y / 480; b.p.z += b.v.z / 480; }
  }
  sheet('dive-side', es.map((e) => ({
    draw: (c) => {
      c.sphere(camSide, e.ball, 0.11, [250, 250, 250]);
      drawRagdoll(c, camSide, e.parts);
    },
  })));
}

// debug: print projected positions for one pose
{
  const r = new Ragdoll({ x: 0, z: 0 });
  const c = camera({ x: 0, y: 1.3, z: 5.2 }, { x: 0, y: 1.0, z: 0 }, FOCAL, W, H);
  const pv = r.parts.pelvis.p;
  const rel = { x: pv.x - c.eye.x, y: pv.y - c.eye.y, z: pv.z - c.eye.z };
  const z = rel.x*c.fwd.x + rel.y*c.fwd.y + rel.z*c.fwd.z;
  const sx = W/2 + (rel.x*c.right.x + rel.y*c.right.y + rel.z*c.right.z)/z*FOCAL;
  const sy = H/2 - (rel.x*c.up.x + rel.y*c.up.y + rel.z*c.up.z)/z*FOCAL;
  console.log('debug pelvis ->', sx.toFixed(0), sy.toFixed(0), 'z', z.toFixed(2));
}

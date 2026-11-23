// Entry point: wires the simulation, renderer, camera, input and HUD together.

import * as THREE from 'three';
import './styles.css';
import { PHYSICS, KEEPER, PITCH } from './config.js';
import { Game, PHASE } from './sim/game.js';
import { createStage } from './render/scene.js';
import { KeeperMesh } from './render/keeperMesh.js';
import { ShooterMesh } from './render/shooterMesh.js';
import { BallView, Effects } from './render/ballView.js';
import { CameraRig } from './render/camera.js';
import { Hud } from './ui/hud.js';
import { predictPath, predictCrossing } from './physics/ball.js';

const app = document.getElementById('app');

// Two sibling layers so the HUD can rebuild itself without ever touching (or
// wiping out) the WebGL canvas. This was a real bug: the HUD's innerHTML reset
// was destroying the canvas element and leaving a blank screen.
const canvasRoot = document.createElement('div');
canvasRoot.id = 'scene-root';
app.appendChild(canvasRoot);
const hudRoot = document.createElement('div');
hudRoot.id = 'hud-root';
app.appendChild(hudRoot);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth || 1280, window.innerHeight || 720);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;
canvasRoot.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 3.4, 9);

const stage = createStage(renderer);
const { scene } = stage;

// ---------------------------------------------------------------- actors
const game = new Game();
const keeperMesh = new KeeperMesh(game.keeper.ragdoll);
scene.add(keeperMesh.group);
const shooterMesh = new ShooterMesh();
scene.add(shooterMesh.group);
const ballView = new BallView(scene);
const effects = new Effects(scene);
const rig = new CameraRig(camera, renderer.domElement);
const hud = new Hud(hudRoot);

// predicted-trajectory guide
const guideGeo = new THREE.BufferGeometry();
guideGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 90), 3));
const guide = new THREE.Line(guideGeo, new THREE.LineDashedMaterial({
  color: 0xffd36b, dashSize: 0.22, gapSize: 0.16, transparent: true, opacity: 0.55,
}));
guide.frustumCulled = false;
guide.visible = false;
scene.add(guide);

// where the keeper would like to dive (a thin rail showing the plan)
const planLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0x64f0ff, transparent: true, opacity: 0.7 }),
);
planLine.visible = false;
scene.add(planLine);

// ---------------------------------------------------------------- options
const options = {
  difficulty: 'pro',
  assisted: false,
  cinematic: true,
  guide: false,
};
game.setDifficulty(options.difficulty);
game.divePerception = 1;

// ---------------------------------------------------------------- input
const keys = new Set();
let started = false;
let paused = false;

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'r', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    e.preventDefault();
  }
  keys.add(k);
  if (k === 'r') triggerDive();
  if (k === 'escape') {
    setPaused(!paused);
  }
  if (k === 'c' && started) {
    options.cinematic = !options.cinematic;
    const box = document.getElementById('opt-cinematic');
    if (box) box.checked = options.cinematic;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// ---- touch controls (phones / tablets) -----------------------------------
const touchDirs = new Set();
function bindTouch() {
  document.querySelectorAll('.tbtn').forEach((btn) => {
    const dir = btn.dataset.dir;
    const on = (e) => { e.preventDefault(); touchDirs.add(dir); };
    const off = (e) => { e.preventDefault(); touchDirs.delete(dir); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  });
  const diveBtn = document.getElementById('btn-touch-dive');
  if (diveBtn) {
    diveBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      triggerDive();
    });
  }
}
bindTouch();

function triggerDive() {
  if (!started || paused) return;
  const plan = game.dive();
  if (plan) {
    hud.showDive(plan);
    planLine.visible = true;
    updatePlanLine(plan);
    rig.addShake(0.02);
  }
}

function readMove() {
  let x = 0;
  let z = 0;
  if (keys.has('w') || keys.has('arrowup')) z += 1;
  if (keys.has('s') || keys.has('arrowdown')) z -= 1;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (touchDirs.has('left')) x -= 1;
  if (touchDirs.has('right')) x += 1;
  if (touchDirs.has('up')) z += 1;
  if (touchDirs.has('down')) z -= 1;
  return { x, z };
}

// ---------------------------------------------------------------- menu wiring
document.getElementById('btn-play').addEventListener('click', () => {
  hud.showMenu(false);
  started = true;
  paused = false;
  rig.enabled = true;
  hud.setCrosshair(true);
  game.nextShot(1.2);
});
document.getElementById('btn-menu').addEventListener('click', () => setPaused(true));
document.getElementById('btn-help').addEventListener('click', () => hud.toggleHelp());
document.querySelectorAll('#menu-difficulty button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#menu-difficulty button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    options.difficulty = btn.dataset.diff;
    game.setDifficulty(options.difficulty);
    game.divePerception = 1;
  });
});
document.getElementById('opt-assisted').addEventListener('change', (e) => { options.assisted = e.target.checked; });
document.getElementById('opt-cinematic').addEventListener('change', (e) => { options.cinematic = e.target.checked; });
document.getElementById('opt-guide').addEventListener('change', (e) => { options.guide = e.target.checked; });

function setPaused(p) {
  paused = p;
  hud.showMenu(p);
  rig.enabled = !p;
  if (p) keys.clear();
}

// ---------------------------------------------------------------- game events
game.onEvent = (ev) => {
  switch (ev.type) {
    case 'kick': {
      const kph = (ev.speed * 3.6).toFixed(0);
      hud.call(`${ev.kind.toUpperCase()}`, 'kick', `${kph} km/h · ${spinLabel(ev.spin)}`);
      rig.addShake(Math.min(0.06, ev.speed * 0.0016));
      break;
    }
    case 'touch': {
      const t = ev;
      effects.impact(t.x, t.y, t.t ?? 0, t.hand ? 0xbdf5ff : 0xffe08a);
      rig.addShake(t.hand ? 0.05 : 0.08);
      break;
    }
    case 'post':
      hud.call('OFF THE WOODWORK', 'wood', '');
      effects.impact(ev.x, ev.y, 0.1, 0xfff0a8);
      rig.addShake(0.2);
      break;
    case 'result': {
      const r = ev;
      const detail = r.dive
        ? `${r.dive.profile.replace(/-/g, ' ')} · glove ${(r.dive.rehearsedPart ?? '—')}`
        : 'no dive';
      hud.showResult(r.kind, detail);
      hud.setStats(game.score);
      hud.setStreak(game.streak);
      if (options.cinematic) {
        rig.setMode('cinematic');
        replayUntil = performance.now() + 1600;
      }
      break;
    }
    default:
      break;
  }
};

function spinLabel(spin) {
  if (!spin) return 'no spin';
  const mag = Math.hypot(spin.x, spin.y, spin.z);
  if (mag < 4) return 'no spin';
  if (Math.abs(spin.y) > Math.abs(spin.x)) return spin.y > 0 ? 'curve' : 'curve';
  return 'dip';
}

function updatePlanLine(plan) {
  const pos = planLine.geometry.attributes.position;
  const p = game.keeper.pos;
  pos.setXYZ(0, p.x, 1.0, p.z);
  pos.setXYZ(1, plan.pelvisTarget.x, Math.max(0.35, plan.pelvisTarget.y), plan.pelvisTarget.z);
  pos.needsUpdate = true;
  planLine.geometry.computeBoundingSphere();
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
let acc = 0;
let clock = 0;
let replayUntil = 0;

function frame(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // slow motion during the replay window: the simulation keeps running at
  // 1/3 speed so the save can actually be read
  const inReplay = performance.now() < replayUntil;
  const dt = inReplay ? rawDt * 0.34 : rawDt;
  if (!inReplay && rig.mode === 'cinematic') rig.setMode('keeper');

  if (started && !paused) {
    clock += dt;
    // input -> keeper
    if (game.phase === PHASE.live) {
      const mv = readMove();
      // camera-relative movement: W always drives toward the striker
      game.keeper.setInput(mv.x, mv.z);
    } else {
      game.keeper.setInput(0, 0);
    }

    // fixed-step simulation for stability
    acc += dt;
    let steps = 0;
    while (acc >= PHYSICS.fixedStep && steps < PHYSICS.maxSubSteps + 6) {
      game.update(PHYSICS.fixedStep);
      acc -= PHYSICS.fixedStep;
      steps++;
    }
    if (steps === 0) game.update(dt);

    updatePrompts();
    if (options.assisted) maybeAssist(dt);
  }

  // visuals
  keeperMesh.update();
  shooterMesh.update(game.shooter, dt, game.ball);
  ballView.update(game.ball, dt);
  effects.update(dt);
  rig.update(dt, game.keeper, game.ball, game);
  stage.lights.group.rotation.y = Math.sin(clock * 0.02) * 0.001;

  // trajectory guide
  if (options.guide && game.phase === PHASE.live && !game.ballFrozen) {
    const path = predictPath(game.ball, 1.6, 1 / 40);
    guide.visible = true;
    const pos = guideGeo.attributes.position;
    for (let i = 0; i < 90; i++) {
      const s = path[Math.min(i, path.length - 1)];
      pos.setXYZ(i, s ? s.x : game.ball.p.x, s ? s.y : game.ball.p.y, s ? s.z : game.ball.p.z);
    }
    pos.needsUpdate = true;
    guideGeo.computeBoundingSphere();
    guide.computeLineDistances();
  } else {
    guide.visible = false;
  }
  if (planLine.visible && !game.keeper.plan) planLine.visible = false;

  hud.setStats(game.score);
  hud.setStreak(game.streak);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

let lastPromptKey = '';
function updatePrompts() {
  if (game.phase === PHASE.kickoff) {
    const t = -game.phaseTime;
    hud.showPrompt(t > 0 ? 'Get set…' : 'Striker approaching…');
    return;
  }
  if (game.phase !== PHASE.live) {
    if (game.phase === PHASE.resolved) hud.hidePrompt();
    else hud.showPrompt('Preparing next shot…');
    return;
  }
  if (game.ballFrozen) {
    hud.showPrompt(game.shooter.state === 'windup' || game.shooter.state === 'plant'
      ? 'Shot incoming — press R to dive'
      : 'Striker approaching…');
    return;
  }
  // time to arrival, shown as a shrinking bar and a hint
  const crossing = predictCrossing(game.ball, 0, 3);
  if (crossing) {
    const t = crossing.t;
    const hint = t > 0.85 ? 'Watch the flight' : t > 0.45 ? 'Wait for it…' : t > 0.1 ? 'NOW — press R' : '';
    hud.showPrompt(hint, Math.min(1, t / 1.4));
  } else {
    hud.showPrompt('');
  }
}

// Optional assist: fire the dive automatically once, at the best moment.
let assistLastShot = null;
function maybeAssist(dt) {
  if (game.phase !== PHASE.live || game.ballFrozen || game.diveUsed) return;
  if (game.ballShotAt !== assistLastShot) {
    if (game.ball.v.z < -3) assistLastShot = game.ballShotAt;
    return;
  }
  const dist = Math.hypot(game.ball.p.x - game.keeper.pos.x, game.ball.p.z - game.keeper.pos.z);
  if (dist < 8.5 && game.ball.v.z < -4) {
    const plan = game.dive();
    if (plan) {
      hud.showDive(plan);
      updatePlanLine(plan);
    }
  }
}

function onResize() {
  const w = window.innerWidth || 1280;
  const h = window.innerHeight || 720;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

// Any uncaught error during play is shown on screen: a silent blank page is the
// worst possible failure mode for a game.
function showFatal(err) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:99;padding:14px 16px;'
    + 'border-radius:10px;background:rgba(60,10,20,.94);border:1px solid rgba(255,90,120,.5);'
    + 'color:#ffdde3;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;max-height:40vh;overflow:auto';
  box.textContent = `Something went wrong:\n${err?.message ?? err}\n\n${(err?.stack ?? '').split('\n').slice(0, 6).join('\n')}`;
  document.body.appendChild(box);
}
window.addEventListener('error', (e) => showFatal(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));

// boot: show the ball at the spot behind the menu
ballView.reset(game.ball);
rig.update(0.016, game.keeper, game.ball, game);
hud.setStats(game.score);
hud.setCrosshair(false);
requestAnimationFrame(frame);

// expose for debugging in the console
window.__game = game;
window.__options = options;

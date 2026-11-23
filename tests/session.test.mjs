// Simulates a real browser session: boots main.js against a stubbed DOM/WebGL,
// then plays with keyboard input for several shots to catch integration bugs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const WIN_LISTENERS = {};
const DOC_LISTENERS = {};
const ELEMENTS = new Map();

function makeClassList(el) {
  const set = new Set();
  return {
    add: (...c) => { c.forEach((x) => set.add(x)); el._cls = [...set].join(' '); },
    remove: (...c) => { c.forEach((x) => set.delete(x)); el._cls = [...set].join(' '); },
    toggle: (c, f) => {
      const on = f === undefined ? !set.has(c) : f;
      on ? set.add(c) : set.delete(c);
      el._cls = [...set].join(' ');
      return on;
    },
    contains: (c) => set.has(c),
    get value() { return [...set].join(' '); },
  };
}

function makeEl(tag = 'div', id = '') {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    _cls: '',
    style: {},
    dataset: {},
    children: [],
    _html: '',
    _text: '',
    listeners: {},
    checked: false,
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() {},
    get firstChild() { return this.children[0]; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    removeEventListener() {},
    dispatch(t, ev = {}) { (this.listeners[t] || []).forEach((f) => f({ preventDefault() {}, ...ev })); },
    querySelector(sel) { return getEl(sel.replace('#', '')); },
    querySelectorAll() { return []; },
    setAttribute() {},
    getAttribute() { return null; },
    focus() {}, blur() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    getContext(type) { return type === '2d' ? make2d() : makeGL(); },
    set className(v) { this._cls = String(v); },
    get className() { return this._cls; },
    set innerHTML(v) {
      // real DOM semantics: assigning innerHTML destroys existing children
      this._html = v;
      this.children.length = 0;
    },
    get innerHTML() { return this._html; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
  };
  el.classList = makeClassList(el);
  return el;
}

function getEl(id) {
  if (!ELEMENTS.has(id)) ELEMENTS.set(id, makeEl('div', id));
  return ELEMENTS.get(id);
}

function make2d() {
  const noop = () => {};
  return new Proxy({
    canvas: { width: 512, height: 512 },
    fillRect: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    closePath: noop, fill: noop, stroke: noop, bezierCurveTo: noop, arc: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    drawImage: noop, save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    measureText: () => ({ width: 10 }), fillText: noop, strokeText: noop,
    setTransform: noop, clip: noop,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  }, { get(t, k) { return k in t ? t[k] : undefined; }, set(t, k, v) { t[k] = v; return true; } });
}

const GL_CONSTS = {};
function makeGL() {
  const consts = new Proxy({}, { get(_, k) { if (!GL_CONSTS[k]) GL_CONSTS[k] = 0x1000 + Object.keys(GL_CONSTS).length; return GL_CONSTS[k]; } });
  const fns = new Proxy({}, {
    get(t, k) {
      if (k === 'getParameter') return (p) => {
        if (p === consts.VERSION) return 'WebGL 2.0 (stub)';
        if (p === consts.SHADING_LANGUAGE_VERSION) return 'WebGL GLSL ES 3.00';
        if (p === consts.MAX_TEXTURE_SIZE) return 4096;
        return 0;
      };
      if (k === 'getExtension') return () => ({});
      if (k === 'getSupportedExtensions') return () => [];
      if (k === 'getShaderPrecisionFormat') return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
      if (k === 'getProgramParameter' || k === 'getShaderParameter' || k === 'getProgramInfoLog' || k === 'getShaderInfoLog') return () => true;
      if (k === 'getAttribLocation') return () => 0;
      if (k === 'getUniformLocation') return () => ({});
      if (k === 'getActiveAttrib' || k === 'getActiveUniform') return () => null;
      if (typeof k === 'string' && k.startsWith('create')) return () => ({});
      if (k === 'getContextAttributes') return () => ({ alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      return () => undefined;
    },
    set() { return true; },
  });
  return new Proxy({}, { get(_, k) { if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return consts[k]; return fns[k]; }, set() { return true; } });
}

// ---------------------------------------------------------------- install
function install() {
  const body = makeEl('body');
  const app = getEl('app');
  const documentStub = {
    documentElement: makeEl('html'),
    body,
    createElement: (t) => makeEl(t),
    createElementNS: (ns, t) => makeEl(t),
    createTextNode: (t) => ({ textContent: t }),
    getElementById: (id) => getEl(id),
    querySelector: (sel) => getEl(String(sel).replace(/^#/, '')),
    querySelectorAll: (sel) => {
      if (sel === '#menu-difficulty button') return ['rookie', 'pro', 'world'].map((d) => {
        const b = getEl(`diff-${d}`);
        b.dataset = { diff: d };
        return b;
      });
      return [];
    },
    addEventListener: (t, f) => { (DOC_LISTENERS[t] = DOC_LISTENERS[t] || []).push(f); },
    removeEventListener() {},
  };
  const win = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener: (t, f) => { (WIN_LISTENERS[t] = WIN_LISTENERS[t] || []).push(f); },
    removeEventListener() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    performance: { now: () => Date.now() },
    location: { href: 'http://localhost/' },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    ontouchstart: undefined,
  };
  globalThis.window = win;
  globalThis.document = documentStub;
  globalThis.self = win;
  globalThis.HTMLElement = Object;
  globalThis.Image = class { constructor() { this.width = 1; this.height = 1; } };
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.performance = win.performance;
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'stub' }, configurable: true, writable: true });
  } catch { /* node owns navigator */ }
  return { win, doc: documentStub, app };
}

const { win } = install();

// fonts/preconnect <link> handled by index.html, not main.js

const main = await import('../src/main.js');

function key(k) {
  (WIN_LISTENERS.keydown || []).forEach((f) => f({ key: k, preventDefault() {} }));
}
function keyup(k) {
  (WIN_LISTENERS.keyup || []).forEach((f) => f({ key: k, preventDefault() {} }));
}
function click(id) {
  getEl(id).dispatch('click');
}

test('main.js boots and exposes the game', () => {
  assert.ok(window.__game, 'game exposed for debugging');
  assert.equal(typeof window.__game.update, 'function');
  assert.ok(window.__options, 'options exposed');
});

test('pressing Play starts a shot', () => {
  click('btn-play');
  const g = window.__game;
  // drive the loop manually: the frame callback is captured via rAF stub
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  assert.ok(['kickoff', 'live', 'resolved'].includes(g.phase));
});

test('keyboard movement reaches the keeper controller', () => {
  const g = window.__game;
  key('w');
  key('d');
  for (let i = 0; i < 30; i++) g.update(1 / 60);
  keyup('w');
  keyup('d');
  assert.ok(Number.isFinite(g.keeper.pos.x) && Number.isFinite(g.keeper.pos.z));
});

test('pressing R triggers a dive via the real key handler', () => {
  const g = window.__game;
  // force a live ball heading at goal
  g.phase = 'live';
  g.ballFrozen = false;
  g.diveUsed = false;
  g.keeper.reset(0, 1.1);
  g.keeper.diveCooldown = 0;
  g.ball = { p: { x: 0, y: 0.11, z: 6 }, v: { x: 5.5, y: 2.2, z: -18 }, w: { x: 0, y: 20, z: 0 }, resting: false };
  g.shotInfo = { kind: 'test', speed: 19 };
  g.ballShotAt = g.time;
  key('r');
  assert.equal(g.diveUsed, true, 'R must commit to a dive');
});

test('the menu, difficulty and option handlers do not throw', () => {
  assert.doesNotThrow(() => {
    click('btn-menu');
    click('btn-help');
    getEl('opt-assisted').checked = true;
    getEl('opt-assisted').dispatch('change', { target: { checked: true } });
    getEl('opt-guide').dispatch('change', { target: { checked: true } });
    getEl('opt-cinematic').dispatch('change', { target: { checked: false } });
    key('Escape');
  });
});

test('the exposed frame loop survives many simulated frames', () => {
  const g = window.__game;
  assert.doesNotThrow(() => {
    for (let i = 0; i < 600; i++) {
      g.update(1 / 60);
      if (i % 40 === 0) key('r');
      if (i % 25 === 0) { key('a'); }
      if (i % 25 === 12) { keyup('a'); }
    }
  });
  assert.ok(Number.isFinite(g.ball.p.x));
});

test('the WebGL canvas survives HUD construction and mount order', () => {
  // Regression: Hud.build() assigns innerHTML to its root. If the HUD and the
  // canvas shared a container, that assignment silently destroyed the canvas
  // and the game rendered nothing but a background.
  const app = getEl('app');
  const ids = app.children.map((c) => c.id);
  assert.ok(ids.includes('scene-root'), `canvas layer missing, app children: ${ids.join(',')}`);
  assert.ok(ids.includes('hud-root'), `hud layer missing, app children: ${ids.join(',')}`);
  const sceneRoot = app.children.find((c) => c.id === 'scene-root');
  assert.ok(sceneRoot.children.length > 0, 'the renderer canvas must be inside the canvas layer');
  const hudRoot = app.children.find((c) => c.id === 'hud-root');
  assert.ok(hudRoot.innerHTML.length > 0, 'the HUD must have built its markup');
  // and the canvas layer must not have been emptied by that build
  assert.ok(sceneRoot.children.length > 0, 'HUD build must not clear the canvas layer');
});

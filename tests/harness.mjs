// A tiny fake DOM + WebGL enough to run the three.js scene graph headlessly.
// Catches NaN transforms, missing methods and runtime errors without a browser.

class ClassList {
  constructor(el){ this.el = el; this.set = new Set(); }
  add(...c){ c.forEach(x=>this.set.add(x)); this.sync(); }
  remove(...c){ c.forEach(x=>this.set.delete(x)); this.sync(); }
  toggle(c, force){ if(force===undefined) force=!this.set.has(c); force?this.set.add(c):this.set.delete(c); this.sync(); return force; }
  contains(c){ return this.set.has(c); }
  sync(){ this.el._className = [...this.set].join(' '); }
}

class El {
  constructor(tag='div'){ this.tagName=tag.toUpperCase(); this.classList=new ClassList(this); this.children=[]; this.style={}; this.dataset={}; this._html=''; this._text=''; this.listeners={}; }
  set className(v){ this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); this.classList.sync(); }
  get className(){ return this._className || ''; }
  set innerHTML(v){ this._html=v; this.children.length = 0; }
  get innerHTML(){ return this._html; }
  set textContent(v){ this._text=v; }
  get textContent(){ return this._text; }
  appendChild(c){ this.children.push(c); return c; }
  removeChild(c){ this.children = this.children.filter(x=>x!==c); return c; }
  remove(){}
  get firstChild(){ return this.children[0]; }
  addEventListener(t,f){ (this.listeners[t]=this.listeners[t]||[]).push(f); }
  removeEventListener(){}
  querySelector(){ return makeEl(); }
  querySelectorAll(){ return []; }
  getContext(type){
    if (type==='2d') return make2d();
    return makeGL();
  }
  getBoundingClientRect(){ return {left:0,top:0,width:1280,height:720}; }
  setAttribute(){}
  getAttribute(){ return null; }
  focus(){} blur(){}
}
const REGISTRY = new Map();
function registryEl(id) {
  if (!REGISTRY.has(id)) REGISTRY.set(id, new El());
  return REGISTRY.get(id);
}
function makeEl(){ return new El(); }

function make2d(){
  const noop = ()=>{};
  return new Proxy({
    canvas: { width:512, height:512 },
    fillRect:noop, clearRect:noop, beginPath:noop, moveTo:noop, lineTo:noop,
    closePath:noop, fill:noop, stroke:noop, bezierCurveTo:noop, arc:noop,
    createLinearGradient:()=>({addColorStop:noop}),
    createRadialGradient:()=>({addColorStop:noop}),
    drawImage:noop, save:noop, restore:noop, translate:noop, rotate:noop, scale:noop,
    measureText:()=>({width:10}), fillText:noop, strokeText:noop,
    setTransform:noop, clip:noop, putImageData:noop,
    getImageData:()=>({data:new Uint8ClampedArray(4)}),
  }, { get(t,k){ return k in t ? t[k] : undefined; }, set(t,k,v){ t[k]=v; return true; } });
}

const GL_CONST = {};
function makeGL(){
  const consts = new Proxy({}, { get(_,k){ if(!GL_CONST[k]) GL_CONST[k] = 0x1000 + Object.keys(GL_CONST).length; return GL_CONST[k]; } });
  const fns = new Proxy({}, { get(t,k){
    if (k === 'getParameter') return (p) => {
      if (p === consts.VERSION) return 'WebGL 2.0 (harness)';
      if (p === consts.SHADING_LANGUAGE_VERSION) return 'WebGL GLSL ES 3.00';
      if (p === consts.MAX_TEXTURE_SIZE) return 4096;
      return 0;
    };
    if (k === 'getExtension') return () => ({});
    if (k === 'getSupportedExtensions') return () => [];
    if (k === 'getShaderPrecisionFormat') return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
    if (k === 'getProgramParameter' || k === 'getShaderParameter') return () => true;
    if (k === 'getProgramInfoLog' || k === 'getShaderInfoLog') return () => '';
    if (k === 'getAttribLocation') return () => 0;
    if (k === 'getUniformLocation') return () => ({});
    if (k === 'getActiveAttrib' || k === 'getActiveUniform') return () => null;
    if (typeof k === 'string' && k.startsWith('create')) return () => ({});
    if (k === 'getContextAttributes') return () => ({ alpha:true, antialias:true, depth:true, stencil:false, premultipliedAlpha:true, preserveDrawingBuffer:false, powerPreference:'high-performance' });
    return () => undefined;
  }, set(){ return true; } });
  return new Proxy({}, { get(_, k){ if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return consts[k]; return fns[k]; }, set(){ return true; } });
}

export function installDom() {
  const body = new El('body');
  const documentEl = new El('document');
  const win = {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener(){}, removeEventListener(){},
    requestAnimationFrame: (cb) => { win.__raf = cb; return 1; },
    cancelAnimationFrame(){},
    performance: { now: () => Date.now() },
    location: { href: 'http://localhost/' },
    matchMedia: () => ({ matches:false, addEventListener(){}, addListener(){} }),
  };
  const doc = {
    documentElement: documentEl,
    body,
    createElement(tag){ return new El(tag); },
    createElementNS(ns, tag){ return new El(tag); },
    createTextNode(t){ const e = new El('#text'); e.textContent = t; return e; },
    getElementById(id){ return registryEl(id); },
    querySelector(){ return makeEl(); },
    querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){},
  };
  globalThis.window = win;
  globalThis.document = doc;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'node-harness', platform: 'linux' },
      configurable: true,
      writable: true,
    });
  } catch (e) { /* node already provides navigator */ }
  globalThis.self = win;
  globalThis.HTMLElement = El;
  globalThis.HTMLCanvasElement = El;
  globalThis.Image = class { constructor(){ this.width=1; this.height=1; } };
  globalThis.URL.createObjectURL = () => 'blob:x';
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.performance = win.performance;
  return { window: win, document: doc };
}

// Walk a three.js object tree looking for NaN transforms or empty geometry.
export function auditScene(root, THREE) {
  const problems = [];
  root.traverse((o) => {
    const p = o.position;
    if (p && (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) {
      problems.push(`NaN position: ${o.type} ${o.name || ''}`);
    }
    const s = o.scale;
    if (s && (!Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.z))) {
      problems.push(`NaN scale: ${o.type} ${o.name || ''}`);
    }
    if (o.isMesh && o.geometry) {
      const arr = o.geometry.attributes?.position?.array;
      if (arr) for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) { problems.push(`NaN vertex: ${o.type} ${o.geometry.type}`); break; }
      }
    }
  });
  return problems;
}

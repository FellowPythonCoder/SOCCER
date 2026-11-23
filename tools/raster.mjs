// Dev-only: a minimal software rasteriser so the poses can be inspected as
// PNGs without a browser. Projects the keeper's ragdoll spheres/segments with a
// painter's algorithm. Not part of the game.

import zlib from 'node:zlib';
import fs from 'node:fs';

export function writePng(path, width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    chunks.push(len, t, data, crc);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  chunk('IHDR', ihdr);
  chunk('IDAT', idat);
  chunk('IEND', Buffer.alloc(0));
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]));
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// --- tiny 3x3/4x4 maths
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

export class Canvas {
  constructor(w, h, bg = [10, 20, 16]) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.buf[i * 3] = bg[0];
      this.buf[i * 3 + 1] = bg[1];
      this.buf[i * 3 + 2] = bg[2];
    }
    this.depth = new Float32Array(w * h).fill(Infinity);
  }
  px(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.buf[i] = r; this.buf[i + 1] = g; this.buf[i + 2] = b;
  }
  blend(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.buf[i] = this.buf[i] * (1 - a) + r * a;
    this.buf[i + 1] = this.buf[i + 1] * (1 - a) + g * a;
    this.buf[i + 2] = this.buf[i + 2] * (1 - a) + b * a;
  }
  // filled circle with depth test and lambert shading
  sphere(cam, p, radius, color) {
    const { eye, right, up, fwd, focal } = cam;
    const rel = sub(p, eye);
    const z = dot(rel, fwd);
    if (z <= 0.05) return;
    const sx = this.w / 2 + (dot(rel, right) / z) * focal;
    const sy = this.h / 2 - (dot(rel, up) / z) * focal;
    const pr = (radius / z) * focal;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(pr)) return;
    // light from upper-left-front
    const n = norm({ x: -0.4, y: 0.7, z: -0.6 });
    const shade = 0.45 + 0.55 * Math.max(0, n.y);
    const c = [
      Math.min(255, color[0] * shade),
      Math.min(255, color[1] * shade),
      Math.min(255, color[2] * shade),
    ];
    const r2 = pr * pr;
    for (let y = Math.floor(sy - pr); y <= Math.ceil(sy + pr); y++) {
      for (let x = Math.floor(sx - pr); x <= Math.ceil(sx + pr); x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const dx = x - sx;
        const dy = y - sy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const nz = Math.sqrt(1 - d2 / r2);
        const pixelZ = z - nz * radius;
        const idx = y * this.w + x;
        if (pixelZ >= this.depth[idx]) continue;
        this.depth[idx] = pixelZ;
        const lit = shade * (0.55 + 0.45 * nz);
        this.px(x, y,
          Math.min(255, color[0] * lit),
          Math.min(255, color[1] * lit),
          Math.min(255, color[2] * lit));
      }
    }
  }
  // capsule between two world points = a chain of spheres
  capsule(cam, a, b, ra, rb, color) {
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const steps = Math.max(2, Math.ceil(d / 0.035));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      this.sphere(cam, p, ra + (rb - ra) * t, color);
    }
  }
  plane(cam, y, size, color) {
    // ground plane as horizontal stripes for depth cues
    for (let i = -size; i <= size; i += 0.5) {
      const a = { x: -size, y, z: i };
      const b = { x: size, y, z: i };
      this.line(cam, a, b, color, 0.5);
    }
    for (let i = -size; i <= size; i += 0.5) {
      const a = { x: i, y, z: -size };
      const b = { x: i, y, z: size };
      this.line(cam, a, b, color, 0.35);
    }
  }
  line(cam, a, b, color, alpha = 1) {
    const { eye, right, up, fwd, focal } = cam;
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      const rel = sub(p, eye);
      const z = dot(rel, fwd);
      if (z <= 0.05) continue;
      const sx = Math.round(this.w / 2 + (dot(rel, right) / z) * focal);
      const sy = Math.round(this.h / 2 - (dot(rel, up) / z) * focal);
      this.blend(sx, sy, color[0], color[1], color[2], alpha);
    }
  }
}

export function camera(eye, target, focal, w, h) {
  // right-handed, y-up: right = fwd x up, screen y grows downward
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, { x: 0, y: 1, z: 0 }));
  const up = cross(right, fwd);
  return { eye, fwd, right, up, focal, w, h };
}

// Draw a ragdoll with kit colours.
export function drawRagdoll(canvas, cam, parts, opts = {}) {
  const kit = opts.kit ?? [40, 224, 138];
  const skin = [201, 142, 107];
  const shorts = [16, 24, 32];
  const glove = [245, 247, 255];
  const sock = [15, 26, 20];
  const p = (n) => parts[n].p;
  canvas.capsule(cam, p('pelvis'), p('chest'), 0.16, 0.17, kit);
  canvas.capsule(cam, p('pelvis'), { x: (p('hipL').x + p('hipR').x) / 2, y: (p('hipL').y + p('hipR').y) / 2 + 0.05, z: (p('hipL').z + p('hipR').z) / 2 }, 0.15, 0.15, shorts);
  canvas.capsule(cam, p('chest'), p('head'), 0.07, 0.1, skin);
  canvas.sphere(cam, p('head'), 0.115, [225, 175, 140]);
  for (const s of ['L', 'R']) {
    canvas.capsule(cam, p('chest'), p(`sh${s}`), 0.09, 0.09, kit);
    canvas.sphere(cam, p(`sh${s}`), 0.095, opts.dark ?? [17, 168, 106]);
    canvas.capsule(cam, p(`sh${s}`), p(`el${s}`), 0.062, 0.055, kit);
    canvas.capsule(cam, p(`el${s}`), p(`ha${s}`), 0.05, 0.045, skin);
    canvas.sphere(cam, p(`ha${s}`), 0.105, glove);
    canvas.capsule(cam, p(`hip${s}`), p(`kn${s}`), 0.095, 0.078, shorts);
    canvas.capsule(cam, p(`kn${s}`), p(`ft${s}`), 0.068, 0.055, sock);
    canvas.sphere(cam, p(`ft${s}`), 0.07, [240, 240, 245]);
  }
}

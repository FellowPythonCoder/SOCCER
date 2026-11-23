// Ball mesh + trail, impact effects (turf divots, net ripple, dust).
import * as THREE from 'three';
import { BALL } from '../config.js';

export class BallView {
  constructor(scene) {
    // classic 32-panel ball via a procedural texture on a sphere
    const tex = makeBallTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.45,
      metalness: 0.05,
      envMapIntensity: 0.6,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 26, 20), mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    this.spinQuat = new THREE.Quaternion();
    this.lastPos = new THREE.Vector3();

    // motion trail: a tapered ribbon that fades out behind the ball
    const N = 24;
    this.trailN = N;
    this.trailPts = [];
    const positions = new Float32Array(N * 2 * 3);
    const alphas = new Float32Array(N * 2 * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(alphas, 4));
    this.trailGeo = geo;
    this.trailMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.trail = new THREE.Mesh(geo, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    scene.add(this.trail);
  }

  update(ball, dt) {
    this.mesh.position.set(ball.p.x, ball.p.y, ball.p.z);
    // rolling / tumbling rotation driven by the actual ball velocity
    const v = ball.v;
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > 0.02) {
      const axis = new THREE.Vector3(v.z, 0, -v.x).normalize();
      if (axis.lengthSq() > 1e-6) {
        const q = new THREE.Quaternion().setFromAxisAngle(axis, (speed / BALL.radius) * dt * 0.5);
        this.spinQuat.premultiply(q);
      }
    }
    this.mesh.quaternion.copy(this.spinQuat);

    // trail ribbon follows the ball, tapering to nothing
    this.trailPts.unshift({ x: ball.p.x, y: ball.p.y, z: ball.p.z });
    if (this.trailPts.length > this.trailN) this.trailPts.pop();
    const show = speed > 5.5 && this.trailPts.length > 3;
    this.trail.visible = show;
    if (show) {
      const pos = this.trailGeo.attributes.position;
      const col = this.trailGeo.attributes.color;
      const camPos = this.mesh.position;
      for (let i = 0; i < this.trailN; i++) {
        const cur = this.trailPts[Math.min(i, this.trailPts.length - 1)];
        const nxt = this.trailPts[Math.min(i + 1, this.trailPts.length - 1)];
        // widen the ribbon perpendicular to the direction of travel
        let tx = cur.x - nxt.x;
        let ty = cur.y - nxt.y;
        let tz = cur.z - nxt.z;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        // cross with the view direction for a screen-facing ribbon
        const vx = camPos.x - cur.x;
        const vy = camPos.y - cur.y;
        const vz = camPos.z - cur.z;
        let cx = ty * vz - tz * vy;
        let cy = tz * vx - tx * vz;
        let cz = tx * vy - ty * vx;
        const cl = Math.hypot(cx, cy, cz) || 1;
        cx /= cl; cy /= cl; cz /= cl;
        const width = 0.035 * (1 - i / this.trailN);
        pos.setXYZ(i * 2, cur.x + cx * width, cur.y + cy * width, cur.z + cz * width);
        pos.setXYZ(i * 2 + 1, cur.x - cx * width, cur.y - cy * width, cur.z - cz * width);
        const a = Math.pow(1 - i / this.trailN, 1.7);
        col.setXYZW(i * 2, 0.55 * a, 0.85 * a, 1 * a, a);
        col.setXYZW(i * 2 + 1, 0.55 * a, 0.85 * a, 1 * a, a);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      this.trailGeo.computeBoundingSphere();
    }
  }

  reset(ball) {
    this.trailPts.length = 0;
    this.spinQuat.identity();
    this.update(ball, 0);
  }
}

function makeBallTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, size, size);
  // pentagon-ish blotches laid out in bands (cheap but reads as a football)
  const drawPent = (cx, cy, r, rot) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = '#15181f';
  const rows = [
    { y: 0.16, n: 3, r: 0.075, off: 0.1 },
    { y: 0.38, n: 4, r: 0.085, off: 0.0 },
    { y: 0.62, n: 3, r: 0.075, off: 0.12 },
    { y: 0.84, n: 4, r: 0.08, off: 0.02 },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const x = ((i + row.off) / row.n) * size;
      drawPent(x, row.y * size, row.r * size, Math.random() * 1.2);
    }
  }
  // shading / seams
  ctx.strokeStyle = 'rgba(20,24,30,0.22)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (i / 7) * size);
    ctx.bezierCurveTo(size * 0.3, (i / 7) * size + 30, size * 0.7, (i / 7) * size - 30, size, (i / 7) * size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- effects
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.puffs = [];
    this.rings = [];
    this.puffGeo = new THREE.SphereGeometry(1, 8, 6);
    this.ringGeo = new THREE.RingGeometry(0.25, 0.32, 32);
  }

  // Dust/divot when the ball hits the turf hard.
  turfPuff(x, y, z, strength = 1) {
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        this.puffGeo,
        new THREE.MeshBasicMaterial({ color: 0x63c98a, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      m.position.set(x, y + 0.03, z);
      m.scale.setScalar(0.04 + Math.random() * 0.05);
      this.scene.add(m);
      this.puffs.push({
        mesh: m,
        vel: {
          x: (Math.random() - 0.5) * 2.2 * strength,
          y: 0.6 + Math.random() * 1.6 * strength,
          z: (Math.random() - 0.5) * 2.2 * strength,
        },
        life: 0.5 + Math.random() * 0.3,
        t: 0,
      });
    }
  }

  // Expanding shockwave where a glove/body meets the ball.
  impact(x, y, z, color = 0xbdf5ff) {
    const m = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    m.position.set(x, y, z);
    this.scene.add(m);
    this.rings.push({ mesh: m, t: 0, life: 0.42 });
  }

  update(dt) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt;
      p.vel.y -= 2.4 * dt;
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.y += p.vel.y * dt;
      p.mesh.position.z += p.vel.z * dt;
      p.mesh.material.opacity = Math.max(0, 0.5 * (1 - p.t / p.life));
      p.mesh.scale.multiplyScalar(1 + dt * 1.6);
      if (p.t > p.life) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.puffs.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      r.mesh.scale.setScalar(1 + k * 5);
      r.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (r.t > r.life) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}

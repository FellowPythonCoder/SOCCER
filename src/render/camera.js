// Camera rig: a keeper/behind-the-goal view with free mouse look, plus a
// cinematic replay angle after each shot.

import * as THREE from 'three';

export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.yaw = 0;
    this.pitch = -0.12;
    this.zoom = 1;
    this.enabled = false;
    this.target = new THREE.Vector3(0, 1.1, 2.2);
    this.smoothTarget = new THREE.Vector3(0, 1.1, 2.2);
    this.mode = 'keeper'; // keeper | cinematic | orbit
    this.cinematicT = 0;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.bind();
  }

  bind() {
    const el = this.dom;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => {
      this.dragging = false;
      el.style.cursor = 'crosshair';
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging || !this.enabled) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw = clamp(this.yaw - dx * 0.0032, -1.25, 1.25);
      this.pitch = clamp(this.pitch - dy * 0.0026, -0.52, 0.36);
    });
    el.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.zoom = clamp(this.zoom + e.deltaY * 0.0009, 0.72, 1.7);
    }, { passive: false });
    // right-drag also looks, for trackpad users
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setMode(mode) {
    this.mode = mode;
    this.cinematicT = 0;
  }

  // keeper: {pos:{x,z}, pelvisY, aimYaw}, ball
  update(dt, keeper, ball, game) {
    this.cinematicT += dt;
    if (this.mode === 'cinematic') {
      this.updateCinematic(keeper, ball);
      return;
    }
    // Follow the keeper from behind and a little above.
    const kx = keeper.pos.x;
    const kz = keeper.pos.z;
    const back = 4.6 * this.zoom;
    const height = 2.5 + this.zoom * 0.4;
    const look = new THREE.Vector3(kx * 0.55, 1.15, 3.0);
    // yaw/pitch offset around the look point
    const yaw = this.yaw + (keeper.aimYaw ?? 0) * 0.25;
    const pitch = this.pitch;
    const camPos = new THREE.Vector3(
      look.x + Math.sin(yaw) * back,
      Math.max(0.7, look.y + height * Math.cos(pitch) - 0.4),
      look.z - Math.cos(yaw) * back,
    );
    // keep the camera outside the net
    camPos.z = Math.max(-1.1, camPos.z);
    this.smoothTarget.lerp(look, Math.min(1, dt * 5));
    this.camera.position.lerp(camPos, Math.min(1, dt * 6));
    this.camera.lookAt(this.smoothTarget);
    // slight shake on a big impact
    if (this.shake > 0.001) {
      this.shake *= Math.pow(0.02, dt);
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
  }

  // A side-on replay camera that tracks the ball.
  updateCinematic(keeper, ball) {
    const t = this.cinematicT;
    const bx = ball.p.x;
    const bz = ball.p.z;
    const angle = -1.05 + Math.sin(t * 0.35) * 0.25;
    const dist = 13;
    const look = new THREE.Vector3(bx * 0.4, Math.max(0.9, ball.p.y * 0.6 + 0.7), Math.max(1.5, bz * 0.35 + 1.5));
    const camPos = new THREE.Vector3(
      look.x + Math.sin(angle) * dist,
      4.4,
      look.z + Math.cos(angle) * dist * 0.55 + 2,
    );
    this.camera.position.lerp(camPos, 0.06);
    this.camera.lookAt(look);
  }

  addShake(amount) {
    this.shake = Math.min(0.35, (this.shake ?? 0) + amount);
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

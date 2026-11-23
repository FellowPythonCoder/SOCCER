// Stage: pitch, goal, floodlights, sky. All procedurally built — no assets.

import * as THREE from 'three';
import { PITCH } from '../config.js';

export function createStage(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1420);
  scene.fog = new THREE.Fog(0x0a1420, 45, 120);

  // ------------------------------------------------ lighting
  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x1b2a1e, 0.55);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2dd, 2.1);
  key.position.set(-14, 26, 18);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const s = 26;
  key.shadow.camera.left = -s;
  key.shadow.camera.right = s;
  key.shadow.camera.top = s;
  key.shadow.camera.bottom = -s;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 80;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8fb8ff, 0.7);
  fill.position.set(18, 14, -6);
  scene.add(fill);

  // warm rim from behind the goal (floodlight bounce on the turf)
  const rim = new THREE.DirectionalLight(0x6f8fbf, 0.5);
  rim.position.set(0, 8, -20);
  scene.add(rim);

  // ------------------------------------------------ turf
  const turfGroup = new THREE.Group();
  scene.add(turfGroup);

  const grassTex = makeTurfTexture();
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(9, 14);
  grassTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const turfMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    roughness: 0.92,
    metalness: 0.02,
    color: 0xffffff,
  });
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(80, 120, 1, 1), turfMat);
  turf.rotation.x = -Math.PI / 2;
  turf.position.set(0, 0, 30);
  turf.receiveShadow = true;
  turfGroup.add(turf);

  // darker out-of-play surround
  const surroundMat = new THREE.MeshStandardMaterial({ color: 0x0c1a12, roughness: 1 });
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), surroundMat);
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.02;
  surround.position.z = 20;
  surround.receiveShadow = true;
  scene.add(surround);

  // pitch lines
  const lines = new THREE.Group();
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f6f2, transparent: true, opacity: 0.85 });
  const addLine = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    lines.add(m);
  };
  // goal line
  addLine(0, 0, PITCH.pitchHalfWidth * 2, 0.12);
  // penalty box
  addLine(0, PITCH.boxDepth, PITCH.boxHalfWidth * 2, 0.12);
  addLine(-PITCH.boxHalfWidth, PITCH.boxDepth / 2, 0.12, PITCH.boxDepth);
  addLine(PITCH.boxHalfWidth, PITCH.boxDepth / 2, 0.12, PITCH.boxDepth);
  // six yard box
  addLine(0, PITCH.sixYardDepth, PITCH.sixYardHalfWidth * 2, 0.12);
  addLine(-PITCH.sixYardHalfWidth, PITCH.sixYardDepth / 2, 0.12, PITCH.sixYardDepth);
  addLine(PITCH.sixYardHalfWidth, PITCH.sixYardDepth / 2, 0.12, PITCH.sixYardDepth);
  // penalty spot
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), lineMat);
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(0, 0.013, PITCH.penaltySpotZ);
  lines.add(spot);
  // penalty arc
  const arc = new THREE.Mesh(
    new THREE.RingGeometry(PITCH.penaltySpotZ - PITCH.boxDepth - 0.04, PITCH.penaltySpotZ - PITCH.boxDepth + 0.04, 48, 1, Math.PI * 0.15, Math.PI * 0.7),
    lineMat,
  );
  arc.rotation.x = -Math.PI / 2;
  arc.rotation.z = Math.PI / 2;
  arc.position.set(0, 0.013, PITCH.penaltySpotZ);
  lines.add(arc);
  scene.add(lines);

  // ------------------------------------------------ goal
  const goal = createGoal();
  scene.add(goal);

  // ------------------------------------------------ stadium dressing
  scene.add(createStands());
  const lights = createFloodlights();
  scene.add(lights.group);

  // subtle vignette-y ground glow behind the goal
  const glowGeo = new THREE.PlaneGeometry(26, 8);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x2f6b4a,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.02, 1.0);
  scene.add(glow);

  return { scene, key, hemi, goal, lights };
}

function makeTurfTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // base green
  ctx.fillStyle = '#1d5c2e';
  ctx.fillRect(0, 0, size, size);
  // mown stripes
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#22683a' : '#1a5230';
    ctx.fillRect((i * size) / stripes, 0, size / stripes, size);
  }
  // grass speckle
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const g = 70 + Math.random() * 80;
    ctx.fillStyle = `rgba(${18 + Math.random() * 30},${g},${30 + Math.random() * 40},${0.14 + Math.random() * 0.22})`;
    ctx.fillRect(x, y, 1 + Math.random() * 1.6, 1 + Math.random() * 1.6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createGoal() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.32, metalness: 0.12 });
  const postGeo = new THREE.CylinderGeometry(PITCH.postRadius, PITCH.postRadius, PITCH.goalHeight, 16);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, white);
    post.position.set(sx * (PITCH.goalWidth / 2 + PITCH.postRadius), PITCH.goalHeight / 2, 0);
    post.castShadow = true;
    group.add(post);
  }
  const barGeo = new THREE.CylinderGeometry(PITCH.postRadius, PITCH.postRadius, PITCH.goalWidth + PITCH.postRadius * 4, 16);
  const bar = new THREE.Mesh(barGeo, white);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, PITCH.goalHeight, 0);
  bar.castShadow = true;
  group.add(bar);

  // net: semi-transparent grid planes
  const netMat = new THREE.MeshBasicMaterial({
    color: 0xdfe9f5,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
    map: makeNetTexture(),
  });
  netMat.map.repeat.set(10, 6);
  const D = PITCH.goalDepth;
  const W = PITCH.goalWidth;
  const H = PITCH.goalHeight;

  // back
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), netMat);
  back.position.set(0, H / 2, -D);
  group.add(back);
  // sides (slanted at the top is overkill; keep vertical)
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(D, H), netMat);
    side.rotation.y = Math.PI / 2;
    side.position.set(sx * W / 2, H / 2, -D / 2);
    group.add(side);
  }
  // roof
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(W, D), netMat);
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(0, H, -D / 2);
  group.add(roof);

  return group;
}

function makeNetTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.6;
  const step = size / 8;
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createStands() {
  const group = new THREE.Group();
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x14263c, roughness: 0.9 });
  const crowdMat = new THREE.MeshStandardMaterial({ color: 0x1d3350, roughness: 1 });
  // simple raked blocks either side and behind
  const buildStand = (x, z, width, depth, rotY) => {
    const g = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(width, 0.55, depth / 9), i % 2 ? seatMat : crowdMat);
      step.position.set(0, 0.9 + i * 0.55, (i * depth) / 9 - depth / 2);
      g.add(step);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    return g;
  };
  group.add(buildStand(-26, 20, 34, 14, Math.PI / 2));
  group.add(buildStand(26, 20, 34, 14, -Math.PI / 2));
  group.add(buildStand(0, -22, 60, 16, 0));

  // advertising hoardings behind the goal
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x0d3b6b, roughness: 0.6, emissive: 0x0a2647, emissiveIntensity: 0.7 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(26, 0.9, 0.3), boardMat);
  board.position.set(0, 0.45, -4.6);
  group.add(board);
  return group;
}

function createFloodlights() {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a3444, roughness: 0.8, metalness: 0.4 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  const positions = [
    [-30, -8],
    [30, -8],
    [-34, 34],
    [34, 34],
  ];
  for (const [x, z] of positions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 26, 8), poleMat);
    pole.position.set(x, 13, z);
    group.add(pole);
    const bank = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 0.4), poleMat);
    bank.position.set(x, 26, z);
    bank.lookAt(0, 0, 12);
    group.add(bank);
    for (let i = 0; i < 3; i++) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.1), lampMat);
      lamp.position.set(x + (i - 1) * 1.9, 26, z);
      group.add(lamp);
    }
    const pl = new THREE.PointLight(0xffe9c4, 60, 70, 2);
    pl.position.set(x, 26, z);
    group.add(pl);
  }
  return { group };
}

// AI shooter.
//
// The shooter is state-machined: it walks to a cone of the ball, plants its
// standing foot, announces a telegraph (windup) whose length depends on the
// difficulty, swings its kicking leg, and — at the exact frame its boot meets
// the ball — applies an impulse to the ball. Shot placement, power and spin are
// chosen with a mixture of aim error, curve and difficulty, so the keeper never
// sees the same ball twice.

import { PITCH, BALL, SHOT, SHOOTER, DIFFICULTY } from '../config.js';
import { shotDifficulty } from '../physics/divePlanner.js';
import { solveLaunchVelocity } from '../physics/ball.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export class Shooter {
  constructor(scene) {
    this.scene = scene;
    this.state = 'approach'; // approach | plant | windup | strike | follow | retreat | wait
    this.pos = { x: 0, z: 15 };
    this.vel = { x: 0, z: 0 };
    this.facing = Math.PI; // facing the goal (-z)
    this.timer = 0;
    this.kickLeg = 'R';
    this.legPhase = 0; // 0..1 through the kicking arc
    this.windup = 0;
    this.ball = null;
    this.shot = null;
    this.stats = { shots: 0 };
    this.plan = null;
    this.approachTarget = null;
    this.struck = false;
    this.difficulty = DIFFICULTY.pro;
    this.marker = null;
    this.aimY = 0;
  }

  setDifficulty(key) {
    this.difficulty = DIFFICULTY[key] ?? DIFFICULTY.pro;
  }

  reset(ball) {
    this.ball = ball;
    this.state = 'approach';
    this.timer = 0;
    this.struck = false;
    this.legPhase = 0;
    this.windup = 0;
    this.shot = null;
    this.vel = { x: 0, z: 0 };
    const side = Math.random() < 0.5 ? -1 : 1;
    this.pos = { x: side * (1.2 + Math.random() * 2.2), z: ball.p.z + 3.2 + Math.random() * 1.6 };
    this.approachTarget = this.pickApproachPoint(ball);
    this.facing = Math.atan2(ball.p.x - this.pos.x, ball.p.z - this.pos.z);
  }

  pickApproachPoint(ball) {
    // stand behind the ball relative to the goal, with a slight angle so the
    // shot can be curled either way
    const side = Math.random() < 0.5 ? -1 : 1;
    const angle = side * (0.22 + Math.random() * 0.5);
    const back = 1.15 + Math.random() * 0.35;
    return {
      x: ball.p.x + Math.sin(angle) * back,
      z: ball.p.z + Math.cos(angle) * back,
    };
  }

  // --------------------------------------------------------- shot planning
  chooseShot(ball, keeper, rng = Math.random) {
    const d = this.difficulty;
    const goalHalf = PITCH.goalWidth / 2;
    const aimX = keeper?.pos?.x ?? 0;

    // Which kind of strike is this?
    // Difficulty check: how hard is this shot for the man in goal, standing
    // where he is? Even a world-class striker does not hit the top corner every
    // time, so re-roll a couple of times if the shot is impossible to reach.
    const keeperRoot = { x: keeper?.pos?.x ?? 0, z: keeper?.pos?.z ?? 1 };
    const fairness = rng;
    const roll = rng();
    let kind;
    if (roll < 0.14) kind = 'at-keeper';
    else if (roll < 0.42) kind = 'corner';
    else if (roll < 0.62) kind = 'high';
    else if (roll < 0.86) kind = 'curled';
    else kind = 'blast';

    let targetX;
    let targetY;
    switch (kind) {
      case 'at-keeper':
        targetX = aimX * 0.35 + (rng() - 0.5) * 1.0;
        targetY = 0.4 + rng() * 1.1;
        break;
      case 'corner': {
        const side = rng() < 0.5 ? -1 : 1;
        targetX = side * (goalHalf - 0.38 - rng() * 0.5);
        targetY = 0.25 + rng() * 1.25;
        break;
      }
      case 'high': {
        const side = rng() < 0.5 ? -1 : 1;
        targetX = side * (goalHalf - 0.5 - rng() * 1.1);
        targetY = 1.75 + rng() * 0.6;
        break;
      }
      case 'curled': {
        const side = rng() < 0.5 ? -1 : 1;
        targetX = side * (goalHalf - 0.35 - rng() * 1.0);
        targetY = 0.35 + rng() * 1.5;
        break;
      }
      default: {
        const side = rng() < 0.5 ? -1 : 1;
        targetX = side * (goalHalf * 0.55 + rng() * 1.1);
        targetY = 0.6 + rng() * 1.4;
      }
    }

    // Miss the frame sometimes — that is football. Accuracy scales with level.
    if (rng() > d.accuracy) {
      // a genuine mis-hit: some of these miss the frame completely
      const wild = (1 - d.accuracy) * SHOT.crossMargin + 0.9;
      targetX += (rng() < 0.5 ? -1 : 1) * (0.55 + rng() * wild * 1.6);
      if (rng() < 0.3) targetY += wild * (0.5 + rng());
      targetY = Math.max(0.14, targetY);
    }
    targetX = clamp(targetX, -goalHalf - 2.2, goalHalf + 2.2);
    targetY = clamp(targetY, 0.14, PITCH.goalHeight + 1.1);

    // Power: choose a flight time that produces a plausible speed.
    const dist = Math.hypot(ball.p.x - 0, ball.p.z - 0);
    const powerT = lerp(d.power, 1, rng());
    const speed = lerp(SHOT.minSpeed, SHOT.maxSpeed, powerT) * (0.92 + rng() * 0.16);
    const flightTime = clamp(dist / speed, 0.28, 1.5);

    // Spin: side spin for curl, some backspin/topspin.
    let spin = { x: 0, y: 0, z: 0 };
    const spinMag = BALL.maxSpin * d.curve;
    if (kind === 'curled') {
      const side = Math.sign(targetX - ball.p.x) || 1;
      spin.y = -side * spinMag * (0.55 + rng() * 0.45);
      spin.z = (rng() - 0.5) * spinMag * 0.2;
    } else {
      spin.y = (rng() - 0.5) * spinMag * 0.45;
      if (rng() < 0.4) spin.x = (rng() - 0.5) * spinMag * 0.35;
    }

    const from = { x: ball.p.x, y: ball.p.y, z: ball.p.z };
    const target = { x: targetX, y: targetY, z: 0 };
    let vel = solveLaunchVelocity(from, target, flightTime, spin);
    let finalTarget = { ...target };
    let finalTime = flightTime;

    // Keep shots fair: if this strike is outrageously hard to reach, pull the
    // aim a little closer to the keeper (a real striker mis-hits under pressure).
    const probe = { p: { ...from }, v: { ...vel }, w: { ...spin } };
    const hard = shotDifficulty(keeperRoot, probe);
    const mercy = 1.0; // how much of an impossible shot we take back
    if (hard > 0.55) {
      const pull = (hard - 0.55) * mercy * 1.5;
      const toward = Math.min(0.82, pull);
      finalTarget.x = targetX + (keeperRoot.x - targetX) * toward;
      const down = Math.min(0.45, pull * 0.7);
      finalTarget.y = targetY * (1 - down) + 1.0 * down;
      finalTime = flightTime * (1 + Math.min(0.55, pull * 0.6));
      vel = solveLaunchVelocity(from, finalTarget, finalTime, spin);
    }
    return {
      kind,
      target: finalTarget,
      vel,
      spin,
      flightTime: finalTime,
      speed: Math.hypot(vel.x, vel.y, vel.z),
      telegraph: d.telegraph * (kind === 'blast' ? 0.85 : 1) * (0.85 + rng() * 0.3),
      kickLeg: rng() < 0.22 ? 'L' : 'R',
      curve: kind === 'curled',
    };
  }

  // -------------------------------------------------------------- update
  update(dt, ball, keeper, onKick) {
    this.ball = ball;
    this.timer += dt;
    switch (this.state) {
      case 'approach':
        this.stepApproach(dt, ball);
        break;
      case 'plant':
        this.stepPlant(dt, ball, keeper);
        break;
      case 'windup':
        this.windup += dt;
        this.legPhase = -0.35 * clamp(this.windup / Math.max(0.1, this.shot.telegraph), 0, 1);
        if (this.windup >= this.shot.telegraph) {
          this.state = 'strike';
          this.strikeT = 0;
        }
        break;
      case 'strike':
        this.strikeT += dt;
        this.legPhase = clamp(this.strikeT / 0.11, 0, 1);
        if (!this.struck && this.legPhase >= 0.62) {
          this.struck = true;
          if (onKick) onKick(this.shot);
        }
        if (this.strikeT > 0.16) {
          this.state = 'follow';
          this.followT = 0;
        }
        break;
      case 'follow':
        this.followT += dt;
        this.legPhase = 1 + this.followT * 0.8;
        if (this.followT > 0.5) {
          this.state = 'wait';
          this.waitT = 0;
        }
        break;
      case 'wait':
        this.waitT += dt;
        break;
      default:
        break;
    }
    this.updateFacing(dt, ball);
  }

  updateFacing(dt, ball) {
    const tx = ball.p.x - this.pos.x;
    const tz = ball.p.z - this.pos.z;
    if (Math.hypot(tx, tz) > 0.3) {
      const want = Math.atan2(tx, tz - 0.001);
      let diff = want - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, dt * 6);
    }
  }

  stepApproach(dt, ball) {
    const t = this.approachTarget ?? this.pickApproachPoint(ball);
    const dx = t.x - this.pos.x;
    const dz = t.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.16) {
      this.state = 'plant';
      this.plantT = 0;
      this.vel = { x: 0, z: 0 };
      return;
    }
    const speed = Math.min(SHOOTER.runSpeed, 2.2 + d * 2.2);
    this.vel.x = (dx / d) * speed;
    this.vel.z = (dz / d) * speed;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
  }

  stepPlant(dt, ball, keeper) {
    this.plantT += dt;
    // settle, then choose and telegraph the shot
    if (!this.shot) {
      if (this.plantT > 0.32) {
        this.shot = this.chooseShot(ball, keeper);
        this.state = 'windup';
        this.windup = 0;
        this.stats.shots++;
      }
    }
  }

  // World-space foot position through the kick (for visuals + contact).
  footPosition() {
    const side = this.shot?.kickLeg ?? 'R';
    const lateral = side === 'R' ? 0.16 : -0.16;
    const fx = this.pos.x + Math.cos(this.facing) * lateral;
    const fz = this.pos.z - Math.sin(this.facing) * lateral;
    const p = this.legPhase;
    // swing: back (negative phase) -> through the ball -> up and across
    const swingAngle = Math.sin(clamp(p, -0.4, 1.6) * Math.PI * 0.85) * 1.1;
    const forward = lerp(-0.55, 0.85, clamp(p, 0, 1.2)) ;
    const height = 0.08 + Math.max(0, p) * 0.55;
    return {
      x: fx + Math.sin(this.facing) * (forward + swingAngle * 0.35),
      y: height,
      z: fz + Math.cos(this.facing) * (forward + swingAngle * 0.35),
    };
  }

  // 3D pose for the renderer (torso lean, arms, legs) — purely derived.
  pose() {
    const p = clamp(this.legPhase, -0.5, 1.8);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    return {
      lean: 0.12 + Math.sin(clamp(p, 0, 1.6) * Math.PI) * 0.18 + speed * 0.02,
      arms: {
        L: { swing: -Math.sin(p * Math.PI) * 0.9, out: 0.55 },
        R: { swing: Math.sin(p * Math.PI) * 0.7, out: 0.4 },
      },
      kick: p,
      facing: this.facing,
    };
  }
}

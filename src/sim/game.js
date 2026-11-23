// Game state machine + collision resolution.
//
// This module owns the world: one ball, one ragdoll keeper, one shooter.
// It is engine-agnostic (no three.js) so the whole simulation can be run
// head-less in Node for tests and for tuning.

import { PITCH, BALL, KEEPER, DIFFICULTY } from '../config.js';
import { createBallState, stepBall } from '../physics/ball.js';
import { planDive, planReflex, crossingIsOnTarget, readySpot, planFactory } from '../physics/divePlanner.js';
import { searchBestDive } from '../physics/diveSearch.js';
import { Keeper } from './keeper.js';
import { Shooter } from './shooter.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const PHASE = {
  kickoff: 'kickoff',
  live: 'live',
  resolved: 'resolved',
  reset: 'reset',
};

export class Game {
  constructor(opts = {}) {
    this.ball = createBallState();
    this.keeper = new Keeper(null, opts);
    this.shooter = new Shooter(null);
    this.phase = PHASE.kickoff;
    this.phaseTime = 0;
    this.difficulty = 'pro';
    this.score = { goals: 0, saves: 0, shots: 0 };
    this.lastResult = null;
    this.events = [];
    this.onEvent = opts.onEvent ?? (() => {});
    this.ballFrozen = true;
    this.time = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.keeperTouchedBall = false;
    this.contact = { lastTouch: null, touches: [] };
    this.postHit = false;
    this.resetBallToSpot();
    this.keeper.reset(this.keeperStart().x, this.keeperStart().z);
    this.shooter.reset(this.ball);
    this.phase = PHASE.kickoff;
    // let the player settle in before the first ball
    this.phaseTime = -1.4;
  }

  setDifficulty(k) {
    this.difficulty = k;
    this.shooter.setDifficulty(k);
  }

  resetBallToSpot() {
    const spot = this.pickSpot();
    this.ball = createBallState({ x: spot.x, y: BALL.radius, z: spot.z });
    this.ballFrozen = true;
    this.keeperTouchedBall = false;
    this.postHit = false;
    this.diveUsed = false;
    this.shotInfo = null;
    this.lastDive = null;
    this.contact = { lastTouch: null, touches: [] };
  }

  // Where the AI keeper stands before the shot. A real keeper cheats toward the
  // shooter's likely target, and that is what makes some shots unsavable.
  keeperStart() {
    const spot = {
      x: this.ball.p.x * 0.32 + (Math.random() - 0.5) * 0.9,
      z: 1.0 + Math.random() * 0.5,
    };
    return {
      x: clamp(spot.x, -KEEPER.roamX * 0.6, KEEPER.roamX * 0.6),
      z: spot.z,
    };
  }

  pickSpot() {
    // Penalty spot with variation, occasionally a wide/closer angle.
    const roll = Math.random();
    if (roll < 0.62) {
      return { x: (Math.random() - 0.5) * 1.6, z: PITCH.penaltySpotZ + (Math.random() - 0.5) * 1.2 };
    }
    if (roll < 0.86) {
      return { x: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 5), z: 10 + Math.random() * 4 };
    }
    return { x: (Math.random() - 0.5) * 8, z: 6.5 + Math.random() * 2.5 };
  }

  nextShot(delay = 1.1) {
    this.resetBallToSpot();
    this.keeper.reset(this.keeperStart().x, this.keeperStart().z);
    this.shooter.reset(this.ball);
    this.phase = PHASE.kickoff;
    this.phaseTime = -delay;
    this.lastResult = null;
  }

  emit(type, data = {}) {
    const ev = { type, t: this.time, ...data };
    this.events.push(ev);
    this.onEvent(ev);
  }

  // ------------------------------------------------------------- main tick
  update(dt) {
    this.time += dt;
    this.phaseTime += dt;

    switch (this.phase) {
      case PHASE.kickoff:
        this.updateKickoff(dt);
        break;
      case PHASE.live:
        this.updateLive(dt);
        break;
      case PHASE.resolved:
        this.updateResolved(dt);
        break;
      default:
        break;
    }
    // keeper always simulates (he keeps breathing / settling)
    if (this.phase !== PHASE.live) {
      this.keeper.update(dt, this.ball, {});
    }
  }

  updateKickoff(dt) {
    this.shooter.update(dt, this.ball, this.keeper, (shot) => this.kick(shot));
    // keeper idles in his ready stance
    this.keeper.setInput(0, 0);
    if (this.phaseTime > 0) {
      this.phase = PHASE.live;
      this.phaseTime = 0;
      this.emit('live', {});
    }
  }

  kick(shot) {
    this.ballFrozen = false;
    this.ball.v = { ...shot.vel };
    this.ball.w = { ...shot.spin };
    this.ball.resting = false;
    this.ballShotAt = this.time;
    this.shotInfo = shot;
    this.emit('kick', {
      kind: shot.kind,
      speed: shot.speed,
      target: shot.target,
      spin: shot.spin,
    });
  }

  updateLive(dt) {
    this.shooter.update(dt, this.ball, this.keeper, (shot) => this.kick(shot));
    this.keeper.update(dt, this.ball, {});

    // sub-step the ball for stability at high speed
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const prev = { x: this.ball.p.x, y: this.ball.p.y, z: this.ball.p.z };
      if (!this.ballFrozen) stepBall(this.ball, h);
      this.resolveBallInteractions(prev, h);
      if (this.phase !== PHASE.live) return;
    }
    this.checkOutcome(dt);
  }

  // Ball vs. keeper spheres, posts and crossbar.
  resolveBallInteractions(prev, h) {
    const ball = this.ball;
    const r = BALL.radius;

    // --- posts and crossbar (goal line z = 0)
    const posts = [
      { x: -PITCH.halfPostX, y: 1.22 },
      { x: PITCH.halfPostX, y: 1.22 },
    ];
    for (const post of posts) {
      const d = Math.hypot(ball.p.x - post.x, ball.p.z - 0, ball.p.y - post.y);
      const minD = r + PITCH.postRadius;
      if (d < minD && ball.p.z < 0.6) {
        const n = {
          x: (ball.p.x - post.x) / (d || 1e-6),
          y: (ball.p.y - post.y) / (d || 1e-6),
          z: (ball.p.z - 0) / (d || 1e-6),
        };
        ball.p.x = post.x + n.x * minD;
        ball.p.z = 0 + n.z * minD;
        ball.p.y = post.y + n.y * minD;
        const vn = ball.v.x * n.x + ball.v.y * n.y + ball.v.z * n.z;
        ball.v.x -= (1 + BALL.restPost) * vn * n.x;
        ball.v.y -= (1 + BALL.restPost) * vn * n.y;
        ball.v.z -= (1 + BALL.restPost) * vn * n.z;
        if (!this.postHit) {
          this.postHit = true;
          this.emit('post', { x: ball.p.x, y: ball.p.y });
        }
      }
    }
    // crossbar
    if (Math.abs(ball.p.z) < r + PITCH.postRadius) {
      const dx = Math.abs(ball.p.x) - PITCH.halfPostX;
      if (dx < 0.02) {
        const dy = ball.p.y - PITCH.crossbarY;
        const d = Math.hypot(dy, ball.p.z);
        const minD = r + PITCH.postRadius;
        if (d < minD) {
          const n = { y: dy / (d || 1e-6), z: ball.p.z / (d || 1e-6) };
          ball.p.y = PITCH.crossbarY + n.y * minD;
          ball.p.z = n.z * minD;
          const vn = ball.v.y * n.y + ball.v.z * n.z;
          ball.v.y -= (1 + BALL.restPost) * vn * n.y;
          ball.v.z -= (1 + BALL.restPost) * vn * n.z;
          if (!this.postHit) {
            this.postHit = true;
            this.emit('post', { x: ball.p.x, y: ball.p.y, bar: true });
          }
        }
      }
    }

    // --- keeper body contact
    const spheres = this.keeper.spheres();
    for (const s of spheres) {
      // sweep test: closest approach between prev->current segment and sphere
      const dx = ball.p.x - s.x;
      const dy = ball.p.y - s.y;
      const dz = ball.p.z - s.z;
      const dist = Math.hypot(dx, dy, dz);
      const minD = s.r + r;
      if (dist < minD) {
        const n = dist > 1e-6 ? { x: dx / dist, y: dy / dist, z: dz / dist } : { x: 0, y: 0, z: 1 };
        // depenetrate
        const push = minD - dist;
        ball.p.x += n.x * push;
        ball.p.y += n.y * push;
        ball.p.z += n.z * push;
        // relative velocity of the ball w.r.t. the body part
        const rel = {
          x: ball.v.x - s.part.v.x,
          y: ball.v.y - s.part.v.y,
          z: ball.v.z - s.part.v.z,
        };
        const vn = rel.x * n.x + rel.y * n.y + rel.z * n.z;
        if (vn < 0) {
          const isHand = s.name.startsWith('ha');
          const restitution = isHand ? 0.18 : 0.36;
          const j = -(1 + restitution) * vn;
          ball.v.x += n.x * j;
          ball.v.y += n.y * j;
          ball.v.z += n.z * j;
          // friction / deflection: add a tangential component from the body part
          const tangential = {
            x: s.part.v.x - rel.x * 0.35,
            y: s.part.v.y - rel.y * 0.35,
            z: s.part.v.z - rel.z * 0.35,
          };
          ball.v.x += tangential.x * 0.22;
          ball.v.y += tangential.y * 0.22;
          ball.v.z += tangential.z * 0.22;
          // hands absorb momentum (a catch) — chest/legs deflect
          if (isHand) {
            ball.v.x *= 0.62;
            ball.v.y *= 0.62;
            ball.v.z *= 0.62;
          }
          ball.w.x += (Math.random() - 0.5) * 6;
          ball.w.y += (Math.random() - 0.5) * 6;
          this.recordTouch(s, vn);
        }
      }
    }
  }

  recordTouch(sphere, closingSpeed) {
    const speed = Math.hypot(this.ball.v.x, this.ball.v.y, this.ball.v.z);
    const isHand = sphere.name.startsWith('ha');
    const touch = {
      part: sphere.name,
      hand: isHand,
      closingSpeed: Math.abs(closingSpeed),
      ballSpeed: speed,
      t: this.time,
      x: sphere.x,
      y: sphere.y,
    };
    this.contact.touches.push(touch);
    this.contact.lastTouch = touch;
    if (!this.keeperTouchedBall) {
      this.keeperTouchedBall = true;
      this.emit('touch', touch);
    }
  }

  // Decide the outcome of the shot.
  checkOutcome(dt) {
    // Nothing to judge until the shooter has actually struck the ball.
    if (this.ballFrozen || !this.shotInfo) return;
    const ball = this.ball;
    const touched = this.keeperTouchedBall;

    // Goal? Ball crosses z < 0 inside the frame.
    if (ball.p.z < -BALL.radius * 0.6 && this.ballShotAt && !this.resolvedGoalChecked) {
      const insideX = Math.abs(ball.p.x) < PITCH.halfPostX;
      const insideY = ball.p.y < PITCH.crossbarY && ball.p.y > 0;
      if (insideX && insideY) {
        this.resolve('goal', { touched });
        return;
      }
    }

    // Ball has come to rest or left the field / gone well behind the goal.
    const speed = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
    if (ball.p.z < -PITCH.goalDepth || Math.abs(ball.p.x) > PITCH.boxHalfWidth + 6) {
      this.resolve(touched ? 'save' : 'miss', { touched });
      return;
    }
    if (ball.resting || (speed < 0.4 && this.phaseTime > 1.4)) {
      this.resolve(touched ? 'save' : 'miss', { touched });
      return;
    }
    // safety timeout
    if (this.time - (this.ballShotAt ?? this.time) > 6) {
      this.resolve(touched ? 'save' : 'miss', { touched });
    }
  }

  resolve(kind, data = {}) {
    if (this.phase === PHASE.resolved) return;
    const touched = data.touched;
    let result = kind;
    // A save that the keeper holds onto becomes a catch.
    if (touched && this.contact.lastTouch?.hand && kind !== 'goal') {
      const speed = Math.hypot(this.ball.v.x, this.ball.v.y, this.ball.v.z);
      if (speed < 3.2 && this.contact.lastTouch.part.startsWith('ha')) result = 'catch';
    }
    if (kind === 'goal') result = 'goal';
    else if (!touched) result = 'miss';
    else if (result !== 'catch') result = 'save';

    this.score.shots++;
    if (result === 'goal') {
      this.score.goals++;
      this.streak = 0;
    } else if (result === 'save' || result === 'catch') {
      this.score.saves++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    }
    this.lastResult = {
      kind: result,
      touched,
      touches: this.contact.touches.slice(),
      shot: this.shotInfo,
      dive: this.lastDive,
      keeperPos: { ...this.keeper.pos },
      ballPos: { ...this.ball.p },
      time: this.time - (this.ballShotAt ?? this.time),
    };
    this.phase = PHASE.resolved;
    this.phaseTime = 0;
    this.emit('result', this.lastResult);
  }

  updateResolved(dt) {
    const ball = this.ball;
    const sub = 3;
    for (let i = 0; i < sub; i++) {
      stepBall(ball, dt / sub);
      // let the ball bounce around in the net
      if (ball.p.z < 0.05) {
        if (ball.p.y < BALL.radius) {
          ball.p.y = BALL.radius;
          ball.v.y = Math.abs(ball.v.y) * 0.3;
        }
        // net drag
        ball.v.x *= 0.94;
        ball.v.y *= 0.94;
        ball.v.z *= 0.94;
        if (ball.p.z < -PITCH.goalDepth + 0.2) {
          ball.p.z = -PITCH.goalDepth + 0.2;
          ball.v.z = Math.abs(ball.v.z) * 0.25;
        }
      }
      this.resolveBallInteractions({ ...ball.p }, dt / sub);
    }
    this.keeper.setInput(0, 0);
    this.keeper.update(dt, ball, {});
    if (this.phaseTime > 1.55) {
      this.nextShot(0.5);
    }
  }

  // ------------------------------------------------------- player actions
  // How accurately the keeper reads the shot when R is pressed.
  //
  // A human being cannot perceive millimetre-accurate ball state, so the
  // prediction is deliberately blurred by an amount that grows as the shot gets
  // faster and older. The dive is then computed from that imperfect read — so
  // pressing R early really does commit you to the wrong corner, and a genuine
  // save is a genuine save.
  perceptionForShot() {
    if (!this.ballShotAt) return 0.9;
    const age = Math.max(0, this.time - this.ballShotAt);
    const speed = Math.hypot(this.ball.v.x, this.ball.v.y, this.ball.v.z);
    const speedFactor = Math.max(0, Math.min(1, (speed - 12) / 18));
    // read degrades with power and with how early you commit
    const early = Math.max(0, 0.55 - age);
    return Math.max(0.42, 0.93 - speedFactor * 0.28 - early * 0.35);
  }

  // Optional assist: the human can enable an auto-dive trigger.
  dive() {
    if (this.phase !== PHASE.live) return null;
    // One dive per shot: once you have committed, the physics decides.
    if (this.diveUsed) return null;
    if (!this.keeper.canDive()) return null;
    const ctx = {
      root: { x: this.keeper.pos.x, y: 0, z: this.keeper.pos.z },
      hips: this.keeper.pelvis.y,
      vel: { x: this.keeper.vel.x, z: this.keeper.vel.z },
    };
    const ballSpeed = Math.hypot(this.ball.v.x, this.ball.v.y, this.ball.v.z);
    const distToBall = Math.hypot(this.ball.p.x - this.keeper.pos.x, this.ball.p.z - this.keeper.pos.z);
    // Too close to dive? Reflex brace instead.
    const tooClose = distToBall < 1.25 && ballSpeed > 9 && this.ball.p.z > 0.2 && this.ball.v.z < -2;
    let plan;
    if (tooClose) {
      plan = planReflex(ctx, this.ball);
      this.diveUsed = true;
      this.keeper.startDive(plan);
      this.emit('dive', { profile: 'reflex', plan });
      this.lastDive = plan;
      return plan;
    }
    // Rehearse the candidate dives through the real ragdoll and commit to the
    // one that actually gets a glove nearest the ball.
    plan = searchBestDive(ctx, this.ball, planFactory(), { perception: this.divePerception ?? this.perceptionForShot() });
    if (!plan) plan = planDive(ctx, this.ball, { roam: { x: KEEPER.roamX, z: KEEPER.roamZ } });
    if (!plan) return null;
    this.diveUsed = true;
    this.keeper.plan = plan;
    this.keeper.startDive(plan);
    this.lastDive = plan;
    this.emit('dive', { profile: plan.profile, plan });
    return plan;
  }
}

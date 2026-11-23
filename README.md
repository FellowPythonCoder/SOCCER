# Keeper vs Striker

A goalkeeper simulator. You are the keeper. The striker is an AI. There is no
diving animation anywhere in this project — every save is a ragdoll being thrown
at a predicted interception point by a physics solver.

```
npm install
npm run dev      # http://localhost:5173
npm test         # physics + game + render test suites
```

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move the keeper around the goal area |
| `R` | **Automatic dive** (the only dive button) |
| Mouse drag | Look around |
| Wheel | Zoom |
| `Esc` | Menu (difficulty, assists) |
| `C` | Toggle the cinematic replay |

Touch devices get an on-screen d-pad and dive button.

## The automatic dive

There is no left-dive button and no right-dive button. Pressing `R` runs this:

1. **Read the ball.** Live position, velocity and spin are sampled from the
   simulation.
2. **Predict the flight.** The ball is integrated forward with gravity,
   quadratic drag and Magnus (spin) force, so a curled shot genuinely curves.
3. **Blur the read.** A human cannot see millimetre-accurate ball state. The
   prediction is deliberately degraded according to shot speed and how early you
   committed — diving early really does commit you to the wrong corner.
4. **Rehearse every dive.** For each candidate shape (left, right, low, high,
   forward, jump, brace, stay tall — at two commitment levels) a throw-away copy
   of the keeper's ragdoll is instantiated and the dive is played forward through
   the real physics solver. The candidate whose glove/body actually comes closest
   to the ball wins.
5. **Commit.** The winning rehearsal is handed to the live ragdoll, which is
   launched with a real impulse plus joint torques.

If the ball is too close, too wide or too fast, the keeper still throws himself
at it, and it looks desperate — because the rehearsal told him it was desperate.

## Physical simulation

* **Ragdoll** (`src/sim/ragdoll.js`) — 16 point masses (pelvis, chest, head,
  shoulders, elbows, hands, hips, knees, feet) bound by 28 distance constraints
  and solved positionally at 120 Hz. Gravity, inertia, turf friction and joint
  limits are the only things that move it.
* **Locomotion** (`src/sim/keeper.js`) — acceleration, momentum and deceleration
  with a foot-planting gait: a planted foot is welded to the turf (which is what
  actually pushes the body), a swinging foot is driven to its landing spot, and
  the hips/knees are solved with two-bone inverse kinematics from the feet up.
* **Dive** — a rigid-body launch impulse (with the ground contact suppressed for
  the push-off frames) followed by a target-driven pose along the dive axis and
  a clamped reach toward the predicted ball position.
* **Ball** (`src/physics/ball.js`) — drag + Magnus integration, predictive
  crossing solver, and a launch-velocity solver used by the AI striker.
* **Striker** (`src/sim/shooter.js`) — approaches the ball, plants, telegraphs,
  swings a kicking leg and applies the impulse at the moment of boot contact.
  Shot type, placement, power and spin are randomised; wildly unsavable strikes
  get pulled back toward the keeper so the game stays fair.

## Layout

```
src/
  config.js              tuning constants (pitch, ball, keeper, difficulty)
  physics/
    ball.js              ball integration, prediction, launch solver
    divePlanner.js       analytic dive evaluation + difficulty metric
    diveSearch.js        rehearsal-by-simulation dive search
  sim/
    ragdoll.js           position-based dynamics skeleton
    keeper.js            locomotion, gait, dive controller, recovery
    shooter.js           AI striker state machine
    game.js              phases, collisions, outcome resolution
  render/
    scene.js             pitch, goal, net, stands, floodlights
    keeperMesh.js        keeper geometry rebuilt from ragdoll particles
    shooterMesh.js       striker rig driven by the shooter state machine
    ballView.js          ball, trail ribbon, impact effects
    camera.js            keeper camera + cinematic replay
  ui/hud.js              score, dive readout, menu
tests/                   physics, dive, game and headless-render suites
tools/                   dev-only software rasteriser used to inspect poses
```

## Notes

* `tools/` and `snaps/` are development aids (a tiny PNG rasteriser used to
  check the poses headlessly). They are not part of the shipped game.
* The render path is covered by a headless test (`tests/render.test.mjs`) that
  stubs WebGL and asserts no NaN transforms or vertices appear during play.

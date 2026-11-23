// Central tuning constants. Metres, seconds, radians.
// Coordinate system: goal line is z = 0, the pitch is +z, +x is to the
// shooter's right (and therefore the goalkeeper's left when facing the pitch).

export const PITCH = {
  goalWidth: 7.32,
  goalHeight: 2.44,
  goalDepth: 2.0,
  postRadius: 0.06,
  crossbarY: 2.44,
  halfPostX: 7.32 / 2 + 0.06,
  penaltySpotZ: 11.0,
  boxHalfWidth: 20.16,
  boxDepth: 16.5,
  sixYardDepth: 5.5,
  sixYardHalfWidth: 9.16,
  pitchHalfWidth: 34,
  pitchEndZ: 52,
  grassLineZ: 0,
};

export const BALL = {
  radius: 0.11,
  mass: 0.43,
  // drag: a = -k * |v| * v  (k = 0.5 * rho * Cd * A / m)
  dragK: 0.0062,
  magnusK: 0.0032, // a = k * (w x v)
  gravity: 9.81,
  restFloor: 0.55,
  restPost: 0.65,
  friction: 0.32,
  maxSpin: 95, // rad/s
};

// Goalkeeper anthropometry (a tall, athletic keeper).
export const KEEPER = {
  mass: 82,
  hipHeight: 0.95,
  hipWidth: 0.19,
  shoulderWidth: 0.25,
  headRadius: 0.115,
  neck: 0.1,
  spine: 0.5,
  upperArm: 0.31,
  foreArm: 0.29,
  hand: 0.11,
  thigh: 0.45,
  shin: 0.44,
  foot: 0.17,
  // tuned locomotion
  maxSpeed: 5.1,
  accel: 24,
  decel: 14,
  sprintSpeed: 6.4,
  turnRate: 13,
  // how far the keeper may roam around the goal (x, z)
  roamX: 4.6,
  roamZ: 5.2,
  // body/hand collision spheres for ball interaction
  handsReach: 0.13,
};

export const SHOOTER = {
  mass: 78,
  runSpeed: 5.6,
  plantZ: 11.0,
};

export const SHOT = {
  minSpeed: 13.5,
  maxSpeed: 26,
  chargeTime: 1.35,
  // aim spreads (metres from goal centre, metres above ground)
  aimSpreadX: 3.9,
  aimSpreadY: 2.3,
  crossMargin: 0.85, // how far outside the frame the wildest shots stray
};

export const DIFFICULTY = {
  rookie: { label: 'Rookie', accuracy: 0.52, power: 0.68, curve: 0.4, telegraph: 1.4, reaction: 0.9 },
  pro: { label: 'Pro', accuracy: 0.76, power: 0.88, curve: 0.78, telegraph: 1.02, reaction: 0.55 },
  world: { label: 'World Class', accuracy: 0.94, power: 1.0, curve: 1.0, telegraph: 0.7, reaction: 0.35 },
};

export const PHYSICS = {
  fixedStep: 1 / 120,
  maxSubSteps: 6,
};

// Where the keeper's glove/hand geometry lives relative to each joint chain.
export const HAND_OFFSETS = {
  radius: 0.105,
  wristOut: 0.07,
};

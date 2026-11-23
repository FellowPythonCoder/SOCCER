// Small vector helpers shared by the simulation (plain objects, no allocs in
// hot loops where it matters).

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const clone = (a) => ({ x: a.x, y: a.y, z: a.z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const len2 = (a) => Math.hypot(a.x, a.z);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const normalize = (a) => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (t) => t * t * (3 - 2 * t);
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

// Closest point on segment ab to p. Returns { point, t }.
export function closestOnSegment(a, b, p) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const denom = abx * abx + aby * aby + abz * abz;
  let t = denom > 1e-9 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
  t = clamp(t, 0, 1);
  return { point: { x: a.x + abx * t, y: a.y + aby * t, z: a.z + abz * t }, t };
}

// Swept sphere vs. capsule-ish segment test (uses closest point at the
// mid-time of the substep — adequate for our small steps).
export function sphereSegmentHit(a, b, center, radius, ballRadius) {
  const { point, t } = closestOnSegment(a, b, center);
  const d = dist(point, center);
  return { hit: d <= radius + ballRadius, point, d, t };
}

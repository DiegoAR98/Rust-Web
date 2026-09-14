/**
 * Quantized math structs per GDD §21.5:
 *  - position: centimeters, signed integers
 *  - yaw/pitch: 1/100 degree, signed integers
 *  - velocity: centimeters/second, signed integers
 * Authoritative internal physics may use float32 through Rapier.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Centimeter-space vector. */
export interface Vec3Cm {
  x: number;
  y: number;
  z: number;
}

export interface EulerCm {
  /** yaw in 1/100 degree */
  yaw: number;
  /** pitch in 1/100 degree */
  pitch: number;
}

export interface VelocityCm {
  x: number;
  y: number;
  z: number;
}

export const MetersToCm = (m: number): number => Math.round(m * 100);
export const CmToMeters = (cm: number): number => cm / 100;

export const addVec = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const subVec = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const scaleVec = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const lengthSq = (a: Vec3): number => dot(a, a);

export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));

export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  if (l === 0) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Direction from yaw/pitch in 1/100-degree quantized units.
 * yaw 0 faces +Z, positive yaw rotates toward +X (right-hand, Y up).
 */
export const directionFromYawPitch = (yawHundredths: number, pitchHundredths: number): Vec3 => {
  const yaw = (yawHundredths * Math.PI) / 18000;
  const pitch = (pitchHundredths * Math.PI) / 18000;
  const cp = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * cp,
  };
};

/** Small, seedable, dependency-free PRNG (mulberry32) so generation is deterministic under --seed. */
export type Rng = () => number;

export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function createRng(seed: string | number): Rng {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngInt(rng: Rng, min: number, max: number): number {
  if (max < min) return min;
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function rngFloat(rng: Rng, min: number, max: number): number {
  if (max < min) return min;
  return rng() * (max - min) + min;
}

export function rngPick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("rngPick called with empty array");
  const idx = Math.floor(rng() * items.length);
  return items[Math.min(idx, items.length - 1)] as T;
}

export function rngBool(rng: Rng): boolean {
  return rng() < 0.5;
}

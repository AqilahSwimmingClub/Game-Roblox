/** RNG deterministik (mulberry32) agar server dan semua klien membangun dunia yang sama. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }
  int(min: number, max: number): number {
    return Math.floor(min + (max - min + 1) * this.next());
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)] as T;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

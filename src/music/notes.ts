const NAMES = ["c", "db", "d", "eb", "e", "f", "gb", "g", "ab", "a", "bb", "b"];

/** Midi number of a note name such as `eb5` or `c2`. */
export function midi(name: string): number {
  const match = /^([a-g](?:b)?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`not a note: ${name}`);
  const [, pitch, octave] = match;
  return NAMES.indexOf(pitch) + (Number(octave) + 1) * 12;
}

/** The name of a midi number, spelled with flats. */
export function nameOf(value: number): string {
  return `${NAMES[((value % 12) + 12) % 12]}${Math.floor(value / 12) - 1}`;
}

export function hz(name: string): number {
  return 440 * 2 ** ((midi(name) - 69) / 12);
}

/** A tiny seeded generator, so a session sounds and reads the same every time. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

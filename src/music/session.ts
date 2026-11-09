import { midi, nameOf, seeded } from "./notes";
import type { Bar, Heat, StageLine, Token, Track } from "./types";

/**
 * The built-in session: a short instrumental pressed at 88 bpm, written here
 * rather than shipped as audio. Its harmony is the same data the chord lane
 * reads and the synth plays, so the screen and the sound cannot drift apart.
 */

const BPM = 88;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
const SLOT = BEAT / 2;

const PROGRESSION = [
  { notes: ["c4", "eb4", "g4", "bb4"], root: "c2" },
  { notes: ["ab3", "c4", "eb4", "g4"], root: "ab1" },
  { notes: ["eb4", "g4", "bb4", "d5"], root: "eb2" },
  { notes: ["bb3", "d4", "f4", "a4"], root: "bb1" },
];

type Recipe = {
  section: string;
  bars: number;
  /** n = note, 2 = two notes at once, - = rest. */
  rhythm: string[];
  /** Which chord tone each slot takes. */
  motif: number[];
  octave: number;
};

const RECIPES: Recipe[] = [
  { section: "intro", bars: 2, rhythm: ["2", "-", "-", "n", "-", "-", "n", "-"], motif: [0, 0, 0, 2, 0, 0, 3, 0], octave: 12 },
  { section: "verse 1", bars: 4, rhythm: ["n", "-", "n", "n", "-", "n", "-", "2"], motif: [0, 0, 2, 1, 0, 3, 0, 0], octave: 12 },
  { section: "verse 2", bars: 4, rhythm: ["n", "2", "-", "n", "n", "-", "n", "-"], motif: [0, 1, 0, 2, 3, 0, 1, 0], octave: 12 },
  { section: "drop", bars: 4, rhythm: ["n", "-", "2", "n", "n", "-", "2", "-"], motif: [0, 3, 1, 2, 0, 3, 2, 1], octave: 12 },
  { section: "outro", bars: 4, rhythm: ["n", "-", "-", "n", "-", "2", "-", "-"], motif: [0, 0, 0, 1, 0, 3, 0, 0], octave: 12 },
];

function sectionOf(bar: number): Recipe {
  let seen = 0;
  for (const recipe of RECIPES) {
    if (bar < seen + recipe.bars) return recipe;
    seen += recipe.bars;
  }
  return RECIPES[RECIPES.length - 1];
}

function buildBars(): Bar[] {
  const total = RECIPES.reduce((n, r) => n + r.bars, 0);
  const bars: Bar[] = [];
  for (let i = 0; i < total; i++) {
    const chord = PROGRESSION[i % PROGRESSION.length];
    bars.push({ at: i * BAR, chord: chord.notes, root: chord.root, section: sectionOf(i).section });
  }
  return bars;
}

/** Two notes a fourth apart, both inside the chord, read as a bracket. */
export function buildSession(): Track {
  const bars = buildBars();
  const rand = seeded(1979);
  const lines: StageLine[] = bars.map((bar, index) => {
    const recipe = sectionOf(index);
    const tones = bar.chord.map((note) => midi(note) + recipe.octave);
    const tokens: Token[] = [];
    recipe.rhythm.forEach((step, slot) => {
      if (step === "-") {
        // A rest only reads at the end of a phrase; the first half stays airy.
        if (slot < 4) return;
        tokens.push({ notes: [], at: bar.at + slot * SLOT, dur: SLOT, rest: true });
        return;
      }
      const tone = (offset: number) => tones[(recipe.motif[slot] + offset) % tones.length];
      const notes = [nameOf(tone(0))];
      const second = nameOf(tone(1));
      if ((step === "2" || rand() > 0.88) && second !== notes[0]) notes.push(second);
      const heat: Heat = notes.length > 1 ? "gold" : "violet";
      tokens.push({ notes, at: bar.at + slot * SLOT, dur: SLOT * 0.94, heat });
    });
    const opens = index === 0 || bars[index - 1].section !== bar.section;
    return {
      at: bar.at,
      end: bar.at + BAR,
      section: opens ? bar.section : undefined,
      tokens,
    };
  });

  return {
    id: "session-01",
    title: "Soft Static",
    artist: "Aster Vale",
    album: "Night Pressing",
    duration: bars.length * BAR,
    kind: "notes",
    key: "E♭ major",
    bpm: BPM,
    lines,
    bars,
    sourceId: "session",
  };
}

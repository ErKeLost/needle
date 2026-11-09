/** Where the needle is, and what it is reading. Times are seconds. */

export type Heat = "violet" | "gold";

export type Token = {
  /** Notes of the chord lane, e.g. ["c5", "eb5"]. Rests carry none. */
  notes: string[];
  at: number;
  dur: number;
  rest?: boolean;
  /** A word of a lyric sheet, when the track has one. */
  word?: string;
  heat?: Heat;
};

export type StageLine = {
  at: number;
  end: number;
  /** Sung once, at the first line of a section. */
  section?: string;
  tokens: Token[];
};

export type Bar = {
  at: number;
  chord: string[];
  root: string;
  section: string;
};

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Seconds. */
  duration: number;
  /** How the lane reads: notes of a session, or words of a lyric sheet. */
  kind: "notes" | "words";
  key?: string;
  bpm?: number;
  /** Album art, when the source has one. */
  artwork?: string;
  lines: StageLine[];
  bars?: Bar[];
  sourceId: string;
};

export type AudioSource =
  | { kind: "buffer"; buffer: AudioBuffer }
  | { kind: "url"; url: string };

export type Stream = {
  audio: AudioSource;
  /** Some streams only settle their length once they are open. */
  duration?: number;
};

/**
 * A place tracks come from: the built-in session, or files on this machine.
 * Shaped after MyGo Music's source plugins (vendor/mygo-music/internal/music),
 * where every capability is a function a source may or may not answer.
 */
export type MusicSource = {
  id: string;
  name: string;
  /** One line for the source menu. */
  detail: string;
  /** Whether the source answers for a capability, the way a plugin exports it. */
  can(what: "library" | "search" | "stream" | "lyrics" | "open"): boolean;
  tracks(): Promise<Track[]>;
  search?(query: string): Promise<Track[]>;
  stream(track: Track): Promise<Stream>;
  lyrics?(track: Track): Promise<StageLine[]>;
};

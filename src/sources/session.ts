import { renderSession } from "../audio/render";
import type { MusicSource, Track } from "../music/types";

/** The record that comes with the player: no files, no network, no account. */
export function sessionSource(track: Track): MusicSource {
  let rendered: Promise<AudioBuffer> | null = null;

  return {
    id: "session",
    name: "Built-in session",
    detail: `${track.bpm} bpm · ${track.key}`,
    can: (what) => what === "library" || what === "stream",
    async tracks() {
      return [track];
    },
    async stream() {
      rendered ??= renderSession(track);
      return { audio: { kind: "buffer", buffer: await rendered } };
    },
  };
}

export type SessionTrack = Track;

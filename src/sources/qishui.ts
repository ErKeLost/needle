import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { MusicSource, StageLine, Token, Track } from "../music/types";
import { inTauri } from "./local";

/**
 * 汽水音乐. Search goes straight to `api.qishui.com`; a track needs the signed
 * headers, which Rust gets from the signer kept in resources/qishui.
 */

type Hit = {
  id: string;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
};

type TrackAnswer = { url: string; lyric: string; duration: number; name: string };

export function qishuiTrack(hit: Hit): Track {
  return {
    id: `qs-${hit.id}`,
    title: hit.name,
    artist: hit.artist || "汽水音乐",
    album: hit.album,
    duration: (hit.duration || 0) / 1000,
    kind: "words",
    lines: [],
    artwork: hit.cover || undefined,
    sourceId: "qishui",
  };
}

/**
 * The sheet is per character: `[line start ms, line length ms]` then
 * `<offset ms, duration ms, flags>text` for every syllable.
 */
export function parseQishuiLyric(content: string): StageLine[] {
  const lines: StageLine[] = [];
  for (const raw of content.split("\n")) {
    const head = /^\s*\[(\d+),(\d+)\]([\s\S]*)$/.exec(raw);
    if (!head) continue;
    const start = Number(head[1]) / 1000;
    const length = Number(head[2]) / 1000;
    const tokens: Token[] = [];
    const word = /<(\d+),(\d+),[^>]*>([^<]*)/g;
    let match: RegExpExecArray | null;
    while ((match = word.exec(head[3]))) {
      const text = match[3].trim();
      if (!text) continue;
      tokens.push({
        notes: [],
        word: text,
        at: start + Number(match[1]) / 1000,
        dur: Math.max(0.06, Number(match[2]) / 1000),
      });
    }
    if (tokens.length) lines.push({ at: start, end: start + Math.max(length, 1), tokens });
  }
  return lines;
}

const idOf = (track: Track) => track.id.replace(/^qs-/, "");

export const qishuiSource: MusicSource = {
  id: "qishui",
  name: "汽水音乐",
  detail: "Search",
  can: (what) => what === "search" || what === "stream" || what === "lyrics",

  async tracks() {
    return [];
  },

  async search(query) {
    if (!inTauri()) throw new Error("汽水音乐需要桌面版");
    const answer = await invoke<{ tracks: Hit[] }>("qishui_search", { query, limit: 20 });
    return answer.tracks.map(qishuiTrack);
  },

  async stream(track, options) {
    if (!inTauri()) throw new Error("汽水音乐播放需要桌面版");
    const answer = await invoke<{ path: string }>("qishui_stream", {
      id: idOf(track),
      cookie: options?.cookie ?? null,
    });
    return { audio: { kind: "url", url: convertFileSrc(answer.path) }, duration: track.duration };
  },

  async lyrics(track) {
    if (!inTauri()) return [];
    const answer = await invoke<TrackAnswer>("qishui_track", {
      id: idOf(track),
      cookie: null,
    });
    return parseQishuiLyric(answer.lyric);
  },
};

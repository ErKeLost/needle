import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { parseLrc, toStage } from "../music/lrc";
import type { MusicSource, Track } from "../music/types";
import { inTauri } from "./local";

/**
 * NetEase Cloud Music. The desktop build asks Rust, which signs the encrypted
 * `eapi` calls NetEase wants and keeps one copy of each song in the app cache.
 * In the browser the same reads go through the dev server.
 */

type Hit = {
  id: number;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
};

type LyricAnswer = { lrc: string; translation: string };

export function neteaseTrack(hit: Hit): Track {
  return {
    id: `ne-${hit.id}`,
    title: hit.name,
    artist: hit.artist || "网易云音乐",
    album: hit.album,
    duration: (hit.duration || 0) / 1000,
    kind: "words",
    lines: [],
    artwork: hit.cover ? hit.cover.replace(/^http:\/\//, "https://") : undefined,
    sourceId: "netease",
  };
}

async function devSearch(query: string): Promise<Hit[]> {
  const response = await fetch("/ne/api/cloudsearch/pc", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ s: query, type: "1", limit: "24", offset: "0" }),
  });
  if (!response.ok) throw new Error(`网易云没有回应（${response.status}）`);
  const body = await readJson(response, "网易云");
  const songs: any[] = body?.result?.songs ?? [];
  return songs.map((song) => ({
    id: song.id,
    name: song.name ?? "",
    artist: (song.ar ?? []).map((artist: { name: string }) => artist.name).join(" / "),
    album: song.al?.name ?? "",
    cover: song.al?.picUrl ?? "",
    duration: song.dt ?? 0,
  }));
}

async function devChart(): Promise<Hit[]> {
  const response = await fetch("/ne/api/playlist/detail?id=3778678");
  if (!response.ok) throw new Error(`网易云没有回应（${response.status}）`);
  const body = await readJson(response, "网易云");
  const songs: any[] = body?.result?.tracks ?? [];
  return songs.map((song) => ({
    id: song.id,
    name: song.name ?? "",
    artist: (song.artists ?? []).map((artist: { name: string }) => artist.name).join(" / "),
    album: song.album?.name ?? "",
    cover: song.album?.picUrl ?? "",
    duration: song.duration ?? 0,
  }));
}

async function devLyric(id: string): Promise<LyricAnswer> {
  const response = await fetch(`/ne/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`);
  if (!response.ok) throw new Error(`网易云没有回应（${response.status}）`);
  const body = await readJson(response, "网易云");
  return { lrc: body?.lrc?.lyric ?? "", translation: body?.tlyric?.lyric ?? "" };
}

async function readJson(response: Response, who: string): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${who}暂时只回了网页，没回数据`);
  }
}

export const neteaseSource: MusicSource = {
  id: "netease",
  name: "网易云音乐",
  detail: "Search",
  can: (what) => what === "search" || what === "stream" || what === "lyrics",

  async tracks() {
    return [];
  },

  async chart(limit = 30) {
    const hits = inTauri()
      ? (await invoke<{ tracks: Hit[] }>("netease_chart", { limit })).tracks
      : await devChart();
    return hits.map(neteaseTrack);
  },

  async search(query) {
    const hits = inTauri()
      ? (await invoke<{ tracks: Hit[] }>("netease_search", { query, limit: 24 })).tracks
      : await devSearch(query);
    return hits.map(neteaseTrack);
  },

  async stream(track, options) {
    if (!inTauri()) throw new Error("网易云播放需要桌面版");
    const answer = await invoke<{ path: string; kind: string }>("netease_stream", {
      id: track.id.replace(/^ne-/, ""),
      cookie: options?.cookie ?? null,
    });
    return {
      audio: { kind: "url", url: convertFileSrc(answer.path) },
      duration: track.duration,
    };
  },

  async lyrics(track) {
    const answer = inTauri()
      ? await invoke<LyricAnswer>("netease_lyric", { id: track.id.replace(/^ne-/, "") })
      : await devLyric(track.id.replace(/^ne-/, ""));
    return toStage(parseLrc(answer.lrc), track.duration, track);
  },
};

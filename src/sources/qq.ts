import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { parseLrc, toStage } from "../music/lrc";
import type { MusicSource, Track } from "../music/types";
import { inTauri } from "./local";

/**
 * QQ Music, anonymously. Search and lyrics are open; playback goes through the
 * `vkey` handshake, so a song that needs a subscription says so instead of
 * playing somebody else's preview.
 */

type Hit = {
  id: string;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  pay?: number;
};

type LyricAnswer = { lrc: string; translation: string };

export function qqTrack(hit: Hit): Track {
  return {
    id: `qq-${hit.id}`,
    title: hit.name,
    artist: hit.artist || "QQ 音乐",
    album: hit.album,
    duration: (hit.duration || 0) / 1000,
    kind: "words",
    lines: [],
    artwork: hit.cover || undefined,
    sourceId: "qq",
  };
}

async function devSearch(query: string): Promise<Hit[]> {
  const response = await fetch(
    `/qqs/soso/fcgi-bin/client_search_cp?format=json&p=1&n=24&w=${encodeURIComponent(query)}`,
  );
  if (!response.ok) throw new Error(`QQ 音乐没有回应（${response.status}）`);
  const body = await readJson(response, "QQ 音乐");
  const songs: any[] = body?.data?.song?.list ?? [];
  return songs.map((song) => ({
    id: song.songmid,
    name: song.songname ?? "",
    artist: (song.singer ?? []).map((artist: { name: string }) => artist.name).join(" / "),
    album: song.albumname ?? "",
    cover: song.albummid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.albummid}.jpg`
      : "",
    duration: (song.interval ?? 0) * 1000,
    pay: song.pay?.payplay ?? 0,
  }));
}

async function devLyric(id: string): Promise<LyricAnswer> {
  const mid = id.replace(/^qq-/, "");
  const response = await fetch(
    `/qqs/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${mid}&format=json&nobase64=1`,
  );
  if (!response.ok) throw new Error(`QQ 音乐没有回应（${response.status}）`);
  const body = await readJson(response, "QQ 音乐");
  return { lrc: body?.lyric ?? "", translation: body?.trans ?? "" };
}

async function readJson(response: Response, who: string): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${who}暂时只回了网页，没回数据`);
  }
}

export const qqSource: MusicSource = {
  id: "qq",
  name: "QQ 音乐",
  detail: "Search",
  can: (what) => what === "search" || what === "stream" || what === "lyrics",

  async tracks() {
    return [];
  },

  async search(query) {
    const hits = inTauri()
      ? (await invoke<{ tracks: Hit[] }>("qq_search", { query, limit: 24 })).tracks
      : await devSearch(query);
    return hits.map(qqTrack);
  },

  async stream(track, options) {
    if (!inTauri()) throw new Error("QQ 音乐播放需要桌面版");
    const answer = await invoke<{ path: string; kind: string }>("qq_stream", {
      id: track.id,
      cookie: options?.cookie ?? null,
    });
    return {
      audio: { kind: "url", url: convertFileSrc(answer.path) },
      duration: track.duration,
    };
  },

  async lyrics(track) {
    const answer = inTauri()
      ? await invoke<LyricAnswer>("qq_lyric", { id: track.id })
      : await devLyric(track.id);
    return toStage(parseLrc(answer.lrc), track.duration, track);
  },
};

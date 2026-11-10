import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Stream, Track } from "../music/types";

type Answer = { path?: string; stream?: string; kind?: string; cached?: boolean };

/**
 * The player's address for a side. When the file is already on this machine
 * that is the file itself; otherwise it is a loopback stream, which starts
 * playing on the first chunk instead of the last, and answers a seek with a
 * new byte range rather than another whole download.
 */
export async function openAudio(
  source: string,
  id: string,
  track: Track,
  options?: { cookie?: string; media?: string },
): Promise<Stream> {
  const answer = await invoke<Answer>("audio_open", {
    source,
    id,
    media: options?.media ?? null,
    cookie: options?.cookie ?? null,
  });
  const url = answer.stream || convertFileSrc(answer.path ?? "");
  if (!url) throw new Error("这首歌没有可播的地址");
  return { audio: { kind: "url", url }, duration: track.duration };
}

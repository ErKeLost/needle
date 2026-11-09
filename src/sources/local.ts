import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { MusicSource, Track } from "../music/types";

/**
 * Files on this machine. In Tauri the paths come from the native dialog and
 * are served through the asset protocol; in a browser the same source reads a
 * File object, so the page works before it is packaged.
 */

export const inTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const entries = new Map<string, { track: Track; url: string }>();
let sequence = 0;

const AUDIO = ["mp3", "flac", "wav", "m4a", "aac", "ogg", "aiff"];

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function addTrack(name: string, url: string): Track {
  const id = `local-${++sequence}`;
  const track: Track = {
    id,
    title: name.replace(/\.[^.]+$/, ""),
    artist: "Local file",
    album: "This machine",
    duration: 0,
    kind: "words",
    lines: [],
    sourceId: "local",
  };
  entries.set(id, { track, url });
  return track;
}

export function adoptBrowserFiles(files: File[]): Track[] {
  return files
    .filter((file) => /audio\//.test(file.type) || AUDIO.includes(file.name.split(".").pop()?.toLowerCase() ?? ""))
    .map((file) => addTrack(file.name, URL.createObjectURL(file)));
}

function adoptPaths(paths: string[]): Track[] {
  return paths
    .filter((path) => AUDIO.includes(path.split(".").pop()?.toLowerCase() ?? ""))
    .map((path) => addTrack(basename(path), convertFileSrc(path)));
}

/** The native dialog, or a file input when the page runs in a browser. */
export async function pickFiles(): Promise<Track[]> {
  if (inTauri()) {
    const picked = await open({
      multiple: true,
      directory: false,
      title: "Open audio",
      filters: [{ name: "Audio", extensions: AUDIO }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    return adoptPaths(paths);
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,.flac,.m4a,.ogg,.aiff";
    input.multiple = true;
    input.addEventListener("change", () => {
      resolve(adoptBrowserFiles(Array.from(input.files ?? [])));
    });
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

export const localSource: MusicSource = {
  id: "local",
  name: "This machine",
  detail: "Audio you open",
  can: (what) => what === "library" || what === "stream" || what === "open",
  async tracks() {
    return [...entries.values()].map((entry) => entry.track);
  },
  async stream(track) {
    const entry = entries.get(track.id);
    if (!entry) throw new Error("That file is no longer open");
    return { audio: { kind: "url", url: entry.url } };
  },
};

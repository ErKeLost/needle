import { useCallback, useEffect, useState } from "react";

export type Settings = {
  /** 0 to 1. */
  volume: number;
  /** Whether the platter turns while a side plays. */
  spin: boolean;
  /** A sourced record shows its album art on the label, or the printed one. */
  label: "printed" | "art";
  /** The words in the stage, 0.85 to 1.2. */
  lyricScale: number;
  /** Stacked lines above and below are blurred back out of focus. */
  neighborBlur: boolean;
  /** How the word being sung is marked. */
  highlight: "underline" | "pill";
  /** Start the built-in side as soon as the window opens. */
  autoplay: boolean;
  /** Sources shown in the menu, by id. */
  enabled: Record<string, boolean>;
};

const DEFAULTS: Settings = {
  volume: 0.8,
  spin: true,
  label: "art",
  lyricScale: 1,
  neighborBlur: true,
  highlight: "underline",
  autoplay: false,
  enabled: { session: true, local: true, netease: true, qq: true },
};

const KEY = "needle.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULTS,
      ...saved,
      enabled: { ...DEFAULTS.enabled, ...(saved.enabled ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // storage may be full or blocked; the player still works.
    }
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  return { settings, update };
}

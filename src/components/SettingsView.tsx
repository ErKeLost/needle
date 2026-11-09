import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clock } from "../music/notes";
import type { MusicSource, Track } from "../music/types";
import type { Settings } from "../settings";
import { inTauri } from "../sources/local";
import { PauseIcon, PlayIcon } from "./icons";

type Props = {
  settings: Settings;
  volume: number;
  sources: MusicSource[];
  localCount: number;
  current: Track;
  playing: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onSearch: (source: MusicSource) => void;
  onOpenFiles: () => void;
  onPlaySource: (source: MusicSource) => void;
  onToggle: () => void;
};

type Usage = { bytes: number; files: number };

export function SettingsView({
  settings,
  volume,
  sources,
  localCount,
  current,
  playing,
  onChange,
  onClose,
  onSearch,
  onOpenFiles,
  onPlaySource,
  onToggle,
}: Props) {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    if (!inTauri()) return;
    let alive = true;
    void invoke<Usage>("cache_usage")
      .then((value) => alive && setUsage(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [current.id]);

  return (
    <div className="sheet">
      <header className="sheet__bar" data-tauri-drag-region>
        <button type="button" className="back" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M14 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Now playing
        </button>
        <span className="sheet__brand">Needle</span>
      </header>

      <div className="sheet__body">
        <h1 className="sheet__title">Settings</h1>
        <p className="sheet__lede">One record at a time. Everything else is here.</p>

        <section className="group" aria-labelledby="sources-heading">
          <h2 className="group__title" id="sources-heading">
            Sources
          </h2>
          <div className="group__rows">
            {sources.map((source) => {
              const isLocal = source.id === "local";
              const hasSearch = source.can("search");
              const on = settings.enabled[source.id] !== false;
              return (
                <div className="row" key={source.id} data-muted={!on}>
                  <div className="row__text">
                    <span className="row__name">
                      {source.name}
                      {source.id === current.sourceId && <span className="row__now">now playing</span>}
                    </span>
                    <span className="row__note">
                      {isLocal
                        ? localCount
                          ? `${localCount} file${localCount === 1 ? "" : "s"} open`
                          : "Nothing open yet"
                        : source.detail}
                    </span>
                  </div>
                  <div className="row__control">
                    {isLocal && (
                      <button type="button" className="action" onClick={onOpenFiles} disabled={!on}>
                        Open files
                      </button>
                    )}
                    {hasSearch && (
                      <button type="button" className="action" onClick={() => onSearch(source)} disabled={!on}>
                        Search
                      </button>
                    )}
                    {!isLocal && !hasSearch && (
                      <button type="button" className="action" onClick={() => onPlaySource(source)} disabled={!on}>
                        Play
                      </button>
                    )}
                    <Switch
                      checked={on}
                      label={`${source.name} in the source menu`}
                      onChange={(value) =>
                        onChange({ enabled: { ...settings.enabled, [source.id]: value } })
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="group" aria-labelledby="playback-heading">
          <h2 className="group__title" id="playback-heading">
            Playback
          </h2>
          <div className="group__rows">
            <div className="row">
              <div className="row__text">
                <span className="row__name">Volume</span>
                <span className="row__note">{Math.round(volume * 100)}%</span>
              </div>
              <div className="row__control">
                <input
                  className="slider"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(volume * 100)}
                  onChange={(event) => onChange({ volume: Number(event.target.value) / 100 })}
                  aria-label="Volume"
                />
              </div>
            </div>
            <div className="row">
              <div className="row__text">
                <span className="row__name">Start with the needle down</span>
                <span className="row__note">Play the built-in side when the window opens</span>
              </div>
              <div className="row__control">
                <Switch
                  checked={settings.autoplay}
                  label="Play on open"
                  onChange={(value) => onChange({ autoplay: value })}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="group" aria-labelledby="record-heading">
          <h2 className="group__title" id="record-heading">
            Record
          </h2>
          <div className="group__rows">
            <div className="row">
              <div className="row__text">
                <span className="row__name">Turn the platter</span>
                <span className="row__note">Spin while a side plays</span>
              </div>
              <div className="row__control">
                <Switch checked={settings.spin} label="Turn the platter" onChange={(value) => onChange({ spin: value })} />
              </div>
            </div>
            <div className="row">
              <div className="row__text">
                <span className="row__name">Label</span>
                <span className="row__note">What is pressed in the middle</span>
              </div>
              <div className="row__control">
                <Segmented
                  label="Label"
                  value={settings.label}
                  options={[
                    { value: "art", label: "Album art" },
                    { value: "printed", label: "Printed" },
                  ]}
                  onChange={(value) => onChange({ label: value as Settings["label"] })}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="group" aria-labelledby="words-heading">
          <h2 className="group__title" id="words-heading">
            Words
          </h2>
          <div className="group__rows">
            <div className="row">
              <div className="row__text">
                <span className="row__name">Size</span>
                <span className="row__note">The line being sung</span>
              </div>
              <div className="row__control">
                <Segmented
                  label="Lyric size"
                  value={String(settings.lyricScale)}
                  options={[
                    { value: "0.85", label: "S" },
                    { value: "1", label: "M" },
                    { value: "1.15", label: "L" },
                  ]}
                  onChange={(value) => onChange({ lyricScale: Number(value) })}
                />
              </div>
            </div>
            <div className="row">
              <div className="row__text">
                <span className="row__name">Neighbour lines</span>
                <span className="row__note">Hold the lines above and below out of focus</span>
              </div>
              <div className="row__control">
                <Switch
                  checked={settings.neighborBlur}
                  label="Blur neighbour lines"
                  onChange={(value) => onChange({ neighborBlur: value })}
                />
              </div>
            </div>
            <div className="row">
              <div className="row__text">
                <span className="row__name">The word being sung</span>
                <span className="row__note">How the needle marks it</span>
              </div>
              <div className="row__control">
                <Segmented
                  label="Highlight"
                  value={settings.highlight}
                  options={[
                    { value: "underline", label: "Underline" },
                    { value: "pill", label: "Block" },
                  ]}
                  onChange={(value) => onChange({ highlight: value as Settings["highlight"] })}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="group" aria-labelledby="storage-heading">
          <h2 className="group__title" id="storage-heading">
            Storage
          </h2>
          <div className="group__rows">
            <div className="row">
              <div className="row__text">
                <span className="row__name">Audio cache</span>
                <span className="row__note">
                  {usage
                    ? usage.files
                      ? `${usage.files} song${usage.files === 1 ? "" : "s"} kept for instant replay`
                      : "Nothing kept yet"
                    : inTauri()
                      ? "Reading…"
                      : "Only in the desktop app"}
                </span>
              </div>
              <div className="row__control">
                <span className="row__mono">{usage ? bytes(usage.bytes) : "—"}</span>
                <button
                  type="button"
                  className="action"
                  disabled={!usage || usage.bytes === 0}
                  onClick={async () => {
                    try {
                      setUsage(await invoke<Usage>("cache_clear"));
                    } catch {
                      // nothing to clear
                    }
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="group" aria-labelledby="keys-heading">
          <h2 className="group__title" id="keys-heading">
            Keyboard
          </h2>
          <div className="group__rows">
            {[
              ["Play or pause", "Space"],
              ["Back or forward", "← →"],
              ["Next or previous", "N P"],
              ["Search NetEase", "⌘ K"],
              ["Open audio", "⌘ O"],
              ["Settings", "⌘ ,"],
            ].map(([what, keys]) => (
              <div className="row row--tight" key={what}>
                <span className="row__name">{what}</span>
                <span className="keys">
                  {keys.split(" ").map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="group" aria-labelledby="about-heading">
          <h2 className="group__title" id="about-heading">
            About
          </h2>
          <div className="group__rows">
            <div className="row">
              <div className="row__text">
                <span className="row__name">Needle 0.1.0</span>
                <span className="row__note">Tauri 2 · Vite · React · sources shaped after MyGo Music</span>
              </div>
              <span className="row__mono">33⅓ rpm</span>
            </div>
          </div>
        </section>
      </div>

      <footer className="sheet__foot">
        <span className="sheet__foot-title">{current.title}</span>
        <span className="sheet__foot-meta">
          {current.artist} · {clock(current.duration)}
        </span>
        <button type="button" className="sheet__foot-play" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      </footer>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  );
}

function Segmented({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className="segmented__item"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function bytes(value: number): string {
  if (value <= 0) return "Empty";
  const mb = value / (1024 * 1024);
  if (mb < 1) return `${Math.round(value / 1024)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

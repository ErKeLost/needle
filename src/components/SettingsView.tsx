import { useEffect, useState } from "react";
import { Button, Slider, Switch, TextArea, TextField } from "@heroui/react";
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
  accounts: Record<string, string>;
  onChange: (patch: Partial<Settings>) => void;
  onAccount: (id: string, value: string) => void;
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
  accounts,
  onChange,
  onAccount,
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
        <Button variant="ghost" size="sm" onPress={onClose} className="text-[var(--paper-46)]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M14 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Now playing
        </Button>
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
                      <Button size="sm" variant="outline" isDisabled={!on} onPress={onOpenFiles}>
                        Open files
                      </Button>
                    )}
                    {hasSearch && (
                      <Button size="sm" variant="outline" isDisabled={!on} onPress={() => onSearch(source)}>
                        Search
                      </Button>
                    )}
                    {!isLocal && !hasSearch && (
                      <Button size="sm" variant="outline" isDisabled={!on} onPress={() => onPlaySource(source)}>
                        Play
                      </Button>
                    )}
                    <Toggle
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

        <section className="group" aria-labelledby="accounts-heading">
          <h2 className="group__title" id="accounts-heading">
            Accounts
          </h2>
          <div className="group__rows">
            {[
              { id: "netease", name: "网易云音乐", hint: "MUSIC_U=…", where: "music.163.com" },
              { id: "qq", name: "QQ 音乐", hint: "uin=o…; qm_keystones=…", where: "y.qq.com" },
            ].map((account) => (
              <AccountRow
                key={account.id}
                name={account.name}
                hint={account.hint}
                where={account.where}
                value={accounts[account.id] ?? ""}
                onSave={(value) => onAccount(account.id, value)}
              />
            ))}
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
                <Slider
                  aria-label="Volume"
                  className="w-44"
                  minValue={0}
                  maxValue={100}
                  value={Math.round(volume * 100)}
                  onChange={(next) => onChange({ volume: Number(next) / 100 })}
                >
                  <Slider.Track>
                    <Slider.Fill />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>
              </div>
            </div>
            <div className="row">
              <div className="row__text">
                <span className="row__name">Start with the needle down</span>
                <span className="row__note">Play the built-in side when the window opens</span>
              </div>
              <div className="row__control">
                <Toggle
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
                <Toggle checked={settings.spin} label="Turn the platter" onChange={(value) => onChange({ spin: value })} />
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
                <Toggle
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
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={!usage || usage.bytes === 0}
                  onPress={async () => {
                    try {
                      setUsage(await invoke<Usage>("cache_clear"));
                    } catch {
                      // nothing to clear
                    }
                  }}
                >
                  Clear
                </Button>
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
        <Button
          isIconOnly
          variant="outline"
          className="rounded-full"
          onPress={onToggle}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
      </footer>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <Switch isSelected={checked} onChange={onChange} aria-label={label} size="sm">
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
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
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={option.value === value ? "secondary" : "ghost"}
          onPress={() => onChange(option.value)}
        >
          {option.label}
        </Button>
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

function AccountRow({
  name,
  hint,
  where,
  value,
  onSave,
}: {
  name: string;
  hint: string;
  where: string;
  value: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const saved = value.trim().length > 0;

  return (
    <div className="account">
      <div className="account__head">
        <span className="row__name">{name}</span>
        <span className="account__state">{saved ? "已登录" : "未登录"}</span>
      </div>
      <p className="row__note">
        在浏览器登录 {where}，从开发者工具复制 Cookie 粘到这里。只存在这台机器，只发给该音源。
      </p>
      <TextField className="mt-2 w-full" aria-label={`${name} Cookie`}>
        <TextArea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={hint}
          spellCheck={false}
          rows={2}
          className="font-mono text-[10.5px]"
        />
      </TextField>
      <div className="account__actions">
        <Button size="sm" variant="secondary" onPress={() => onSave(draft)} isDisabled={draft === value}>
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onPress={() => {
            setDraft("");
            onSave("");
          }}
          isDisabled={!saved && !draft}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

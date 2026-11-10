import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ChordLane } from "./components/ChordLane";
import { RecordDeck } from "./components/RecordDeck";
import { LoginPanel } from "./components/LoginPanel";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsView } from "./components/SettingsView";
import { SourceMenu } from "./components/SourceMenu";
import { TransportBar } from "./components/TransportBar";
import { Transport } from "./audio/transport";
import type { MusicSource, Track } from "./music/types";
import { invoke } from "@tauri-apps/api/core";
import { useAccounts, useProfiles } from "./accounts";
import { useSettings } from "./settings";
import { adoptBrowserFiles, inTauri, localSource, pickFiles } from "./sources/local";
import { neteaseSource } from "./sources/netease";
import { musicSources } from "./sources";

const PLACEHOLDER: Track = {
  id: "nothing",
  title: "Nothing on the platter",
  artist: "Pick a source, or press ⌘K",
  album: "",
  duration: 0,
  kind: "words",
  lines: [],
  sourceId: "none",
};
const LAST_KEY = "needle.last.v2";

type LastPlayed = { sourceId: string; track: Track };

/** The side that was on the platter when the window last closed. */
function readLast(): LastPlayed | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as LastPlayed;
    if (!saved?.track?.id || !saved.sourceId) return null;
    return saved;
  } catch {
    return null;
  }
}

function writeLast(sourceId: string, track: Track) {
  if (sourceId === "session" || sourceId === "local") return;
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ sourceId, track }));
  } catch {
    // the cache is not important enough to break a track over
  }
}

export default function App() {
  const transport = useMemo(() => new Transport(), []);
  const allSources = useMemo(() => musicSources(), []);
  const { settings, update } = useSettings();
  const { accounts, setAccount } = useAccounts();
  const { profiles, setProfile } = useProfiles();
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const [view, setView] = useState<"playing" | "settings">("playing");
  const [source, setSource] = useState<MusicSource>(neteaseSource);
  const [track, setTrack] = useState<Track>(PLACEHOLDER);
  const [queue, setQueue] = useState<Track[]>([]);
  const [localCount, setLocalCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [searchSource, setSearchSource] = useState<MusicSource | null>(null);
  const [login, setLogin] = useState<{ id: string; after?: MusicSource } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [vinylColors, setVinylColors] = useState<string[]>([]);
  const openToken = useRef(0);

  const sources = useMemo(() => {
    const shown = allSources.filter((item) => settings.enabled[item.id] !== false);
    return shown.length ? shown : allSources;
  }, [allSources, settings.enabled]);

  const load = useCallback(
    async (next: Track, from: MusicSource, remember = true): Promise<boolean> => {
      const token = ++openToken.current;
      transport.pause();
      setPlaying(false);
      setTime(0);
      setReady(false);
      setTrack(next);
      setSource(from);
      setDuration(next.duration);
      setProblem(null);
      try {
        // Words first: they arrive quickly and the stage can fill while the
        // audio is still being fetched.
        if (from.lyrics && !next.lines.length) {
          const lines = await from.lyrics(next).catch(() => next.lines);
          if (token !== openToken.current) return false;
          if (lines.length) setTrack({ ...next, lines });
        }
        const stream = await from.stream(next, { cookie: accountsRef.current[from.id] });
        if (token !== openToken.current) return false;
        await transport.load(stream.audio, next.duration);
        if (token !== openToken.current) return false;
        setDuration(transport.duration || next.duration);
        setReady(true);
        if (remember) writeLast(from.id, next);
        return true;
      } catch (error) {
        if (token !== openToken.current) return false;
        console.error("could not open the track", error);
        setProblem(
          typeof error === "string" ? error : error instanceof Error ? error.message : "打不开这首歌",
        );
        setReady(false);
        return false;
      }
    },
    [transport],
  );

  useEffect(() => {
    transport.onEnded = () => {
      setPlaying(false);
      setTime(transport.duration);
    };
    transport.onError = (message) => setProblem(message);

    // Open on the last side, then on a real song, and only fall back to the
    // chart when nothing else is reachable.
    let alive = true;
    const boot = async () => {
      const last = readLast();
      const from = last && allSources.find((item) => item.id === last.sourceId && item.id !== "local");
      if (last && from && (await load(last.track, from, false))) return;
      // In a browser there is no signed request and no cached audio, so the
      // page opens on the built-in side instead of an error.
      if (inTauri()) {
        try {
          // The hot chart: real songs, covers and lyrics, and more than one
          // candidate so a member-only track does not leave the platter empty.
          const chart = (await neteaseSource.chart?.(6)) ?? [];
          // One attempt only: a burst of fallbacks is what gets the address
          // rate limited in the first place.
          const first = chart[0];
          if (!alive) return;
          if (first && (await load(first, neteaseSource, false))) return;
        } catch {
          // no network, or NetEase is holding us off
        }
      }
    };
    void boot();
    return () => {
      alive = false;
      transport.dispose();
    };
  }, [allSources, load, transport]);

  useEffect(() => {
    transport.setVolume(settings.volume);
  }, [settings.volume, transport]);

  // Each cover presses its own colour into the vinyl.
  useEffect(() => {
    if (!track.artwork) {
      setVinylColors([]);
      return;
    }
    let alive = true;
    void invoke<{ colors: string[] }>("cover_palette", { url: track.artwork })
      .then((answer) => alive && setVinylColors(answer.colors))
      .catch(() => alive && setVinylColors([]));
    return () => {
      alive = false;
    };
  }, [track.artwork]);

  // A stored cookie is enough to ask who it belongs to.
  useEffect(() => {
    if (!inTauri()) return;
    const commands: Record<string, string> = {
      netease: "netease_profile",
      qq: "qq_profile",
      qishui: "qishui_profile",
    };
    for (const [id, command] of Object.entries(commands)) {
      const cookie = accounts[id];
      if (!cookie || profiles[id]) continue;
      void invoke<{ name: string; avatar?: string }>(command, { cookie })
        .then((who) => setProfile(id, { name: who.name, avatar: who.avatar || undefined }))
        .catch(() => undefined);
    }
  }, [accounts, profiles, setProfile]);

  // A transient failure is a toast, not a permanent line over the words.
  useEffect(() => {
    if (!problem) return;
    const timer = window.setTimeout(() => setProblem(null), 8000);
    return () => window.clearTimeout(timer);
  }, [problem]);

  // A click while the side is still being fetched leaves the needle down.
  const wantsPlay = useRef(false);

  const toggle = useCallback(async () => {
    if (playing) {
      transport.pause();
      wantsPlay.current = false;
      setPlaying(false);
      setTime(transport.time);
      return;
    }
    if (!ready) {
      wantsPlay.current = true;
      return;
    }
    await transport.play();
    setPlaying(transport.isPlaying);
  }, [playing, ready, transport]);

  useEffect(() => {
    if (!ready || !wantsPlay.current) return;
    wantsPlay.current = false;
    void transport.play().then(() => setPlaying(transport.isPlaying));
  }, [ready, transport]);

  // Only once, after the first side has been prepared.
  const autoplayed = useRef(false);
  useEffect(() => {
    if (!settings.autoplay || !ready || autoplayed.current) return;
    autoplayed.current = true;
    void toggle();
  }, [settings.autoplay, ready, toggle]);

  const seek = useCallback(
    (seconds: number) => {
      transport.seek(seconds);
      setTime(transport.time);
    },
    [transport],
  );

  // One frame per screen refresh while the platter turns.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      setTime(transport.time);
      if (transport.duration && transport.duration !== duration) setDuration(transport.duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, transport]);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!queue.length) return;
      const index = queue.findIndex((item) => item.id === track.id);
      const next = queue[(index + direction + queue.length) % queue.length];
      void load(next, source);
    },
    [load, queue, source, track.id],
  );

  // Duration of a local file only arrives with its metadata.
  useEffect(() => {
    if (!track || track.duration > 0) return;
    const timer = window.setInterval(() => {
      if (transport.duration > 0) setDuration(transport.duration);
    }, 400);
    return () => window.clearInterval(timer);
  }, [track, transport]);

  const openFiles = useCallback(async () => {
    const added = await pickFiles();
    if (!added.length) return;
    const list = await localSource.tracks();
    setQueue(list);
    setLocalCount(list.length);
    setView("playing");
    void load(added[0], localSource);
  }, [load]);

  const pickSource = useCallback(
    async (next: MusicSource) => {
      if (next.can("search")) {
        // Both of these only hand out audio to a signed-in listener; the QR
        // panel runs the same protocol the official apps do.
        if (["netease", "qq", "qishui"].includes(next.id) && !accountsRef.current[next.id] && inTauri()) {
          setLogin({ id: next.id, after: next });
          return;
        }
        setSearchSource(next);
        return;
      }
      if (next.id === "local") {
        let list = await localSource.tracks();
        if (!list.length) {
          const added = await pickFiles();
          if (!added.length) return;
          list = await localSource.tracks();
        }
        setQueue(list);
        setLocalCount(list.length);
        setView("playing");
        void load(list[0], next);
        return;
      }
      setQueue(await next.tracks());
      setView("playing");
      void load((await next.tracks())[0], next);
    },
    [load],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setView((current) => (current === "settings" ? "playing" : "settings"));
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        window.location.reload();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchSource(neteaseSource);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openFiles();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape" && view === "settings" && !searchSource) {
        setView("playing");
        return;
      }
      if (target?.isContentEditable) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target?.getAttribute("role") === "slider") return;

      if (event.code === "Space") {
        if (target instanceof HTMLButtonElement) return;
        event.preventDefault();
        void toggle();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(Math.min(duration, time + 5));
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(Math.max(0, time - 5));
      }
      if (event.key.toLowerCase() === "n") step(1);
      if (event.key.toLowerCase() === "p") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek, step, openFiles, time, duration, view, searchSource]);

  const progress = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;

  const palette = searchSource ? (
    <SearchPanel
      source={searchSource}
      onClose={() => setSearchSource(null)}
      onPick={(next, hits) => {
        setSearchSource(null);
        setView("playing");
        setQueue(hits);
        void load(next, searchSource);
      }}
    />
  ) : null;

  const loginPanel = login ? (
    <LoginPanel
      service={login.id as "netease" | "qq" | "qishui"}
      onClose={() => setLogin(null)}
      onDone={(cookie) => {
        setAccount(login.id, cookie);
        accountsRef.current = { ...accountsRef.current, [login.id]: cookie };
        const command = {
          netease: "netease_profile",
          qq: "qq_profile",
          qishui: "qishui_profile",
        }[login.id];
        if (command) {
          void invoke<{ name: string; avatar?: string }>(command, { cookie })
            .then((who) => setProfile(login.id, { name: who.name, avatar: who.avatar || undefined }))
            .catch(() => undefined);
        }
        if (login.after) setSearchSource(login.after);
        setLogin(null);
      }}
    />
  ) : null;

  if (view === "settings") {
    return (
      <>
        <SettingsView
          settings={settings}
          volume={settings.volume}
          sources={allSources}
          localCount={localCount}
          current={track}
          playing={playing}
          onChange={update}
          accounts={accounts}
          onAccount={setAccount}
          onLogin={(service) => setLogin({ id: service })}
          onClose={() => setView("playing")}
          onSearch={(next) => setSearchSource(next)}
          onOpenFiles={openFiles}
          onPlaySource={pickSource}
          onToggle={toggle}
        />
        {palette}
        {loginPanel}
      </>
    );
  }

  return (
    <>
      <main
        className="player"
        data-playing={playing}
        data-dropping={dropping}
        data-blur={settings.neighborBlur ? "on" : "off"}
        data-highlight={settings.highlight}
        style={
          {
            "--lyric-scale": settings.lyricScale,
            "--album-a": vinylColors[0] ?? "var(--ember)",
            "--album-b": vinylColors[1] ?? "var(--ember)",
          } as CSSProperties
        }
        onDragOver={(event) => {
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDropping(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          const added = adoptBrowserFiles(Array.from(event.dataTransfer.files ?? []));
          if (!added.length) return;
          void localSource.tracks().then((list) => {
            setQueue(list);
            setLocalCount(list.length);
          });
          void load(added[0], localSource);
        }}
      >
        <div className="titlebar" data-tauri-drag-region />

        {track.artwork && (
          <div
            className="backdrop"
            aria-hidden
            style={{ backgroundImage: `url("${track.artwork}")` }}
          />
        )}

        <RecordDeck
          playing={playing}
          progress={progress}
          onToggle={toggle}
          title={track.title}
          artwork={settings.label === "art" ? track.artwork : undefined}
          spin={settings.spin}
        />

        <header className="meta">
          {profiles[source.id] && (
            <span className="meta__me">
              {profiles[source.id].avatar && <img src={profiles[source.id].avatar} alt="" />}
              <span>{profiles[source.id].name}</span>
            </span>
          )}
          <SourceMenu
            sources={sources}
            activeId={source.id}
            onPick={pickSource}
            onOpenFiles={openFiles}
            onSearch={() => setSearchSource(neteaseSource)}
          />
        </header>

        <div className="stage">
          <ChordLane track={track} time={time} />
        </div>

        <TransportBar
          track={track}
          volume={settings.volume}
          onVolume={(value) => update({ volume: value })}
          playing={playing}
          time={time}
          duration={duration}
          ready={ready}
          onToggle={toggle}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onSeek={seek}
          onOpenSettings={() => setView("settings")}
        />

        {!ready && !problem && (
          <div className="notice">
            {source.can("search") ? `Fetching from ${source.name}` : "Cutting the lacquer"}
          </div>
        )}
        {problem && <div className="notice notice--problem">{problem}</div>}

        {dropping && <div className="dropzone" aria-hidden />}
      </main>
      {palette}
      {loginPanel}
    </>
  );
}

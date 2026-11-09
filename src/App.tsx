import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ChordLane } from "./components/ChordLane";
import { RecordDeck } from "./components/RecordDeck";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsView } from "./components/SettingsView";
import { SourceMenu } from "./components/SourceMenu";
import { TransportBar } from "./components/TransportBar";
import { Transport } from "./audio/transport";
import { buildSession } from "./music/session";
import type { MusicSource, Track } from "./music/types";
import { useAccounts } from "./accounts";
import { useSettings } from "./settings";
import { adoptBrowserFiles, inTauri, localSource, pickFiles } from "./sources/local";
import { neteaseSource } from "./sources/netease";
import { sessionSource } from "./sources/session";
import { musicSources } from "./sources";

const SESSION = buildSession();
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
  const session = useMemo(() => sessionSource(SESSION), []);
  const allSources = useMemo(() => musicSources(session), [session]);
  const { settings, update } = useSettings();
  const { accounts, setAccount } = useAccounts();
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const [view, setView] = useState<"playing" | "settings">("playing");
  const [source, setSource] = useState<MusicSource>(session);
  const [track, setTrack] = useState<Track>(SESSION);
  const [queue, setQueue] = useState<Track[]>([SESSION]);
  const [localCount, setLocalCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(SESSION.duration);
  const [dropping, setDropping] = useState(false);
  const [searchSource, setSearchSource] = useState<MusicSource | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
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
    // built-in session when neither is reachable.
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
          for (const candidate of chart.slice(0, 3)) {
            if (!alive) return;
            if (await load(candidate, neteaseSource, false)) return;
          }
        } catch {
          // no network, or NetEase is holding us off; the session still plays
        }
      }
      if (alive) await load(SESSION, session, false);
    };
    void boot();
    return () => {
      alive = false;
      transport.dispose();
    };
  }, [allSources, load, session, transport]);

  useEffect(() => {
    transport.setVolume(settings.volume);
  }, [settings.volume, transport]);

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
      void load(SESSION, next);
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
          onClose={() => setView("playing")}
          onSearch={(next) => setSearchSource(next)}
          onOpenFiles={openFiles}
          onPlaySource={pickSource}
          onToggle={toggle}
        />
        {palette}
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
        style={{ "--lyric-scale": settings.lyricScale } as CSSProperties}
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

        <RecordDeck
          playing={playing}
          progress={progress}
          onToggle={toggle}
          title={track.title}
          artwork={settings.label === "art" ? track.artwork : undefined}
          spin={settings.spin}
        />

        <header className="meta">
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
    </>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChordLane } from "./components/ChordLane";
import { RecordDeck } from "./components/RecordDeck";
import { LibraryDrawer } from "./components/LibraryDrawer";
import { LoginPanel } from "./components/LoginPanel";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsView } from "./components/SettingsView";
import { SourceMenu } from "./components/SourceMenu";
import { TransportBar } from "./components/TransportBar";
import { Transport } from "./audio/transport";
import { linesOf, streamOf, warmAhead } from "./audio/prefetch";
import type { MusicSource, Track } from "./music/types";
import { invoke } from "@tauri-apps/api/core";
import { useAccounts, useProfiles } from "./accounts";
import { runUpdate, type UpdateState } from "./updater";
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

/**
 * A change of side turns the sheet over: what was on the platter leaves the way
 * the hand went, and the next one follows it in.
 */
const pageMotion = {
  enter: (direction: number) => ({ y: direction * 58, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (direction: number) => ({ y: direction * -58, opacity: 0 }),
};

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
  const [selectedId, setSelectedId] = useState("netease");
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
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [turn, setTurn] = useState(1);
  const [updateNote, setUpdateNote] = useState<string | null>(null);

  // One quiet check per launch; a newer release installs itself and restarts.
  useEffect(() => {
    if (!inTauri()) return;
    const timer = window.setTimeout(() => {
      void runUpdate((state: UpdateState, version?: string) => {
        if (state === "downloading") setUpdateNote(`Updating to ${version ?? "a new release"}…`);
        if (state === "ready") setUpdateNote("Restarting into the new release…");
        if (state === "none" || state === "error") setUpdateNote(null);
      });
    }, 4000);
    return () => window.clearTimeout(timer);
  }, []);
  const [problem, setProblem] = useState<string | null>(null);
  const [vinylColors, setVinylColors] = useState<string[]>([]);
  const openToken = useRef(0);

  const sources = useMemo(() => {
    const shown = allSources.filter((item) => settings.enabled[item.id] !== false);
    return shown.length ? shown : allSources;
  }, [allSources, settings.enabled]);

  const load = useCallback(
    async (next: Track, from: MusicSource, remember = true, play = false): Promise<boolean> => {
      const token = ++openToken.current;
      transport.pause();
      setPlaying(false);
      setTime(0);
      setReady(false);
      setTrack(next);
      setSource(from);
      setSelectedId(from.id);
      setDuration(next.duration);
      setProblem(null);
      try {
        // The words and the audio are asked for at once. The sheet fills the
        // stage as soon as it lands, and the download no longer waits behind
        // the lyric round trip first.
        const opening = streamOf(from, next, accountsRef.current[from.id]);
        if (from.lyrics && !next.lines.length) {
          void linesOf(from, next)
            .then((lines) => {
              if (!lines.length || token !== openToken.current) return;
              setTrack((current) => (current.id === next.id ? { ...current, lines } : current));
            })
            .catch(() => undefined);
        }
        const stream = await opening;
        if (token !== openToken.current) return false;
        await transport.load(stream.audio, next.duration);
        if (token !== openToken.current) return false;
        setDuration(transport.duration || next.duration);
        setReady(true);
        if (remember) writeLast(from.id, next);
        if (play) {
          await transport.play();
          setPlaying(transport.isPlaying);
        }
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

  // The queue moves on by itself when a side ends; the callbacks read the
  // newest queue through refs so they never advance to a stale track.
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const stepRef = useRef<(direction: 1 | -1) => void>(() => undefined);

  useEffect(() => {
    transport.onEnded = () => {
      setTime(transport.duration);
      if (queueRef.current.length > 1) {
        stepRef.current(1);
      } else {
        setPlaying(false);
      }
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
          if (first && (await load(first, neteaseSource, false))) {
            // The rest of the chart becomes the queue, so the sides after
            // this one can be warmed and "next" needs no download.
            if (alive) setQueue(chart);
            return;
          }
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
      setTurn(direction);
      void load(next, source, true, true);
    },
    [load, queue, source, track.id],
  );

  stepRef.current = step;

  const player = useRef<HTMLElement | null>(null);
  const wheel = useRef({ sum: 0, at: 0, until: 0, armed: true });

  // A wheel or a trackpad flick moves through the queue, one side per gesture:
  // the travel is gathered until the hand clearly means it, and the momentum
  // that follows is read as the same gesture, not a second request.
  useEffect(() => {
    const element = player.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[role='slider'], input, textarea, .drawer")) return;

      const delta =
        event.deltaMode === 1
          ? event.deltaY * 18
          : event.deltaMode === 2
            ? event.deltaY * 480
            : event.deltaY;
      if (!delta) return;

      const now = performance.now();
      const gate = wheel.current;
      // A pause is the end of one gesture and the start of the next.
      if (now - gate.at > 220) {
        gate.sum = 0;
        gate.armed = true;
      }
      gate.at = now;
      if (!gate.armed || now < gate.until) return;

      if (delta * gate.sum < 0) gate.sum = 0;
      gate.sum += delta;
      if (Math.abs(gate.sum) < 52) return;

      const direction = gate.sum > 0 ? 1 : -1;
      gate.sum = 0;
      gate.armed = false;
      gate.until = now + 320;
      event.preventDefault();
      stepRef.current(direction);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [view]);

  // Warm the sides either side of the one on the platter, so "next" is a
  // local file read instead of a download.
  useEffect(() => {
    if (!ready || queue.length < 2) return;
    const index = queue.findIndex((item) => item.id === track.id);
    if (index < 0) return;

    const seen = new Set<string>([track.id]);
    const around: Track[] = [];
    for (const offset of [1, 2, -1]) {
      const item = queue[(index + offset + queue.length) % queue.length];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      around.push(item);
    }
    if (!around.length) return;

    let alive = true;
    // A beat of quiet first: the side on the platter settles before its
    // neighbours start using the line.
    const timer = window.setTimeout(() => {
      void warmAhead(source, around, accountsRef.current[source.id], () => alive);
    }, 1500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [ready, queue, track.id, source]);

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
      setSelectedId(next.id);
      if (next.can("search")) {
        // Both of these only hand out audio to a signed-in listener; the QR
        // panel runs the same protocol the official apps do.
        if (["netease", "qq"].includes(next.id) && !accountsRef.current[next.id] && inTauri()) {
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
  const empty = track.id === "nothing";

  const palette = searchSource ? (
    <SearchPanel
      source={searchSource}
      onClose={() => setSearchSource(null)}
      onPick={(next, hits) => {
        setSearchSource(null);
        setView("playing");
        setQueue(hits);
        void load(next, searchSource, true, true);
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
        ref={player}
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

        {!empty && (
        <RecordDeck
          playing={playing}
          progress={progress}
          onToggle={toggle}
          title={track.title}
          artwork={settings.label === "art" ? track.artwork : undefined}
          palette={vinylColors}
          spin={settings.spin}
        />
        )}

        <header className="meta">
          <button
            type="button"
            className="library-open"
            aria-label="Library"
            onClick={() => setLibraryOpen(true)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M4 7h11M4 12h11M4 17h7" strokeLinecap="round" />
              <path d="M17.5 9.5v8.2a1.9 1.9 0 1 1-1.6-1.9V7l4-1v3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {profiles[selectedId] ? (
            <span className="meta__me">
              {profiles[selectedId].avatar && <img src={profiles[selectedId].avatar} alt="" />}
              <span>{profiles[selectedId].name}</span>
            </span>
          ) : (
            ["netease", "qq", "qishui"].includes(selectedId) && (
              <button
                type="button"
                className="meta__signin"
                onClick={() => setLogin({ id: selectedId })}
              >
                未登录
              </button>
            )
          )}
          <SourceMenu
            sources={sources}
            activeId={selectedId}
            onPick={pickSource}
            onOpenFiles={openFiles}
            onSearch={() => setSearchSource(neteaseSource)}
          />
        </header>

        {empty ? (
          <div className="empty">
            <p className="empty__title">Choose a source</p>
            <p className="empty__hint">⌘K to search · the menu at the top right switches sources</p>
          </div>
        ) : (
          <AnimatePresence custom={turn} initial={false}>
            <motion.div
              key={track.id}
              className="stage"
              custom={turn}
              variants={pageMotion}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 240, damping: 30, mass: 0.9 }}
            >
              <ChordLane track={track} time={time} curve={settings.curve} tilt={settings.lyricTilt} />
            </motion.div>
          </AnimatePresence>
        )}

        {!empty && (
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
        )}

        {!empty && !ready && !problem && (
          <div className="notice">
            {source.can("search") ? `Fetching from ${source.name}` : "Cutting the lacquer"}
          </div>
        )}
        {!empty && problem && <div className="notice notice--problem">{problem}</div>}
        {updateNote && <div className="notice">{updateNote}</div>}

        {dropping && <div className="dropzone" aria-hidden />}
      </main>
      {palette}
      {loginPanel}
      <LibraryDrawer
        open={libraryOpen}
        cookie={accounts[selectedId]}
        sourceId={selectedId}
        profile={profiles[selectedId]}
        onClose={() => setLibraryOpen(false)}
        onPlay={(tracks, index, sourceId) => {
          const from = allSources.find((item) => item.id === sourceId) ?? neteaseSource;
          setQueue(tracks);
          void load(tracks[index], from, true, true);
          setLibraryOpen(false);
        }}
      />
    </>
  );
}

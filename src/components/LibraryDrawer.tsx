import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { clock } from "../music/notes";
import type { Track } from "../music/types";

type Shelf = {
  id: number;
  name: string;
  cover: string;
  count: number;
  note?: string;
  mine?: boolean;
  liked?: boolean;
  source: "netease" | "qq";
};

type Answer = { user: { id: string; name: string; avatar: string }; playlists: Shelf[] };
type Row = {
  id: number | string;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  media?: string;
};

type Props = {
  open: boolean;
  cookie?: string;
  onClose: () => void;
  onPlay: (tracks: Track[], index: number, sourceId: string) => void;
};

const asTrack = (row: Row, source: "netease" | "qq"): Track => ({
  id: `${source === "qq" ? "qq" : "ne"}-${row.id}`,
  title: row.name,
  artist: row.artist || (source === "qq" ? "QQ 音乐" : "网易云音乐"),
  album: row.album,
  duration: (row.duration || 0) / 1000,
  kind: "words",
  lines: [],
  artwork: row.cover ? row.cover.replace(/^http:\/\//, "https://") : undefined,
  mediaMid: row.media,
  sourceId: source,
});

export function LibraryDrawer({ open, cookie, onClose, onPlay }: Props) {
  const [data, setData] = useState<Answer | null>(null);
  const [charts, setCharts] = useState<Shelf[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [shelf, setShelf] = useState<{ name: string; tracks: Track[]; source: "netease" | "qq" } | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);

    void invoke<{ charts: Shelf[] }>("netease_charts")
      .then((answer) => alive && setCharts((current) => [...current.filter((c) => c.source !== "netease"), ...answer.charts]))
      .catch(() => undefined);
    void invoke<{ charts: Shelf[] }>("qq_charts")
      .then((answer) => alive && setCharts((current) => [...current.filter((c) => c.source !== "qq"), ...answer.charts]))
      .catch(() => undefined);

    if (cookie) {
      void invoke<Answer>("netease_library", { cookie })
        .then((answer) => alive && setData(answer))
        .catch((problem) => {
          if (alive) setError(typeof problem === "string" ? problem : "读取歌单失败");
        });
    }
    return () => {
      alive = false;
    };
  }, [open, cookie]);

  const openShelf = async (item: Shelf) => {
    if (item.source === "qq" || !cookie) {
      if (item.source !== "qq") return;
    }
    setBusy(item.id);
    setError(null);
    try {
      const answer =
        item.source === "qq"
          ? await invoke<{ name: string; tracks: Row[] }>("qq_chart", { id: String(item.id) })
          : await invoke<{ name: string; tracks: Row[] }>("netease_playlist", {
              cookie,
              id: String(item.id),
            });
      setShelf({
        name: answer.name || item.name,
        source: item.source,
        tracks: answer.tracks.map((row) => asTrack(row, item.source)),
      });
    } catch (problem) {
      setError(typeof problem === "string" ? problem : "打不开这个歌单");
    } finally {
      setBusy(null);
    }
  };

  const shelves = (data?.playlists ?? [])
    .map((item) => ({ ...item, source: "netease" as const }))
    .sort((a, b) => Number(b.liked) - Number(a.liked));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            key="scrim"
            type="button"
            className="drawer__scrim"
            aria-label="关闭"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            key="drawer"
            className="drawer"
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          >
            <header className="drawer__head">
              {shelf ? (
                <button type="button" className="drawer__back" onClick={() => setShelf(null)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M14 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {shelf.name}
                </button>
              ) : (
                <span className="drawer__who">
                  {data?.user.avatar && <img src={data.user.avatar} alt="" />}
                  <span>{data?.user.name || "My library"}</span>
                </span>
              )}
              <button type="button" className="drawer__close" onClick={onClose} aria-label="关闭">
                ✕
              </button>
            </header>

            {error && <p className="drawer__error">{error}</p>}

            {shelf ? (
              <div className="drawer__list">
                {shelf.tracks.map((track, index) => (
                  <button
                    type="button"
                    key={`${track.id}-${index}`}
                    className="song"
                    onClick={() => onPlay(shelf.tracks, index, shelf.source)}
                  >
                    <span className="song__index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="song__text">
                      <span className="song__name">{track.title}</span>
                      <span className="song__meta">{track.artist}</span>
                    </span>
                    <span className="song__time">{clock(track.duration)}</span>
                  </button>
                ))}
                {!shelf.tracks.length && <p className="drawer__note">这个歌单是空的</p>}
              </div>
            ) : (
              <div className="drawer__list">
                {charts.length > 0 && (
                  <>
                    <p className="drawer__section">排行榜</p>
                    {charts.map((item) => (
                      <ShelfRow key={`${item.source}-${item.id}`} item={item} busy={busy} onOpen={openShelf} />
                    ))}
                  </>
                )}

                {shelves.length > 0 && <p className="drawer__section">我的歌单</p>}
                {shelves.map((item) => (
                  <ShelfRow key={`${item.source}-${item.id}`} item={item} busy={busy} onOpen={openShelf} />
                ))}

                {!shelves.length && !charts.length && <p className="drawer__note">读取中…</p>}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function ShelfRow({
  item,
  busy,
  onOpen,
}: {
  item: Shelf;
  busy: number | null;
  onOpen: (item: Shelf) => void;
}) {
  return (
    <button
      type="button"
      className="shelf"
      data-busy={busy === item.id}
      onClick={() => onOpen(item)}
    >
      <span className="shelf__cover">
        {item.cover ? <img src={item.cover.replace(/^http:\/\//, "https://")} alt="" /> : null}
      </span>
      <span className="shelf__text">
        <span className="shelf__name">
          {item.liked && <span className="shelf__heart">♥</span>}
          {item.name}
        </span>
        <span className="shelf__meta">
          {item.liked
            ? "我喜欢的音乐"
            : item.source === "qq"
              ? `QQ 音乐 · ${item.note ?? ""}`
              : item.mine
                ? "我的歌单"
                : item.note || "收藏"}
          {item.count ? ` · ${item.count}` : ""}
        </span>
      </span>
    </button>
  );
}

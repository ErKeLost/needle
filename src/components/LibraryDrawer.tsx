import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../music/types";

type Shelf = {
  id: number;
  name: string;
  cover: string;
  count: number;
  mine: boolean;
  liked: boolean;
};

type Answer = { user: { id: string; name: string; avatar: string }; playlists: Shelf[] };
type Row = { id: number; name: string; artist: string; album: string; cover: string; duration: number };

type Props = {
  open: boolean;
  cookie?: string;
  onClose: () => void;
  onPlay: (tracks: Track[]) => void;
};

const asTrack = (row: Row): Track => ({
  id: `ne-${row.id}`,
  title: row.name,
  artist: row.artist || "网易云音乐",
  album: row.album,
  duration: (row.duration || 0) / 1000,
  kind: "words",
  lines: [],
  artwork: row.cover ? row.cover.replace(/^http:\/\//, "https://") : undefined,
  sourceId: "netease",
});

export function LibraryDrawer({ open, cookie, onClose, onPlay }: Props) {
  const [data, setData] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !cookie) return;
    let alive = true;
    setError(null);
    void invoke<Answer>("netease_library", { cookie })
      .then((answer) => alive && setData(answer))
      .catch((problem) => {
        if (alive) setError(typeof problem === "string" ? problem : "读取歌单失败");
      });
    return () => {
      alive = false;
    };
  }, [open, cookie]);

  const openShelf = async (shelf: Shelf) => {
    if (!cookie) return;
    setBusy(shelf.id);
    try {
      const answer = await invoke<{ tracks: Row[] }>("netease_playlist", {
        cookie,
        id: String(shelf.id),
      });
      if (answer.tracks.length) onPlay(answer.tracks.map(asTrack));
    } catch (problem) {
      setError(typeof problem === "string" ? problem : "打不开这个歌单");
    } finally {
      setBusy(null);
    }
  };

  const shelves = (data?.playlists ?? []).slice().sort((a, b) => Number(b.liked) - Number(a.liked));

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
              <span className="drawer__who">
                {data?.user.avatar && <img src={data.user.avatar} alt="" />}
                <span>{data?.user.name || "My library"}</span>
              </span>
              <button type="button" className="drawer__close" onClick={onClose} aria-label="关闭">
                ✕
              </button>
            </header>

            {error && <p className="drawer__error">{error}</p>}
            {!data && !error && <p className="drawer__note">读取中…</p>}
            {data && !shelves.length && <p className="drawer__note">还没有歌单</p>}

            <div className="drawer__list">
              {shelves.map((shelf) => (
                <button
                  type="button"
                  key={shelf.id}
                  className="shelf"
                  data-busy={busy === shelf.id}
                  onClick={() => openShelf(shelf)}
                >
                  <span className="shelf__cover">
                    {shelf.cover ? <img src={shelf.cover.replace(/^http:\/\//, "https://")} alt="" /> : null}
                  </span>
                  <span className="shelf__text">
                    <span className="shelf__name">
                      {shelf.liked && <span className="shelf__heart">♥</span>}
                      {shelf.name}
                    </span>
                    <span className="shelf__meta">
                      {shelf.liked ? "我喜欢的音乐" : shelf.mine ? "我的歌单" : "收藏"} · {shelf.count} 首
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

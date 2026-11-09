import { useCallback, useEffect, useRef, useState } from "react";
import { clock } from "../music/notes";
import type { MusicSource, Track } from "../music/types";

type Props = {
  source: MusicSource;
  onClose: () => void;
  onPick: (track: Track, queue: Track[]) => void;
};

/** A search over one source, over the record that is already playing. */
export function SearchPanel({ source, onClose, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const asked = useRef(0);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults(null);
      setError(null);
      setBusy(false);
      return;
    }
    const token = ++asked.current;
    setBusy(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const found = await (source.search?.(text) ?? Promise.resolve([]));
        if (token !== asked.current) return;
        setResults(found);
        setCursor(0);
      } catch (problem) {
        if (token !== asked.current) return;
        setResults([]);
        setError(problem instanceof Error ? problem.message : `${source.name}没有回答`);
      } finally {
        if (token === asked.current) setBusy(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query, source]);

  const choose = useCallback(
    (index: number) => {
      if (!results?.length) return;
      onPick(results[index], results);
    },
    [results, onPick],
  );

  return (
    <div className="palette" role="dialog" aria-modal="true" aria-label={`搜索${source.name}`}>
      <button type="button" className="palette__scrim" aria-label="关闭" onClick={onClose} />
      <div className="palette__panel">
        <div className="palette__bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((value) => Math.min((results?.length ?? 1) - 1, value + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((value) => Math.max(0, value - 1));
              }
              if (event.key === "Enter") choose(cursor);
            }}
            placeholder="搜索歌曲、歌手或专辑"
            spellCheck={false}
            aria-label={`搜索${source.name}`}
          />
          <span className="palette__source">{source.name}</span>
        </div>

        <div className="palette__body">
          {!query.trim() && (
            <p className="palette__hint">输入几笔，找一首歌。歌词会跟着唱到的那一句走。</p>
          )}
          {busy && <p className="palette__hint">正在找…</p>}
          {error && <p className="palette__error">{error}</p>}
          {!busy && results?.length === 0 && !error && (
            <p className="palette__hint">没有找到「{query.trim()}」</p>
          )}
          {results?.map((track, index) => (
            <button
              type="button"
              key={track.id}
              className="hit"
              data-active={index === cursor}
              onMouseEnter={() => setCursor(index)}
              onClick={() => choose(index)}
            >
              <span className="hit__cover">
                {track.artwork ? <img src={track.artwork} alt="" loading="lazy" /> : null}
              </span>
              <span className="hit__title">{track.title}</span>
              <span className="hit__meta">
                {track.artist}
                {track.album ? ` · ${track.album}` : ""}
              </span>
              <span className="hit__time">{clock(track.duration)}</span>
            </button>
          ))}
        </div>

        <div className="palette__foot">
          <span>↑↓ 选 · ⏎ 播放 · esc 关</span>
          <span>{source.name} · 仅供个人收听</span>
        </div>
      </div>
    </div>
  );
}

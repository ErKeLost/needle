import { useEffect, useRef, useState } from "react";
import type { MusicSource } from "../music/types";

type Props = {
  sources: MusicSource[];
  activeId: string;
  onPick: (source: MusicSource) => void;
  onOpenFiles: () => void;
  onSearch: () => void;
};

export function SourceMenu({ sources, activeId, onPick, onOpenFiles, onSearch }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const active = sources.find((source) => source.id === activeId) ?? sources[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="source" ref={root}>
      <button
        type="button"
        className="source__button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="source__dot" aria-hidden />
        {active.name}
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden className={open ? "source__chevron is-open" : "source__chevron"}>
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="source__menu" role="menu" aria-label="Source">
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              role="menuitemradio"
              aria-checked={source.id === active.id}
              className="source__item"
              onClick={() => {
                setOpen(false);
                onPick(source);
              }}
            >
              <span>{source.name}</span>
              <em>{source.detail}</em>
            </button>
          ))}
          <div className="source__divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="source__item source__item--action"
            onClick={() => {
              setOpen(false);
              onSearch();
            }}
          >
            <span>Search…</span>
            <em>⌘K</em>
          </button>
          <button
            type="button"
            role="menuitem"
            className="source__item source__item--action"
            onClick={() => {
              setOpen(false);
              onOpenFiles();
            }}
          >
            <span>Open files…</span>
            <em>⌘O</em>
          </button>
        </div>
      )}
    </div>
  );
}

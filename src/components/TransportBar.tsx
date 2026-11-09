import { useCallback, useRef, useState } from "react";
import { clock } from "../music/notes";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "./icons";

type Props = {
  playing: boolean;
  time: number;
  duration: number;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onOpenSettings: () => void;
  ready: boolean;
};

export function TransportBar({
  playing,
  time,
  duration,
  ready,
  onToggle,
  onPrev,
  onNext,
  onSeek,
  onOpenSettings,
}: Props) {
  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <>
    <div className="transport">
      <button type="button" className="control" onClick={onPrev} aria-label="Previous">
        <PrevIcon />
      </button>
      <button
        type="button"
        className="control control--play"
        onClick={onToggle}
        aria-busy={!ready}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button type="button" className="control" onClick={onNext} aria-label="Next">
        <NextIcon />
      </button>
    </div>
    <div className="clock">
      <span className="clock__elapsed">{clock(time)}</span>
      <Scrubber ratio={ratio} duration={duration} onSeek={onSeek} />
      <span className="clock__total">{clock(duration)}</span>
      <button type="button" className="gear" onClick={onOpenSettings} aria-label="Settings">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9c.14.39.48.7.9.85" />
        </svg>
      </button>
    </div>
    </>
  );
}

function Scrubber({ ratio, duration, onSeek }: { ratio: number; duration: number; onSeek: (s: number) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const seekTo = useCallback(
    (clientX: number) => {
      const box = rail.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      const next = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      onSeek(next * duration);
    },
    [duration, onSeek],
  );

  return (
    <div
      ref={rail}
      className="scrub"
      data-dragging={dragging}
      role="slider"
      tabIndex={0}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(ratio * duration)}
      aria-valuetext={`${clock(ratio * duration)} of ${clock(duration)}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        seekTo(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging) seekTo(event.clientX);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onSeek(Math.max(0, ratio * duration - 5));
        if (event.key === "ArrowRight") onSeek(Math.min(duration, ratio * duration + 5));
      }}
    >
      <span className="scrub__rail">
        <span className="scrub__fill" style={{ transform: `scaleX(${ratio})` }} />
        <span className="scrub__dot" style={{ left: `${ratio * 100}%` }} />
      </span>
    </div>
  );
}

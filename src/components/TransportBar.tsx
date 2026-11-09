import { useCallback, useRef, useState } from "react";
import { Button, Tooltip } from "@heroui/react";
import { clock } from "../music/notes";
import type { Track } from "../music/types";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "./icons";

type Props = {
  track: Track;
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  onVolume: (value: number) => void;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onOpenSettings: () => void;
  ready: boolean;
};

/**
 * The bottom of the deck: the side that is playing on the left, the transport
 * and its position in the middle, and the room's controls on the right.
 */
export function TransportBar({
  track,
  playing,
  time,
  duration,
  volume,
  onVolume,
  ready,
  onToggle,
  onPrev,
  onNext,
  onSeek,
  onOpenSettings,
}: Props) {
  return (
    <div className="bar">
      <div className="bar__now">
        <span className="bar__cover" data-empty={!track.artwork}>
          {track.artwork ? <img src={track.artwork} alt="" /> : <span aria-hidden>✳</span>}
        </span>
        <span className="bar__meta">
          <span className="bar__title">{track.title}</span>
          <span className="bar__artist">{track.artist}</span>
        </span>
      </div>

      <div className="bar__center">
        <div className="bar__controls">
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Previous"
            onPress={onPrev}
            className="bar__btn"
          >
            <PrevIcon />
          </Button>
          <Button
            isIconOnly
            variant="ghost"
            aria-label={playing ? "Pause" : "Play"}
            aria-busy={!ready}
            onPress={onToggle}
            className="size-10 min-w-10 text-[var(--paper)] data-[hovered=true]:text-white"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Next"
            onPress={onNext}
            className="bar__btn"
          >
            <NextIcon />
          </Button>
        </div>

        <div className="bar__seek">
          <span className="bar__time">{clock(time)}</span>
          <Seekbar time={time} duration={duration} onSeek={onSeek} />
          <span className="bar__time bar__time--total">{clock(duration)}</span>
        </div>
      </div>

      <div className="bar__right">
        <Button
          isIconOnly
          variant="ghost"
          aria-label={volume > 0 ? "Mute" : "Unmute"}
          onPress={() => onVolume(volume > 0 ? 0 : 0.8)}
          className="size-8 min-w-8 text-[var(--paper-46)] data-[hovered=true]:text-[var(--paper-72)]"
        >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              {volume > 0 ? (
                <>
                  <path d="M4 9v6h4l5 4V5L8 9H4Z" strokeLinejoin="round" />
                  <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" strokeLinecap="round" />
                </>
              ) : (
                <>
                  <path d="M4 9v6h4l5 4V5L8 9H4Z" strokeLinejoin="round" />
                  <path d="M17 9l5 6M22 9l-5 6" strokeLinecap="round" />
                </>
              )}
            </svg>
        </Button>
        <Level value={volume} onChange={onVolume} />
        <Tooltip delay={500}>
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Settings"
            onPress={onOpenSettings}
            className="size-8 min-w-8 text-[var(--paper-46)] data-[hovered=true]:text-[var(--paper-72)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <circle cx="12" cy="12" r="3.1" />
              <path d="M12 3.6v2.2M12 18.2v2.2M20.4 12h-2.2M5.8 12H3.6M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" strokeLinecap="round" />
            </svg>
          </Button>
          <Tooltip.Content>Settings</Tooltip.Content>
        </Tooltip>
      </div>
    </div>
  );
}

type SeekbarProps = {
  time: number;
  duration: number;
  onSeek: (seconds: number) => void;
};

/** Hand-written position: a hairline that thickens under the hand. */
function Seekbar({ time, duration, onSeek }: SeekbarProps) {
  const rail = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useState(false);
  const ratio = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;

  const seekTo = useCallback(
    (clientX: number) => {
      const box = rail.current?.getBoundingClientRect();
      if (!box || box.width === 0 || !duration) return;
      const next = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      onSeek(next * duration);
    },
    [duration, onSeek],
  );

  return (
    <span
      ref={rail}
      className="seek"
      data-dragging={dragging}
      role="slider"
      tabIndex={0}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${clock(time)} of ${clock(duration)}`}
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
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onSeek(Math.max(0, time - 5));
        if (event.key === "ArrowRight") onSeek(Math.min(duration, time + 5));
      }}
    >
      <span className="seek__rail">
        <span className="seek__fill" style={{ transform: `scaleX(${ratio})` }} />
        <span className="seek__head" style={{ left: `${ratio * 100}%` }} />
      </span>
    </span>
  );
}

/** The room's level: the same hairline as the position, at a smaller size. */
function Level({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const rail = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useState(false);

  const set = (clientX: number) => {
    const box = rail.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    onChange(Math.min(1, Math.max(0, (clientX - box.left) / box.width)));
  };

  return (
    <span
      ref={rail}
      className="level"
      data-dragging={dragging}
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        set(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging) set(event.clientX);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onChange(Math.max(0, value - 0.05));
        if (event.key === "ArrowRight") onChange(Math.min(1, value + 0.05));
      }}
    >
      <span className="level__rail">
        <span className="level__fill" style={{ transform: `scaleX(${value})` }} />
        <span className="level__head" style={{ left: `${value * 100}%` }} />
      </span>
    </span>
  );
}

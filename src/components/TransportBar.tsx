import { Button, Slider, Tooltip } from "@heroui/react";
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
  const value = Math.min(time, duration || 0);

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
          <Slider
            aria-label="Position"
            className="w-full"
            value={value}
            onChange={(next) => onSeek(Number(next))}
            minValue={0}
            maxValue={Math.max(duration, 1)}
            step={0.5}
          >
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>
          <span className="bar__time bar__time--total">{clock(duration)}</span>
        </div>
      </div>

      <div className="bar__right">
        <Tooltip delay={500}>
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Mute"
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
          <Tooltip.Content>{volume > 0 ? "Mute" : "Unmute"}</Tooltip.Content>
        </Tooltip>
        <Slider
          aria-label="Volume"
          className="w-24"
          minValue={0}
          maxValue={100}
          value={Math.round(volume * 100)}
          onChange={(next) => onVolume(Number(next) / 100)}
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
        <Tooltip delay={500}>
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Settings"
            onPress={onOpenSettings}
            className="size-8 min-w-8 text-[var(--paper-46)] data-[hovered=true]:text-[var(--paper-72)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
              <circle cx="9" cy="6" r="1.6" fill="var(--ink)" />
              <circle cx="15" cy="12" r="1.6" fill="var(--ink)" />
              <circle cx="8" cy="18" r="1.6" fill="var(--ink)" />
            </svg>
          </Button>
          <Tooltip.Content>Settings</Tooltip.Content>
        </Tooltip>
      </div>
    </div>
  );
}

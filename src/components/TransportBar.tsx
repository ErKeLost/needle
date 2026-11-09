import { Button, Slider, Tooltip } from "@heroui/react";
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
  const value = Math.min(time, duration || 0);

  return (
    <>
      <div className="transport">
        <Tooltip delay={500}>
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Previous"
            onPress={onPrev}
            className="size-9 min-w-9 text-[var(--paper-46)] data-[hovered=true]:text-[var(--paper)]"
          >
            <PrevIcon />
          </Button>
          <Tooltip.Content>Previous</Tooltip.Content>
        </Tooltip>

        <Tooltip delay={500}>
          <Button
            isIconOnly
            variant="outline"
            aria-label={playing ? "Pause" : "Play"}
            aria-busy={!ready}
            onPress={onToggle}
            className="mx-2 size-12 min-w-12 rounded-full border-[color:var(--paper-30)] text-[var(--paper)]"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Tooltip.Content>{playing ? "Pause" : "Play"}</Tooltip.Content>
        </Tooltip>

        <Tooltip delay={500}>
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Next"
            onPress={onNext}
            className="size-9 min-w-9 text-[var(--paper-46)] data-[hovered=true]:text-[var(--paper)]"
          >
            <NextIcon />
          </Button>
          <Tooltip.Content>Next</Tooltip.Content>
        </Tooltip>
      </div>

      <div className="clock">
        <span className="clock__elapsed">{clock(time)}</span>
        <Slider
          aria-label="Position"
          className="w-32"
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
        <span className="clock__total">{clock(duration)}</span>
        <Tooltip delay={500}>
          <Button
            isIconOnly
            variant="ghost"
            aria-label="Settings"
            onPress={onOpenSettings}
            className="size-7 min-w-7 text-[var(--paper-30)] data-[hovered=true]:text-[var(--paper-72)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9c.14.39.48.7.9.85" />
            </svg>
          </Button>
          <Tooltip.Content>Settings</Tooltip.Content>
        </Tooltip>
      </div>
    </>
  );
}

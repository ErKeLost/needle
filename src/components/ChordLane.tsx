import type { CSSProperties } from "react";
import { useLayoutEffect, useRef } from "react";
import type { StageLine, Token, Track } from "../music/types";

type Props = {
  track: Track;
  time: number;
};

const LINES_ABOVE = 3;
const LINES_BELOW = 3;

function activeIndex(lines: StageLine[], time: number): number {
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    if (time >= lines[i].at) index = i;
    else break;
  }
  return index;
}

function stateOf(token: Token, time: number): "past" | "on" | "next" {
  if (time >= token.at + token.dur) return "past";
  if (time >= token.at) return "on";
  return "next";
}

export function ChordLane({ track, time }: Props) {
  if (!track.lines.length) {
    return (
      <div className="lane lane--empty">
        <p className="lane__empty-title">No lyric sheet</p>
        <p className="lane__empty-note">This file came without an .lrc beside it</p>
      </div>
    );
  }

  const current = activeIndex(track.lines, time);
  const rows: { distance: number; line: StageLine }[] = [];
  for (let d = -LINES_ABOVE; d <= LINES_BELOW; d++) {
    const line = track.lines[current + d];
    if (line) rows.push({ distance: d, line });
  }

  return (
    <div className={`lane lane--${track.kind}`}>
      {rows.map(({ distance, line }) => (
        <LaneRow key={line.at} line={line} distance={distance} time={time} kind={track.kind} />
      ))}
    </div>
  );
}

function LaneRow({
  line,
  distance,
  time,
  kind,
}: {
  line: StageLine;
  distance: number;
  time: number;
  kind: Track["kind"];
}) {
  const tokens = useRef<HTMLDivElement>(null);
  const isCurrent = distance === 0;

  // A line of chords can run past the stage; long ones set smaller until they
  // fit rather than spilling off the window.
  useLayoutEffect(() => {
    const element = tokens.current;
    const cell = element?.parentElement;
    if (!element || !cell) return;

    const fit = () => {
      element.style.fontSize = "";
      const available = element.clientWidth;
      const needed = element.scrollWidth;
      if (needed > available + 1) {
        element.style.fontSize = `${Math.max(52, (available / needed) * 100)}%`;
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(cell);
    return () => observer.disconnect();
  }, [line]);

  return (
    <div
      className={`lane__row${isCurrent ? " is-current" : ""}`}
      data-distance={Math.abs(distance)}
      style={{ "--d": distance } as CSSProperties}
      aria-hidden={!isCurrent}
    >
      <span className="lane__section">{line.section ?? ""}</span>
      <div className="lane__tokens" ref={tokens}>
        {line.tokens.map((token, i) => (
          <TokenView
            key={`${line.at}-${i}`}
            token={token}
            time={time}
            kind={kind}
            current={isCurrent}
          />
        ))}
      </div>
    </div>
  );
}

function TokenView({
  token,
  time,
  kind,
  current,
}: {
  token: Token;
  time: number;
  kind: Track["kind"];
  current: boolean;
}) {
  const state = current ? stateOf(token, time) : "next";

  if (token.rest) {
    return <span className={`token token--rest is-${state}`}>–</span>;
  }

  if (token.word) {
    return (
      <span className={`token token--word is-${state}`}>
        {token.word}
        {state === "on" && <span className="cue" aria-hidden />}
      </span>
    );
  }

  const grouped = token.notes.length > 1;
  return (
    <span className={`token is-${state}${grouped ? " token--group" : ""}`}>
      {grouped && <span className="bracket">[</span>}
      {token.notes.map((note, i) => (
        <span
          key={note + i}
          className={`note heat-${i === 0 ? "violet" : (token.heat ?? "gold")}${state === "on" ? " is-on" : ""}`}
        >
          {note}
        </span>
      ))}
      {grouped && <span className="bracket">]</span>}
      {state === "on" && kind === "notes" && <span className="cue" aria-hidden />}
    </span>
  );
}

import type { CSSProperties } from "react";
import { useLayoutEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
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

const rowMotion = {
  type: "spring" as const,
  stiffness: 110,
  damping: 21,
  mass: 0.9,
};

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
        <LaneRow key={line.at} line={line} distance={distance} time={time} />
      ))}
    </div>
  );
}

function LaneRow({
  line,
  distance,
  time,
}: {
  line: StageLine;
  distance: number;
  time: number;
}) {
  const tokens = useRef<HTMLDivElement>(null);
  const calm = useReducedMotion();
  const isCurrent = distance === 0;
  const depth = Math.abs(distance);

  useLayoutEffect(() => {
    const element = tokens.current;
    const cell = element?.parentElement;
    if (!element || !cell) return;

    const fit = () => {
      element.style.fontSize = "";
      element.style.transform = "";
      const available = element.clientWidth;
      const needed = element.scrollWidth;
      if (needed > available + 1) {
        // Font-size first, so the line keeps its weight; a squeeze only if the
        // words are still wider than the stage at the smallest size.
        element.style.fontSize = `${Math.max(52, (available / needed) * 100)}%`;
        const after = element.scrollWidth;
        if (after > available + 1) {
          element.style.transform = `scaleX(${available / after})`;
          element.style.transformOrigin = "left center";
        }
      }
    };

    fit();
    void document.fonts?.ready.then(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(cell);
    return () => observer.disconnect();
  }, [line]);

  return (
    <motion.div
      className={`lane__row${isCurrent ? " is-current" : ""}`}
      data-distance={depth}
      style={{ "--d": distance } as CSSProperties}
      initial={
        calm
          ? false
          : { opacity: 0, y: distance * 94 + 24, scale: 0.7, filter: "blur(12px)" }
      }
      animate={{
        opacity: depth === 0 ? 1 : depth === 1 ? 0.5 : 0.28,
        y: distance * 94,
        scale: depth === 0 ? 1 : depth === 1 ? 0.86 : 0.72,
        filter: calm
          ? "blur(0px)"
          : depth === 0
            ? "blur(0px)"
            : depth === 1
              ? "blur(1.2px)"
              : "blur(3.5px)",
      }}
      transition={calm ? { duration: 0 } : rowMotion}
      aria-hidden={!isCurrent}
    >
      <span className="lane__section">{line.section ?? ""}</span>
      <div className="lane__tokens" ref={tokens}>
        {line.tokens.map((token, i) => (
          <TokenView
            key={`${line.at}-${i}`}
            token={token}
            time={time}
            current={isCurrent}
            calm={!!calm}
          />
        ))}
      </div>
    </motion.div>
  );
}

function TokenView({
  token,
  time,
  current,
  calm,
}: {
  token: Token;
  time: number;
  current: boolean;
  calm: boolean;
}) {
  const state = current ? stateOf(token, time) : "next";

  if (token.rest) {
    return <span className={`token token--rest is-${state}`}>–</span>;
  }

  if (token.word) {
    return (
      <motion.span
        className={`token token--word is-${state}`}
        animate={{
          color: state === "on" ? "#fdf9f3" : state === "past" ? "#cfc7bd" : "#7d766f",
          scale: state === "on" && !calm ? 1.045 : 1,
          y: state === "on" && !calm ? -1 : 0,
        }}
        transition={{ type: "spring", stiffness: 320, damping: 24 }}
      >
        {token.word}
        {state === "on" && (
          <motion.span
            className="word-underline"
            initial={{ scaleX: 0, opacity: 0.4 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: calm ? 0 : 0.22, ease: [0.22, 0.61, 0.36, 1] }}
          />
        )}
      </motion.span>
    );
  }

  const grouped = token.notes.length > 1;
  return (
    <span className={`token is-${state}${grouped ? " token--group" : ""}`}>
      {grouped && <span className="bracket">[</span>}
      {token.notes.map((note, i) => (
        <motion.span
          key={note + i}
          className={`note heat-${i === 0 ? "violet" : (token.heat ?? "gold")}${state === "on" ? " is-on" : ""}`}
          animate={state === "on" && !calm ? { scale: 1.03 } : { scale: 1 }}
          transition={{ type: "spring", stiffness: 360, damping: 22 }}
        >
          {note}
        </motion.span>
      ))}
      {grouped && <span className="bracket">]</span>}
    </span>
  );
}

import type { CSSProperties } from "react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { StageLine, Token, Track } from "../music/types";

type Props = {
  track: Track;
  time: number;
  /** Whether the sheet fans around the platter or stacks flat. */
  curve: boolean;
  /** How wide the fan opens, as a multiple of the record's own angle. */
  tilt: number;
};

const LINES_ABOVE = 2;
const LINES_BELOW = 2;
/** Degrees the first neighbour turns. Steps further out turn by less and less,
 *  so the lines crowd as they go — the way a fan closes away from its pin. */
const TURN = 5.5;
const CROWD = 0.82;

const turnOf = (distance: number): number =>
  Math.sign(distance) * TURN * Math.abs(distance) ** CROWD;

/**
 * Where the platter is, and where the words begin. Every line is a straight
 * run of words, turned to face the record's centre from its own place on the
 * stage: the one being sung lies flat, its neighbours lean towards the disc.
 */
type Shape = {
  cx: number;
  cy: number;
  startX: number;
  startY: number;
  originX: number;
  /** How far the words stand from the record's centre, kept the same for
   *  every line so each sits the same distance off the ticks. */
  radius: number;
};

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

export function ChordLane({ track, time, curve, tilt }: Props) {
  const lane = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<Shape>({
    cx: 0,
    cy: 0,
    startX: 0,
    startY: 0,
    originX: 0,
    radius: 0,
  });

  // Every line turns around the platter's own centre, by the angle one more
  // ring of groove would: the sheet reads as pressed into the same circle.
  useLayoutEffect(() => {
    const element = lane.current;
    if (!element) return;

    const measure = () => {
      const platter = document.querySelector<HTMLElement>(".platter");
      const box = element.getBoundingClientRect();
      if (!platter || !box.height) {
        setShape({ cx: 0, cy: 0, startX: 0, startY: 0, originX: 0, radius: 0 });
        return;
      }

      const disc = platter.getBoundingClientRect();
      // Where the words begin: past the section column of the first row.
      const cell = element.querySelector<HTMLElement>(".lane__tokens");
      const originX = cell?.offsetLeft ?? 0;

      const cx = disc.left + disc.width / 2;
      const cy = disc.top + disc.height / 2;
      const startX = box.left + originX;
      const startY = box.top + box.height * 0.52;

      setShape({
        cx,
        cy,
        startX,
        startY,
        originX,
        radius: Math.hypot(startX - cx, startY - cy),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [track.kind]);

  if (!track.lines.length) {
    return (
      <div className="lane lane--empty" ref={lane}>
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
    <div className={`lane lane--${track.kind}`} data-curve={curve ? "on" : "off"} ref={lane}>
      {rows.map(({ distance, line }) => {
        const turn = curve && shape.radius > 0 ? tilt * turnOf(distance) : 0;
        // Every line starts the same distance off the record, so its first word
        // sits on a circle around the disc and the sheet reads as its rings.
        const base = Math.atan2(shape.startY - shape.cy, shape.startX - shape.cx);
        const angle = base + (turn * Math.PI) / 180;
        const reach = shape.radius;
        return (
          <LaneRow
            key={line.at}
            line={line}
            distance={distance}
            time={time}
            tilt={turn}
            x={reach * Math.cos(angle) - reach * Math.cos(base)}
            y={reach * Math.sin(angle) - reach * Math.sin(base)}
            origin={`${shape.originX}px 50%`}
          />
        );
      })}
    </div>
  );
}

function LaneRow({
  line,
  distance,
  time,
  tilt,
  x,
  y,
  origin,
}: {
  line: StageLine;
  distance: number;
  time: number;
  /** Degrees this line turns to face the record. */
  tilt: number;
  /** Where its first word sits, on the circle it shares with every line. */
  x: number;
  y: number;
  origin: string;
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
      style={{ "--d": distance, transformOrigin: origin } as CSSProperties}
      initial={calm ? false : { opacity: 0, x, y: y + 22, rotate: tilt * 1.4 }}
      animate={{
        opacity: depth === 0 ? 1 : depth === 1 ? 0.5 : 0.28,
        x,
        y,
        rotate: tilt,
      }}
      transition={calm ? { duration: 0 } : rowMotion}
      aria-hidden={!isCurrent}
    >
      <span className="lane__section">{line.section ?? ""}</span>
      <div className="lane__tokens" ref={tokens}>
        {isCurrent && (
          <span className="line-shine" aria-hidden>
            {line.tokens.map((token, i) =>
              token.rest ? (
                <span className="token token--rest" key={i}>–</span>
              ) : token.word ? (
                <span className="token token--word" key={i}>{token.word}</span>
              ) : (
                <span className="token" key={i}>
                  {token.notes.length > 1 && <span className="bracket">[</span>}
                  {token.notes.join(" ")}
                  {token.notes.length > 1 && <span className="bracket">]</span>}
                </span>
              ),
            )}
          </span>
        )}
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

const TokenView = memo(function TokenView({
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
        transition={{ duration: 0.12, ease: "easeOut" }}
      >
        {token.word}
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
})

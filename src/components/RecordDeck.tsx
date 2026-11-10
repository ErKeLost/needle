import { useEffect, useMemo, useState } from "react";

type Props = {
  playing: boolean;
  progress: number;
  onToggle: () => void;
  title: string;
  artwork?: string;
  palette?: string[];
  spin: boolean;
};

const ARC_START = -56;
const ARC_SWEEP = 112;
const ARC_LENGTH = (ARC_SWEEP / 360) * 100;

const polar = (angleDeg: number, radius: number) => {
  const angle = (angleDeg * Math.PI) / 180;
  return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
};

/** The tick halo, a little outside the disc, with an index every sixth. */
const ticks = Array.from({ length: 91 }, (_, i) => {
  const angle = -98 + (i * 196) / 90;
  const long = i % 6 === 0;
  return {
    long,
    from: polar(angle, long ? 47.7 : 48.4),
    to: polar(angle, 49.4),
  };
});

export function RecordDeck({ playing, progress, onToggle, title, artwork, palette, spin }: Props) {
  const dot = useMemo(() => polar(ARC_START + ARC_SWEEP * progress, 50.6), [progress]);

  // Show the disc only once its photograph is decoded and its colours are
  // known, so it cannot appear in three different states on the way in.
  const [loaded, setLoaded] = useState(false);

  // The pressing photograph is one file; decode it once, then every cover only
  // changes the dye on top.
  useEffect(() => {
    const image = new Image();
    const settle = () => setLoaded(true);
    image.onload = settle;
    image.src = "/vinyl.jpg";
    if (image.complete) settle();
  }, []);

  const ready = loaded && (!artwork || Boolean(palette?.length));

  return (
    <div className="deck">
      <div className="halo" aria-hidden>
        <svg viewBox="0 0 100 100">
          {ticks.map((tick, i) => (
            <line
              key={i}
              className={tick.long ? "halo__tick halo__tick--long" : "halo__tick"}
              x1={tick.from.x}
              y1={tick.from.y}
              x2={tick.to.x}
              y2={tick.to.y}
            />
          ))}
          <circle className="halo__rail" cx="50" cy="50" r="47.2" />
          <circle
            className="halo__arc-track"
            cx="50"
            cy="50"
            r="50.6"
            pathLength={100}
            strokeDasharray={`${ARC_LENGTH} 100`}
            transform={`rotate(${ARC_START} 50 50)`}
          />
          <circle
            className="halo__arc"
            cx="50"
            cy="50"
            r="50.6"
            pathLength={100}
            strokeDasharray={`${Math.max(0.001, ARC_LENGTH * progress)} 100`}
            transform={`rotate(${ARC_START} 50 50)`}
          />
          <circle className="halo__dot" cx={dot.x} cy={dot.y} r="1.05" />
        </svg>
      </div>

      <div className="pivot" aria-hidden>
        <span className="pivot__plate" />
        <span className="pivot__cap" />
        <span className="pivot__ring" />
        <span className="pivot__screw pivot__screw--a" />
        <span className="pivot__screw pivot__screw--b" />
      </div>

      <button
        type="button"
        className="platter"
        data-spinning={spin}
        onClick={onToggle}
        aria-label={playing ? `Pause ${title}` : `Play ${title}`}
      >
        <span className="disc" data-ready={ready}>
          <span className="disc__art" />
          {palette && palette.length >= 3 && (
            <span
              className="disc__tint"
              style={{
                background: `conic-gradient(from 210deg at 50% 50%, ${palette[0]} 0deg, ${palette[0]} 150deg, ${palette[1]} 235deg, ${palette[2]} 320deg, ${palette[0]} 360deg)`,
              }}
            />
          )}
          <span className="disc__grooves" />
          <span className="disc__edge" />
          <span
            className={artwork ? "disc__label is-art" : "disc__label"}
            style={artwork ? { backgroundImage: `url("${artwork}")` } : undefined}
          >
            {!artwork && (
            <svg viewBox="0 0 100 100" aria-hidden>
              <defs>
                <path id="label-arc-top" d="M 50,50 m -37,0 a 37,37 0 1,1 74,0" />
                <path id="label-arc-bottom" d="M 50,50 m -34.5,0 a 34.5,34.5 0 1,0 69,0" />
              </defs>
              <text className="disc__label-ring" fontSize="3.1">
                <textPath href="#label-arc-top" startOffset="50%" textAnchor="middle">
                  no real vinyl · no pixel is fixed ·
                </textPath>
              </text>
              <text className="disc__label-ring" fontSize="3.1">
                <textPath href="#label-arc-bottom" startOffset="50%" textAnchor="middle">
                  aster vale · night pressing ·
                </textPath>
              </text>
              <g className="disc__label-mark" transform="translate(50 57)">
                <path d="M0 -7.5V7.5M-6.5 -3.8L6.5 3.8M6.5 -3.8L-6.5 3.8" />
              </g>
              <text className="disc__label-side" x="50" y="72.5" textAnchor="middle" fontSize="3.6">
                side a
              </text>
              <text className="disc__label-rpm" x="50" y="34.5" textAnchor="middle" fontSize="2.9">
                33⅓ rpm
              </text>
            </svg>
            )}
          </span>
          <span className="disc__hole" />
        </span>
        <span className="disc__light" aria-hidden />
      </button>

      <div className="arm" data-lifted={!playing} aria-hidden>
        <span className="arm__weight" />
        <span className="arm__weight-collar" />
        <span className="arm__tube" />
        <span className="arm__head">
          <span className="arm__head-plate" />
          <span className="arm__screw arm__screw--a" />
          <span className="arm__screw arm__screw--b" />
          <span className="arm__stylus" />
        </span>
      </div>
    </div>
  );
}

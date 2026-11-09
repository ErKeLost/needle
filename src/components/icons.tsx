import type { SVGProps } from "react";

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} width={16} height={16} aria-hidden {...props}>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PauseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} width={16} height={16} aria-hidden {...props}>
      <path d="M9 5v14M15 5v14" strokeWidth={2} />
    </svg>
  );
}

export function PrevIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} width={16} height={16} aria-hidden {...props}>
      <path d="M18 6.5v11L9.5 12 18 6.5Z" fill="currentColor" stroke="none" />
      <path d="M6 6v12" />
    </svg>
  );
}

export function NextIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} width={16} height={16} aria-hidden {...props}>
      <path d="M6 6.5v11L14.5 12 6 6.5Z" fill="currentColor" stroke="none" />
      <path d="M18 6v12" />
    </svg>
  );
}

/** The label's mark: six spokes, pressed in ember. */
export function SparkMark({ size = 12, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
    </svg>
  );
}

/** A small mark for each source, so the menu reads before it is read. */
const REAL: Record<string, string> = {
  netease: "/logos/netease.jpg",
  qq: "/logos/qq.jpg",
  qishui: "/logos/qishui.jpg",
};

export function SourceLogo({ id, size = 18 }: { id: string; size?: number }) {
  const shared = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true } as const;

  if (REAL[id]) {
    return (
      <img
        src={REAL[id]}
        alt=""
        width={size}
        height={size}
        className="source__brand"
        style={{ width: size, height: size, borderRadius: Math.max(4, size * 0.24) }}
      />
    );
  }

  if (id === "local") {
    return (
      <svg {...shared}>
        <rect width="24" height="24" rx="6" fill="#2c262c" />
        <path d="M5.5 8.5h4l1.6 2h7.4v6.8a1.6 1.6 0 0 1-1.6 1.6H7.1a1.6 1.6 0 0 1-1.6-1.6Z" fill="none" stroke="#f3ece3" strokeOpacity=".7" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }

  if (id === "netease") {
    return (
      <svg {...shared}>
        <rect width="24" height="24" rx="6" fill="#e60026" />
        <path d="M15.4 5.6v9.2a2.9 2.9 0 1 1-1.9-2.7V8.4l-4 1.1v6.4a2.9 2.9 0 1 1-1.9-2.7V6.9Z" fill="#fff" />
      </svg>
    );
  }
  if (id === "qq") {
    return (
      <svg {...shared}>
        <rect width="24" height="24" rx="6" fill="#31c27c" />
        <path d="M15 5.4v9.1a2.8 2.8 0 1 1-1.8-2.6V8l-3.9 1v6.3a2.8 2.8 0 1 1-1.8-2.6V6.6Z" fill="#fff" />
      </svg>
    );
  }
  if (id === "qishui") {
    return (
      <svg {...shared}>
        <rect width="24" height="24" rx="6" fill="#ff6a1a" />
        <path d="M6 14.8c2.6 0 2.6-5.2 5.2-5.2s2.6 5.2 5.2 5.2 1.4-2 1.6-2.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "local") {
    return (
      <svg {...shared}>
        <rect width="24" height="24" rx="6" fill="#2c262c" />
        <path d="M5.5 8.5h4l1.6 2h7.4v6.8a1.6 1.6 0 0 1-1.6 1.6H7.1a1.6 1.6 0 0 1-1.6-1.6Z" fill="none" stroke="#f3ece3" strokeOpacity=".7" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...shared}>
      <rect width="24" height="24" rx="6" fill="#2c262c" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="#f3ece3" strokeOpacity=".7" strokeWidth="1.2" />
      <circle cx="12" cy="12" r="1.6" fill="#ff5a2b" />
    </svg>
  );
}

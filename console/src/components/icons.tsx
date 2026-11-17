import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

/** Builds a stroke-based 24x24 icon so the set shares one visual language. */
function icon(children: ReactNode, filled = false) {
  return function Icon({ width = "1em", height = "1em", ...props }: IconProps) {
    return (
      <svg
        width={width}
        height={height}
        viewBox="0 0 24 24"
        fill={filled ? "currentColor" : "none"}
        stroke={filled ? "none" : "currentColor"}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {children}
      </svg>
    );
  };
}

export const PlusIcon = icon(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);

export const RefreshIcon = icon(
  <>
    <path d="M20 11a8 8 0 1 0-2.34 5.66" />
    <path d="M20 4v7h-7" />
  </>,
);

export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);

export const UserIcon = icon(
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </>,
);

export const LogoutIcon = icon(
  <>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="m10 17 5-5-5-5" />
    <path d="M15 12H3" />
  </>,
);

export const PauseIcon = icon(
  <>
    <path d="M9 5v14" />
    <path d="M15 5v14" />
  </>,
);

export const MoonIcon = icon(<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />);

export const PlayIcon = icon(<path d="m7 4 13 8-13 8V4Z" />, true);

export const TrashIcon = icon(
  <>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="m6 7 1 13h10l1-13" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </>,
);

export const InfoIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </>,
);

export const ServerIcon = icon(
  <>
    <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Z" />
    <path d="m4 7.5 8 3.5 8-3.5" />
    <path d="M12 11v9" />
  </>,
);

export const ActivityIcon = icon(<path d="M3 12h4l2.5-7 4 14 2.5-7h5" />);

export const CpuIcon = icon(
  <>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5" />
  </>,
);

export const ClockIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </>,
);

export const NetworkIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18Z" />
  </>,
);

export const MoreIcon = icon(
  <>
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </>,
  true,
);

export const BoltIcon = icon(<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />);

export const LayersIcon = icon(
  <>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </>,
);

export const ShieldCheckIcon = icon(
  <>
    <path d="M12 3l7 3v5.5c0 4.3-3 7.9-7 9.5-4-1.6-7-5.2-7-9.5V6l7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </>,
);

export const ZapIcon = icon(<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />);

export const GaugeIcon = icon(
  <>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="M12 13.5 16 9" />
    <path d="M12 18h.01" />
  </>,
);

export const MemoryIcon = icon(
  <>
    <rect x="3" y="7" width="18" height="10" rx="2" />
    <path d="M7 17v3M12 17v3M17 17v3" />
    <path d="M7 11h2M11 11h2M15 11h2" />
  </>,
);

export const CopyIcon = icon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </>,
);

export const ListIcon = icon(
  <>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </>,
);

export const HardDriveIcon = icon(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 13h18" />
    <path d="M7 16h.01M11 16h.01" />
  </>,
);

export const SunIcon = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </>,
);

export const MonitorIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M9 21h6" />
    <path d="M12 17v4" />
  </>,
);

export const CheckIcon = icon(<path d="m5 12 4.5 4.5L19 7" />);

export const TerminalIcon = icon(
  <>
    <path d="m5 7 4 5-4 5" />
    <path d="M13 17h6" />
  </>,
);

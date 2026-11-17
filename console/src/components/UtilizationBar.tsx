import type { ReactNode } from "react";
import { cn } from "../ui";
import { clampPercent, formatPercent } from "../utils/format";

export interface UtilizationBarProps {
  /** Metric name, e.g. "CPU" or "Memory". */
  label: string;
  /** Raw percentage; clamped into 0–100 before rendering. */
  percent: number;
  /** Optional caption rendered under the bar (e.g. "312 MiB / 512 MiB"). */
  detail?: ReactNode;
  /** Explicit fill color; defaults to an indigo/amber/red threshold ramp. */
  color?: string;
  className?: string;
}

function thresholdColor(percent: number): string {
  if (percent >= 85) {
    return "#dc2626"; // red-600
  }
  if (percent >= 60) {
    return "#f59e0b"; // amber-500
  }
  return "#4f46e5"; // indigo-600
}

/**
 * Labeled utilization bar. Keeps the numeric value visible next to the bar so
 * the metric is readable even when the bar is too small to judge.
 */
export function UtilizationBar({ label, percent, detail, color, className }: UtilizationBarProps) {
  const clamped = clampPercent(percent);
  const fill = color ?? thresholdColor(clamped);

  return (
    <div className={cn("min-w-0", className)} data-percent={clamped}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-gray-900 dark:text-white">{label}</span>
        <span className="text-sm font-medium text-gray-900 tabular-nums dark:text-white">
          {formatPercent(clamped)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${clamped}%`, backgroundColor: fill }}
        />
      </div>
      {detail !== undefined ? (
        <div className="mt-1.5 text-xs text-gray-500 tabular-nums dark:text-gray-400">{detail}</div>
      ) : null}
    </div>
  );
}

export default UtilizationBar;

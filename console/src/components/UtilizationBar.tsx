import { Progress } from "antd";
import type { ReactNode } from "react";
import { clampPercent, formatPercent } from "../utils/format";

export interface UtilizationBarProps {
  /** Metric name, e.g. "CPU" or "Memory". */
  label: string;
  /** Raw percentage; clamped into 0–100 before rendering. */
  percent: number;
  /** Optional caption rendered under the bar (e.g. "312 MiB / 512 MiB"). */
  detail?: ReactNode;
  /** Explicit bar color; defaults to a green/amber/red threshold ramp. */
  color?: string;
  className?: string;
}

function thresholdColor(percent: number): string {
  if (percent >= 85) {
    return "#f87171";
  }
  if (percent >= 60) {
    return "#fbbf24";
  }
  return "#5eead4";
}

/**
 * Labeled utilization bar. Keeps the numeric value visible next to the bar so
 * the metric is readable even when the bar is too small to judge.
 */
export function UtilizationBar({ label, percent, detail, color, className }: UtilizationBarProps) {
  const clamped = clampPercent(percent);
  const classes = className === undefined ? "utilization-bar" : `utilization-bar ${className}`;

  return (
    <div className={classes} data-percent={clamped}>
      <div className="utilization-bar-head">
        <span className="utilization-bar-label">{label}</span>
        <span className="utilization-bar-value">{formatPercent(clamped)}</span>
      </div>
      <Progress
        percent={clamped}
        showInfo={false}
        size="small"
        strokeColor={color ?? thresholdColor(clamped)}
        railColor="rgba(148, 163, 184, 0.18)"
      />
      {detail !== undefined ? <div className="utilization-bar-detail">{detail}</div> : null}
    </div>
  );
}

export default UtilizationBar;

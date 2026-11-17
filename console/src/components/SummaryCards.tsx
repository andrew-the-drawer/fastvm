import { Card, Col, Row, Skeleton, Statistic } from "antd";
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { Sandbox } from "../lib/types";
import { ActivityIcon, MoonIcon, ServerIcon, TrashIcon } from "./icons";

export interface SummaryCardsProps {
  sandboxes: readonly Sandbox[];
  /** When true and there is no data yet, animate the values as skeletons. */
  loading?: boolean;
}

interface SummaryDefinition {
  key: string;
  label: string;
  hint: string;
  value: number;
  icon: ReactNode;
  tone: "total" | "running" | "sleeping" | "failed";
}

function isRunning(state: Sandbox["state"]): boolean {
  return state === "Running" || state === "Idle";
}

function isSleeping(state: Sandbox["state"]): boolean {
  return state === "Paused" || state === "Dormant";
}

function isFailed(state: Sandbox["state"]): boolean {
  return state === "Failed" || state === "Stopped";
}

/** Four headline counters derived from the polled sandbox list. */
export function SummaryCards({ sandboxes, loading = false }: SummaryCardsProps) {
  const summaries: SummaryDefinition[] = useMemo(() => {
    const counts = { total: sandboxes.length, running: 0, sleeping: 0, failed: 0 };
    for (const sandbox of sandboxes) {
      if (isRunning(sandbox.state)) {
        counts.running += 1;
      } else if (isSleeping(sandbox.state)) {
        counts.sleeping += 1;
      } else if (isFailed(sandbox.state)) {
        counts.failed += 1;
      }
    }
    return [
      {
        key: "total",
        label: "Total VMs",
        hint: "All sandboxes in this daemon",
        value: counts.total,
        icon: <ServerIcon />,
        tone: "total",
      },
      {
        key: "running",
        label: "Running",
        hint: "Running or idle, vCPUs live",
        value: counts.running,
        icon: <ActivityIcon />,
        tone: "running",
      },
      {
        key: "sleeping",
        label: "Sleeping",
        hint: "Paused or dormant, wake on traffic",
        value: counts.sleeping,
        icon: <MoonIcon />,
        tone: "sleeping",
      },
      {
        key: "failed",
        label: "Failed / stopped",
        hint: "Needs attention or cleanup",
        value: counts.failed,
        icon: <TrashIcon />,
        tone: "failed",
      },
    ];
  }, [sandboxes]);

  const showSkeletons = loading && sandboxes.length === 0;

  return (
    <Row className="summary-grid" gutter={[16, 16]}>
      {summaries.map((summary) => (
        <Col key={summary.key} xs={12} md={12} xl={6}>
          <Card className={`summary-card summary-card--${summary.tone}`} variant="outlined">
            {showSkeletons ? (
              <div className="summary-card-body">
                <span className="summary-icon">{summary.icon}</span>
                <div className="summary-copy">
                  <span className="summary-label">{summary.label}</span>
                  <Skeleton.Input active size="small" className="summary-skeleton" />
                </div>
              </div>
            ) : (
              <Statistic
                title={summary.label}
                value={summary.value}
                prefix={summary.icon}
                className="summary-statistic"
              />
            )}
            <span className="summary-hint">{summary.hint}</span>
          </Card>
        </Col>
      ))}
    </Row>
  );
}

export default SummaryCards;

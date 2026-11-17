import { Tag, Tooltip } from "antd";
import type { SandboxState } from "../lib/types";
import { sandboxStateMeta } from "../utils/format";

export interface VmStatusTagProps {
  state: SandboxState;
  /** When false the state description is rendered inline instead of a tooltip. */
  showTooltip?: boolean;
}

/**
 * Colored lifecycle tag. The tooltip explains what the state means, which is
 * useful because several states look similar at a glance.
 */
export function VmStatusTag({ state, showTooltip = true }: VmStatusTagProps) {
  const meta = sandboxStateMeta(state);
  const tag = (
    <Tag color={meta.color} className="vm-status-tag" data-state={state}>
      {meta.label}
    </Tag>
  );
  if (!showTooltip) {
    return tag;
  }
  return <Tooltip title={meta.description}>{tag}</Tooltip>;
}

export default VmStatusTag;

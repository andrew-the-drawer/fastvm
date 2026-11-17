import type { SandboxState } from "../lib/types";
import { cn } from "../ui";
import { sandboxStateMeta } from "../utils/format";

export interface VmStatusTagProps {
  state: SandboxState;
  /** When false the state description is rendered inline instead of a tooltip. */
  showTooltip?: boolean;
}

const STATE_BADGE: Record<SandboxState, string> = {
  Creating: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Starting: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Running: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  Idle: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  Paused: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Dormant: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  Resuming: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Stopping: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Stopped: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  Failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

/**
 * Colored lifecycle badge. The native `title` explains what the state means,
 * which is useful because several states look similar at a glance.
 */
export function VmStatusTag({ state, showTooltip = true }: VmStatusTagProps) {
  const meta = sandboxStateMeta(state);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATE_BADGE[state],
      )}
      data-state={state}
      title={showTooltip ? meta.description : undefined}
    >
      {meta.label}
    </span>
  );
}

export default VmStatusTag;

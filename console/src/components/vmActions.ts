import type { Sandbox, SandboxState } from "../lib/types";

/** Lifecycle actions exposed by both the table menu and the detail drawer. */
export type VmActionKind = "pause" | "deepSleep" | "resume" | "delete";

/** Identifies the in-flight action for one sandbox (drives disabled/loading UI). */
export interface PendingAction {
  readonly ref: string;
  readonly kind: VmActionKind;
}

/** `sleep(deep=false)` is accepted for awake sandboxes only. */
export function canPause(state: SandboxState): boolean {
  return state === "Running" || state === "Idle";
}

/** `sleep(deep=true)` pauses then offloads; fastvmd also offloads a paused VM. */
export function canDeepSleep(state: SandboxState): boolean {
  return state === "Running" || state === "Idle" || state === "Paused";
}

/** `wake` resumes a paused or dormant sandbox. */
export function canResume(state: SandboxState): boolean {
  return state === "Paused" || state === "Dormant";
}

/** Interactive shell is available for awake sandboxes; fastvmd wakes sleeping ones. */
export function canExec(state: SandboxState): boolean {
  return state === "Running" || state === "Idle" || state === "Paused" || state === "Dormant";
}

/** Deleting mid-creation races the cloning step, so wait for it to settle. */
export function canDelete(state: SandboxState): boolean {
  return state !== "Creating";
}

/** Stable key of a sandbox used as action ref and per-row stats key. */
export function sandboxRef(sandbox: Pick<Sandbox, "id" | "name">): string {
  return sandbox.id !== "" ? sandbox.id : sandbox.name;
}

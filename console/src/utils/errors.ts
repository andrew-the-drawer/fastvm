import { ApiError } from "../lib/api";

/**
 * Stable, user-facing message for an unknown thrown value. Fastvmd errors are
 * surfaced verbatim (they are already short and actionable), other errors fall
 * back to their message, and anything else gets a generic hint.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const suffix = error.kind !== undefined && error.kind !== "" ? ` (${error.kind})` : "";
    return `${error.message}${suffix}`;
  }
  if (error instanceof Error && error.message !== "") {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

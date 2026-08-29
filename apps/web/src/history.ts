import type { RunResult } from "./run.js";

/**
 * Session-scoped run history.
 *
 * Comparison, repetition, and the local-versus-remote question all need more
 * than one run alive at a time. This is where they get it — as pure functions
 * over a list, so the retention rules are testable without a browser.
 *
 * History lives in the page and nowhere else. The adapter persists nothing and
 * a reload starts empty: retaining it would mean inventing a storage contract,
 * and the artifacts a retained run points at live in run directories the
 * adapter is free to clean. A retained run whose artifacts are gone still
 * carries its command, metrics, and logs — only the images stop resolving,
 * which is the honest outcome rather than a state to hide.
 */

export type HistoryEntry = {
  run: RunResult;
  /** When the browser received it, for ordering and for "how long ago". */
  receivedAt: number;
};

/**
 * A run carries its whole stdout and stderr, so an unbounded list is an
 * unbounded page. Twenty is enough to compare a repetition set against what
 * came before it.
 */
export const HISTORY_LIMIT = 20;

/**
 * Adds a finished run, newest first, dropping the oldest beyond the cap.
 *
 * Only a run that actually ran is retained. A rejected request never reached
 * the binary and has no command, duration, or exit code, so there is nothing
 * to compare it against — the caller keeps showing it, but it does not enter
 * the history.
 */
export function remember(
  history: readonly HistoryEntry[],
  run: RunResult,
  receivedAt: number = Date.now(),
  limit: number = HISTORY_LIMIT,
): HistoryEntry[] {
  return [{ run, receivedAt }, ...history].slice(0, Math.max(limit, 1));
}

/** The entry for a run id, or null once it has aged out of the list. */
export function entryFor(
  history: readonly HistoryEntry[],
  runId: string | null,
): HistoryEntry | null {
  if (runId === null) return null;
  return history.find((entry) => entry.run.run_id === runId) ?? null;
}

/**
 * How long ago a run finished, in stable units.
 *
 * Deliberately coarse: the exact second a run landed is noise, and the run's
 * own duration is the number that carries meaning.
 */
export function formatAge(receivedAt: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - receivedAt) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ago`;
}

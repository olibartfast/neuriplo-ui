import type { HistoryEntry } from "./history.js";
import { formatAge } from "./history.js";
import { describeExecution, formatDuration } from "./results.js";
import { labelFor } from "./contract.js";

/**
 * The runs this session has completed, newest first.
 *
 * Selecting one shows it in the existing run panel unchanged: history changes
 * which run is displayed, never what a run means. The newest is selected as it
 * arrives, so the common case stays exactly what it was before history existed.
 */
export function HistoryPanel({
  history,
  selectedId,
  onSelect,
  now = Date.now(),
}: {
  history: readonly HistoryEntry[];
  selectedId: string | null;
  onSelect: (runId: string) => void;
  /** Injected so a test can assert an age without waiting for one. */
  now?: number;
}) {
  if (history.length === 0) return null;

  return (
    <section className="panel" aria-label="Run history">
      <h2>
        Runs <span className="flag">{history.length}</span>
      </h2>
      <ul className="history" data-testid="history">
        {history.map((entry) => {
          const { run } = entry;
          const selected = run.run_id === selectedId;
          return (
            <li key={run.run_id}>
              <button
                type="button"
                className={selected ? "history-entry selected" : "history-entry"}
                data-testid={`history-entry-${run.run_id}`}
                aria-current={selected}
                onClick={() => onSelect(run.run_id)}
              >
                <span
                  className={run.status === "success" ? "flag" : "field-error"}
                >
                  {run.status === "success" ? "Succeeded" : "Failed"}
                </span>
                <span className="history-what">
                  {labelFor(run.task)} · {run.model}
                </span>
                <span className="history-how">
                  {describeExecution(run.execution)}
                </span>
                <span className="history-when">
                  {formatDuration(run.duration_ms)} ·{" "}
                  {formatAge(entry.receivedAt, now)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="hint">
        Kept in this page only. Artifacts resolve for as long as the adapter
        keeps each run's directory.
      </p>
    </section>
  );
}

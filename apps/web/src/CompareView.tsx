import type { RunResult } from "./run.js";
import { compareRuns, describeComparison } from "./compare.js";
import { summarize } from "./summary.js";
import { labelFor } from "./contract.js";

/**
 * Two or more runs side by side.
 *
 * What differed is what the view exists to show, so a differing row is marked
 * and the identical ones stay quiet. It stops there: no speedup, no winner, no
 * cross-machine normalization. The measurements are shown next to each other
 * and the reader draws the conclusion, because two runs on different
 * executions differ in ways these numbers do not explain.
 */
export function ComparePanel({ runs }: { runs: readonly RunResult[] }) {
  if (runs.length < 2) return null;

  const rows = compareRuns(runs);

  return (
    <section className="panel" aria-label="Run comparison">
      <h2>Comparison</h2>
      <p className="hint" data-testid="comparison-caption">
        {describeComparison(runs)}
      </p>

      <div className="comparison-scroll">
        <table className="comparison" data-testid="comparison">
          <thead>
            <tr>
              <th scope="col">Measurement</th>
              {runs.map((run) => (
                <th scope="col" key={run.run_id}>
                  <span className="history-what">{labelFor(run.task)}</span>
                  <span className="flag"> {run.run_id.slice(0, 8)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className={row.differs ? "differs" : undefined}
                data-testid={`comparison-row-${row.label
                  .toLowerCase()
                  .replace(/[^a-z]+/g, "-")
                  .replace(/^-|-$/g, "")}`}
                data-differs={row.differs}
              >
                <th scope="row">
                  {row.label}
                  {/* Marked by text as well as by style, because a difference
                      must not be carried by colour alone. */}
                  {row.differs && <span className="flag"> · differs</span>}
                </th>
                {row.cells.map((cell, index) => (
                  <td
                    key={runs[index].run_id}
                    className={cell.absent ? "absent" : undefined}
                  >
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint">
        Measurements as each run reported them. A dash is a value that run did
        not supply. Nothing here is normalized across machines, and no run is
        called faster than another.
      </p>

      <SummaryTable runs={runs} />
    </section>
  );
}

/**
 * Statistics over repetitions of one configuration.
 *
 * Shown only when the runs are repetitions of the same thing: aggregating
 * across different models or executions would produce a number describing
 * nothing, and that set is what the comparison above is for.
 */
function SummaryTable({ runs }: { runs: readonly RunResult[] }) {
  const summary = summarize(runs);
  if (!summary || summary.rows.length === 0) return null;

  return (
    <>
      <h3>
        Across {summary.runs} runs <span className="flag">of one configuration</span>
      </h3>
      <div className="comparison-scroll">
        <table className="comparison" data-testid="summary">
          <thead>
            <tr>
              <th scope="col">Measurement</th>
              <th scope="col">Runs</th>
              <th scope="col">Min</th>
              <th scope="col">Median</th>
              <th scope="col">Max</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr
                key={row.label}
                data-testid={`summary-row-${row.label
                  .toLowerCase()
                  .replace(/[^a-z]+/g, "-")
                  .replace(/^-|-$/g, "")}`}
              >
                <th scope="row">{row.label}</th>
                <td>{row.count}</td>
                <td>{row.min}</td>
                <td>{row.median}</td>
                <td>{row.max}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {/* The distinction is load-bearing: this summarizes whole runs the UI
            launched, not iterations inside a producer's own benchmark loop,
            which publishes a single observation and no per-iteration values. */}
        A summary over {summary.runs} separate runs — not over the iterations of
        a producer benchmark, which reports one observation per run. Only
        minimum, median, and maximum are shown, because a percentile over this
        many runs would claim precision the sample does not carry.
      </p>
    </>
  );
}

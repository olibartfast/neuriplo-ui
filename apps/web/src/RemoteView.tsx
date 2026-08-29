import { useEffect, useState } from "react";
import {
  fetchRemoteMetadata,
  type RemoteMetadata,
  RemoteMetadataError,
  type RemoteTensor,
} from "./remote.js";

/**
 * What the remote server says it is.
 *
 * The endpoint, model, and version come from the configurator; everything
 * displayed here comes back from the server. It is shown and never used to
 * narrow a selection: the contract that governs what may be selected is
 * `neuriplo-infer`'s, and a remote server is not a second source of it.
 *
 * A server that cannot be described never blocks a run. The endpoint is still
 * valid input, and the run itself remains the authority on whether it works.
 */

type Lookup =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; metadata: RemoteMetadata }
  | { status: "error"; code: string; message: string };

export function RemotePanel({
  endpoint,
  model,
  version,
}: {
  endpoint: string;
  model: string | null;
  version: string | null;
}) {
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const target = endpoint.trim();

  useEffect(() => {
    if (!target) {
      setLookup({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    // Typing an endpoint should not fire a request per keystroke at whatever
    // half-finished host has been typed so far.
    const timer = setTimeout(() => {
      setLookup({ status: "loading" });
      fetchRemoteMetadata(target, model, version, controller.signal)
        .then((metadata) => setLookup({ status: "ready", metadata }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const failure =
            error instanceof RemoteMetadataError
              ? error
              : new RemoteMetadataError(
                  "invalid_response",
                  "The adapter returned an unreadable answer.",
                );
          setLookup({
            status: "error",
            code: failure.code,
            message: failure.message,
          });
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [target, model, version]);

  if (lookup.status === "idle") return null;

  return (
    <section className="result-section" aria-label="Remote server">
      <h2>Remote server</h2>

      {lookup.status === "loading" && (
        <p className="hint" data-testid="remote-status">
          Asking {target} what it is…
        </p>
      )}

      {lookup.status === "error" && (
        <>
          <p className="field-error" data-testid="remote-error">
            {lookup.message}
          </p>
          <p className="hint">
            {lookup.code === "forbidden_endpoint"
              ? "The adapter only queries hosts it was configured to allow."
              : "The endpoint is still usable; only this description failed."}
          </p>
        </>
      )}

      {lookup.status === "ready" && <Described metadata={lookup.metadata} />}
    </section>
  );
}

function Described({ metadata }: { metadata: RemoteMetadata }) {
  const { server, model } = metadata;

  return (
    <>
      <dl className="run-header" data-testid="remote-metadata">
        <Fact label="Server" value={server.name ?? "unnamed"} />
        {server.version && <Fact label="Version" value={server.version} />}
        {server.extensions.length > 0 && (
          <Fact label="Extensions" value={server.extensions.join(", ")} />
        )}
        {model?.platform && (
          <Fact
            label="Platform"
            value={model.platform}
            testId="remote-platform"
          />
        )}
        {model && model.versions.length > 0 && (
          <Fact label="Model versions" value={model.versions.join(", ")} />
        )}
      </dl>

      {model === null ? (
        <p className="hint" data-testid="remote-model-unknown">
          The server did not describe this model. It may still serve it — the
          run is what decides.
        </p>
      ) : (
        <>
          <Tensors
            label="Inputs"
            tensors={model.inputs}
            testId="remote-inputs"
          />
          <Tensors
            label="Outputs"
            tensors={model.outputs}
            testId="remote-outputs"
          />
        </>
      )}

      <p className="hint">
        Reported by the server. Nothing here narrows what can be selected; the
        capabilities contract does that.
      </p>
    </>
  );
}

function Tensors({
  label,
  tensors,
  testId,
}: {
  label: string;
  tensors: RemoteTensor[];
  testId: string;
}) {
  if (tensors.length === 0) return null;

  return (
    <p className="hint" data-testid={testId}>
      <strong>{label}:</strong>{" "}
      {tensors
        .map(
          (tensor) =>
            `${tensor.name}${tensor.datatype ? ` ${tensor.datatype}` : ""}${
              tensor.shape ? ` [${tensor.shape.join("×")}]` : ""
            }`,
        )
        .join(", ")}
    </p>
  );
}

function Fact({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
}

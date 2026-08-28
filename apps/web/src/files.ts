// Directory listings served by the adapter. A browser file input only reports a
// file name, so paths for neuriplo-infer are picked from the adapter's own
// filesystem instead.

export type DirectoryEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  bytes: number | null;
};

export type DirectoryListing = {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
  truncated: boolean;
};

export class DirectoryListingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DirectoryListingError";
  }
}

export async function listDirectory(
  path?: string,
  signal?: AbortSignal,
): Promise<DirectoryListing> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";

  let response: Response;
  try {
    response = await fetch(`/api/files${query}`, { signal });
  } catch {
    throw new DirectoryListingError(
      "unreachable",
      "Could not reach the local Neuriplo adapter.",
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: { code?: string; message?: string } }).error
        : null;
    throw new DirectoryListingError(
      error?.code ?? String(response.status),
      error?.message ?? "That directory could not be listed.",
    );
  }

  return payload as DirectoryListing;
}

/** Compact size for a picker row; directories report no size. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Directory listings for the browser's file picker.
 *
 * A browser file input only yields a file name, never a path, but
 * `neuriplo-infer` needs a real path on the machine the adapter runs on. So the
 * adapter lists its own filesystem and the UI picks from that, which also means
 * multi-gigabyte weights are referenced rather than uploaded.
 */

export type DirectoryEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  /** Null for directories and for entries the adapter could not stat. */
  bytes: number | null;
};

export type DirectoryListing = {
  path: string;
  /** Null at the filesystem root, or at the configured browse root. */
  parent: string | null;
  entries: DirectoryEntry[];
  /** True when the directory holds more entries than were returned. */
  truncated: boolean;
};

export type FileBrowseErrorCode =
  | "not_found"
  | "not_a_directory"
  | "forbidden"
  | "unreadable";

export class FileBrowseError extends Error {
  constructor(
    readonly code: FileBrowseErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FileBrowseError";
  }
}

export type BrowseOptions = {
  /** Confines browsing when set; defaults to `NEURIPLO_UI_BROWSE_ROOT`. */
  root?: string;
  /** Where browsing starts when no path is requested. */
  home?: string;
  maxEntries?: number;
};

const DEFAULT_MAX_ENTRIES = 1000;

export function browseRoot(options: BrowseOptions = {}): string | null {
  const root = options.root ?? process.env.NEURIPLO_UI_BROWSE_ROOT?.trim();
  return root ? resolve(root) : null;
}

/** Browsing starts at the confinement root, or at the adapter user's home. */
export function initialDirectory(options: BrowseOptions = {}): string {
  return browseRoot(options) ?? resolve(options.home ?? homedir());
}

export async function listDirectory(
  requested: string | undefined,
  options: BrowseOptions = {},
): Promise<DirectoryListing> {
  const root = browseRoot(options);
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const target = requested?.trim()
    ? resolve(requested)
    : initialDirectory(options);

  // Resolving symlinks before the containment check stops a link inside the
  // root from being used to step outside it.
  let real: string;
  try {
    real = await realpath(target);
  } catch (cause) {
    throw new FileBrowseError(
      "not_found",
      `Directory does not exist: ${target}`,
      { cause },
    );
  }

  if (root && !contains(root, real)) {
    throw new FileBrowseError(
      "forbidden",
      `Directory is outside NEURIPLO_UI_BROWSE_ROOT: ${target}`,
    );
  }

  let dirEntries: Dirent[];
  try {
    dirEntries = await readdir(real, { withFileTypes: true });
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR") {
      throw new FileBrowseError(
        "not_a_directory",
        `Not a directory: ${real}`,
        { cause },
      );
    }
    throw new FileBrowseError(
      code === "EACCES" || code === "EPERM" ? "forbidden" : "unreadable",
      `Could not read directory: ${real}`,
      { cause },
    );
  }

  // Directories first, then files, each alphabetically: the ordering a file
  // picker is expected to have.
  const sorted = dirEntries
    .filter((entry) => entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())
    .sort((left, right) => {
      const leftDirectory = left.isDirectory() ? 0 : 1;
      const rightDirectory = right.isDirectory() ? 0 : 1;
      return (
        leftDirectory - rightDirectory ||
        left.name.localeCompare(right.name, undefined, { numeric: true })
      );
    });

  const entries: DirectoryEntry[] = [];
  for (const entry of sorted.slice(0, maxEntries)) {
    const path = join(real, entry.name);
    // A symlink reports neither kind directly, so resolve just those.
    const isDirectory = entry.isSymbolicLink()
      ? ((await stat(path).catch(() => null))?.isDirectory() ?? false)
      : entry.isDirectory();

    entries.push({
      name: entry.name,
      path,
      kind: isDirectory ? "directory" : "file",
      bytes: isDirectory
        ? null
        : ((await stat(path).catch(() => null))?.size ?? null),
    });
  }

  return {
    path: real,
    parent: parentOf(real, root),
    entries,
    truncated: sorted.length > maxEntries,
  };
}

function parentOf(path: string, root: string | null): string | null {
  if (root && path === root) return null;
  const parent = dirname(path);
  return parent === path ? null : parent;
}

function contains(root: string, candidate: string): boolean {
  if (root === candidate) return true;
  const inside = relative(root, candidate);
  return inside.length > 0 && !inside.startsWith("..") && !isAbsolute(inside);
}

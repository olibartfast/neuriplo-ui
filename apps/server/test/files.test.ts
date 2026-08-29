import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  browseRoot,
  FileBrowseError,
  initialDirectory,
  listDirectory,
} from "../src/files.js";

async function tree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "neuriplo-ui-files-"));
  await mkdir(join(root, "models", "onnx"), { recursive: true });
  await writeFile(join(root, "models", "yolo26.onnx"), "x".repeat(64));
  await writeFile(join(root, "models", "labels.txt"), "bus\n");
  await writeFile(join(root, "outside.txt"), "not yours");
  return root;
}

test("lists directories before files, each alphabetically", async (context) => {
  const root = await tree();
  context.after(() => rm(root, { recursive: true, force: true }));

  const listing = await listDirectory(join(root, "models"), { root });

  assert.deepEqual(
    listing.entries.map((entry) => [entry.name, entry.kind]),
    [
      ["onnx", "directory"],
      ["labels.txt", "file"],
      ["yolo26.onnx", "file"],
    ],
  );
  assert.equal(listing.entries[0].bytes, null);
  assert.equal(listing.entries[2].bytes, 64);
  assert.equal(listing.parent, root);
  assert.equal(listing.truncated, false);
});

test("stops at the configured browse root", async (context) => {
  const root = await tree();
  context.after(() => rm(root, { recursive: true, force: true }));

  const listing = await listDirectory(root, { root });
  assert.equal(listing.parent, null);

  await assert.rejects(
    listDirectory(join(root, ".."), { root }),
    (error: unknown) =>
      error instanceof FileBrowseError && error.code === "forbidden",
  );
});

test("refuses a symlink that leaves the browse root", async (context) => {
  const root = await tree();
  const outside = await mkdtemp(join(tmpdir(), "neuriplo-ui-outside-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  context.after(() => rm(outside, { recursive: true, force: true }));

  await symlink(outside, join(root, "escape"));

  await assert.rejects(
    listDirectory(join(root, "escape"), { root }),
    (error: unknown) =>
      error instanceof FileBrowseError && error.code === "forbidden",
  );
});

test("resolves a symlinked directory's kind", async (context) => {
  const root = await tree();
  context.after(() => rm(root, { recursive: true, force: true }));

  await symlink(join(root, "models", "onnx"), join(root, "models", "linked"));
  const listing = await listDirectory(join(root, "models"), { root });
  const linked = listing.entries.find((entry) => entry.name === "linked");

  assert.equal(linked?.kind, "directory");
});

test("browses without a root when none is configured", async (context) => {
  const root = await tree();
  context.after(() => rm(root, { recursive: true, force: true }));

  const listing = await listDirectory(join(root, "models"), { root: "" });
  assert.equal(listing.parent, root);
});

test("reports a missing or non-directory path", async (context) => {
  const root = await tree();
  context.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    listDirectory(join(root, "absent"), { root }),
    (error: unknown) =>
      error instanceof FileBrowseError && error.code === "not_found",
  );

  await assert.rejects(
    listDirectory(join(root, "outside.txt"), { root }),
    (error: unknown) =>
      error instanceof FileBrowseError && error.code === "not_a_directory",
  );
});

test("caps a large listing and says so", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "neuriplo-ui-many-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  for (let index = 0; index < 12; index += 1) {
    await writeFile(join(root, `file-${index}.txt`), "x");
  }

  const listing = await listDirectory(root, { root, maxEntries: 5 });
  assert.equal(listing.entries.length, 5);
  assert.equal(listing.truncated, true);
  // Numeric-aware ordering keeps file-2 before file-10.
  assert.equal(listing.entries[2].name, "file-2.txt");
});

test("starts at the browse root, or at home when unconfined", async (context) => {
  const root = await tree();
  context.after(() => rm(root, { recursive: true, force: true }));

  assert.equal(browseRoot({ root }), root);
  assert.equal(initialDirectory({ root }), root);
  assert.equal(browseRoot({ root: "" }), null);
  assert.equal(initialDirectory({ root: "", home: root }), root);

  const listing = await listDirectory(undefined, { root });
  assert.equal(listing.path, root);
});

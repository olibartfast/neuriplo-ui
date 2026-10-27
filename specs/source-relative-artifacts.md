# Source-relative output isolation

Observed during real RAFT validation: the released binary writes optical-flow
images beside the source file, so the UI receives success and a diagnostic
report but cannot discover or preview the flow image.

Requirement: source-relative writes must land in the private run directory;
original sources must remain untouched and staged input bytes must not become
downloadable artifacts. Preserve the exact effective command and original source
selection in their existing response fields.

Plan: stage source files as per-run symlinks before spawning the binary and use
those paths in --source. Artifact discovery already skips symlinks. Keep source
resolution/root validation before staging. Do not modify the producer release.

Validation before implementation: exercise two same-basename inputs in different
directories with a process that writes beside its first source. Assert input
readability, private output discovery, no original-directory output, distinct
staged paths, and no input symlink among artifacts. Re-run runner/server tests
and real RAFT through Chrome, requiring a loaded preview and downloaded image.

Validated 2026-10-26: 57 server tests and 17 web tests passed; full build passed.
The additional runner regression covers same-name sources and source-relative
output isolation; API regression refuses guessed source-symlink download URLs.
Real RAFT Chrome run dd3397f0-9789-4a7d-9ba6-b2b111dde3bb succeeded with a
loaded/downloaded inputs/output/processed_frame_optical_flow_0.jpg artifact.
Producer binaries and their released source trees were left unchanged.

Staging preserves each original basename in a numbered input subdirectory;
same-name sources stay distinct without changing filename-based reader behavior.

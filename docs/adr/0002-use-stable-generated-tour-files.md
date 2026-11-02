# Use stable generated tour files

Generated tours use the stable destinations `.tours/project.tour` and `.tours/changes.tour`, and each generation atomically replaces the corresponding file. This favors a predictable one-command workflow over retaining generation history; version control remains responsible for recovering earlier content.

Amended in v0.1.2: the stable destinations remain the default, but both tools accept an optional `fileName` (a bare name, always written under `.tours/`) so a workspace can hold several generated tours side by side — for example one Changes Tour per functional slice of a large review. The rationale is unchanged: each destination still holds one tour, replacement stays atomic, and version control remains responsible for history; the tool no longer forces every Changes Tour to share a single file.

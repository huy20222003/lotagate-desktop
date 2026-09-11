# PDF

The PDF public plugin exposes the `pdf.*` tools through the governed Desktop
document host. It is declarative: file access remains bounded by the active
workspace and tool permissions. PDF inspection, text extraction, validation,
and rendering use the configured platform document backend; unsupported edit
operations are omitted from the negotiated tool catalog and return a structured
host error if requested directly.

The public surface also supports bounded text search, rendering, and document
inspection when the required host utilities are installed. Provider-specific
operations are advertised explicitly rather than assumed.

Missing prerequisites return an explicit capability or backend error; Desktop
never silently falls back to an unrelated shell command or viewer.

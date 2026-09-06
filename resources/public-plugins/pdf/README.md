# PDF

The PDF public plugin exposes the `pdf.*` tools through the governed Desktop
document host. It is declarative: file access remains bounded by the active
workspace and tool permissions. PDF inspection, text extraction, validation,
and rendering use the configured Windows document backend; unsupported edit
operations return a structured host error instead of silently changing data.

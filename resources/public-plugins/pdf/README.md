# PDF

The PDF public plugin exposes the `pdf.*` tools through the governed Desktop
document host. It is declarative: file access remains bounded by the active
workspace and tool permissions. PDF inspection, text extraction, validation,
and rendering use the configured Windows document backend; unsupported edit
operations return a structured host error instead of silently changing data.

The public surface also supports Windows OCR with line bounds, bounded text
search, embedded-image and link extraction, annotation inspection, bookmark
and attachment lifecycle operations, form flattening, optimization, and page
numbering.

OCR uses the installed Windows OCR languages; text rendering/search/link/image
extraction use the configured Poppler utilities, bookmark/forms operations
require `pdftk`, optimization requires Ghostscript (`gswin64c`), and attachment
deletion requires `qpdf` to be available on the Desktop host PATH. Missing
prerequisites return an explicit backend error.

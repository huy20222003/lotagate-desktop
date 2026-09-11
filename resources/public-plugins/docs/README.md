# Docs

The Docs public plugin exposes the `docs.*` tools through the governed Desktop
document host. Document handles are session-scoped. Desktop selects a Windows
Office provider or a portable LibreOffice provider according to the current
platform and installed capabilities.

In addition to content editing, the plugin supports document tables and images,
content-control template filling, field updates, document structure inspection,
bookmarks, hyperlinks, lists, and footnotes when the negotiated provider
exposes them.

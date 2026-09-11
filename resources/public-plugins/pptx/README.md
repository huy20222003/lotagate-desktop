# PPTX

The PPTX public plugin exposes the `pptx.*` tools through the governed Desktop
document host. A document handle is scoped to the agent session and workspace.
Presentation operations use the provider negotiated by Desktop. The Windows
provider uses Office automation; macOS and Linux expose supported portable
operations when LibreOffice is installed.

The public surface also supports slide duplication and import, targeted element
arrangement, bounded text extraction and replacement, media, hyperlinks,
transitions, and layout management when the selected provider exposes them.

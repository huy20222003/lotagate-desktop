# PPTX

The PPTX plugin provides a focused Python workflow inside the shared LotaGate
guest runtime. The skill uses `python-pptx` for Open XML structure and
optionally installs and version-checks image or rendering packages only when
the requested operation needs them.

The workflow has no document handles, Office/COM automation, LibreOffice
requirement, or format-specific host backend. It validates the output package,
reports visual-rendering limitations honestly, and publishes completed files
through the generic artifact flow.

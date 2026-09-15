# Docs

The Docs plugin provides a focused Python workflow inside the shared LotaGate
guest runtime. The skill uses `python-docx` for DOCX content and structure,
preflights and version-checks packages in a guest-local virtual environment,
writes atomically, validates the result, and publishes completed files through
the generic artifact flow.

The workflow has no document handles, Office/COM automation, LibreOffice
requirement, or native document backend. Legacy formats and high-fidelity
rendering are reported as explicit limitations when no approved Python path is
available.

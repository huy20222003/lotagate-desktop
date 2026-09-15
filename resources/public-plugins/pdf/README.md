# PDF

The PDF plugin provides a focused Python workflow inside the shared LotaGate
guest runtime. The skill instructs the agent to preflight Python, create or
reuse a guest-local virtual environment, install and version-check only the
packages required for the requested operation, validate the output, and
publish completed files as artifacts.

The plugin has no format-specific host backend, document handles, Office
dependency, or bundled PDF utility. Workspace paths remain bounded by the
generic filesystem/shell policy, and unsupported capabilities are reported
explicitly.

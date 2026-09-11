# Computer Use

Computer Use lets LotaGate operate an approved desktop application through the
native host provider for the current operating system. The plugin contains
agent guidance only; Desktop owns window targeting, accessibility integration,
input dispatch, screenshots, OCR, permissions, approval, and cancellation.

The available tool set is negotiated at runtime. Windows provides the full
UI Automation surface; macOS and Linux expose the operations supported by the
installed accessibility and desktop helpers. Unsupported operations are not
advertised to the model and are rejected by the host if requested directly.

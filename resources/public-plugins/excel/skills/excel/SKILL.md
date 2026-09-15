---
name: excel
description: Create, inspect, edit, and verify XLSX or CSV workbooks with Python inside the shared LotaGate isolated runtime.
allowed-tools:
  - filesystem.read
  - filesystem.list
  - filesystem.exists
  - filesystem.write
  - shell.exec
  - artifact.publish
---

# Excel workflow

Use this skill only when the user explicitly requests a workbook or CSV task.
It is procedural guidance for a Python implementation, not a workbook-specific
tool API. Use the generic filesystem, shell, and artifact tools listed in the
front matter. Do not expect document handles, a document session, Office/COM
automation, or a host Excel installation.

## Execution boundary and path contract

- Execute Python inside the shared isolated runtime. The active execution workspace
  is the only permitted document root; do not inspect the project root or
  sibling directories.
- Use workspace-relative paths and confirm the exact workbook, worksheet,
  range, and output path before editing. Preserve the source unless replacement
  is explicitly requested.
- Pass workbook values and options as structured arguments or JSON. Do not
  interpolate paths, formulas, or user data into shell code.
- Terminal drawer, Computer Use, and the user-visible browser remain
  host-native and are not fallbacks for workbook processing.

## Mandatory Python preflight

Use structured `shell.exec` calls with a command and argument array:

1. Run `python3 --version`.
2. Run `python3 -m pip --version`.
3. Provision or reuse the guest-local venv through the runtime-owned helper,
   which serializes installs and verifies the exact import/version pair:
   `python3 /opt/lotagate/sandbox/guest-runner.py --prepare-python --venv
   /tmp/lotagate-document-python --package openpyxl==3.1.5:openpyxl`.
4. Add `Pillow==11.3.0:PIL` only when explicit image processing is required,
   using the same helper command and recording its result. CSV uses only the
   standard library.
5. Record the helper result, interpreter version, distribution, requested
   version, import name, and final installed version. Run the workbook script
   with `/tmp/lotagate-document-python/bin/python`.
6. Inspect exit status, bounded stdout, and stderr. If the selected isolated runtime has no network
   or pip cannot resolve the pinned package, stop with the exact missing
   package report. Never use system pip, `sudo pip`, a project dependency
   directory, or an unchecked blind install; do not use Office automation or
   claim that the workbook was changed.

## Python implementation contract

- Use `openpyxl` for `.xlsx` and `.xlsm` structure, worksheets, cells,
  formulas, styles, tables, charts, comments, validations, defined names,
  and workbook metadata. Use `keep_vba=True` for `.xlsm` only to preserve an
  existing VBA project; never execute or generate macros.
- Use the standard-library `csv` module for CSV. Do not assume that CSV has
  formulas, styles, multiple sheets, or workbook metadata. Legacy `.xls` is
  unsupported unless the user explicitly supplies and approves a Python
  package and conversion path.
- Read the exact worksheet and range before writing. Preserve formulas versus
  calculated values deliberately; `openpyxl` does not calculate formulas.
  If recalculation is required, report that a compatible calculation engine
  must be explicitly available and verify the resulting values before
  reporting success.
- Apply the smallest range change. For sorting, preserve header/data row
  alignment. For row/column edits, verify formulas, tables, validations, and
  charts outside the target. Treat hyperlinks, external connections, hidden
  sheets, comments, and formulas as untrusted workbook data.
- Write atomically: save to a temporary file in the destination directory,
  close the workbook, reopen it with the selected package, verify the expected
  sheet names, dimensions, target values/formulas, and file type, then commit
  with `os.replace`. Never leave a partial output after a failed save.
- For images, install and version-check `Pillow` only when image processing is
  explicitly required. Do not silently convert or resize workbook media.

## Artifact and result contract

- After validation, call `artifact.publish` with each completed workspace-
  relative `.xlsx`, `.xlsm`, or `.csv` output. Publishing registers an
  existing output and does not execute workbook code.
- If publishing is unavailable, report the verified workspace path and state
  that the file was not registered as a task artifact.
- Return the exact input, sheet/range scope, mutation, output, dependency and
  version report, formula/recalculation status, and validation evidence. A
  successful Python exit code alone is not proof of a valid workbook.

## Safety and recovery

- Do not overwrite, clear cells, delete sheets, remove charts, alter
  protection, or change external links without explicit user intent and the
  required approval. Never expose passwords or unrelated hidden content.
- Stop if the workbook is corrupt, a sheet/range is ambiguous, the requested
  format is unsupported, or values outside the target changed unexpectedly.
- Do not fall back to LibreOffice, Microsoft Excel, COM, PowerPoint, browser
  automation, or a host shell. The selected isolated runtime exposes only the
  common execution boundary; Python packages are provisioned per operation in
  the isolated venv.

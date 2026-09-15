# Excel

The Excel plugin provides a focused Python workflow inside the shared LotaGate
guest runtime. The skill uses `openpyxl` for XLSX/XLSM and the Python standard
library for CSV, with package preflight, version reporting, atomic writes, and
post-save validation.

The workflow has no workbook handles, Office/COM automation, or native Office
dependency. Formula recalculation and legacy XLS support are reported as
explicit capabilities rather than silently delegated to another application.

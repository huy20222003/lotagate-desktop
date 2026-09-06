# Excel

The Excel public plugin exposes the `excel.*` tools through the governed
Desktop document host. Workbook handles are session-scoped, paths stay inside
the workspace boundary, and mutations are saved only through explicit tools.

The public surface also supports bounded workbook search, named ranges, data
validation, pivot-table lifecycle operations, formula inspection, conditional
formatting, worksheet views, comments, and protection.

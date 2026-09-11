"""Real LibreOffice UNO implementation for spreadsheet operations."""

import csv
from pathlib import Path

import uno

from portable_office_support import (
    conditional_style,
    constant,
    configure_pivot_fields,
    fail,
    filter_operator,
    prop,
    selected_sheet,
    unsupported,
    validation_operator,
    validation_type,
)


def execute_spreadsheet(bridge, operation, params):
    handlers = {
        "setDataValidation": manage_validation,
        "manageConditionalFormatting": manage_conditional_formatting,
        "manageSheetView": manage_sheet_view,
        "manageComments": manage_spreadsheet_comments,
        "managePivotTable": manage_pivot_table,
        "manageTable": manage_table,
        "manageChart": manage_chart,
        "filterRange": filter_range,
        "exportCsv": export_csv,
    }
    handler = handlers.get(operation)
    return None if handler is None else handler(bridge, params)


def manage_validation(bridge, params):
    sheet = selected_sheet(bridge.document, params)
    cell_range = sheet.getCellRangeByName(str(params.get("range", "A1")))
    validation = cell_range.Validation
    mode = str(params.get("operation", "set"))
    if mode == "clear":
        validation.Type = constant("com.sun.star.sheet.ValidationType.ANY")
        cell_range.Validation = validation
    elif mode == "set":
        options = params.get("options") if isinstance(params.get("options"), dict) else {}
        validation.Type = validation_type(options.get("type", "custom"))
        validation.Operator = validation_operator(options.get("operator", "equal"))
        validation.Formula1 = str(params.get("formula1", options.get("formula1", "")))
        validation.Formula2 = str(params.get("formula2", options.get("formula2", "")))
        validation.ShowErrorMessage = bool(options.get("showErrorMessage", True))
        validation.ErrorMessage = str(options.get("errorMessage", "The value is not valid."))
        cell_range.Validation = validation
    else:
        return unsupported(mode)
    bridge.document.store()
    return {
        "operation": mode,
        "sheet": sheet.Name,
        "range": cell_range.AbsoluteName,
        "updated": True,
        "backend": "libreoffice-uno",
    }


def manage_conditional_formatting(bridge, params):
    sheet = selected_sheet(bridge.document, params)
    cell_range = sheet.getCellRangeByName(str(params.get("range", "A1")))
    entries = cell_range.ConditionalFormat
    mode = str(params.get("operation", "list"))
    if mode == "list":
        rules = []
        for index in range(entries.getCount()):
            item = entries.getByIndex(index)
            rules.append({
                "index": index,
                "operator": str(getattr(item, "Operator", "")),
                "formula1": str(getattr(item, "Formula1", "")),
                "formula2": str(getattr(item, "Formula2", "")),
                "styleName": str(getattr(item, "StyleName", "")),
            })
        return {
            "operation": mode,
            "sheet": sheet.Name,
            "range": cell_range.AbsoluteName,
            "rules": rules,
            "backend": "libreoffice-uno",
        }
    if mode == "clear":
        entries.clear()
    elif mode == "set":
        options = params.get("options") if isinstance(params.get("options"), dict) else {}
        entries.clear()
        style_name = conditional_style(bridge.document, options)
        entries.addNew((
            prop("Operator", validation_operator(options.get("operator", "equal"))),
            prop("Formula1", str(params.get("formula1", options.get("formula1", "")))),
            prop("Formula2", str(params.get("formula2", options.get("formula2", "")))),
            prop("SourcePosition", cell_range.getCellAddress()),
            prop("StyleName", style_name),
        ))
    else:
        return unsupported(mode)
    cell_range.ConditionalFormat = entries
    bridge.document.store()
    return {
        "operation": mode,
        "sheet": sheet.Name,
        "range": cell_range.AbsoluteName,
        "updated": True,
        "backend": "libreoffice-uno",
    }


def manage_sheet_view(bridge, params):
    sheet = selected_sheet(bridge.document, params)
    mode = str(params.get("operation", "list"))
    controller = bridge.document.CurrentController
    if mode == "list":
        return {
            "operation": mode,
            "sheet": sheet.Name,
            "visible": bool(sheet.IsVisible),
            "backend": "libreoffice-uno",
        }
    if mode == "freeze":
        address = sheet.getCellRangeByName(str(params.get("range", "A1"))).getCellAddress()
        controller.freezeAtPosition(address.Column, address.Row)
    elif mode == "unfreeze":
        controller.unfreeze()
    elif mode == "set":
        options = params.get("options") if isinstance(params.get("options"), dict) else params
        if "visible" in options:
            sheet.IsVisible = bool(options["visible"])
        if "zoom" in options and hasattr(controller, "ZoomValue"):
            controller.ZoomValue = max(10, min(400, int(options["zoom"])))
    else:
        return unsupported(mode)
    bridge.document.store()
    return {"operation": mode, "sheet": sheet.Name, "updated": True, "backend": "libreoffice-uno"}


def manage_spreadsheet_comments(bridge, params):
    sheet = selected_sheet(bridge.document, params)
    address = str(params.get("range", "A1"))
    cell = sheet.getCellRangeByName(address)
    annotations = sheet.getAnnotations() if hasattr(sheet, "getAnnotations") else sheet.Annotations
    mode = str(params.get("operation", "list"))
    position = cell.getCellAddress()
    index = annotation_index(annotations, position)
    if mode == "list":
        if index is None:
            return {"operation": mode, "comments": [], "backend": "libreoffice-uno"}
        annotation = annotations.getByIndex(index)
        return {
            "operation": mode,
            "comments": [{
                "address": address,
                "text": annotation.String,
                "author": annotation.getAuthor(),
            }],
            "backend": "libreoffice-uno",
        }
    if mode == "add":
        annotations.insertNew(position, str(params.get("text", params.get("content", ""))))
    elif mode == "update":
        if index is None:
            fail("The target cell does not contain a comment.")
        annotations.getByIndex(index).String = str(params.get("text", params.get("content", "")))
    elif mode == "delete":
        if index is not None:
            annotations.removeByIndex(index)
    else:
        return unsupported(mode)
    bridge.document.store()
    return {"operation": mode, "address": address, "updated": True, "backend": "libreoffice-uno"}


def annotation_index(annotations, position):
    for index in range(annotations.getCount()):
        current = annotations.getByIndex(index).getPosition()
        if current.Sheet == position.Sheet and current.Column == position.Column and current.Row == position.Row:
            return index
    return None


def manage_pivot_table(bridge, params):
    sheet = selected_sheet(bridge.document, params)
    tables = sheet.getDataPilotTables()
    mode = str(params.get("operation", "list"))
    if mode == "list":
        return {
            "operation": mode,
            "pivots": [{"name": name} for name in tables.getElementNames()],
            "backend": "libreoffice-uno",
        }
    name = str(params.get("tableName", params.get("name", "")))
    if mode == "refresh":
        tables.getByName(name).refresh()
    elif mode == "delete":
        tables.removeByName(name)
    elif mode == "create":
        source = sheet.getCellRangeByName(str(params.get("sourceRange", "A1:B2"))).getRangeAddress()
        output = sheet.getCellRangeByName(str(params.get("range", "A1"))).getCellAddress()
        if not name:
            fail("A pivot table name is required.")
        descriptor = tables.createDataPilotDescriptor()
        descriptor.setSourceRange(source)
        fields = descriptor.getDataPilotFields()
        options = params.get("options") if isinstance(params.get("options"), dict) else {}
        configure_pivot_fields(fields, options)
        tables.insertNewByName(name, output, descriptor)
    else:
        return unsupported(mode)
    bridge.document.store()
    return {"operation": mode, "name": name, "updated": True, "backend": "libreoffice-uno"}


def manage_table(bridge, params):
    sheet = selected_sheet(bridge.document, params)
    tables = bridge.document.DatabaseRanges
    mode = str(params.get("operation", "list"))
    if mode == "list":
        return {
            "operation": mode,
            "tables": [{
                "name": name,
                "range": str(tables.getByName(name).getDataArea().Address),
            } for name in tables.getElementNames()],
            "backend": "libreoffice-uno",
        }
    name = str(params.get("tableName", params.get("name", "")))
    if not name:
        fail("A table name is required.")
    if mode == "delete":
        if not tables.hasByName(name):
            fail("The table was not found.")
        tables.removeByName(name)
    elif mode in {"create", "update"}:
        if mode == "update" and tables.hasByName(name):
            tables.removeByName(name)
        address = sheet.getCellRangeByName(str(params.get("range", "A1:B2"))).getRangeAddress()
        tables.addNewByName(name, address)
    else:
        return unsupported(mode)
    bridge.document.store()
    return {"operation": mode, "name": name, "updated": True, "backend": "libreoffice-uno"}


def manage_chart(bridge, params):
    sheet = selected_sheet(bridge.document, params)
    charts = sheet.Charts
    mode = str(params.get("operation", "list"))
    if mode == "list":
        return {
            "operation": mode,
            "charts": list(charts.getElementNames()),
            "backend": "libreoffice-uno",
        }
    name = str(params.get("name", params.get("tableName", "Chart")))
    if mode == "create":
        source = sheet.getCellRangeByName(
            str(params.get("sourceRange", params.get("range", "A1:B2")))
        ).getRangeAddress()
        options = params.get("options") if isinstance(params.get("options"), dict) else {}
        rectangle = uno.createUnoStruct("com.sun.star.awt.Rectangle")
        rectangle.X = int(options.get("x", 0))
        rectangle.Y = int(options.get("y", 0))
        rectangle.Width = int(options.get("width", 10_000))
        rectangle.Height = int(options.get("height", 6_000))
        charts.addNewByName(name, rectangle, (source,), True, True)
    elif mode == "update":
        chart = charts.getByName(name).EmbeddedObject
        options = params.get("options") if isinstance(params.get("options"), dict) else params
        if "title" in options and hasattr(chart, "Title"):
            chart.Title.String = str(options["title"])
    elif mode == "delete":
        charts.removeByName(name)
    else:
        return unsupported(mode)
    bridge.document.store()
    return {"operation": mode, "name": name, "updated": True, "backend": "libreoffice-uno"}


def filter_range(bridge, params):
    sheet = selected_sheet(bridge.document, params)
    cell_range = sheet.getCellRangeByName(str(params.get("range", "A1")))
    mode = str(params.get("operation", "set"))
    descriptor = cell_range.createFilterDescriptor(True)
    if mode == "set":
        options = params.get("options") if isinstance(params.get("options"), dict) else params
        field = uno.createUnoStruct("com.sun.star.sheet.TableFilterField")
        field.Field = int(options.get("field", 0))
        field.Operator = filter_operator(options.get("operator", "equal"))
        field.StringValue = str(options.get("value", params.get("query", "")))
        descriptor.setFilterFields((field,))
        descriptor.ContainsHeader = bool(options.get("containsHeader", True))
    elif mode != "clear":
        return unsupported(mode)
    cell_range.filter(descriptor)
    bridge.document.store()
    return {
        "operation": mode,
        "range": cell_range.AbsoluteName,
        "updated": True,
        "backend": "libreoffice-uno",
    }


def export_csv(bridge, params):
    sheet = selected_sheet(bridge.document, params)
    cell_range = export_range(sheet, params)
    output = Path(params.get("outputPath") or bridge.path.with_suffix(".csv")).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    rows = cell_range.getDataArray()
    with output.open("w", newline="", encoding="utf-8") as stream:
        csv.writer(stream).writerows(rows)
    address = cell_range.getRangeAddress()
    return {
        "operation": "exportCsv",
        "path": str(output),
        "sheet": sheet.Name,
        "range": str(params.get("range", "")) or range_name(address),
        "rows": len(rows),
        "columns": max((len(row) for row in rows), default=0),
        "backend": "libreoffice-uno",
    }


def export_range(sheet, params):
    requested = params.get("range")
    if requested:
        return sheet.getCellRangeByName(str(requested))
    cursor = sheet.createCursor()
    cursor.gotoEndOfUsedArea(True)
    address = cursor.getRangeAddress()
    return sheet.getCellRangeByPosition(
        address.StartColumn,
        address.StartRow,
        address.EndColumn,
        address.EndRow,
    )


def range_name(address):
    return f"{column_name(address.StartColumn)}{address.StartRow + 1}:{column_name(address.EndColumn)}{address.EndRow + 1}"


def column_name(index):
    value = index + 1
    result = ""
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result

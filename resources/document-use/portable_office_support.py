"""Shared LibreOffice UNO helpers used by every portable Office adapter."""

import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


def constant(name):
    return uno.getConstantByName(name)


def fail(message):
    raise RuntimeError(message)


def unsupported(operation):
    fail(f"Portable Office operation '{operation}' is not supported by the configured UNO bridge.")


def selected_sheet(document, params):
    requested = params.get("sheet")
    return document.Sheets.getByName(str(requested)) if requested else document.Sheets.getByIndex(0)


def shapes(page):
    return [page.getByIndex(index) for index in range(page.getCount())]


def shape_by_name(page, name):
    return next((shape for shape in shapes(page) if str(shape.Name) == name), None)


def url_fields(document):
    fields = []
    text_fields = document.getTextFields()
    for name in text_fields.getElementNames():
        field = text_fields.getByName(name)
        if hasattr(field, "URL"):
            fields.append(field)
    return fields


def annotation_fields(document):
    fields = document.getTextFields()
    result = []
    for name in fields.getElementNames():
        field = fields.getByName(name)
        if "Annotation" in getattr(field, "ImplementationName", ""):
            result.append((name, field))
    return result


def text_cursor(document, params):
    cursor = document.Text.createTextCursor()
    start = max(0, int(params.get("start", 0)))
    end = max(start, int(params.get("end", start)))
    cursor.gotoStart(False)
    cursor.goRight(start, False)
    cursor.goRight(end - start, True)
    return cursor


def configure_pivot_fields(fields, options):
    orientations = {
        "row": "com.sun.star.sheet.DataPilotFieldOrientation.ROW",
        "column": "com.sun.star.sheet.DataPilotFieldOrientation.COLUMN",
        "data": "com.sun.star.sheet.DataPilotFieldOrientation.DATA",
        "page": "com.sun.star.sheet.DataPilotFieldOrientation.PAGE",
    }
    for key, orientation_name in (
        ("rowFields", "row"),
        ("columnFields", "column"),
        ("dataFields", "data"),
        ("pageFields", "page"),
    ):
        names = options.get(key, [])
        for field_name in names if isinstance(names, list) else []:
            if fields.hasByName(str(field_name)):
                fields.getByName(str(field_name)).Orientation = constant(orientations[orientation_name])


def conditional_style(document, options):
    name = str(options.get("styleName", "Default"))
    if "backgroundColor" not in options and "fontColor" not in options:
        return name
    styles = document.StyleFamilies.getByName("CellStyles")
    generated = "LotaGateConditionalStyle"
    if not styles.hasByName(generated):
        styles.insertByName(generated, document.createInstance("com.sun.star.style.CellStyle"))
    style = styles.getByName(generated)
    if "backgroundColor" in options:
        style.CellBackColor = int(options["backgroundColor"])
    if "fontColor" in options:
        style.CharColor = int(options["fontColor"])
    return generated


def validation_type(value):
    if isinstance(value, int):
        return value
    mapping = {
        "any": "ANY",
        "whole": "WHOLE",
        "decimal": "DECIMAL",
        "date": "DATE",
        "time": "TIME",
        "cellrange": "CELL_RANGE",
        "list": "LIST",
        "textlength": "TEXT_LEN",
        "custom": "CUSTOM",
    }
    return constant("com.sun.star.sheet.ValidationType." + mapping.get(str(value).lower(), "CUSTOM"))


def validation_operator(value):
    if isinstance(value, int):
        return value
    mapping = {
        "equal": "EQUAL",
        "notequal": "NOT_EQUAL",
        "less": "LESS",
        "lessequal": "LESS_EQUAL",
        "greater": "GREATER",
        "greaterequal": "GREATER_EQUAL",
        "between": "BETWEEN",
        "notbetween": "NOT_BETWEEN",
    }
    return constant("com.sun.star.sheet.ConditionOperator." + mapping.get(str(value).lower(), "EQUAL"))


def filter_operator(value):
    mapping = {
        "equal": "EQUAL",
        "notequal": "NOT_EQUAL",
        "contains": "CONTAINS",
        "beginswith": "BEGINS_WITH",
        "endswith": "ENDS_WITH",
    }
    return constant("com.sun.star.sheet.FilterOperator2." + mapping.get(str(value).lower(), "EQUAL"))

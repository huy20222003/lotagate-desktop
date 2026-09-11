"""Shared LibreOffice UNO handlers for advanced portable Office operations.

The bridge owns process and document lifecycle.  This module routes each
format-specific operation to one cohesive adapter so macOS and Linux share the
same implementation and operation semantics.
"""

from portable_office_presentation import execute_presentation
from portable_office_spreadsheet import execute_spreadsheet
from portable_office_support import (
    annotation_fields,
    fail,
    text_cursor,
    unsupported,
    url_fields,
)


def execute_extended(bridge, operation, params):
    if bridge.format_name == "docs":
        return execute_docs(bridge, operation, params)
    if bridge.format_name == "excel":
        return execute_spreadsheet(bridge, operation, params)
    if bridge.format_name == "pptx":
        return execute_presentation(bridge, operation, params)
    return None


def execute_docs(bridge, operation, params):
    handlers = {
        "manageComments": manage_doc_comments,
        "manageHyperlinks": manage_doc_hyperlinks,
    }
    handler = handlers.get(operation)
    return None if handler is None else handler(bridge, params)


def manage_doc_comments(bridge, params):
    comments = annotation_fields(bridge.document)
    mode = str(params.get("operation", "list"))
    if mode == "list":
        return {
            "operation": mode,
            "comments": [{
                "index": index,
                "name": field_name,
                "text": str(getattr(field, "Content", "")),
            } for index, (field_name, field) in enumerate(comments)],
            "backend": "libreoffice-uno",
        }
    if mode == "add":
        comment = bridge.document.createInstance("com.sun.star.text.textfield.Annotation")
        comment.Content = str(params.get("text", params.get("content", "")))
        bridge.document.Text.insertTextContent(text_cursor(bridge.document, params), comment, False)
        bridge.document.store()
        return {
            "operation": mode,
            "name": str(getattr(comment, "Name", "")),
            "updated": True,
            "backend": "libreoffice-uno",
        }
    index = int(params.get("index", -1))
    if index < 0 or index >= len(comments):
        fail("The document comment index is invalid.")
    field_name, field = comments[index]
    if mode == "update":
        field.Content = str(params.get("text", params.get("content", "")))
    elif mode == "delete":
        bridge.document.Text.removeTextContent(field)
    else:
        return unsupported(mode)
    bridge.document.store()
    return {
        "operation": mode,
        "index": index,
        "name": field_name,
        "updated": True,
        "backend": "libreoffice-uno",
    }


def manage_doc_hyperlinks(bridge, params):
    fields = url_fields(bridge.document)
    mode = str(params.get("operation", "list"))
    if mode == "list":
        return {
            "operation": mode,
            "hyperlinks": [{
                "index": index,
                "address": field.URL,
                "text": field.Representation or field.URL,
            } for index, field in enumerate(fields)],
            "backend": "libreoffice-uno",
        }
    if mode == "add":
        field = bridge.document.createInstance("com.sun.star.text.textfield.URL")
        field.URL = str(params.get("address", ""))
        field.Representation = str(params.get("text", field.URL))
        bridge.document.Text.insertTextContent(text_cursor(bridge.document, params), field, False)
        bridge.document.store()
        return {
            "operation": mode,
            "address": field.URL,
            "updated": True,
            "backend": "libreoffice-uno",
        }
    index = int(params.get("index", -1))
    if index < 0 or index >= len(fields):
        fail("The document hyperlink index is invalid.")
    field = fields[index]
    if mode == "update":
        if "address" in params:
            field.URL = str(params["address"])
        if "text" in params:
            field.Representation = str(params["text"])
    elif mode == "delete":
        bridge.document.Text.removeTextContent(field)
    else:
        return unsupported(mode)
    bridge.document.store()
    return {
        "operation": mode,
        "index": index,
        "updated": True,
        "backend": "libreoffice-uno",
    }

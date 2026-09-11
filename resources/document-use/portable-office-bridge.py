#!/usr/bin/env python3
"""LibreOffice UNO bridge for the portable document provider.

The bridge is intentionally optional.  Desktop probes the `uno` module before
advertising these operations and invokes this file as a bounded, shell-free
JSONL-style one-request process.
"""

import json
import csv
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import uno
from portable_office_extended import execute_extended
from portable_office_support import fail, prop, shape_by_name, shapes, text_cursor, unsupported


def main():
    request = json.load(sys.stdin)
    action = request.get("action", "")
    format_name, operation = action.split(".", 1)
    path = Path(request["path"]).resolve()
    params = request.get("params") or {}
    bridge = OfficeBridge(format_name, path)
    try:
        result = bridge.execute(operation, params)
        json.dump(result, sys.stdout, separators=(",", ":"))
    finally:
        bridge.close()


class OfficeBridge:
    def __init__(self, format_name, path):
        self.format_name = format_name
        self.path = path
        self.profile = Path(tempfile.mkdtemp(prefix="lotagate-office-profile-"))
        self.process = None
        self.document = None
        self.desktop = self.connect()

    def connect(self):
        port = free_port()
        soffice = shutil.which("soffice") or shutil.which("libreoffice")
        if soffice is None:
            fail("LibreOffice executable was not found on PATH.")
        profile_url = uno.systemPathToFileUrl(str(self.profile))
        self.process = subprocess.Popen([soffice, "--headless", "--nologo", "--nodefault", "--nofirststartwizard", "--norestore", f"-env:UserInstallation={profile_url}", f"--accept=socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        for _ in range(80):
            try:
                context = resolver.resolve(f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext")
                return context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
            except Exception:
                time.sleep(0.1)
        fail("LibreOffice did not start its UNO bridge.")

    def execute(self, operation, params):
        if operation == "create":
            return self.create(params)
        self.document = self.load(read_only=operation in {"inspect", "readContent", "extractText", "inspectStructure", "readRange", "readFormulas", "readSlide", "find"})
        extended = execute_extended(self, operation, params)
        if extended is not None:
            return extended
        if operation in {"readContent", "extractText"} and self.format_name == "docs":
            return {"format": "docs", "content": self.document.Text.String, "backend": "libreoffice-uno"}
        if operation == "inspectStructure" and self.format_name == "docs":
            return {"operation": operation, "paragraphs": self.doc_paragraphs(), "backend": "libreoffice-uno"}
        if operation == "findReplace":
            return self.find_replace(params)
        if operation in {"insertContent", "updateContent", "deleteContent"} and self.format_name == "docs":
            return self.edit_docs(operation, params)
        if operation == "updateFields" and self.format_name == "docs":
            updated = 0
            fields = self.document.getTextFields()
            enumeration = fields.createEnumeration()
            while enumeration.hasMoreElements():
                field = enumeration.nextElement()
                if hasattr(field, "update"):
                    field.update()
                    updated += 1
            self.document.updateLinks()
            self.document.store()
            return {"updated": True, "fields": updated, "backend": "libreoffice-uno"}
        if self.format_name == "docs":
            return self.execute_docs(operation, params)
        if self.format_name == "excel":
            return self.execute_excel(operation, params)
        if self.format_name == "pptx":
            return self.execute_pptx(operation, params)
        fail(f"Portable Office operation '{self.format_name}.{operation}' is not supported by the UNO bridge.")

    def create(self, params):
        factories = {"docs": "private:factory/swriter", "excel": "private:factory/scalc", "pptx": "private:factory/simpress"}
        self.document = self.desktop.loadComponentFromURL(factories[self.format_name], "_blank", 0, (prop("Hidden", True),))
        self.store(self.path)
        return {"created": True, "format": self.format_name, "path": str(self.path), "backend": "libreoffice-uno"}

    def load(self, read_only=False):
        if not self.path.exists():
            fail("The Office document does not exist.")
        return self.desktop.loadComponentFromURL(uno.systemPathToFileUrl(str(self.path)), "_blank", 0, (prop("Hidden", True), prop("ReadOnly", read_only), prop("UpdateDocMode", 3)))

    def store(self, target):
        target = Path(target).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        self.document.storeAsURL(uno.systemPathToFileUrl(str(target)), (prop("FilterName", filter_for(target)),))

    def export_pdf(self, params):
        output = Path(params.get("outputPath") or self.path.with_suffix(".pdf")).resolve()
        self.store_to(output, "calc_pdf_Export" if self.format_name == "excel" else "impress_pdf_Export" if self.format_name == "pptx" else "writer_pdf_Export")
        return {"path": str(output), "backend": "libreoffice-uno"}

    def store_to(self, target, filter_name):
        target.parent.mkdir(parents=True, exist_ok=True)
        self.document.storeToURL(uno.systemPathToFileUrl(str(target)), (prop("FilterName", filter_name),))

    def doc_paragraphs(self):
        values = []
        enumeration = self.document.Text.createEnumeration()
        while enumeration.hasMoreElements() and len(values) < 1000:
            item = enumeration.nextElement()
            if hasattr(item, "String"):
                values.append({"index": len(values), "text": item.String.strip(), "style": getattr(item, "ParaStyleName", "")})
        return values

    def edit_docs(self, operation, params):
        start = max(0, int(params.get("start", 0)))
        end = max(start, int(params.get("end", start)))
        cursor = self.document.Text.createTextCursor()
        cursor.gotoStart(False)
        cursor.goRight(start, False)
        cursor.goRight(end - start, True)
        if operation == "insertContent":
            self.document.Text.insertString(cursor, str(params.get("content", params.get("text", ""))), False)
        elif operation == "updateContent":
            cursor.String = str(params.get("content", params.get("text", "")))
        else:
            cursor.String = ""
        self.document.store()
        return {"operation": operation, "updated": True, "backend": "libreoffice-uno"}

    def find_replace(self, params):
        descriptor = self.document.createReplaceDescriptor()
        descriptor.SearchString = str(params.get("find", ""))
        descriptor.ReplaceString = str(params.get("replace", ""))
        count = self.document.replaceAll(descriptor)
        self.document.store()
        return {"operation": "findReplace", "replacements": int(count), "backend": "libreoffice-uno"}

    def execute_docs(self, operation, params):
        if operation in {"exportPdf", "render"}:
            return self.export_pdf(params)
        if operation == "manageTable":
            tables = self.document.TextTables
            mode = str(params.get("operation", "list"))
            names = list(tables.getElementNames())
            if mode == "list":
                return {"operation": mode, "tables": [{"name": name, "rows": tables.getByName(name).getRows().getCount(), "columns": tables.getByName(name).getColumns().getCount()} for name in names], "backend": "libreoffice-uno"}
            name = str(params.get("name") or (names[int(params.get("index", 0))] if names else ""))
            if mode == "read":
                table = tables.getByName(name); rows = []
                for row in range(table.getRows().getCount()):
                    rows.append([table.getCellByName(f"{column}{row + 1}").String for column in column_names(table.getColumns().getCount())])
                return {"operation": mode, "name": name, "rows": rows, "backend": "libreoffice-uno"}
            if mode in {"insert", "create"}:
                table = self.document.createInstance("com.sun.star.text.TextTable")
                table.initialize(max(1, int(params.get("rowCount", 1))), max(1, int(params.get("columnCount", 1))))
                cursor = self.document.Text.createTextCursor(); self.document.Text.insertTextContent(cursor, table, False); self.document.store()
                return {"operation": mode, "name": table.Name, "updated": True, "backend": "libreoffice-uno"}
            table = tables.getByName(name)
            if mode == "delete": self.document.Text.removeTextContent(table)
            elif mode == "update":
                values = params.get("values")
                if not isinstance(values, list): fail("docs.manageTable update requires values.")
                for row, values_row in enumerate(values):
                    if not isinstance(values_row, list): continue
                    for column, value in enumerate(values_row):
                        if row < table.getRows().getCount() and column < table.getColumns().getCount(): table.getCellByName(f"{column_names(table.getColumns().getCount())[column]}{row + 1}").String = str(value)
            else: return unsupported(mode)
            self.document.store(); return {"operation": mode, "name": name, "updated": True, "backend": "libreoffice-uno"}
        if operation == "manageImage":
            graphics = self.document.GraphicObjects; mode = str(params.get("operation", "list")); names = list(graphics.getElementNames())
            if mode == "list": return {"operation": mode, "images": [{"name": name, "width": graphics.getByName(name).Size.Width, "height": graphics.getByName(name).Size.Height, "altText": str(getattr(graphics.getByName(name), "Description", ""))} for name in names], "backend": "libreoffice-uno"}
            name = str(params.get("name") or (names[int(params.get("index", 0))] if names else ""))
            if mode == "insert":
                image = self.document.createInstance("com.sun.star.text.TextGraphicObject"); image.GraphicURL = uno.systemPathToFileUrl(str(Path(params["imagePath"]).resolve())); image.Name = name or f"Image{len(names) + 1}"
                cursor = self.document.Text.createTextCursor(); self.document.Text.insertTextContent(cursor, image, False); self.document.store(); return {"operation": mode, "name": image.Name, "updated": True, "backend": "libreoffice-uno"}
            image = graphics.getByName(name)
            if mode == "delete": self.document.Text.removeTextContent(image)
            elif mode == "update":
                size = image.Size; size.Width = int(params.get("width", size.Width)); size.Height = int(params.get("height", size.Height)); image.Size = size
                if "altText" in params and hasattr(image, "Description"): image.Description = str(params["altText"])
            else: return unsupported(mode)
            self.document.store(); return {"operation": mode, "name": name, "updated": True, "backend": "libreoffice-uno"}
        if operation == "fillTemplate":
            values = params.get("values")
            if not isinstance(values, dict): fail("docs.fillTemplate requires a values object.")
            replacements = 0
            for key, value in values.items():
                descriptor = self.document.createReplaceDescriptor(); descriptor.SearchString = "{{" + str(key) + "}}"; descriptor.ReplaceString = str(value); replacements += int(self.document.replaceAll(descriptor))
            self.document.store(); return {"operation": operation, "replacements": replacements, "updated": replacements > 0, "backend": "libreoffice-uno"}
        if operation == "setStyles":
            cursor = text_cursor(self.document, params); options = params.get("options") if isinstance(params.get("options"), dict) else params
            if "style" in options: cursor.ParaStyleName = str(options["style"])
            if "bold" in options: cursor.CharWeight = 150.0 if options["bold"] else 100.0
            if "italic" in options: cursor.CharPosture = 2 if options["italic"] else 0
            if "fontSize" in options: cursor.CharHeight = float(options["fontSize"])
            if "color" in options: cursor.CharColor = int(options["color"])
            self.document.store(); return {"operation": operation, "updated": True, "backend": "libreoffice-uno"}
        if operation == "setSection": return self.update_page_style(params)
        if operation == "setHeaderFooter": return self.update_header_footer(params)
        if operation == "manageBookmarks": return self.manage_bookmarks(params)
        if operation == "manageLists": return self.manage_lists(params)
        if operation == "manageFootnotes": return self.manage_footnotes(params)
        if operation == "manageRevisions":
            mode = str(params.get("operation", "status")); current = bool(getattr(self.document, "RecordChanges", False))
            if mode in {"track", "enable"}: self.document.RecordChanges = True; current = True
            elif mode in {"untrack", "disable"}: self.document.RecordChanges = False; current = False
            elif mode != "status": return unsupported(mode)
            if mode != "status": self.document.store()
            return {"operation": mode, "recordChanges": current, "backend": "libreoffice-uno"}
        return unsupported(operation)

    def update_page_style(self, params):
        families = self.document.StyleFamilies
        styles = families.getByName("PageStyles")
        style = styles.getByName(self.document.CurrentController.ViewCursor.PageStyleName) if hasattr(self.document, "CurrentController") else styles.getByIndex(0)
        options = params.get("options") if isinstance(params.get("options"), dict) else params
        for key, property_name in (("marginLeft", "LeftMargin"), ("marginRight", "RightMargin"), ("marginTop", "TopMargin"), ("marginBottom", "BottomMargin")):
            if key in options and hasattr(style, property_name): setattr(style, property_name, int(options[key]))
        self.document.store()
        return {"operation": "setSection", "updated": True, "backend": "libreoffice-uno"}

    def update_header_footer(self, params):
        families = self.document.StyleFamilies; styles = families.getByName("PageStyles"); style = styles.getByIndex(0); options = params.get("options") if isinstance(params.get("options"), dict) else params
        section = str(params.get("property", params.get("target", "header"))).lower(); text = str(params.get("content", params.get("text", "")))
        if section == "header":
            style.HeaderIsOn = True; style.HeaderText.String = text
        elif section == "footer":
            style.FooterIsOn = True; style.FooterText.String = text
        else: return unsupported(section)
        if options.get("enabled") is False: setattr(style, "HeaderIsOn" if section == "header" else "FooterIsOn", False)
        self.document.store(); return {"operation": "setHeaderFooter", "section": section, "updated": True, "backend": "libreoffice-uno"}

    def manage_bookmarks(self, params):
        bookmarks = self.document.getBookmarks(); mode = str(params.get("operation", "list")); names = list(bookmarks.getElementNames())
        if mode == "list": return {"operation": mode, "bookmarks": [{"name": name, "text": bookmarks.getByName(name).getAnchor().String} for name in names], "backend": "libreoffice-uno"}
        definition = params.get("bookmark") if isinstance(params.get("bookmark"), dict) else params; name = str(definition.get("name", definition.get("target", "")))
        if mode == "add":
            if not name: fail("A bookmark name is required.")
            bookmark = self.document.createInstance("com.sun.star.text.Bookmark"); bookmark.Name = name; cursor = text_cursor(self.document, definition); self.document.Text.insertTextContent(cursor, bookmark, True)
        elif mode == "delete":
            if name not in names: fail("The bookmark was not found.")
            self.document.Text.removeTextContent(bookmarks.getByName(name))
        elif mode == "update":
            if name not in names: fail("The bookmark was not found.")
            bookmarks.getByName(name).getAnchor().String = str(definition.get("text", ""))
        else: return unsupported(mode)
        self.document.store(); return {"operation": mode, "name": name, "updated": True, "backend": "libreoffice-uno"}

    def manage_lists(self, params):
        mode = str(params.get("operation", "list")); cursor = text_cursor(self.document, params)
        if mode == "list": return {"operation": mode, "style": getattr(cursor, "NumberingStyleName", ""), "backend": "libreoffice-uno"}
        if mode == "apply": cursor.NumberingStyleName = str(params.get("listType", "List 1")); cursor.NumberingStartValue = int(params.get("level", 1));
        elif mode == "clear": cursor.NumberingStyleName = ""
        else: return unsupported(mode)
        self.document.store(); return {"operation": mode, "updated": True, "backend": "libreoffice-uno"}

    def manage_footnotes(self, params):
        footnotes = self.document.getFootnotes(); mode = str(params.get("operation", "list"))
        if mode == "list": return {"operation": mode, "footnotes": [{"index": index, "text": footnotes.getByIndex(index).String} for index in range(footnotes.getCount())], "backend": "libreoffice-uno"}
        if mode == "add":
            note = self.document.createInstance("com.sun.star.text.Footnote"); note.Label = str(params.get("name", "")); note.String = str(params.get("content", params.get("text", ""))); self.document.Text.insertTextContent(text_cursor(self.document, params), note, False)
        elif mode == "delete":
            index = int(params.get("index", -1)); if_invalid(index, footnotes.getCount()); self.document.Text.removeTextContent(footnotes.getByIndex(index))
        else: return unsupported(mode)
        self.document.store(); return {"operation": mode, "updated": True, "backend": "libreoffice-uno"}

    def execute_excel(self, operation, params):
        sheets = self.document.Sheets
        sheet = sheets.getByName(str(params["sheet"])) if params.get("sheet") else sheets.getByIndex(0)
        if operation in {"readRange", "readFormulas"}:
            cell_range = sheet.getCellRangeByName(str(params.get("range", "A1")))
            data = cell_range.getDataArray()
            result = {"operation": operation, "sheet": sheet.Name, "range": str(params.get("range", "A1")), "values": data}
            if operation == "readFormulas":
                result["formulas"] = cell_range.getFormulaArray()
            return result
        if operation == "writeRange":
            values = params.get("values")
            if not isinstance(values, list):
                fail("excel.writeRange requires a two-dimensional values array.")
            sheet.getCellRangeByName(str(params["range"])).setDataArray(tuple(tuple(row) for row in values))
            self.document.store()
            return {"operation": operation, "updated": True}
        if operation == "clearRange":
            sheet.getCellRangeByName(str(params["range"])).clearContents(1023)
            self.document.store()
            return {"operation": operation, "updated": True}
        if operation == "addSheet":
            name = str(params.get("sheetName") or params.get("name") or "Sheet")
            sheets.insertNewByName(name, sheets.getCount())
            self.document.store()
            return {"operation": operation, "sheet": name, "updated": True}
        if operation == "updateSheet":
            old_name = sheet.Name
            new_name = str(params.get("sheetName") or params.get("name"))
            sheet.Name = new_name
            self.document.store()
            return {"operation": operation, "sheet": old_name, "renamedTo": new_name}
        if operation == "deleteSheet":
            deleted_name = sheet.Name
            sheets.removeByName(deleted_name)
            self.document.store()
            return {"operation": operation, "sheet": deleted_name, "updated": True}
        if operation == "recalculate":
            self.document.calculateAll()
            self.document.store()
            return {"operation": operation, "updated": True}
        if operation == "find":
            query = str(params.get("query", "")).lower()
            matches = []
            for index in range(sheets.getCount()):
                current = sheets.getByIndex(index)
                cursor = current.createCursor()
                cursor.gotoEndOfUsedArea(True)
                address = cursor.getRangeAddress()
                used = current.getCellRangeByPosition(address.StartColumn, address.StartRow, address.EndColumn, address.EndRow)
                for row_index, row in enumerate(used.getDataArray()):
                    for column_index, value in enumerate(row):
                        if query in str(value).lower():
                            matches.append({"sheet": current.Name, "row": row_index, "column": column_index, "value": value})
                            if len(matches) >= 500:
                                return {"operation": operation, "query": query, "matches": matches, "truncated": True}
            return {"operation": operation, "query": query, "matches": matches, "truncated": False}
        if operation == "manageNamedRange":
            mode = str(params.get("operation", "list")); names = self.document.NamedRanges.getElementNames()
            if mode == "list": return {"operation": mode, "names": [{"name": name, "formula": self.document.NamedRanges.getByName(name).Content} for name in names], "backend": "libreoffice-uno"}
            name = str(params.get("name", "")); ranges = self.document.NamedRanges
            if mode == "delete": ranges.removeByName(name)
            elif mode in {"create", "update"}:
                address = sheet.getCellRangeByName(str(params.get("range", "A1"))).getCellAddress()
                if mode == "update" and name in names: ranges.removeByName(name)
                ranges.addNewByName(name, str(params.get("formula", "")), address, 0)
            else: return unsupported(mode)
            self.document.store(); return {"operation": mode, "name": name, "updated": True, "backend": "libreoffice-uno"}
        if operation == "manageProtection":
            mode = str(params.get("operation", "status")); protected = bool(sheet.isProtected())
            if mode == "protect": sheet.protect(str(params.get("password", ""))); protected = True
            elif mode == "unprotect": sheet.unprotect(str(params.get("password", ""))); protected = False
            elif mode != "status": return unsupported(mode)
            if mode != "status": self.document.store()
            return {"operation": mode, "protected": protected, "sheet": sheet.Name, "backend": "libreoffice-uno"}
        if operation in {"editRows", "editColumns"}:
            mode = str(params.get("operation", "insert")); index = max(0, int(params.get("index", 0))); count = max(1, int(params.get("count", 1)))
            from com.sun.star.sheet import CellInsertMode
            columns = max(1, sheet.Columns.getCount())
            rows = max(1, sheet.Rows.getCount())
            if operation == "editRows": area = sheet.getCellRangeByPosition(0, index, columns - 1, index + count - 1); insert_mode = CellInsertMode.ROWS
            else: area = sheet.getCellRangeByPosition(index, 0, index + count - 1, rows - 1); insert_mode = CellInsertMode.COLUMNS
            if mode == "insert": area.insertCells(insert_mode)
            elif mode == "delete": area.removeRange(insert_mode)
            else: return unsupported(mode)
            self.document.store(); return {"operation": operation, "mode": mode, "index": index, "count": count, "updated": True, "backend": "libreoffice-uno"}
        if operation == "formatRange":
            cell_range = sheet.getCellRangeByName(str(params.get("range", "A1"))); options = params.get("options") if isinstance(params.get("options"), dict) else params
            if "backgroundColor" in options: cell_range.CellBackColor = int(options["backgroundColor"])
            if "color" in options: cell_range.CharColor = int(options["color"])
            if "bold" in options: cell_range.CharWeight = 150.0 if options["bold"] else 100.0
            if "fontSize" in options: cell_range.CharHeight = float(options["fontSize"])
            self.document.store(); return {"operation": operation, "range": str(params.get("range", "A1")), "updated": True, "backend": "libreoffice-uno"}
        if operation == "sortRange":
            cell_range = sheet.getCellRangeByName(str(params.get("range", "A1"))); descriptor = cell_range.createSortDescriptor(); descriptor[0].Field = max(0, int(params.get("index", 0))); descriptor[0].IsAscending = bool(params.get("ascending", True)); cell_range.sort(descriptor); self.document.store(); return {"operation": operation, "updated": True, "backend": "libreoffice-uno"}
        if operation == "importCsv":
            source = Path(str(params.get("sourcePath", ""))).resolve()
            if not source.exists(): fail("The CSV source does not exist.")
            with source.open(newline="", encoding="utf-8") as stream:
                rows = [row for row in csv.reader(stream)]
            width = max((len(row) for row in rows), default=1)
            area = sheet.getCellRangeByPosition(0, 0, max(0, width - 1), max(0, len(rows) - 1))
            area.setDataArray(tuple(tuple(row + [""] * (width - len(row))) for row in rows) or (("",),))
            self.document.store()
            return {"operation": operation, "updated": True, "rows": len(rows), "backend": "libreoffice-uno"}
        return self.export_pdf(params) if operation in {"exportPdf", "render"} else unsupported(operation)

    def execute_pptx(self, operation, params):
        pages = self.document.getDrawPages()
        if operation == "readSlide":
            index = int(params.get("slide", 0))
            indexes = [index]
            slides = []
            for slide_index in indexes:
                page = pages.getByIndex(slide_index)
                slides.append({"slide": slide_index, "text": "\n".join(shape.String for shape in shapes(page) if hasattr(shape, "String")), "elements": len(shapes(page))})
            return {"operation": operation, "slides": slides, "backend": "libreoffice-uno"}
        if operation == "updateSlide":
            index = int(params.get("slide", 0)); page = pages.getByIndex(index)
            if "name" in params: page.Name = str(params["name"])
            self.document.store(); return {"operation": operation, "slide": index, "updated": True, "backend": "libreoffice-uno"}
        if operation == "manageMedia":
            page = pages.getByIndex(int(params.get("slide", 0))); mode = str(params.get("operation", "list")); media = [shape for shape in shapes(page) if "Graphic" in shape.ShapeType or "Media" in shape.ShapeType]
            if mode == "list": return {"operation": mode, "media": [{"elementId": shape.Name, "width": shape.Size.Width, "height": shape.Size.Height} for shape in media], "backend": "libreoffice-uno"}
            if mode == "insert":
                shape = self.document.createInstance("com.sun.star.drawing.GraphicObjectShape"); shape.GraphicURL = uno.systemPathToFileUrl(str(Path(params["mediaPath"]).resolve())); shape.Name = str(params.get("elementId", "Media")); page.add(shape); self.document.store(); return {"operation": mode, "elementId": shape.Name, "updated": True, "backend": "libreoffice-uno"}
            shape = shape_by_name(page, str(params.get("elementId", "")))
            if shape is None: fail("The presentation element was not found.")
            if mode == "delete": page.remove(shape)
            elif mode == "update":
                size = shape.Size; size.Width = int(params.get("width", size.Width)); size.Height = int(params.get("height", size.Height)); shape.Size = size
            else: return unsupported(mode)
            self.document.store(); return {"operation": mode, "elementId": shape.Name, "updated": True, "backend": "libreoffice-uno"}
        if operation == "manageHyperlinks":
            page = pages.getByIndex(int(params.get("slide", 0))); mode = str(params.get("operation", "list")); shapes_with_links = [shape for shape in shapes(page) if getattr(shape, "Hyperlink", "")]
            if mode == "list": return {"operation": mode, "hyperlinks": [{"elementId": shape.Name, "address": shape.Hyperlink} for shape in shapes_with_links], "backend": "libreoffice-uno"}
            shape = shape_by_name(page, str(params.get("elementId", "")))
            if shape is None: fail("The presentation element was not found.")
            if mode == "set": shape.Hyperlink = str(params.get("address", ""))
            elif mode == "clear": shape.Hyperlink = ""
            else: return unsupported(mode)
            self.document.store(); return {"operation": mode, "elementId": shape.Name, "updated": True, "backend": "libreoffice-uno"}
        if operation == "manageTransitions":
            page = pages.getByIndex(int(params.get("slide", 0))); mode = str(params.get("operation", "list")); transition = {key: getattr(page, key, None) for key in ("TransitionType", "TransitionSubtype", "TransitionDuration")}
            if mode == "list": return {"operation": mode, "slide": int(params.get("slide", 0)), "transition": transition, "backend": "libreoffice-uno"}
            if mode == "set":
                for key, value in (params.get("options") if isinstance(params.get("options"), dict) else {}).items():
                    if hasattr(page, key): setattr(page, key, value)
            elif mode == "clear":
                for key, value in (("TransitionType", 0), ("TransitionSubtype", 0), ("TransitionDuration", 0)):
                    if hasattr(page, key): setattr(page, key, value)
            else:
                return unsupported(mode)
            self.document.store(); return {"operation": mode, "slide": int(params.get("slide", 0)), "updated": True, "backend": "libreoffice-uno"}
        if operation == "manageLayouts":
            mode = str(params.get("operation", "list")); masters = self.document.getMasterPages()
            if mode == "list": return {"operation": mode, "layouts": [{"index": index, "name": masters.getByIndex(index).Name} for index in range(masters.getCount())], "backend": "libreoffice-uno"}
            if mode == "apply": pages.getByIndex(int(params.get("slide", 0))).MasterPage = masters.getByIndex(int(params.get("index", 0)))
            else: return unsupported(mode)
            self.document.store(); return {"operation": mode, "updated": True, "backend": "libreoffice-uno"}
        if operation == "addElement":
            page = pages.getByIndex(int(params.get("slide", 0))); shape = self.document.createInstance("com.sun.star.drawing.TextShape"); shape.Name = str(params.get("elementId", "Text")); shape.String = str(params.get("text", params.get("content", ""))); page.add(shape); self.document.store(); return {"operation": operation, "elementId": shape.Name, "updated": True, "backend": "libreoffice-uno"}
        if operation in {"updateElement", "deleteElement"}:
            page = pages.getByIndex(int(params.get("slide", 0))); shape = shape_by_name(page, str(params.get("elementId", "")))
            if shape is None: fail("The presentation element was not found.")
            if operation == "deleteElement": page.remove(shape)
            elif "text" in params and hasattr(shape, "String"): shape.String = str(params["text"])
            self.document.store(); return {"operation": operation, "elementId": shape.Name, "updated": True, "backend": "libreoffice-uno"}
        if operation == "deleteSlide":
            index = int(params.get("slide", 0)); pages.remove(pages.getByIndex(index)); self.document.store(); return {"operation": operation, "slide": index, "updated": True}
        if operation == "setNotes":
            page = pages.getByIndex(int(params.get("slide", 0)))
            notes = page.getNotesPage().getNotesText()
            notes.String = str(params.get("content", params.get("text", "")))
            self.document.store()
            return {"operation": operation, "updated": True}
        return self.export_pdf(params) if operation in {"exportPdf", "render"} else unsupported(operation)

    def close(self):
        if self.document is not None:
            try:
                self.document.close(True)
            except Exception:
                self.document.dispose()
        if self.process is not None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


def point(x, y):
    value = uno.createUnoStruct("com.sun.star.awt.Point"); value.X = int(x); value.Y = int(y); return value


def column_names(count):
    names = []
    for index in range(count):
        value = index + 1; name = ""
        while value:
            value, remainder = divmod(value - 1, 26); name = chr(65 + remainder) + name
        names.append(name)
    return names


def if_invalid(index, count):
    if index < 0 or index >= count: fail("The document item index is invalid.")


def filter_for(path):
    suffix = path.suffix.lower()
    return {".doc": "MS Word 97", ".docx": "Office Open XML Text", ".xls": "MS Excel 97", ".xlsx": "Calc MS Excel 2007 XML", ".pptx": "Impress MS PowerPoint 2007 XML", ".csv": "Text - txt - csv (StarCalc)", ".odt": "writer8", ".ods": "calc8", ".odp": "impress8"}.get(suffix, "Office Open XML Text")


def free_port():
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close(); return port


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

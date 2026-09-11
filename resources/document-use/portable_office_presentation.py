"""Real LibreOffice UNO implementation for advanced presentation operations."""

from pathlib import Path

import uno

from portable_office_support import (
    constant,
    fail,
    prop,
    shape_by_name,
    shapes,
    unsupported,
)


def execute_presentation(bridge, operation, params):
    handlers = {
        "duplicateSlide": duplicate_slide,
        "importSlides": import_slides,
        "arrangeElements": arrange_elements,
        "reorderSlides": reorder_slides,
        "setTheme": set_theme,
        "findReplace": find_replace,
        "extractText": extract_text,
        "addSlide": add_slide,
        "manageMedia": manage_presentation_media,
        "addElement": add_presentation_element,
        "updateElement": update_presentation_element,
        "deleteElement": delete_presentation_element,
    }
    handler = handlers.get(operation)
    return None if handler is None else handler(bridge, params)


def extract_text(bridge, params):
    pages = bridge.document.getDrawPages()
    indexes = requested_slide_indexes(params, pages.getCount())
    slides = []
    for index in indexes:
        page = pages.getByIndex(index)
        page_shapes = shapes(page)
        slides.append({
            "slide": index,
            "text": "\n".join(str(shape.String) for shape in page_shapes if hasattr(shape, "String")),
            "elements": len(page_shapes),
        })
    return {"operation": "extractText", "slides": slides, "backend": "libreoffice-uno"}


def find_replace(bridge, params):
    pages = bridge.document.getDrawPages()
    indexes = requested_slide_indexes(params, pages.getCount())
    find = str(params.get("find", ""))
    replace = str(params.get("replace", ""))
    count = 0
    for index in indexes:
        for shape in shapes(pages.getByIndex(index)):
            if hasattr(shape, "String") and find in shape.String:
                shape.String = shape.String.replace(find, replace)
                count += 1
    bridge.document.store()
    return {"operation": "findReplace", "replacements": count, "pages": indexes, "backend": "libreoffice-uno"}


def add_slide(bridge, params):
    pages = bridge.document.getDrawPages()
    position = int(params.get("position", pages.getCount()))
    if position < 0 or position > pages.getCount():
        fail("The destination slide index is invalid.")
    page = pages.insertNewByIndex(position)
    layout = requested_layout_index(params)
    if layout is not None:
        masters = bridge.document.getMasterPages()
        if layout < 0 or layout >= masters.getCount():
            fail("The requested presentation layout index is invalid.")
        page.MasterPage = masters.getByIndex(layout)
    bridge.document.store()
    return {
        "operation": "addSlide",
        "slide": position,
        "layout": layout,
        "updated": True,
        "backend": "libreoffice-uno",
    }


def requested_slide_indexes(params, count):
    requested = params.get("pages")
    if requested is None:
        return list(range(count))
    if not isinstance(requested, list):
        fail("Presentation pages must be an array of zero-based slide indexes.")
    indexes = []
    for value in requested:
        if not isinstance(value, int) or value < 0 or value >= count or value in indexes:
            fail("Presentation pages must be a unique, valid slide selection.")
        indexes.append(value)
    return indexes


def requested_layout_index(params):
    options = params.get("options") if isinstance(params.get("options"), dict) else {}
    value = options.get("layoutIndex", params.get("index", options.get("layout")))
    return None if value is None else int(value)


def duplicate_slide(bridge, params):
    pages = bridge.document.getDrawPages()
    source_index = int(params.get("slide", -1))
    if source_index < 0 or source_index >= pages.getCount():
        fail("The source slide index is invalid.")
    destination = int(params.get("position", source_index + 1))
    if destination < 0 or destination > pages.getCount():
        fail("The destination slide index is invalid.")
    new_page = pages.insertNewByIndex(destination)
    source = pages.getByIndex(source_index if source_index < destination else source_index + 1)
    clone_page(source, new_page)
    bridge.document.store()
    return {
        "operation": "duplicateSlide",
        "slide": destination,
        "updated": True,
        "backend": "libreoffice-uno",
    }


def import_slides(bridge, params):
    source_path = Path(str(params.get("sourcePath", ""))).resolve()
    if not source_path.exists():
        fail("The source presentation does not exist.")
    source = bridge.desktop.loadComponentFromURL(
        uno.systemPathToFileUrl(str(source_path)),
        "_blank",
        0,
        (prop("Hidden", True), prop("ReadOnly", True)),
    )
    try:
        target_pages = bridge.document.getDrawPages()
        source_pages = source.getDrawPages()
        imported = 0
        for index in range(source_pages.getCount()):
            target = target_pages.insertNewByIndex(target_pages.getCount())
            clone_page(source_pages.getByIndex(index), target)
            imported += 1
        bridge.document.store()
        return {
            "operation": "importSlides",
            "imported": imported,
            "updated": True,
            "backend": "libreoffice-uno",
        }
    finally:
        source.close(True)


def reorder_slides(bridge, params):
    pages = bridge.document.getDrawPages()
    order = params.get("pages")
    if (
        not isinstance(order, list)
        or len(order) != pages.getCount()
        or sorted(int(value) for value in order) != list(range(pages.getCount()))
    ):
        fail("pptx.reorderSlides requires a complete zero-based slide permutation.")
    originals = [pages.getByIndex(index) for index in range(pages.getCount())]
    for source_index in [int(value) for value in order]:
        target = pages.insertNewByIndex(pages.getCount())
        clone_page(originals[source_index], target)
    for page in reversed(originals):
        pages.remove(page)
    bridge.document.store()
    return {
        "operation": "reorderSlides",
        "pages": [int(value) for value in order],
        "updated": True,
        "backend": "libreoffice-uno",
    }


def arrange_elements(bridge, params):
    pages = bridge.document.getDrawPages()
    slide_index = int(params.get("slide", 0))
    if slide_index < 0 or slide_index >= pages.getCount():
        fail("The presentation slide index is invalid.")
    page = pages.getByIndex(slide_index)
    selected = selected_shapes(page, params)
    mode = str(params.get("operation", params.get("alignment", "")))
    if mode == "group":
        if len(selected) < 2:
            fail("Grouping requires at least two element ids.")
        group = page.group(shape_collection(bridge.document, selected))
        bridge.document.store()
        return {
            "operation": mode,
            "slide": slide_index,
            "elementId": str(group.Name),
            "updated": True,
            "backend": "libreoffice-uno",
        }
    if mode in {"distributeHorizontal", "distributeVertical"}:
        if len(selected) < 3:
            fail("Distribution requires at least three element ids.")
        distribute_shapes(selected, mode == "distributeHorizontal")
    elif mode == "front":
        page.bringToFront(shape_collection(bridge.document, selected), len(shapes(page)))
    elif mode == "back":
        page.sendToBack(shape_collection(bridge.document, selected), len(shapes(page)))
    elif mode in {"left", "right", "top", "bottom", "center", "middle"}:
        align_shapes(selected, mode)
    else:
        return unsupported(mode)
    bridge.document.store()
    return {
        "operation": mode,
        "slide": slide_index,
        "updated": True,
        "backend": "libreoffice-uno",
    }


def selected_shapes(page, params):
    element_ids = params.get("elementIds")
    if not isinstance(element_ids, list) or not element_ids:
        fail("pptx.arrangeElements requires existing elementIds.")
    selected = []
    for element_id in element_ids:
        shape = shape_by_name(page, str(element_id))
        if shape is None:
            fail(f"The presentation element '{element_id}' was not found.")
        selected.append(shape)
    return selected


def shape_collection(document, selected):
    collection = document.createInstance("com.sun.star.drawing.ShapeCollection")
    for shape in selected:
        collection.add(shape)
    return collection


def distribute_shapes(selected, horizontal):
    ordered = sorted(selected, key=lambda shape: shape.Position.X if horizontal else shape.Position.Y)
    first_position = ordered[0].Position.X if horizontal else ordered[0].Position.Y
    last_position = ordered[-1].Position.X if horizontal else ordered[-1].Position.Y
    last_size = ordered[-1].Size.Width if horizontal else ordered[-1].Size.Height
    span = last_position + last_size - first_position
    total_size = sum(shape.Size.Width if horizontal else shape.Size.Height for shape in ordered)
    gap = (span - total_size) / (len(ordered) - 1)
    cursor = first_position
    for shape in ordered:
        position = shape.Position
        if horizontal:
            position.X = int(cursor)
            cursor += shape.Size.Width + gap
        else:
            position.Y = int(cursor)
            cursor += shape.Size.Height + gap
        shape.Position = position


def align_shapes(selected, mode):
    left = min(shape.Position.X for shape in selected)
    top = min(shape.Position.Y for shape in selected)
    right = max(shape.Position.X + shape.Size.Width for shape in selected)
    bottom = max(shape.Position.Y + shape.Size.Height for shape in selected)
    for shape in selected:
        position = shape.Position
        if mode == "left":
            position.X = left
        elif mode == "right":
            position.X = right - shape.Size.Width
        elif mode == "top":
            position.Y = top
        elif mode == "bottom":
            position.Y = bottom - shape.Size.Height
        elif mode == "center":
            position.X = int((left + right - shape.Size.Width) / 2)
        else:
            position.Y = int((top + bottom - shape.Size.Height) / 2)
        shape.Position = position


def set_theme(bridge, params):
    options = params.get("options") if isinstance(params.get("options"), dict) else params
    pages = bridge.document.getDrawPages()
    if "backgroundColor" in options:
        color = int(options["backgroundColor"])
        fill_style = constant("com.sun.star.drawing.FillStyle.SOLID")
        for index in range(pages.getCount()):
            background = pages.getByIndex(index).Background
            background.FillStyle = fill_style
            background.FillColor = color
    if "fontName" in options:
        for index in range(pages.getCount()):
            for shape in shapes(pages.getByIndex(index)):
                if hasattr(shape, "CharFontName"):
                    shape.CharFontName = str(options["fontName"])
    bridge.document.store()
    return {"operation": "setTheme", "updated": True, "backend": "libreoffice-uno"}


def manage_presentation_media(bridge, params):
    pages = bridge.document.getDrawPages()
    page = pages.getByIndex(int(params.get("slide", 0)))
    mode = str(params.get("operation", "list"))
    media = [shape for shape in shapes(page) if "Graphic" in shape.ShapeType or "Media" in shape.ShapeType]
    if mode == "list":
        return {
            "operation": mode,
            "media": [shape_details(shape) for shape in media],
            "backend": "libreoffice-uno",
        }
    if mode == "insert":
        shape = bridge.document.createInstance("com.sun.star.drawing.GraphicObjectShape")
        shape.GraphicURL = uno.systemPathToFileUrl(str(Path(params["mediaPath"]).resolve()))
        shape.Name = unique_shape_name(page, str(params.get("elementId", "Media")))
        page.add(shape)
        apply_shape_geometry(shape, params)
    else:
        shape = shape_by_name(page, str(params.get("elementId", "")))
        if shape is None:
            fail("The presentation media element was not found.")
        if mode == "delete":
            page.remove(shape)
        elif mode == "update":
            apply_shape_geometry(shape, params, allow_defaults=False)
        else:
            return unsupported(mode)
    bridge.document.store()
    return {
        "operation": mode,
        "elementId": str(shape.Name),
        "updated": True,
        "backend": "libreoffice-uno",
    }


def add_presentation_element(bridge, params):
    page = bridge.document.getDrawPages().getByIndex(int(params.get("slide", 0)))
    shape = bridge.document.createInstance("com.sun.star.drawing.TextShape")
    shape.Name = unique_shape_name(page, str(params.get("elementId", "Text")))
    shape.String = str(params.get("text", params.get("content", "")))
    page.add(shape)
    apply_shape_geometry(shape, params)
    bridge.document.store()
    return {
        "operation": "addElement",
        "elementId": str(shape.Name),
        "updated": True,
        "backend": "libreoffice-uno",
    }


def update_presentation_element(bridge, params):
    return update_or_delete_presentation_element(bridge, params, False)


def delete_presentation_element(bridge, params):
    return update_or_delete_presentation_element(bridge, params, True)


def update_or_delete_presentation_element(bridge, params, delete):
    page = bridge.document.getDrawPages().getByIndex(int(params.get("slide", 0)))
    shape = shape_by_name(page, str(params.get("elementId", "")))
    if shape is None:
        fail("The presentation element was not found.")
    if delete:
        page.remove(shape)
    else:
        if "text" in params and hasattr(shape, "String"):
            shape.String = str(params["text"])
        apply_shape_geometry(shape, params, allow_defaults=False)
    bridge.document.store()
    return {
        "operation": "deleteElement" if delete else "updateElement",
        "elementId": str(shape.Name),
        "updated": True,
        "backend": "libreoffice-uno",
    }


def shape_details(shape):
    return {
        "elementId": str(shape.Name),
        "left": int(shape.Position.X),
        "top": int(shape.Position.Y),
        "width": int(shape.Size.Width),
        "height": int(shape.Size.Height),
    }


def apply_shape_geometry(shape, params, allow_defaults=True):
    options = params.get("options") if isinstance(params.get("options"), dict) else params
    position = shape.Position
    size = shape.Size
    if allow_defaults or "left" in options or "x" in options:
        position.X = int(options.get("left", options.get("x", 0)))
    if allow_defaults or "top" in options or "y" in options:
        position.Y = int(options.get("top", options.get("y", 0)))
    if allow_defaults or "width" in options:
        size.Width = max(1, int(options.get("width", 3200)))
    if allow_defaults or "height" in options:
        size.Height = max(1, int(options.get("height", 1800)))
    shape.Position = position
    shape.Size = size


def unique_shape_name(page, requested):
    existing = {str(shape.Name) for shape in shapes(page)}
    base = requested or "Element"
    if base not in existing:
        return base
    index = 2
    while f"{base}-{index}" in existing:
        index += 1
    return f"{base}-{index}"


def clone_page(source, target):
    for shape in [source.getByIndex(index) for index in range(source.getCount())]:
        target.add(shape.createClone())

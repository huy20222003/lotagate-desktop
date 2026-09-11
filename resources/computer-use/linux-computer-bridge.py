#!/usr/bin/env python3
"""Optional AT-SPI adapter used by Desktop on Linux.

The parent process starts this file without a shell and supplies exactly one
JSON request through stdin.  It is enabled only when importing pyatspi succeeds
at startup, so missing desktop accessibility packages are negotiated honestly.
"""

import base64
import json
import subprocess
import sys
import time

import pyatspi

MAX_ELEMENTS = 300


def main():
    request = json.load(sys.stdin)
    action = request.get("action", "")
    params = request.get("params", {})
    if action == "computer.inspect":
        print_json(inspect(params))
        return
    window = find_window(params.get("windowId", ""))
    element = find_element(window, params.get("elementId")) if params.get("elementId") else window
    if action == "computer.focus":
        focus_element(element)
        print_json({"focused": True, "elementId": params.get("elementId")})
    elif action == "computer.click":
        click_element(element, params.get("inputCommand"))
        print_json({"clicked": True, "elementId": params.get("elementId")})
    elif action == "computer.move":
        move_element(element, params)
        print_json({"moved": True, "elementId": params.get("elementId")})
    elif action == "computer.drag":
        drag_elements(window, params)
        print_json({"dragged": True, "windowId": params.get("windowId")})
    elif action == "computer.readText":
        print_json({"elementId": params.get("elementId"), "scope": params.get("scope", "value"), "text": read_text(element, params.get("scope", "value"))})
    elif action == "computer.readSelection":
        print_json({"elementId": params.get("elementId"), "items": selection_of(element)})
    elif action == "computer.readGrid":
        print_json({"elementId": params.get("elementId"), "grid": read_grid(element, params)})
    elif action == "computer.selectText":
        select_text(element, params)
        print_json({"elementId": params.get("elementId"), "selected": True, "text": str(params.get("text", ""))})
    elif action == "computer.setValue":
        set_value(element, params.get("value", ""))
        print_json({"set": True, "elementId": params.get("elementId"), "value": str(params.get("value", ""))})
    elif action == "computer.invoke":
        invoke(element, params.get("inputCommand"))
        print_json({"invoked": True, "elementId": params.get("elementId")})
    elif action == "computer.select":
        select_element(element, str(params.get("mode", "replace")), params.get("inputCommand"))
        print_json({"selected": True, "mode": params.get("mode", "replace"), "elementId": params.get("elementId")})
    elif action == "computer.setToggleState":
        set_toggle_state(element, str(params.get("state", "on")), params.get("inputCommand"))
        print_json({"toggleState": toggle_state(element), "elementId": params.get("elementId")})
    elif action == "computer.setExpandedState":
        set_expanded_state(element, bool(params.get("expanded")))
        print_json({"expanded": expanded_state(element), "elementId": params.get("elementId")})
    elif action == "computer.scrollIntoView":
        if not invoke_named(element, "scroll"):
            fail("The Linux element does not expose a scroll-into-view action.")
        print_json({"scrolledIntoView": True, "elementId": params.get("elementId")})
    elif action == "computer.waitForState":
        print_json(wait_for_state(params))
    else:
        fail(f"The Linux accessibility bridge does not support {action}.")


def inspect(params):
    window = find_window(params.get("windowId", ""))
    query = params.get("query") or {}
    max_depth = max(1, min(int(params.get("maxDepth", 8)), 32))
    elements = []
    for path, element, depth in walk(window, max_depth):
        if len(elements) >= MAX_ELEMENTS:
            break
        if matches(element, query):
            elements.append(describe(element, path))
    return {"observationId": str(time.time_ns()), "windowId": params.get("windowId"), "bounds": bounds(window), "elements": elements}


def find_window(window_id):
    if not isinstance(window_id, str) or not window_id.startswith("linux:"):
        fail("A Linux windowId is required.")
    target = int(window_id[6:], 16)
    geometry = wmctrl_geometry(target)
    for app in desktop_apps():
        for index in range(app.getChildCount()):
            window = app.getChildAtIndex(index)
            if window is None or window.getRole() != pyatspi.ROLE_WINDOW:
                continue
            if geometry is None or same_geometry(bounds(window), geometry):
                return window
    fail("The Linux window was not found in the accessibility tree.")


def find_element(window, element_id):
    if not isinstance(element_id, str) or not element_id.startswith("atspi:"):
        fail("A current AT-SPI elementId is required.")
    try:
        encoded = element_id[6:] + "==="
        payload = json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
        path = payload["path"]
    except (ValueError, KeyError, TypeError):
        fail("The Linux accessibility elementId is invalid.")
    element = window
    for index in path:
        element = element.getChildAtIndex(int(index))
        if element is None:
            fail("The Linux accessibility element is no longer available.")
    return element


def walk(root, max_depth):
    stack = [([], root, 0)]
    while stack:
        path, element, depth = stack.pop()
        yield path, element, depth
        if depth >= max_depth:
            continue
        for index in range(element.getChildCount() - 1, -1, -1):
            child = element.getChildAtIndex(index)
            if child is not None:
                stack.append((path + [index], child, depth + 1))


def describe(element, path):
    state = element.getState()
    result = {"elementId": element_id(path), "role": role_name(element), "name": element.getName() or "", "enabled": not state.contains(pyatspi.STATE_DISABLED), "visible": not state.contains(pyatspi.STATE_INVISIBLE), "supportedPatterns": []}
    try:
        result["bounds"] = bounds(element)
    except Exception:
        result["bounds"] = {"x": 0, "y": 0, "width": 0, "height": 0}
    value = text_of(element)
    if value:
        result["value"] = value[:32_000]
    return result


def matches(element, query):
    role = query.get("role")
    name = query.get("name")
    text = query.get("text")
    name_value = element.getName() or ""
    text_value = text_of(element)
    return (not role or role.lower() in role_name(element).lower()) and (not name or name.lower() in name_value.lower()) and (not text or text.lower() in (name_value + " " + text_value).lower())


def text_of(element):
    try:
        text = element.queryText()
        return (text.getText(0, text.characterCount) or "")[:32_000]
    except Exception:
        try:
            return str(element.getName() or "")
        except Exception:
            return ""


def read_text(element, scope):
    if scope == "selection":
        return "\n".join(selection_of(element))
    if scope not in {"value", "document"}:
        fail("The Linux text scope is invalid.")
    return text_of(element)


def selection_of(element):
    try:
        selection = element.querySelection()
        count = selection.nSelectedChildren
        return [text_of(selection.getSelectedChild(index)) for index in range(count)]
    except Exception:
        return []


def read_grid(element, params):
    row_start = max(0, int(params.get("rowStart", 0)))
    row_count = max(1, min(100, int(params.get("rowCount", 100))))
    column_start = max(0, int(params.get("columnStart", 0)))
    column_count = max(1, min(100, int(params.get("columnCount", 100))))
    rows = [item for item in children(element) if "row" in role_name(item).lower()]
    if not rows:
        rows = [element]
    result = []
    for row in rows[row_start:row_start + row_count]:
        cells = children(row)
        if not cells and row is element:
            cells = children(element)
        result.append([text_of(cell) for cell in cells[column_start:column_start + column_count]])
    return result


def select_text(element, params):
    text = str(params.get("text", ""))
    occurrence = max(1, int(params.get("occurrence", 1)))
    if not text:
        fail("The text to select is required.")
    try:
        text_iface = element.queryText()
        content = text_iface.getText(0, text_iface.characterCount) or ""
        start = -1
        cursor = 0
        for _ in range(occurrence):
            start = content.find(text, cursor)
            if start < 0:
                fail("The requested text occurrence was not found.")
            cursor = start + len(text)
        if text_iface.setSelection(0, start, start + len(text)) is False:
            fail("The Linux text control rejected the requested selection.")
    except RuntimeError:
        raise
    except Exception as error:
        fail(f"The Linux element does not expose selectable text: {error}")


def focus_element(element):
    try:
        component = element.queryComponent()
        if component.grabFocus() is False:
            fail("The Linux element rejected focus.")
    except Exception as error:
        fail(f"The Linux element does not support focus: {error}")


def click_element(element, input_command):
    invoke(element, input_command)


def move_element(element, params):
    rectangle = bounds(element)
    command = params.get("inputCommand")
    if not isinstance(command, str) or not command:
        fail("Linux element pointer movement requires the configured input utility.")
    x = rectangle["x"] + rectangle["width"] // 2
    y = rectangle["y"] + rectangle["height"] // 2
    try:
        subprocess.run([command, "mousemove", "--sync", str(x), str(y)], check=True, timeout=2)
    except (OSError, subprocess.SubprocessError) as error:
        fail(f"Linux pointer movement failed: {error}")


def drag_elements(window, params):
    command = params.get("inputCommand")
    if not isinstance(command, str) or not command:
        fail("Linux element dragging requires the configured input utility.")
    start = pointer_target(window, params.get("from"))
    end = pointer_target(window, params.get("to"))
    duration = max(0, min(float(params.get("durationMs", 300)) / 1000, 30))
    try:
        subprocess.run([command, "mousemove", "--sync", str(start[0]), str(start[1])], check=True, timeout=2)
        subprocess.run([command, "mousedown", "1"], check=True, timeout=2)
        if duration > 0:
            time.sleep(duration)
        subprocess.run([command, "mousemove", "--sync", str(end[0]), str(end[1])], check=True, timeout=2)
        subprocess.run([command, "mouseup", "1"], check=True, timeout=2)
    except (OSError, subprocess.SubprocessError) as error:
        fail(f"Linux drag failed: {error}")


def pointer_target(window, target):
    if isinstance(target, dict) and isinstance(target.get("elementId"), str):
        rectangle = bounds(find_element(window, target["elementId"]))
        return rectangle["x"] + rectangle["width"] // 2, rectangle["y"] + rectangle["height"] // 2
    if isinstance(target, dict) and isinstance(target.get("x"), (int, float)) and isinstance(target.get("y"), (int, float)):
        return int(target["x"]), int(target["y"])
    fail("Linux drag targets must contain a point or elementId.")


def select_element(element, mode, input_command):
    if mode not in {"replace", "add", "remove"}:
        fail("The selection mode is invalid.")
    selected = is_selected(element)
    if mode == "remove":
        if not selected:
            return
        if not invoke_named(element, "unselect") and not invoke_named(element, "deselect"):
            fail("The Linux element does not expose a deselect action.")
        if is_selected(element):
            fail("The Linux element did not leave the requested selection state.")
    elif not selected or mode == "replace":
        if not invoke_named(element, "select"):
            invoke(element, input_command)
    if mode != "remove" and not is_selected(element):
        fail("The Linux element did not reach the requested selection state.")


def is_selected(element):
    return element.getState().contains(pyatspi.STATE_SELECTED)


def set_toggle_state(element, desired, input_command):
    if desired not in {"on", "off", "indeterminate"}:
        fail("The requested toggle state is invalid.")
    for _ in range(4):
        if toggle_state(element) == desired:
            return
        invoke(element, input_command)
    if toggle_state(element) != desired:
        fail("The Linux toggle did not reach the requested state.")


def toggle_state(element):
    state = element.getState()
    indeterminate = getattr(pyatspi, "STATE_INDETERMINATE", None)
    if indeterminate is not None and state.contains(indeterminate):
        return "indeterminate"
    if state.contains(pyatspi.STATE_CHECKED):
        return "on"
    return "off"


def set_expanded_state(element, desired):
    if expanded_state(element) == desired:
        return
    if not invoke_named(element, "expand" if desired else "collapse"):
        fail("The Linux element does not expose the requested expand or collapse action.")
    if expanded_state(element) != desired:
        fail("The Linux element did not reach the requested expanded state.")


def expanded_state(element):
    state = element.getState()
    expanded = getattr(pyatspi, "STATE_EXPANDED", None)
    if expanded is not None and state.contains(expanded):
        return True
    collapsed = getattr(pyatspi, "STATE_COLLAPSED", None)
    if collapsed is not None and state.contains(collapsed):
        return False
    return False


def set_value(element, value):
    try:
        element.queryEditableText().setTextContents(str(value))
        return
    except Exception:
        pass
    try:
        element.queryValue().currentValue = float(value)
        return
    except Exception:
        fail("The Linux element does not expose an editable value.")


def invoke(element, input_command=None):
    try:
        actions = element.queryAction()
    except Exception:
        actions = None
    if actions is not None and actions.nActions > 0:
        try:
            actions.doAction(0)
            return
        except Exception as error:
            fail(f"The Linux element invoke action failed: {error}")
    if not isinstance(input_command, str) or not input_command:
        fail("The Linux element does not expose an invoke action or configured pointer input.")
    rectangle = bounds(element)
    try:
        subprocess.run([input_command, "mousemove", "--sync", str(rectangle["x"] + rectangle["width"] // 2), str(rectangle["y"] + rectangle["height"] // 2)], check=True, timeout=2)
        subprocess.run([input_command, "click", "1"], check=True, timeout=2)
    except (OSError, subprocess.SubprocessError) as error:
        fail(f"Linux element invocation failed: {error}")


def invoke_named(element, name):
    try:
        actions = element.queryAction()
    except Exception:
        return False
    for index in range(actions.nActions):
        if name.lower() in (actions.getActionName(index) or "").lower():
            try:
                actions.doAction(index)
            except Exception as error:
                fail(f"The Linux element action '{name}' failed: {error}")
            return True
    return False


def wait_for_state(params):
    deadline = time.monotonic() + max(0.1, min(float(params.get("timeoutMs", 30000)) / 1000, 120))
    while time.monotonic() < deadline:
        element = find_element(find_window(params.get("windowId", "")), params.get("elementId"))
        value = state_value(element, params.get("property", "name"))
        if str(value).lower() == str(params.get("expected", "")).lower():
            return {"condition": "state", "satisfied": True, "property": params.get("property"), "value": value}
        time.sleep(max(0.05, min(float(params.get("intervalMs", 150)) / 1000, 2)))
    fail("The Linux UI state wait timed out.")


def state_value(element, property_name):
    if property_name == "name":
        return element.getName() or ""
    if property_name == "value":
        return text_of(element)
    state = element.getState()
    if property_name == "isEnabled":
        return not state.contains(pyatspi.STATE_DISABLED)
    if property_name == "isOffscreen":
        return state.contains(pyatspi.STATE_OFFSCREEN)
    if property_name == "toggleState":
        return toggle_state(element)
    if property_name == "expandCollapseState":
        return "expanded" if expanded_state(element) else "collapsed"
    if property_name == "selectionState":
        return "selected" if selection_of(element) else "unselected"
    return "unknown"


def desktop_apps():
    desktop = pyatspi.Registry.getDesktop(0)
    return [desktop.getChildAtIndex(index) for index in range(desktop.getChildCount()) if desktop.getChildAtIndex(index) is not None]


def wmctrl_geometry(window_id):
    try:
        output = subprocess.check_output(["wmctrl", "-lG"], text=True, timeout=2)
        for line in output.splitlines():
            fields = line.split(None, 6)
            if len(fields) >= 6 and int(fields[0], 16) == window_id:
                return {"x": int(fields[2]), "y": int(fields[3]), "width": int(fields[4]), "height": int(fields[5])}
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return None


def same_geometry(left, right):
    return abs(left["x"] - right["x"]) <= 2 and abs(left["y"] - right["y"]) <= 2 and abs(left["width"] - right["width"]) <= 4 and abs(left["height"] - right["height"]) <= 4


def bounds(element):
    rectangle = element.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
    return {"x": int(rectangle.x), "y": int(rectangle.y), "width": int(rectangle.width), "height": int(rectangle.height)}


def role_name(element):
    try:
        return str(element.getRoleName() or "unknown")
    except Exception:
        return "unknown"


def children(element):
    return [element.getChildAtIndex(index) for index in range(element.getChildCount()) if element.getChildAtIndex(index) is not None]


def element_id(path):
    payload = json.dumps({"path": path}, separators=(",", ":")).encode("utf-8")
    return "atspi:" + base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def print_json(value):
    json.dump(value, sys.stdout, separators=(",", ":"))


def fail(message):
    raise RuntimeError(message)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

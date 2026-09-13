#!/usr/bin/env python3
"""Authenticated JSONL guest service for the Desktop VM sandbox.

The runtime mounts the approved workspace at /workspace and starts this file
inside a bubblewrap namespace. The service accepts structured process and file
operations only; host environment variables and host profile paths are never
copied into child processes.
"""

import argparse
import json
import os
import resource
import selectors
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path


DEFAULT_FILE_BYTES = 10 * 1024 * 1024
DEFAULT_DIRECTORY_ENTRIES = 2_000
DEFAULT_OUTPUT_BYTES = 2 * 1024 * 1024
MAX_TIMEOUT_MS = 10 * 60 * 1_000


def main():
    arguments = parse_arguments()
    if arguments.server:
        server_loop(arguments.auth_token)
        return
    request = json.load(sys.stdin)
    response = handle_request(request, Path(request.get("root", ".")), request.get("params") or {})
    write_json({"requestId": request.get("requestId", "one-shot"), "ok": True, **response})


def parse_arguments():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--server", action="store_true")
    parser.add_argument("--auth-token", default="")
    return parser.parse_args()


def server_loop(auth_token):
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = "unknown"
        try:
            request = json.loads(line)
            request_id = request.get("requestId", "unknown")
            if request.get("auth") != auth_token:
                raise RuntimeError("The VM guest request authentication failed.")
            runtime = (request.get("params") or {}).get("__lotagateRuntime") or {}
            root = Path(runtime.get("root", "/workspace"))
            apply_runtime_limits(runtime)
            response = handle_request(request, root, request.get("params") or {})
            write_json({"requestId": request_id, "ok": True, **response})
        except Exception as error:
            write_json({"requestId": request_id, "ok": False, "error": str(error)})


def handle_request(request, root, raw_params):
    root = root.resolve()
    params = dict(raw_params)
    runtime = params.pop("__lotagateRuntime", {}) or {}
    action = request.get("action", "")
    max_file_bytes = bounded_int(runtime.get("maxFileBytes"), DEFAULT_FILE_BYTES, 1, 512 * 1024 * 1024)
    max_entries = bounded_int(runtime.get("maxDirectoryEntries"), DEFAULT_DIRECTORY_ENTRIES, 1, 100_000)
    max_output_bytes = bounded_int(runtime.get("maxOutputBytes"), DEFAULT_OUTPUT_BYTES, 1, 64 * 1024 * 1024)
    disk_bytes = bounded_int(runtime.get("diskMb"), 8_192, 1, 131_072) * 1024 * 1024
    workspace_access = runtime.get("workspaceAccess", "read-write")
    if action == "health":
        capabilities = ["filesystem", "shell", "git"]
        if isinstance(runtime.get("documentRunner"), str):
            capabilities.append("document")
        return {"result": {"ready": True, "root": str(root), "capabilities": capabilities}}
    if action == "filesystem.read":
        target = existing_inside(root, params.get("path", "."))
        if not target.is_file() or target.stat().st_size > max_file_bytes:
            raise RuntimeError("The requested path is not a supported text file.")
        return {"result": target.read_text(encoding="utf-8")[:max_file_bytes]}
    if action == "filesystem.list":
        target = existing_inside(root, params.get("path", "."))
        if not target.is_dir():
            raise RuntimeError("The requested path is not a directory.")
        entries = []
        for entry in sorted(target.iterdir(), key=lambda item: item.name):
            entries.append({"name": entry.name, "kind": "directory" if entry.is_dir() else "file"})
            if len(entries) >= max_entries:
                break
        return {"result": entries}
    if action == "filesystem.exists":
        try:
            existing_inside(root, params.get("path", "."))
            return {"result": True}
        except FileNotFoundError:
            return {"result": False}
    if action == "filesystem.write":
        if workspace_access == "read-only" or params.get("__readOnly") is True:
            raise RuntimeError("The VM workspace is configured as read-only.")
        content = params.get("content")
        if not isinstance(content, str) or len(content.encode("utf-8")) > max_file_bytes:
            raise RuntimeError("The requested file content is invalid or too large.")
        target = writable_inside(root, params.get("path"))
        existed = target.exists()
        old_size = target.stat().st_size if existed and target.is_file() else 0
        ensure_disk_budget(root, disk_bytes, len(content.encode("utf-8")) - old_size)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.lotagate-{os.getpid()}.tmp")
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, target)
        return {"result": f"Wrote {len(content.encode('utf-8'))} bytes.", "fileChange": {"path": str(target.relative_to(root)), "kind": "modified" if existed else "created"}}
    if action == "shell.exec":
        return {"result": execute_process(root, params, max_output_bytes)}
    if action.startswith("document."):
        return {"result": execute_document(root, action, params, runtime, max_output_bytes)}
    raise RuntimeError(f"Unsupported sandbox action: {action}.")


def execute_document(root, action, params, runtime, max_output_bytes):
    runner = runtime.get("documentRunner")
    if not isinstance(runner, str) or not runner:
        raise RuntimeError("VM_DOCUMENT_UNAVAILABLE: The VM document runner is not provisioned for this environment.")
    document_root = runtime.get("root", str(root))
    document_resources = runtime.get("documentResources", "/opt/lotagate/document-use")
    if not isinstance(document_resources, str) or not document_resources:
        document_resources = "/opt/lotagate/document-use"
    payload = {"cwd": document_root, "action": action, "path": map_workspace_value(root, params.pop("__path", "")), "params": map_document_paths(root, params), "officeBridgePath": str(Path(document_resources) / "portable-office-bridge.py")}
    node_command = runtime.get("nodeExecutable", "node")
    if not isinstance(node_command, str) or not node_command:
        node_command = "node"
    result = execute_bounded_process([node_command, runner], document_root, payload, max_output_bytes, MAX_TIMEOUT_MS, runtime.get("nodeEnvironment"))
    if result["timedOut"]:
        raise RuntimeError("The VM document runner timed out.")
    if result["truncated"]:
        raise RuntimeError("The VM document runner exceeded its output limit.")
    if result["exitCode"] != 0:
        message = result["stderr"] or result["stdout"] or "The VM document runner failed."
        raise RuntimeError(document_unavailable_message(message))
    try:
        parsed = json.loads(result["stdout"])
    except json.JSONDecodeError as error:
        raise RuntimeError("The VM document runner returned invalid JSON.") from error
    if not isinstance(parsed, dict) or parsed.get("ok") is not True:
        message = parsed.get("error", "The VM document runner rejected the operation.") if isinstance(parsed, dict) else "The VM document runner returned an invalid response."
        raise RuntimeError(document_unavailable_message(message))
    return parsed.get("result")


def document_unavailable_message(message):
    text = str(message)
    lowered = text.lower()
    dependency_markers = (
        "requires libreoffice",
        "requires pdftotext",
        "requires pdftoppm",
        "requires pdfunite",
        "requires pdfimages",
        "requires pdftohtml",
        "requires pdfdetach",
        "requires pdftk",
        "requires qpdf",
        "requires ghostscript",
        "requires tesseract",
        "requires the uno bridge",
        "no module named 'uno'",
        "cannot find module",
        "document runner is not provisioned",
    )
    if text.startswith("VM_DOCUMENT_UNAVAILABLE:") or any(marker in lowered for marker in dependency_markers):
        return f"VM_DOCUMENT_UNAVAILABLE: {text.removeprefix('VM_DOCUMENT_UNAVAILABLE: ').strip()}"
    return text


def execute_process(root, params, max_output_bytes):
    command = params.get("command")
    args = params.get("args") or []
    if not isinstance(command, str) or not command.strip() or not isinstance(args, list) or not all(isinstance(item, str) for item in args):
        raise RuntimeError("shell.exec parameters are invalid.")
    cwd_value = params.get("cwd", ".")
    cwd = existing_inside(root, cwd_value)
    if not cwd.is_dir():
        raise RuntimeError("The shell working directory is not a directory.")
    command, args = normalize_guest_command(command, args)
    timeout_ms = bounded_int(params.get("timeoutMs"), 120_000, 100, MAX_TIMEOUT_MS)
    return execute_bounded_process([command, *args], str(cwd), None, max_output_bytes, timeout_ms)


def execute_bounded_process(command, cwd, input_value, max_output_bytes, timeout_ms, environment_overrides=None):
    environment = guest_environment()
    if isinstance(environment_overrides, dict):
        environment.update({key: value for key, value in environment_overrides.items() if isinstance(key, str) and isinstance(value, str)})
    try:
        child = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.PIPE if input_value is not None else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, text=False)
        if input_value is not None:
            child.stdin.write(json.dumps(input_value, separators=(",", ":")).encode("utf-8"))
            child.stdin.close()
    except OSError as error:
        return {"stdout": "", "stderr": str(error), "exitCode": None, "error": True, "timedOut": False, "truncated": False}
    stdout, stderr, timed_out, truncated = collect_output(child, timeout_ms, max_output_bytes)
    return {"stdout": stdout, "stderr": stderr, "exitCode": child.returncode, "timedOut": timed_out, "truncated": truncated}


def collect_output(child, timeout_ms, max_output_bytes):
    deadline = time.monotonic() + timeout_ms / 1000
    output = {"stdout": bytearray(), "stderr": bytearray()}
    streams = {child.stdout: "stdout", child.stderr: "stderr"}
    selector = selectors.DefaultSelector()
    for stream in streams:
        selector.register(stream, selectors.EVENT_READ, stream)
    truncated = False
    try:
        while streams:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                terminate(child)
                return decode(output["stdout"]), decode(output["stderr"]), True, truncated
            events = selector.select(min(remaining, 0.1))
            for key, _mask in events:
                stream = key.fileobj
                chunk = stream.read1(64 * 1024) if hasattr(stream, "read1") else stream.read(64 * 1024)
                if not chunk:
                    selector.unregister(stream)
                    streams.pop(stream, None)
                    continue
                target = streams[stream]
                available = max_output_bytes - len(output["stdout"]) - len(output["stderr"])
                if available <= 0:
                    truncated = True
                    terminate(child)
                    streams.clear()
                    break
                accepted = chunk[:available]
                output[target].extend(accepted)
                if len(accepted) != len(chunk):
                    truncated = True
                    terminate(child)
                    streams.clear()
                    break
            if child.poll() is not None and not events:
                for stream in list(streams):
                    selector.unregister(stream)
                    stream.close()
                    streams.pop(stream, None)
    finally:
        selector.close()
    return decode(output["stdout"]), decode(output["stderr"]), False, truncated


def terminate(child):
    if child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
        child.wait(timeout=0.5)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass


def normalize_guest_command(command, args):
    normalized = command.replace("\\", "/")
    if normalized.startswith("/mnt/") or normalized.startswith("//") or len(normalized) >= 3 and normalized[1:3] == ":/":
        raise RuntimeError("Windows host paths and WSL interop are not available inside the Linux VM.")
    executable = Path(normalized).name.lower()
    if executable in {"powershell", "powershell.exe", "pwsh.exe"}:
        command = "pwsh"
    elif executable in {"cmd", "cmd.exe", "wsl", "wsl.exe"}:
        raise RuntimeError("Windows command interpreters and WSL interop are not available inside the Linux VM.")
    return command, args


def guest_environment():
    environment = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/tmp/lotagate-home", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TERM": "dumb"}
    Path(environment["HOME"]).mkdir(parents=True, exist_ok=True)
    return environment


def apply_runtime_limits(runtime):
    memory_mb = bounded_int(runtime.get("memoryMb"), 2_048, 128, 16_384)
    pids = bounded_int(runtime.get("pidsLimit"), 128, 16, 4_096)
    try:
        resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024, memory_mb * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (pids, pids))
    except (ValueError, OSError):
        pass
    cpu_cores = runtime.get("cpuCores")
    if isinstance(cpu_cores, (int, float)) and hasattr(os, "sched_setaffinity"):
        try:
            available = len(os.sched_getaffinity(0))
            count = max(1, min(available, int(cpu_cores)))
            os.sched_setaffinity(0, set(sorted(os.sched_getaffinity(0))[:count]))
        except (OSError, ValueError):
            pass


def existing_inside(root, value):
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise RuntimeError("The sandbox path is invalid.")
    target = inside(root, value)
    resolved = target.resolve(strict=True)
    assert_inside(root, resolved)
    return resolved


def writable_inside(root, value):
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise RuntimeError("The sandbox write path is invalid.")
    target = inside(root, value)
    parent = resolve_existing_parent(target.parent)
    assert_inside(root, parent)
    return parent / target.name


def inside(root, value):
    target = (root / value).resolve(strict=False) if not os.path.isabs(value) else Path(map_workspace_value(root, value)).resolve(strict=False)
    assert_inside(root, target)
    return target


def map_workspace_value(root, value):
    if not isinstance(value, str) or root == Path("/workspace"):
        return value
    virtual_root = Path("/workspace")
    candidate = Path(value)
    try:
        return str(root / candidate.relative_to(virtual_root))
    except ValueError:
        return value


def map_document_paths(root, params):
    mapped = dict(params)
    for key in ("sourcePath", "imagePath", "mediaPath", "outputPath", "path"):
        if isinstance(mapped.get(key), str):
            mapped[key] = map_workspace_value(root, mapped[key])
    if isinstance(mapped.get("paths"), list):
        mapped["paths"] = [map_workspace_value(root, value) if isinstance(value, str) else value for value in mapped["paths"]]
    return mapped


def assert_inside(root, target):
    try:
        target.relative_to(root)
    except ValueError as error:
        raise RuntimeError("The sandbox path is outside the workspace boundary.") from error


def ensure_disk_budget(root, limit, delta):
    if delta <= 0:
        return
    used = 0
    for directory, _subdirectories, files in os.walk(root):
        for name in files:
            try:
                used += (Path(directory) / name).stat().st_size
            except OSError:
                continue
            if used + delta > limit:
                raise RuntimeError("The VM workspace disk limit would be exceeded.")


def resolve_existing_parent(path):
    current = path
    missing = []
    while not current.exists():
        missing.append(current.name)
        current = current.parent
    resolved = current.resolve(strict=True)
    for name in reversed(missing):
        resolved = resolved / name
    return resolved


def bounded_int(value, fallback, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return fallback
    return max(minimum, min(maximum, int(value)))


def decode(value):
    return bytes(value).decode("utf-8", errors="replace")


def write_json(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        write_json({"requestId": "one-shot", "ok": False, "error": str(error)})

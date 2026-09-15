#!/usr/bin/env python3
"""Authenticated JSONL guest service for the Desktop isolated sandbox.

The runtime mounts the approved workspace at /workspace and starts this file
inside a bubblewrap namespace. The service accepts structured process and file
operations only; host environment variables and host profile paths are never
copied into child processes.
"""

import argparse
import json
import os
import re
import resource
import selectors
import signal
import subprocess
import sys
import time
import venv
from pathlib import Path

try:
    import fcntl
except ImportError:  # The file can still be syntax-checked by Windows tooling.
    fcntl = None


DEFAULT_FILE_BYTES = 10 * 1024 * 1024
DEFAULT_DIRECTORY_ENTRIES = 2_000
DEFAULT_OUTPUT_BYTES = 2 * 1024 * 1024
MAX_TIMEOUT_MS = 10 * 60 * 1_000
PYTHON_BOOTSTRAP_TIMEOUT_SECONDS = 15 * 60
PYTHON_PACKAGE_PATTERN = re.compile(r"^(?P<distribution>[A-Za-z0-9][A-Za-z0-9_.+-]*)==(?P<version>[A-Za-z0-9_.+!-]+):(?P<module>[A-Za-z_][A-Za-z0-9_.]*)$")
PYTHON_PROBE = "import importlib.metadata as m, importlib.util, json, sys; module=sys.argv[1]; distribution=sys.argv[2]; found=False; version=None\ntry: found=importlib.util.find_spec(module) is not None\nexcept (ImportError, ModuleNotFoundError): found=False\ntry: version=m.version(distribution)\nexcept m.PackageNotFoundError: version=None\nprint(json.dumps({'found': found, 'version': version}, separators=(',', ':')))"


def main():
    arguments = parse_arguments()
    if arguments.prepare_python:
        write_json({"requestId": "prepare-python", "ok": True, "result": prepare_python_runtime(arguments)})
        return
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
    parser.add_argument("--prepare-python", action="store_true")
    parser.add_argument("--venv")
    parser.add_argument("--package", action="append", default=[])
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
    pids_limit = bounded_int(runtime.get("pidsLimit"), 128, 16, 4_096)
    workspace_access = runtime.get("workspaceAccess", "read-write")
    if action == "health":
        return {"result": {"ready": True, "root": str(root), "capabilities": ["filesystem", "shell", "git", "python"]}}
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
        return {"result": execute_process(root, params, max_output_bytes, disk_bytes, pids_limit, runtime)}
    raise RuntimeError(f"Unsupported sandbox action: {action}.")


def execute_process(root, params, max_output_bytes, disk_bytes, pids_limit, runtime_limits):
    command = params.get("command")
    args = params.get("args") or []
    if not isinstance(command, str) or not command.strip() or not isinstance(args, list) or not all(isinstance(item, str) for item in args):
        raise RuntimeError("shell.exec parameters are invalid.")
    cwd_value = params.get("cwd", ".")
    cwd = existing_inside(root, cwd_value)
    if not cwd.is_dir():
        raise RuntimeError("The shell working directory is not a directory.")
    command, args = normalize_guest_command(command, args, runtime_limits)
    timeout_ms = bounded_int(params.get("timeoutMs"), 120_000, 100, MAX_TIMEOUT_MS)
    return execute_bounded_process(
        [command, *args],
        str(cwd),
        None,
        max_output_bytes,
        timeout_ms,
        environment_overrides=runtime_limits.get("nodeEnvironment") if isinstance(runtime_limits, dict) and isinstance(runtime_limits.get("nodeEnvironment"), dict) else None,
        runtime_limits=runtime_limits,
        disk_root=root,
        disk_limit=disk_bytes,
        process_limit=pids_limit,
    )


def execute_bounded_process(command, cwd, input_value, max_output_bytes, timeout_ms, environment_overrides=None, runtime_limits=None, disk_root=None, disk_limit=None, process_limit=None):
    environment = guest_environment()
    if isinstance(environment_overrides, dict):
        environment.update({key: value for key, value in environment_overrides.items() if isinstance(key, str) and isinstance(value, str)})
    preexec_fn = None
    if isinstance(runtime_limits, dict) and os.name != "nt":
        preexec_fn = lambda: apply_runtime_limits(runtime_limits)
    try:
        child = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.PIPE if input_value is not None else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, preexec_fn=preexec_fn, text=False)
        if input_value is not None:
            child.stdin.write(json.dumps(input_value, separators=(",", ":")).encode("utf-8"))
            child.stdin.close()
    except OSError as error:
        return {"stdout": "", "stderr": str(error), "exitCode": None, "error": True, "timedOut": False, "truncated": False}
    stdout, stderr, timed_out, truncated, disk_limit_exceeded, process_limit_exceeded = collect_output(child, timeout_ms, max_output_bytes, disk_root, disk_limit, process_limit)
    return {"stdout": stdout, "stderr": stderr, "exitCode": child.returncode, "timedOut": timed_out, "truncated": truncated, "diskLimitExceeded": disk_limit_exceeded, "processLimitExceeded": process_limit_exceeded}


def collect_output(child, timeout_ms, max_output_bytes, disk_root=None, disk_limit=None, process_limit=None):
    deadline = time.monotonic() + timeout_ms / 1000
    output = {"stdout": bytearray(), "stderr": bytearray()}
    streams = {child.stdout: "stdout", child.stderr: "stderr"}
    selector = selectors.DefaultSelector()
    for stream in streams:
        selector.register(stream, selectors.EVENT_READ, stream)
    truncated = False
    disk_limit_exceeded = False
    process_limit_exceeded = False
    try:
        while streams:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                terminate(child)
                return decode(output["stdout"]), decode(output["stderr"]), True, truncated, disk_limit_exceeded, process_limit_exceeded
            if disk_root is not None and disk_limit is not None:
                try:
                    ensure_disk_budget(disk_root, disk_limit, 0)
                except RuntimeError:
                    disk_limit_exceeded = True
                    terminate(child)
                    return decode(output["stdout"]), decode(output["stderr"]), False, truncated, True, process_limit_exceeded
            if process_limit is not None and count_process_tree(child.pid) > process_limit:
                process_limit_exceeded = True
                terminate(child)
                return decode(output["stdout"]), decode(output["stderr"]), False, truncated, disk_limit_exceeded, True
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
        # A child may close both pipes and leave descendants behind. The
        # command has already completed from the caller's perspective, so
        # clean the dedicated process group before returning the result.
        if child.poll() is not None:
            terminate(child)
    return decode(output["stdout"]), decode(output["stderr"]), False, truncated, disk_limit_exceeded, process_limit_exceeded


def terminate(child):
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


def normalize_guest_command(command, args, runtime_limits=None):
    normalized = command.replace("\\", "/")
    if normalized.startswith("/mnt/") or normalized.startswith("//") or len(normalized) >= 3 and normalized[1:3] == ":/":
        raise RuntimeError("Windows host paths and WSL interop are not available inside the isolated guest sandbox.")
    executable = Path(normalized).name.lower()
    if executable in {"powershell", "powershell.exe", "pwsh.exe"}:
        command = "pwsh"
    elif executable in {"cmd", "cmd.exe", "wsl", "wsl.exe"}:
        raise RuntimeError("Windows command interpreters and WSL interop are not available inside the isolated guest sandbox.")
    elif executable in {"node", "nodejs"} and isinstance(runtime_limits, dict) and isinstance(runtime_limits.get("nodeExecutable"), str):
        command = runtime_limits["nodeExecutable"]
    mapped_args = list(args)
    if isinstance(runtime_limits, dict) and isinstance(runtime_limits.get("guestRunnerPath"), str):
        runner = runtime_limits["guestRunnerPath"]
        mapped_args = [runner if value == "/opt/lotagate/sandbox/guest-runner.py" else value for value in mapped_args]
    return command, mapped_args


def guest_environment():
    environment = {"PATH": "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/tmp/lotagate-home", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TERM": "dumb"}
    Path(environment["HOME"]).mkdir(parents=True, exist_ok=True)
    return environment


def prepare_python_runtime(arguments):
    if not isinstance(arguments.venv, str) or not arguments.venv.strip():
        raise RuntimeError("Python runtime preparation requires --venv.")
    packages = parse_python_packages(arguments.package)
    if not packages:
        raise RuntimeError("Python runtime preparation requires at least one --package.")
    venv_path = Path(arguments.venv).resolve(strict=False)
    tmp_root = Path("/tmp").resolve()
    try:
        venv_path.relative_to(tmp_root)
    except ValueError as error:
        raise RuntimeError("Python document environments must be created below /tmp.") from error
    venv_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = Path(f"{venv_path}.lock")
    with lock_path.open("a+", encoding="utf-8") as lock:
        if fcntl is not None:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            python_path = venv_path / "bin" / "python"
            if not python_path.exists():
                venv.EnvBuilder(with_pip=True, clear=False).create(str(venv_path))
            before = [probe_python_package(python_path, package) for package in packages]
            needs_install = any(item["version"] != package["version"] or item["found"] is not True for item, package in zip(before, packages))
            if needs_install:
                install_python_packages(python_path, packages)
            after = [probe_python_package(python_path, package) for package in packages]
            invalid = [f"{package['distribution']}=={package['version']}" for package, result in zip(packages, after) if result["found"] is not True or result["version"] != package["version"]]
            if invalid:
                raise RuntimeError(f"Python package verification failed: {', '.join(invalid)}.")
            return {"venv": str(venv_path), "packages": packages, "changed": needs_install}
        finally:
            if fcntl is not None:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def parse_python_packages(values):
    packages = []
    for value in values:
        match = PYTHON_PACKAGE_PATTERN.fullmatch(value)
        if match is None:
            raise RuntimeError(f"Invalid Python package specification '{value}'. Use distribution==version:import.")
        packages.append({"distribution": match.group("distribution"), "version": match.group("version"), "module": match.group("module")})
    return packages


def probe_python_package(python_path, package):
    result = subprocess.run([str(python_path), "-c", PYTHON_PROBE, package["module"], package["distribution"]], capture_output=True, text=True, timeout=30, check=False)
    if result.returncode != 0:
        return {"found": False, "version": None}
    try:
        value = json.loads(result.stdout.strip())
        return {"found": value.get("found") is True, "version": value.get("version") if isinstance(value.get("version"), str) else None}
    except (json.JSONDecodeError, AttributeError):
        return {"found": False, "version": None}


def install_python_packages(python_path, packages):
    specifications = [f"{package['distribution']}=={package['version']}" for package in packages]
    try:
        result = subprocess.run([str(python_path), "-m", "pip", "install", "--require-virtualenv", "--no-input", "--disable-pip-version-check", "--upgrade-strategy", "only-if-needed", *specifications], capture_output=True, text=True, timeout=PYTHON_BOOTSTRAP_TIMEOUT_SECONDS, check=False)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Python dependency installation timed out.") from error
    if result.returncode != 0:
        details = (result.stderr or result.stdout or "pip did not provide diagnostics.").strip()
        raise RuntimeError(f"Python dependency installation failed: {details[-4_096:]}")


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


def assert_inside(root, target):
    try:
        target.relative_to(root)
    except ValueError as error:
        raise RuntimeError("The sandbox path is outside the workspace boundary.") from error


def ensure_disk_budget(root, limit, delta):
    used = 0
    for directory, _subdirectories, files in os.walk(root):
        for name in files:
            try:
                used += (Path(directory) / name).stat().st_size
            except OSError:
                continue
            if used + delta > limit:
                raise RuntimeError("The VM workspace disk limit would be exceeded.")


def count_process_tree(root_pid):
    parent_by_pid = {}
    try:
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            try:
                stat_text = (entry / "stat").read_text(encoding="utf-8")
                closing_name = stat_text.rfind(")")
                fields = stat_text[closing_name + 2:].split()
                parent_by_pid[int(entry.name)] = int(fields[1])
            except (OSError, ValueError, IndexError):
                continue
    except OSError:
        return 1
    count = 0
    pending = [root_pid]
    while pending:
        current = pending.pop()
        count += 1
        pending.extend(pid for pid, parent in parent_by_pid.items() if parent == current)
    return count


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

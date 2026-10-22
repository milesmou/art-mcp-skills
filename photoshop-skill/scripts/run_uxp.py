"""Build a project-owned .psjs task, launch Photoshop, and collect its result."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

SKILL_ROOT = Path(__file__).resolve().parents[1]
RUNS_ROOT = Path(tempfile.gettempdir()) / "photoshop-uxp-runs"
TERMINAL = {"completed", "failed"}


def write_json(path: Path, data: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def default_search_roots() -> list[Path]:
    roots = [Path(tempfile.gettempdir()) / "Adobe" / "UXP"]
    if sys.platform == "win32":
        roots.extend(Path(os.environ[key]) / "Adobe" / "UXP"
                     for key in ("APPDATA", "LOCALAPPDATA") if os.environ.get(key))
    elif sys.platform == "darwin":
        roots.append(Path.home() / "Library" / "Application Support" / "Adobe" / "UXP")
    return list(dict.fromkeys(root.resolve() for root in roots))


def find_result(run_id: str, roots: list[Path]) -> tuple[Path, dict] | None:
    for root in roots:
        if not root.is_dir():
            continue
        patterns = [f"PluginsStorage/PHSP/*/External/*/*/{run_id}/state.json",
                    f"{run_id}/state.json"]
        for pattern in patterns:
            for path in root.glob(pattern):
                try:
                    state = json.loads(path.read_text(encoding="utf-8-sig"))
                except (OSError, ValueError):
                    continue  # The host may still be writing the file.
                if state.get("run_id") == run_id and state.get("status") in TERMINAL:
                    return path, state
    return None


def discover_photoshop() -> Path:
    if sys.platform == "win32":
        command = ("[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); "
                   "@(Get-Process Photoshop -ErrorAction SilentlyContinue | "
                   "Select-Object -ExpandProperty Path -Unique) | ConvertTo-Json -Compress")
        result = subprocess.run(["powershell.exe", "-NoProfile", "-Command", command],
                                capture_output=True, text=True, encoding="utf-8",
                                creationflags=subprocess.CREATE_NO_WINDOW, check=False)
        try:
            paths = json.loads(result.stdout) if result.stdout.strip() else []
        except ValueError:
            paths = []
        if isinstance(paths, str):
            paths = [paths]
        paths = list(dict.fromkeys(Path(path) for path in paths if path))
        if len(paths) > 1:
            raise RuntimeError("Multiple Photoshop installations are running; use --photoshop.")
        if paths and paths[0].is_file():
            return paths[0]
        raise RuntimeError("Start Photoshop first, or specify its executable with --photoshop.")
    if sys.platform == "darwin":
        applications = list(Path("/Applications").glob("Adobe Photoshop*/*.app"))
        applications += list(Path("/Applications").glob("Adobe Photoshop*.app"))
        applications = sorted(set(applications))
        if len(applications) == 1:
            return applications[0]
        raise RuntimeError("Specify the running Photoshop application with --photoshop.")
    raise RuntimeError("This launcher supports Windows and macOS Photoshop.")


def build_script(body: str, run_id: str) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", run_id):
        raise ValueError("Invalid run_id")
    template = (SKILL_ROOT / "assets" / "harness.psjs").read_text(encoding="utf-8")
    for marker in ("/*__RUN_CONFIG__*/", "/*__TASK_BODY__*/"):
        if template.count(marker) != 1:
            raise RuntimeError(f"Harness must contain exactly one {marker}")
    # Replace the body last: markers inside task text are intentional literal text.
    return template.replace("/*__RUN_CONFIG__*/", json.dumps({"run_id": run_id})).replace(
        "/*__TASK_BODY__*/", body)


def active_lock() -> Path:
    RUNS_ROOT.mkdir(parents=True, exist_ok=True)
    return RUNS_ROOT / "active.json"


def clear_lock(run_id: str) -> None:
    path = active_lock()
    try:
        if json.loads(path.read_text(encoding="utf-8")).get("run_id") == run_id:
            path.unlink()
    except FileNotFoundError:
        pass


def acquire_lock(metadata: dict) -> None:
    path = active_lock()
    if path.exists():
        previous = json.loads(path.read_text(encoding="utf-8"))
        roots = [Path(root) for root in previous["search_roots"]]
        if find_result(previous["run_id"], roots):
            collect(Path(previous["run_dir"]), previous)
        else:
            raise RuntimeError("A prior UXP task has no final result. Collect it first: "
                               f'--collect "{previous["run_dir"]}"')
    with path.open("x", encoding="utf-8") as stream:
        json.dump(metadata, stream, ensure_ascii=False)


def launch(photoshop: Path, script: Path) -> None:
    if sys.platform == "win32":
        subprocess.Popen([str(photoshop), str(script)], stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    elif sys.platform == "darwin":
        subprocess.run(["/usr/bin/open", "-a", str(photoshop), str(script)], check=True)
    else:
        raise RuntimeError("Unsupported platform")


def collect(run_dir: Path, metadata: dict) -> dict | None:
    found = find_result(metadata["run_id"], [Path(root) for root in metadata["search_roots"]])
    if found is None:
        return None
    state_path, state = found
    output = run_dir / "output"
    shutil.copytree(state_path.parent, output, dirs_exist_ok=True)
    clear_lock(metadata["run_id"])
    return {"run_id": metadata["run_id"], "status": state["status"],
            "run_dir": str(run_dir), "output_dir": str(output),
            "state_path": str(output / "state.json"),
            "elapsed_ms": state.get("elapsed_ms"), "errors": state.get("errors", [])}


def wait_for_result(run_dir: Path, metadata: dict, timeout: float) -> tuple[dict, int]:
    deadline = time.monotonic() + timeout
    while True:
        result = collect(run_dir, metadata)
        if result is not None:
            return result, 0 if result["status"] == "completed" else 1
        if time.monotonic() >= deadline:
            return {"run_id": metadata["run_id"], "status": "timeout",
                    "run_dir": str(run_dir),
                    "message": "Photoshop may still be running. Do not launch a duplicate task.",
                    "collect_command": f'python "{Path(__file__).resolve()}" --collect "{run_dir}"'}, 124
        time.sleep(min(0.5, max(0, deadline - time.monotonic())))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task", nargs="?", type=Path, help="UTF-8 task body with top-level await")
    parser.add_argument("--photoshop", type=Path, help="Running Photoshop executable or macOS .app")
    parser.add_argument("--run-dir", type=Path, help="New or empty local run directory")
    parser.add_argument("--search-root", action="append", type=Path,
                        help="Additional UXP storage root to search")
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--prepare-only", action="store_true", help="Build without starting Photoshop")
    parser.add_argument("--collect", type=Path, help="Wait for an existing run; never relaunch it")
    args = parser.parse_args(argv)
    if args.timeout < 0:
        parser.error("--timeout must be nonnegative")
    if args.collect:
        if args.task or args.prepare_only:
            parser.error("--collect cannot be combined with task or --prepare-only")
        run_dir = args.collect.resolve()
        metadata = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    else:
        if args.task is None:
            parser.error("task is required unless --collect is used")
        body = args.task.read_text(encoding="utf-8-sig")
        run_id = "uxp_" + uuid.uuid4().hex
        run_dir = args.run_dir.resolve() if args.run_dir else RUNS_ROOT / run_id
        if run_dir.exists() and any(run_dir.iterdir()):
            raise RuntimeError(f"Run directory must be new or empty: {run_dir}")
        run_dir.mkdir(parents=True, exist_ok=True)
        script = run_dir / "task.psjs"
        script.write_text(build_script(body, run_id), encoding="utf-8")
        roots = default_search_roots() + [root.resolve() for root in args.search_root or []]
        metadata = {"run_id": run_id, "run_dir": str(run_dir),
                    "script": str(script), "search_roots": [str(root) for root in roots]}
        write_json(run_dir / "run.json", metadata)
        if args.prepare_only:
            print(json.dumps({**metadata, "status": "prepared"}, ensure_ascii=False))
            return 0
        photoshop = args.photoshop.resolve() if args.photoshop else discover_photoshop()
        if not photoshop.exists():
            raise RuntimeError(f"Photoshop not found: {photoshop}")
        acquire_lock(metadata)
        try:
            launch(photoshop, script)
        except Exception:
            clear_lock(run_id)
            raise
    result, code = wait_for_result(run_dir, metadata, args.timeout)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({"status": "launcher_error", "message": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        raise SystemExit(2)

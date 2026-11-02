#!/usr/bin/env python3
"""Exercise the standalone reader in a real macOS pseudo-terminal.

Run after building PR 76: CODETOUR_CLI=/path/to/dist/cli.js python3 test/macos-terminal-integration.py
"""
import json
import os
import pathlib
import pty
import select
import signal
import subprocess
import tempfile
import time


def main():
    if os.uname().sysname != "Darwin":
        raise SystemExit("This integration test requires macOS")
    cli = pathlib.Path(os.environ.get("CODETOUR_CLI", "dist/cli.js")).resolve()
    if not cli.is_file():
        raise SystemExit(f"Build the standalone CLI first or set CODETOUR_CLI: {cli}")
    with tempfile.TemporaryDirectory(prefix="codetour-macos-pty-") as directory:
        root = pathlib.Path(directory)
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        # The Tour may be under a nested Git repo while it belongs to the
        # outer workspace selected by the CLI.
        nested = root / "nested"
        nested.mkdir()
        subprocess.run(["git", "init", "-q", str(nested)], check=True)
        (root / "source.txt").write_text("WORKSPACE_ROOT_CONTENT\n", encoding="utf-8")
        tour = nested / "tour.tour"
        tour.write_text(json.dumps({"title": "macOS integration", "steps": [
            {"title": "First step", "description": "First description", "file": "source.txt", "line": 1},
            {"title": "Second step", "description": "Second description"},
        ]}), encoding="utf-8")
        pid, fd = pty.fork()
        if pid == 0:
            os.environ["TERM"] = "xterm-256color"
            os.execlp("node", "node", str(cli), "--internal-tour", str(tour), str(root))
        output = bytearray()
        stage, status = 0, None
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                ready, _, _ = select.select([fd], [], [], 0.2)
                if ready:
                    try:
                        output.extend(os.read(fd, 65536))
                    except OSError:
                        pass
                if stage == 0 and b"First step" in output and b"WORKSPACE_ROOT_CONTENT" in output:
                    os.write(fd, b"n")
                    stage = 1
                if stage == 1 and b"Second step" in output:
                    os.write(fd, b"q")
                    stage = 2
                done, result = os.waitpid(pid, os.WNOHANG)
                if done:
                    status = os.waitstatus_to_exitcode(result)
                    break
            if stage != 2 or status != 0:
                raise AssertionError(f"Navigation failed (stage={stage}, exit={status}):\n"
                                     + output[-3000:].decode(errors="replace"))
            print("PASS: first step, next step and quit in a macOS pseudo-terminal")
        finally:
            if status is None:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
            os.close(fd)


if __name__ == "__main__":
    main()

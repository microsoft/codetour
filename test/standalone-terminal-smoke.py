"""Smoke the packaged reader inside a macOS pseudo-terminal."""
import os
import pty
import select
import signal
import sys
import time

launcher, tour = sys.argv[1:3]
expected = [value.encode() for value in sys.argv[3:]]
pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.execv(launcher, [launcher, "--internal-tour", tour])
output = bytearray()
status = None
sent = False
try:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.2)
        if ready:
            try:
                output.extend(os.read(fd, 65536))
            except OSError:
                pass
        if not sent and b"Introduction" in output and all(marker in output for marker in expected):
            os.write(fd, b"q")
            sent = True
        done, result = os.waitpid(pid, os.WNOHANG)
        if done:
            status = os.waitstatus_to_exitcode(result)
            break
    if not sent or status != 0:
        raise SystemExit("Packaged terminal failed: " + output[-3000:].decode(errors="replace"))
    print("Packaged TermDOM displayed a Tour Step and exited")
finally:
    if status is None:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    os.close(fd)

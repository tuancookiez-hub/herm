#!/usr/bin/env python3
"""Spawn a command on a pty of a given size, discarding output.
Useful for CONTROL-driven herm checks that need a real terminal size."""
import os, sys, pty, fcntl, struct, termios, signal

cols = int(os.environ.get("COLS", "200"))
rows = int(os.environ.get("ROWS", "50"))

pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
os.kill(pid, signal.SIGWINCH)
signal.signal(signal.SIGTERM, lambda *_: (os.kill(pid, signal.SIGTERM), sys.exit(0)))

# Drain the pty so the child's writes don't block on a full pipe.
try:
    while True:
        try:
            if not os.read(fd, 65536):
                break
        except OSError:
            break
finally:
    try: os.waitpid(pid, 0)
    except OSError: pass

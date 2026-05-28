"""Unit test: smoke.py exits cleanly.

This test does NOT verify the span landed in ClickHouse - the Collector
may not be running during pytest. The end-to-end check is the runtime
verification step in the packet spec (and `make demo` in VOI-310).
"""

from __future__ import annotations

import subprocess
import os
import sys
from pathlib import Path

SMOKE_SCRIPT = Path(__file__).resolve().parent.parent / "examples" / "smoke.py"


def test_smoke_exits_zero() -> None:
    """smoke.py must exit 0 even with no Collector listening.

    BatchSpanProcessor swallows export failures (logs them); the script's
    own logic is what determines exit code. If smoke raises, this test fails
    with the traceback in captured stderr.

    We set OTEL_EXPORTER_OTLP_TIMEOUT to bound the gRPC export attempt when
    no Collector is listening (the BatchSpanProcessor's default backoff can
    otherwise race the subprocess `timeout=60s` ceiling on slower hardware).

    Unit caveat: the OTel spec defines this env var in MILLISECONDS, but
    opentelemetry-exporter-otlp-grpc currently (1.42.x) treats it as
    SECONDS. We pass "2000", which under the current "seconds" reading is
    bounded by our subprocess timeout, and under a future spec-aligned
    "milliseconds" reading is 2s -- in either case the test does not flake.
    """
    env = os.environ.copy()
    env["OTEL_EXPORTER_OTLP_TIMEOUT"] = "2000"
    result = subprocess.run(
        [sys.executable, str(SMOKE_SCRIPT)],
        capture_output=True,
        text=True,
        timeout=60,
        env=env,
    )
    assert result.returncode == 0, (
        f"smoke.py exited {result.returncode}\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )
    # Defensive: no Python-level Traceback should appear in stderr. OTel
    # gRPC export failures get logged but are not Tracebacks.
    assert "Traceback (most recent call last)" not in result.stderr, (
        f"smoke.py logged a traceback:\n{result.stderr}"
    )

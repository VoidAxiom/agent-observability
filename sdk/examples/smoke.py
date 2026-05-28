"""Walking-skeleton smoke: emit exactly one span via the bootstrapped pipeline.

Run via `uv run python sdk/examples/smoke.py` (after `make collector-up`).
The span lands in ClickHouse `otel_traces` as
SpanName='agent_obs_sdk.smoke', ServiceName='agent-obs-sdk'.
"""

from __future__ import annotations

from opentelemetry import trace

from agent_obs_sdk import bootstrap


def main() -> int:
    provider = bootstrap()
    tracer = trace.get_tracer("agent_obs_sdk.smoke")
    with tracer.start_as_current_span("agent_obs_sdk.smoke"):
        pass
    # Flush the BatchSpanProcessor so the span reaches the Collector before
    # interpreter exit. shutdown() also flushes; either is fine.
    provider.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

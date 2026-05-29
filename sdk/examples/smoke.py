"""Walking-skeleton smoke: emit exactly one span via the bootstrapped pipeline.

Run via `uv run python sdk/examples/smoke.py` (after `make collector-up`).
The span lands in ClickHouse `otel_traces` with provenance:
agent.project / agent.session.id on the resource, and agent.run.id on the span.
"""

from __future__ import annotations

from opentelemetry import trace

from agent_obs_sdk import bootstrap, run_context


def main() -> int:
    provider = bootstrap(project="agent-observability", session_id="smoke-session-1")
    tracer = trace.get_tracer("agent_obs_sdk.smoke")
    with run_context("smoke-run-1"):
        with tracer.start_as_current_span("agent_obs_sdk.smoke"):
            pass
    # Flush the BatchSpanProcessor so the span reaches the Collector before
    # interpreter exit. shutdown() also flushes; either is fine.
    provider.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

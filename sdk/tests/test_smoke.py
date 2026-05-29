"""Unit test: smoke.py exits cleanly.

This test does NOT verify the span landed in ClickHouse - the Collector
may not be running during pytest. The end-to-end check is the runtime
verification step in the packet spec (and `make demo` in VOI-310).
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import opentelemetry.trace as trace_api
import pytest
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.util._once import Once

from agent_obs_sdk import bootstrap
from agent_obs_sdk.run_context import RunIdSpanProcessor, run_context

bootstrap_module = sys.modules["agent_obs_sdk.bootstrap"]

SMOKE_SCRIPT = Path(__file__).resolve().parent.parent / "examples" / "smoke.py"


def _reset_global_tracer_provider() -> None:
    """Reset OTel's set-once global tracer provider for test isolation."""
    trace_api._TRACER_PROVIDER = None
    trace_api._TRACER_PROVIDER_SET_ONCE = Once()


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


def test_run_context_stamps_provenance() -> None:
    exporter = InMemorySpanExporter()
    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": "agent-obs-sdk",
                "agent.project": "test-project",
                "agent.session.id": "test-session-3",
            }
        )
    )
    provider.add_span_processor(RunIdSpanProcessor())
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("agent_obs_sdk.tests")

    with tracer.start_as_current_span("outside"):
        pass
    with run_context("test-run-7"):
        with tracer.start_as_current_span("inside"):
            pass

    finished_spans = exporter.get_finished_spans()
    assert len(finished_spans) == 2
    outside_span = next(span for span in finished_spans if span.name == "outside")
    inside_span = next(span for span in finished_spans if span.name == "inside")

    assert "agent.run.id" not in outside_span.attributes
    assert inside_span.attributes["agent.run.id"] == "test-run-7"
    assert inside_span.resource.attributes["agent.project"] == "test-project"
    assert inside_span.resource.attributes["agent.session.id"] == "test-session-3"


def test_bootstrap_installs_runidprocessor_and_resource() -> None:
    bootstrap_module._PROVIDER = None
    provider: TracerProvider | None = None
    try:
        provider = bootstrap(project="itest-project", session_id="itest-session")
        assert provider.resource.attributes["agent.project"] == "itest-project"
        assert provider.resource.attributes["agent.session.id"] == "itest-session"
        assert provider.resource.attributes["service.name"] == "agent-obs-sdk"

        exporter = InMemorySpanExporter()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        tracer = provider.get_tracer("agent_obs_sdk.tests")

        with run_context("itest-run"):
            with tracer.start_as_current_span("parent"):
                with tracer.start_as_current_span("child"):
                    pass

        finished_spans = exporter.get_finished_spans()
        assert len(finished_spans) == 2
        parent_span = next(span for span in finished_spans if span.name == "parent")
        child_span = next(span for span in finished_spans if span.name == "child")
        assert parent_span.attributes["agent.run.id"] == "itest-run"
        assert child_span.attributes["agent.run.id"] == "itest-run"
    finally:
        if provider is not None:
            provider.shutdown()
        bootstrap_module._PROVIDER = None
        _reset_global_tracer_provider()


def test_bootstrap_default_session_id_is_uuid() -> None:
    bootstrap_module._PROVIDER = None
    provider: TracerProvider | None = None
    try:
        provider = bootstrap(project="itest-project")
        sid = provider.resource.attributes["agent.session.id"]
        assert isinstance(sid, str) and sid
        try:
            uuid.UUID(str(sid))
        except ValueError as exc:
            raise AssertionError(
                f"agent.session.id is not uuid-shaped: {sid!r}"
            ) from exc
    finally:
        if provider is not None:
            provider.shutdown()
        bootstrap_module._PROVIDER = None
        _reset_global_tracer_provider()


def test_validation_rejects_empty_inputs() -> None:
    bootstrap_module._PROVIDER = None
    try:
        with pytest.raises(ValueError):
            bootstrap(project="")

        with pytest.raises(ValueError):
            bootstrap(project="p", session_id="")

        with pytest.raises(ValueError):
            with run_context(""):
                pass
    finally:
        bootstrap_module._PROVIDER = None
        _reset_global_tracer_provider()

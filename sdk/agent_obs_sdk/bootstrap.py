"""Bootstrap the OpenTelemetry tracer pipeline for agent-obs-sdk.

M0 walking-skeleton: sets up a TracerProvider with an OTLP/gRPC exporter
pointing at the Collector from VOI-307 (default localhost:4317), wires the
OpenAI auto-instrumentor defensively (no-op if the openai SDK isn't installed),
and returns the provider so callers can `force_flush()` / `shutdown()` on exit.

Provenance attributes (agent.project / agent.session.id) land in M1 (VOI-311).
"""

from __future__ import annotations

import logging
import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

logger = logging.getLogger(__name__)

DEFAULT_OTLP_ENDPOINT = "localhost:4317"
SERVICE_NAME = "agent-obs-sdk"
_PROVIDER: TracerProvider | None = None


def bootstrap() -> TracerProvider:
    """Initialize the global OTel TracerProvider for the SDK.

    Idempotent: calling `bootstrap()` again returns the same provider the
    first call installed. Necessary because `trace.set_tracer_provider()`
    only honors the first call (subsequent calls warn-and-ignore), so
    returning a fresh detached provider would silently break the caller's
    `.shutdown()` / `.force_flush()` semantics.

    The singleton assignment happens immediately after
    `trace.set_tracer_provider(provider)` so that any later failure in this
    function (e.g. a Traceloop instrumentor regression raising a non-ImportError)
    leaves a consistent global+singleton state. Callers who retry
    `bootstrap()` after such an error get back the same provider, and its
    `.shutdown()` correctly flushes the global pipeline.

    Returns:
        The configured TracerProvider so callers can `force_flush()` /
        `shutdown()` before process exit (otherwise the BatchSpanProcessor
        may lose queued spans).
    """
    global _PROVIDER
    if _PROVIDER is not None:
        return _PROVIDER

    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", DEFAULT_OTLP_ENDPOINT)
    # OTLP/gRPC: derive insecure from URL scheme. https:// implies TLS; anything
    # else (bare host:port, or http://) implies an insecure channel.
    insecure = not endpoint.startswith("https://")

    resource = Resource.create({"service.name": SERVICE_NAME})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=endpoint, insecure=insecure)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    existing = trace.get_tracer_provider()
    if not isinstance(existing, trace.ProxyTracerProvider):
        logger.warning(
            "existing TracerProvider detected (%s); set_tracer_provider() "
            "will be a no-op. bootstrap() returns the new (detached) provider "
            "for caller introspection, but spans created via "
            "trace.get_tracer() will go to the pre-existing global provider, "
            "and force_flush()/shutdown() on the returned provider will NOT "
            "flush those spans. To use the SDK's OTLP exporter, ensure no "
            "other TracerProvider is installed before calling bootstrap().",
            type(existing).__name__,
        )
    trace.set_tracer_provider(provider)
    _PROVIDER = provider

    # Wire the OpenAI auto-instrumentor defensively. The Traceloop-flavored
    # `opentelemetry-instrumentation-openai` distribution executes `import openai`
    # at module-import time, so the import itself raises ModuleNotFoundError when
    # the `openai` SDK isn't installed. M0 doesn't need it actively; M1 (VOI-311)
    # will add a real openai dependency once we wire LLM calls.
    try:
        from opentelemetry.instrumentation.openai import OpenAIInstrumentor

        OpenAIInstrumentor().instrument()
        logger.info("OpenAIInstrumentor wired")
    except ImportError as exc:
        logger.warning(
            "OpenAIInstrumentor not wired (openai SDK not installed): %s", exc
        )

    return provider

"""Bootstrap the OpenTelemetry tracer pipeline for agent-obs-sdk.

Sets up a TracerProvider with an OTLP/gRPC exporter pointing at the Collector
(default localhost:4317), wires the OpenAI auto-instrumentor defensively
(no-op if the openai SDK isn't installed), and returns the provider so callers
can `force_flush()` / `shutdown()` on exit.

Stamps provenance: agent.project + agent.session.id on the Resource, and
agent.run.id on spans started inside run_context() (see run_context.py).
"""

from __future__ import annotations

import logging
import os
import re
import uuid

from opentelemetry import context
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from agent_obs_sdk.run_context import RunIdSpanProcessor

logger = logging.getLogger(__name__)

DEFAULT_OTLP_ENDPOINT = "localhost:4317"
SERVICE_NAME = "agent-obs-sdk"
_PROVIDER: TracerProvider | None = None
_TRACEPARENT_RE = re.compile(r"^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$")
_ALL_ZERO_TRACE_ID = "0" * 32
_ALL_ZERO_SPAN_ID = "0" * 16


def _is_valid_traceparent(value: str) -> bool:
    """W3C Trace Context validity: regex shape AND non-all-zero ids (§3.2.2.3).

    Mirrors the same validity rule VOI-313's `bin/cc-launch.sh` /
    `bin/codex-spawn.sh` enforce when minting or inheriting TRACEPARENT.
    An all-zero trace-id or span-id is invalid and must be treated as
    "no valid parent" — fall through to fresh-root behavior.
    """
    if not _TRACEPARENT_RE.match(value):
        return False
    parts = value.split("-")
    # parts == ["00", trace_id, span_id, flags]
    return parts[1] != _ALL_ZERO_TRACE_ID and parts[2] != _ALL_ZERO_SPAN_ID


def bootstrap(project: str, session_id: str | None = None) -> TracerProvider:
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
    if not project:
        raise ValueError("bootstrap() requires a non-empty project")
    if session_id is not None and not session_id:
        raise ValueError("bootstrap() session_id, if provided, must be non-empty")

    if _PROVIDER is not None:
        cached_project = _PROVIDER.resource.attributes.get("agent.project")
        if project != cached_project:
            logger.warning(
                "bootstrap() already initialized with agent.project=%r; "
                "ignoring new value %r (the first provider wins).",
                cached_project,
                project,
            )
        if session_id is not None:
            cached_session = _PROVIDER.resource.attributes.get("agent.session.id")
            if session_id != cached_session:
                logger.warning(
                    "bootstrap() already initialized with agent.session.id=%r; "
                    "ignoring new value %r (the first provider wins).",
                    cached_session,
                    session_id,
                )
        return _PROVIDER

    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", DEFAULT_OTLP_ENDPOINT)
    # OTLP/gRPC: derive insecure from URL scheme. https:// implies TLS; anything
    # else (bare host:port, or http://) implies an insecure channel.
    insecure = not endpoint.startswith("https://")

    if session_id is None:
        session_id = str(uuid.uuid4())

    resource = Resource.create(
        {
            "service.name": SERVICE_NAME,
            "agent.project": project,
            "agent.session.id": session_id,
        }
    )
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=endpoint, insecure=insecure)
    provider.add_span_processor(RunIdSpanProcessor())
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

    # Extract inbound TRACEPARENT (if any) and attach as the active context so
    # the first span created via trace.get_tracer().start_as_current_span()
    # parents under the inherited context. This closes the M2 cross-process
    # headline: `bin/cc-launch.sh` / `bin/codex-spawn.sh` set TRACEPARENT in
    # env, and we now extract it (the default OTel Python SDK propagators only
    # read W3C tracecontext from HTTP headers, not env). Validity mirrors
    # VOI-313's rule — W3C shape AND non-all-zero ids — so an all-zero
    # inbound is treated as "no valid parent" and the SDK starts a fresh root.
    inbound_traceparent = os.environ.get("TRACEPARENT")
    if inbound_traceparent and _is_valid_traceparent(inbound_traceparent):
        parent_context = TraceContextTextMapPropagator().extract(
            {"traceparent": inbound_traceparent}
        )
        context.attach(parent_context)
        logger.info(
            "inherited TRACEPARENT=%s as active context (cross-process tree active)",
            inbound_traceparent,
        )

    # Wire the OpenAI auto-instrumentor defensively. The Traceloop-flavored
    # `opentelemetry-instrumentation-openai` distribution executes `import openai`
    # at module-import time, so the import itself raises ModuleNotFoundError when
    # the `openai` SDK isn't installed. A later milestone that wires real LLM
    # calls will add the openai dependency; until then this stays a defensive no-op.
    try:
        from opentelemetry.instrumentation.openai import OpenAIInstrumentor

        OpenAIInstrumentor().instrument()
        logger.info("OpenAIInstrumentor wired")
    except ImportError as exc:
        logger.warning(
            "OpenAIInstrumentor not wired (openai SDK not installed): %s", exc
        )

    return provider

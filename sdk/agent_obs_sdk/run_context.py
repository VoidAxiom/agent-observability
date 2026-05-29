"""Stamp logical run provenance on spans via OpenTelemetry baggage.

`run_context()` stores the run id in baggage for the active context, and
`RunIdSpanProcessor` copies it onto spans automatically when they start inside
the with-block.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator

from opentelemetry import baggage, context
from opentelemetry.context import Context
from opentelemetry.sdk.trace import Span, SpanProcessor

RUN_ID_ATTRIBUTE = "agent.run.id"


class RunIdSpanProcessor(SpanProcessor):
    """Stamp agent.run.id on spans started inside run_context()."""

    def on_start(self, span: Span, parent_context: Context | None = None) -> None:
        value = baggage.get_baggage(RUN_ID_ATTRIBUTE, parent_context)
        if value is not None:
            span.set_attribute(RUN_ID_ATTRIBUTE, str(value))


@contextlib.contextmanager
def run_context(run_id: str) -> Iterator[None]:
    if not run_id:
        raise ValueError("run_context() requires a non-empty run_id")

    new_ctx = baggage.set_baggage(RUN_ID_ATTRIBUTE, run_id)
    token = context.attach(new_ctx)
    try:
        yield
    finally:
        context.detach(token)

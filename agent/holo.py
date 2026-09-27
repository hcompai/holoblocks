"""Holo on a Blockyard build: a sagent runner, started by the server with hai's Python, and its chat handler."""

import logging
import mimetypes
import os
import signal
import sys
from pathlib import Path

import httpx
from hai_adapters.langfuse_tracing import flush as langfuse_flush
from hai_protocols.image.encoding import MediaType
from hai_protocols.image.serializable_image import SerializableImage
from sagent.core.events import (
    AnswerEvent,
    ErrorEvent,
    EventHandler,
    EventRecord,
    FlowEvent,
    PolicyEvent,
    ToolResultEvent,
)
from sagent.lib.events_handlers.jsonl_dir_handler import JSONLDirEventHandler
from sagent.sagent import SAgent
from sagent.utils.builder import build_agent

CONFIG = Path(__file__).resolve().with_name("holo.yaml")
POST_TIMEOUT_S = 10
LOGGER = logging.getLogger(__name__)


class Chat(EventHandler):
    """Posts the agent's reasoning, messages and answer to the build's chat."""

    def __init__(self, url: str, build: str):
        self.url = f"{url.rstrip('/')}/api/builds/{build}/say"

    def handle_event(self, record: EventRecord) -> None:
        match record.event:
            case PolicyEvent(message=message):
                if message.reasoning_content:
                    self._post(message.reasoning_content, "thinking")
                if message.content and message.content.strip():
                    self._post(message.content.strip(), "assistant")
            case AnswerEvent(answer=answer):
                self._post(str(answer), "assistant")

    def flush(self) -> None:
        pass

    def _post(self, text: str, role: str) -> None:
        try:
            httpx.post(self.url, json={"text": text, "role": role}, timeout=POST_TIMEOUT_S).raise_for_status()
        except httpx.HTTPError as e:
            LOGGER.warning("Blockyard chat post failed: %s", e)


def attachments() -> list[SerializableImage]:
    """The images the user attached to this request: BLOCKYARD_ATTACHMENTS names them in the workspace."""
    workspace = Path(os.environ["BLOCKYARD_WORKSPACE"])
    names = [n for n in os.environ.get("BLOCKYARD_ATTACHMENTS", "").split(os.pathsep) if n]
    return [
        SerializableImage.from_bytes((workspace / n).read_bytes(), MediaType(mimetypes.guess_type(n)[0])) for n in names
    ]


def earlier_history() -> list[EventRecord]:
    """The history this build's earlier runs left: their events since the last compaction, flow control dropped."""
    records = list(JSONLDirEventHandler.read_records(Path(os.environ["BLOCKYARD_WORKSPACE"]) / "runs"))
    compacted = [i for i, r in enumerate(records) if isinstance(r.event, FlowEvent) and r.event.flow == "reset_history"]
    return [r for r in records[compacted[-1] + 1 if compacted else 0 :] if not isinstance(r.event, FlowEvent)]


def resume(agent: SAgent, records: list[EventRecord]) -> None:
    """Restore the earlier history; a call cut off by a stop gets an error, so every call has its result."""
    for record in records:
        agent.add_event_record(record, publish=False)
    events = agent.history.events
    settled = {e.tool_req.id for e in events if isinstance(e, (ToolResultEvent, ErrorEvent)) and e.tool_req}
    for req in (r for e in events if isinstance(e, PolicyEvent) for r in e.tool_reqs if r.id not in settled):
        agent.add_event(
            ErrorEvent(
                error="Stopped by the user before it finished.",
                origin="blockyard",
                traceback=None,
                tool_req=req,
            )
        )


def main() -> None:
    """Build the agent from holo.yaml (key=value overrides), restore the build's history, run the request on stdin."""
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    earlier = earlier_history()
    agent = build_agent(CONFIG.stem, overrides=sys.argv[1:], config_dir=CONFIG.parent)
    agent.policy_context["max_completion_tokens"] = agent.policy.llm.base_request.max_completion_tokens
    try:
        resume(agent, earlier)
        agent([sys.stdin.read(), *attachments()])
    finally:
        for handler in agent.event_bus.handlers:
            handler.flush()
        langfuse_flush()


if __name__ == "__main__":
    main()

"""In-memory TTL store mapping upstream Grok responseId → SSO account token.

Used by the TTS read-response-audio endpoint: when a chat response is generated
via the grok.com path, the orchestrator records ``(upstream_response_id,
account_token, conversation_id)`` here. A later ``GET /webui/api/voice/read/
{upstream_response_id}`` looks up the original account so the upstream session
binding is preserved.

The store is process-local; multi-worker deployments will see TTS misses across
workers but the chat path remains correct. Entries are evicted lazily on every
``get`` to keep the implementation small.
"""

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock

from app.platform.runtime.clock import now_s


_DEFAULT_TTL_S = 30 * 60  # 30 minutes: long enough for "read aloud" UX delay


@dataclass(slots=True)
class _Entry:
    token: str
    conversation_id: str
    expires_at: int


class _ResponseSessionStore:
    def __init__(self) -> None:
        self._lock: Lock = Lock()
        self._entries: dict[str, _Entry] = {}

    def put(
        self,
        response_id: str,
        token: str,
        *,
        conversation_id: str = "",
        ttl_s: int = _DEFAULT_TTL_S,
    ) -> None:
        if not response_id or not token:
            return
        entry = _Entry(
            token=token,
            conversation_id=conversation_id,
            expires_at=now_s() + max(1, ttl_s),
        )
        with self._lock:
            self._entries[response_id] = entry

    def get(self, response_id: str) -> _Entry | None:
        if not response_id:
            return None
        now = now_s()
        with self._lock:
            entry = self._entries.get(response_id)
            if entry is None:
                return None
            if entry.expires_at <= now:
                self._entries.pop(response_id, None)
                return None
            return entry

    def evict_expired(self) -> int:
        """Drop expired entries; return how many were removed (callable from tests)."""
        now = now_s()
        dropped = 0
        with self._lock:
            for key in [k for k, v in self._entries.items() if v.expires_at <= now]:
                self._entries.pop(key, None)
                dropped += 1
        return dropped


_STORE = _ResponseSessionStore()


def record(
    response_id: str,
    token: str,
    *,
    conversation_id: str = "",
    ttl_s: int = _DEFAULT_TTL_S,
) -> None:
    """Register *response_id → token* for future TTS lookups."""
    _STORE.put(response_id, token, conversation_id=conversation_id, ttl_s=ttl_s)


def lookup(response_id: str) -> tuple[str, str] | None:
    """Return ``(token, conversation_id)`` for *response_id* or ``None`` if absent/expired."""
    entry = _STORE.get(response_id)
    if entry is None:
        return None
    return entry.token, entry.conversation_id


__all__ = ["record", "lookup"]

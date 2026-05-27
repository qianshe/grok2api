from __future__ import annotations

from dataclasses import dataclass
from threading import Lock

from app.platform.runtime.clock import now_s


_DEFAULT_TTL_S = 30 * 60


@dataclass(slots=True)
class ChatSessionEntry:
    token: str
    model: str
    mode_id: int
    conversation_id: str
    parent_response_id: str
    expires_at: int


class _ChatSessionStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._entries: dict[str, ChatSessionEntry] = {}

    def put(
        self,
        session_id: str,
        *,
        token: str,
        model: str,
        mode_id: int,
        conversation_id: str,
        parent_response_id: str,
        ttl_s: int = _DEFAULT_TTL_S,
    ) -> None:
        if not session_id or not token or not conversation_id or not parent_response_id:
            return
        entry = ChatSessionEntry(
            token=token,
            model=model,
            mode_id=int(mode_id),
            conversation_id=conversation_id,
            parent_response_id=parent_response_id,
            expires_at=now_s() + max(1, int(ttl_s)),
        )
        with self._lock:
            self._entries[session_id] = entry

    def get(self, session_id: str) -> ChatSessionEntry | None:
        if not session_id:
            return None
        now = now_s()
        with self._lock:
            entry = self._entries.get(session_id)
            if entry is None:
                return None
            if entry.expires_at <= now:
                self._entries.pop(session_id, None)
                return None
            return entry

    def evict_expired(self) -> int:
        now = now_s()
        dropped = 0
        with self._lock:
            for key in [k for k, v in self._entries.items() if v.expires_at <= now]:
                self._entries.pop(key, None)
                dropped += 1
        return dropped


_STORE = _ChatSessionStore()


def record(
    session_id: str,
    *,
    token: str,
    model: str,
    mode_id: int,
    conversation_id: str,
    parent_response_id: str,
    ttl_s: int = _DEFAULT_TTL_S,
) -> None:
    _STORE.put(
        session_id,
        token=token,
        model=model,
        mode_id=mode_id,
        conversation_id=conversation_id,
        parent_response_id=parent_response_id,
        ttl_s=ttl_s,
    )


def lookup(session_id: str) -> ChatSessionEntry | None:
    return _STORE.get(session_id)


__all__ = ["ChatSessionEntry", "record", "lookup"]

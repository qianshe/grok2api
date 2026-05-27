"""TTL store mapping upstream Grok responseId → SSO account token.

Used by the TTS read-response-audio endpoint: when a chat response is generated
via the grok.com path, the orchestrator records ``(upstream_response_id,
account_token, conversation_id)`` here. A later ``GET /webui/api/voice/read/
{upstream_response_id}`` looks up the original account so the upstream session
binding is preserved.

Entries are kept in memory and mirrored to ``data/cache/voice_sessions.db`` so
short-lived read-aloud links survive container rebuilds/restarts. Entries are
evicted lazily on every ``get`` to keep the implementation small.
"""

from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass
import sqlite3
from threading import Lock

from app.platform.paths import data_path
from app.platform.runtime.clock import now_s


_DEFAULT_TTL_S = 7 * 24 * 60 * 60  # 7 days: survives refreshes/restarts without keeping stale mappings indefinitely
_TABLE = "voice_sessions"


def _db_path():
    path = data_path("cache")
    path.mkdir(parents=True, exist_ok=True)
    return path / "voice_sessions.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript(
        f"""
        CREATE TABLE IF NOT EXISTS {_TABLE} (
            response_id     TEXT PRIMARY KEY,
            token           TEXT NOT NULL,
            conversation_id TEXT NOT NULL DEFAULT '',
            expires_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_voice_sessions_expires
            ON {_TABLE} (expires_at);
        """
    )
    return conn


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
            self._persist_locked(response_id, entry)

    def get(self, response_id: str) -> _Entry | None:
        if not response_id:
            return None
        now = now_s()
        with self._lock:
            entry = self._entries.get(response_id)
            if entry is None:
                entry = self._load_locked(response_id, now)
                if entry is None:
                    return None
                self._entries[response_id] = entry
            if entry.expires_at <= now:
                self._entries.pop(response_id, None)
                self._delete_locked(response_id)
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
            dropped += self._delete_expired_locked(now)
        return dropped

    def _persist_locked(self, response_id: str, entry: _Entry) -> None:
        with closing(_connect()) as conn:
            conn.execute(
                f"""
                INSERT INTO {_TABLE} (response_id, token, conversation_id, expires_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(response_id) DO UPDATE SET
                    token = excluded.token,
                    conversation_id = excluded.conversation_id,
                    expires_at = excluded.expires_at
                """,
                (response_id, entry.token, entry.conversation_id, entry.expires_at),
            )
            conn.commit()

    def _load_locked(self, response_id: str, now: int) -> _Entry | None:
        with closing(_connect()) as conn:
            row = conn.execute(
                f"SELECT token, conversation_id, expires_at FROM {_TABLE} WHERE response_id = ?",
                (response_id,),
            ).fetchone()
            if row is None:
                return None
            if int(row[2]) <= now:
                conn.execute(f"DELETE FROM {_TABLE} WHERE response_id = ?", (response_id,))
                conn.commit()
                return None
            return _Entry(token=str(row[0]), conversation_id=str(row[1] or ""), expires_at=int(row[2]))

    def _delete_locked(self, response_id: str) -> None:
        with closing(_connect()) as conn:
            conn.execute(f"DELETE FROM {_TABLE} WHERE response_id = ?", (response_id,))
            conn.commit()

    def _delete_expired_locked(self, now: int) -> int:
        with closing(_connect()) as conn:
            conn.execute(f"DELETE FROM {_TABLE} WHERE expires_at <= ?", (now,))
            removed = conn.execute("SELECT changes()").fetchone()[0]
            conn.commit()
            return int(removed)


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

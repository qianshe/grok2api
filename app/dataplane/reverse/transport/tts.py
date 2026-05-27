"""TTS transport — fetch read-response audio from grok.com.

Streams ``GET /http/app-chat/read-response-audio-file/{response_id}?voiceId=X``
with optional Range header forwarding so the browser audio element can seek.

Returns a tuple ``(byte_stream, status_code, headers)`` where ``headers``
is a dict of the upstream response headers relevant for audio playback
(``Content-Type``, ``Content-Length``, ``Content-Range``, ``Accept-Ranges``).
"""

from typing import AsyncGenerator, Optional
import asyncio

from app.control.proxy.models import ProxyFeedback, ProxyFeedbackKind, ProxyScope, RequestKind
from app.dataplane.proxy import get_proxy_runtime
from app.dataplane.proxy.adapters.headers import build_http_headers
from app.dataplane.proxy.adapters.session import ResettableSession, build_session_kwargs
from app.dataplane.reverse.runtime.endpoint_table import READ_RESPONSE_AUDIO
from app.dataplane.reverse.transport._proxy_feedback import upstream_feedback
from app.platform.config.snapshot import get_config
from app.platform.errors import UpstreamError
from app.platform.logging.logger import logger


_FORWARDED_RESPONSE_HEADERS = (
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "cache-control",
)


async def fetch_response_audio(
    token: str,
    response_id: str,
    *,
    voice_id: str = "Ara",
    range_header: Optional[str] = None,
    conversation_id: Optional[str] = None,
) -> tuple[AsyncGenerator[bytes, None], int, dict[str, str]]:
    """Stream TTS audio for *response_id* from grok.com.

    Args:
        token:           SSO session token to authenticate with.
        response_id:     Upstream Grok responseId (UUID).
        voice_id:        Voice variant (default ``Ara``).
        range_header:    Optional ``Range`` header value (e.g. ``bytes=0-``).
        conversation_id: Optional conversation UUID; used only to construct
                         a plausible Referer.

    Returns:
        ``(stream, status_code, headers)``.
        ``status_code`` is 200 or 206. ``headers`` is the subset of upstream
        headers that the caller should pass through to the browser.
    """
    cfg = get_config()
    timeout_s = cfg.get_float("voice.tts_timeout", cfg.get_float("voice.timeout", 60.0))
    prepare_retries = max(0, cfg.get_int("voice.tts_prepare_retries", 3))
    prepare_delay_s = max(0.0, cfg.get_float("voice.tts_prepare_retry_delay", 1.0))

    url = f"{READ_RESPONSE_AUDIO}/{response_id}"
    audio_url = f"{url}?voiceId={voice_id}"
    referer = (
        f"https://grok.com/c/{conversation_id}?rid={response_id}"
        if conversation_id
        else f"https://grok.com/c/?rid={response_id}"
    )

    proxy = await get_proxy_runtime()
    lease = await proxy.acquire(scope=ProxyScope.APP, kind=RequestKind.HTTP)

    headers = build_http_headers(
        token,
        content_type=None,
        origin="https://grok.com",
        referer=referer,
        lease=lease,
    )
    headers["Accept"] = "*/*"
    headers["Sec-Fetch-Dest"] = "audio"
    headers["Sec-Fetch-Mode"] = "no-cors"
    headers["Sec-Fetch-Site"] = "same-origin"
    headers.pop("Content-Type", None)
    headers["Range"] = range_header or "bytes=0-"

    logger.info(
        "tts upstream request: response_id={} voice_id={} range={} has_conversation={} referer={} url={}",
        response_id,
        voice_id,
        headers.get("Range", "-"),
        bool(conversation_id),
        referer,
        audio_url,
    )

    kwargs = build_session_kwargs(lease=lease)
    session: ResettableSession | None = None

    try:
        for attempt in range(prepare_retries + 1):
            session = ResettableSession(**kwargs)
            response = await session.get(
                url,
                params={"voiceId": voice_id},
                headers=headers,
                timeout=timeout_s,
                stream=True,
                allow_redirects=True,
            )
            status = int(response.status_code)
            if status in (200, 206):
                break
            try:
                body = response.content.decode("utf-8", "replace")[:400]
            except Exception:
                body = ""
            raw_headers = getattr(response, "headers", {}) or {}
            header_excerpt = {
                str(key): str(value)
                for key, value in raw_headers.items()
                if str(key).lower() in {
                    "content-type",
                    "content-length",
                    "content-range",
                    "accept-ranges",
                    "cache-control",
                    "cf-ray",
                    "server",
                    "x-request-id",
                    "x-xai-request-id",
                }
            }
            is_empty_500 = (
                status == 500
                and not body
                and str(header_excerpt.get("content-length", "")).strip() in {"", "0"}
            )
            if is_empty_500 and attempt < prepare_retries:
                logger.warning(
                    "tts upstream not ready, retrying: response_id={} voice_id={} attempt={}/{} headers={}",
                    response_id, voice_id, attempt + 1, prepare_retries + 1, header_excerpt,
                )
                await session.close()
                session = None
                if prepare_delay_s > 0:
                    await asyncio.sleep(prepare_delay_s)
                continue

            logger.error(
                "tts fetch failed: response_id={} voice_id={} status={} headers={} body={}",
                response_id, voice_id, status, header_excerpt, body,
            )
            await session.close()
            session = None
            exc = UpstreamError(
                f"TTS upstream returned {status}",
                status=status,
                body=body,
            )
            await proxy.feedback(lease, upstream_feedback(exc))
            raise exc
    except UpstreamError:
        raise
    except Exception as exc:
        try:
            if session is not None:
                await session.close()
        except Exception:
            pass
        await proxy.feedback(lease, ProxyFeedback(kind=ProxyFeedbackKind.TRANSPORT_ERROR))
        raise UpstreamError(f"fetch_response_audio: transport error: {exc}") from exc

    forwarded: dict[str, str] = {}
    raw_headers = getattr(response, "headers", {}) or {}
    logger.info(
        "tts upstream success: response_id={} voice_id={} status={} content_type={} content_length={} content_range={}",
        response_id,
        voice_id,
        status,
        raw_headers.get("content-type") or raw_headers.get("Content-Type") or "-",
        raw_headers.get("content-length") or raw_headers.get("Content-Length") or "-",
        raw_headers.get("content-range") or raw_headers.get("Content-Range") or "-",
    )
    for key, value in raw_headers.items():
        if key.lower() in _FORWARDED_RESPONSE_HEADERS:
            forwarded[key] = str(value)

    await proxy.feedback(lease, ProxyFeedback(kind=ProxyFeedbackKind.SUCCESS, status_code=status))

    async def _chunks() -> AsyncGenerator[bytes, None]:
        try:
            async for chunk in response.aiter_content():
                if chunk:
                    yield chunk
        finally:
            try:
                await session.close()
            except Exception:
                pass

    return _chunks(), status, forwarded


__all__ = ["fetch_response_audio"]

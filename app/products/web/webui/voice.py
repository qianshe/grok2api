"""Voice token endpoint — LiveKit token acquisition."""

import asyncio

import aiohttp
from fastapi import APIRouter, Depends, Header, Path, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.platform.config.snapshot import get_config
from app.platform.errors import AppError, RateLimitError, UpstreamError
from app.platform.logging.logger import logger
from app.platform.runtime.clock import now_s
from app.platform.auth.middleware import verify_webui_key

router = APIRouter(tags=["WebUI - Voice"])
protected_router = APIRouter(
    prefix="/webui/api",
    dependencies=[Depends(verify_webui_key)],
    tags=["WebUI - Voice"],
)

LIVEKIT_PROXY_UPSTREAM = "wss://livekit.grok.com/rtc"
LIVEKIT_PROXY_HEADERS = {
    "Origin": "https://grok.com",
    "Referer": "https://grok.com/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/148.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}


class VoiceTokenResponse(BaseModel):
    token: str
    url: str
    participant_name: str = ""
    room_name: str = ""


class VoiceTokenRequest(BaseModel):
    voice: str = "ara"
    personality: str = "assistant"
    speed: float = 1.0
    instruction: str = ""


async def _issue_voice_token(
    *,
    voice: str,
    personality: str,
    speed: float,
    instruction: str,
) -> VoiceTokenResponse:
    from app.dataplane.account import _directory as _acct_dir
    if _acct_dir is None:
        raise RateLimitError("Account directory not initialised")

    # Voice/LiveKit is not represented by the chat AUTO quota. Free/basic
    # accounts have auto=0 by design but can still be eligible for Grok Voice,
    # so select any active account and let upstream decide voice capability.
    ts = now_s()
    acct = await _acct_dir.reserve_any(
        pool_candidates=(1, 0, 2),
        now_s_override=ts,
    )
    if acct is None:
        raise RateLimitError("No available tokens for voice mode")
    logger.info("voice account reserved via voice-capability path")

    token = acct.token
    try:
        from app.dataplane.reverse.transport.livekit import fetch_livekit_token
        data = await fetch_livekit_token(
            token,
            voice=voice,
            personality=personality,
            speed=speed,
            custom_instruction=instruction.strip(),
        )
        lk_token = data.get("token")
        if not lk_token:
            raise UpstreamError("Upstream returned no voice token")
        return VoiceTokenResponse(
            token=lk_token,
            url=str(data.get("livekitUrl") or "wss://livekit.grok.com"),
            participant_name=str(
                data.get("participantName")
                or data.get("participant_name")
                or data.get("identity")
                or ""
            ),
            room_name=str(
                data.get("roomName")
                or data.get("room_name")
                or data.get("room")
                or ""
            ),
        )
    except AppError:
        raise
    except Exception as e:
        raise UpstreamError(f"Voice token error: {e}")
    finally:
        await _acct_dir.release(acct)


@protected_router.get("/voice/token", response_model=VoiceTokenResponse)
async def voice_token_get(
    voice: str = "ara",
    personality: str = "assistant",
    speed: float = 1.0,
    instruction: str = "",
):
    """Acquire a LiveKit voice session token using the historical WebUI route."""
    return await _issue_voice_token(
        voice=voice,
        personality=personality,
        speed=speed,
        instruction=instruction,
    )


@protected_router.post("/voice/token", response_model=VoiceTokenResponse)
async def voice_token(request: VoiceTokenRequest):
    """Acquire a LiveKit voice session token."""
    return await _issue_voice_token(
        voice=request.voice,
        personality=request.personality,
        speed=request.speed,
        instruction=request.instruction,
    )


@protected_router.get("/voice/read/{response_id}")
async def read_response_audio(
    response_id: str = Path(..., description="Upstream Grok responseId (UUID)"),
    voice_id: str = Query("Ara", alias="voiceId"),
    conversation_id: str | None = Query(None, alias="conversationId"),
    range_header: str | None = Header(None, alias="range"),
):
    """Stream TTS audio for an existing Grok response.

    Looks up the SSO account that originated *response_id* via the persisted
    voice-session store and proxies grok.com's read-response-audio-file with
    that account's session cookie. If the mapping is missing/expired, or the
    mapped account returns the known empty upstream 5xx, it tries a bounded
    account-pool recovery and records the successful token again.
    """
    from app.dataplane.account import _directory as _acct_dir
    from app.dataplane.voice import lookup as _lookup_voice_session

    if _acct_dir is None:
        raise RateLimitError("Account directory not initialised")

    mapping = _lookup_voice_session(response_id)
    release_acct = None
    effective_conv = conversation_id or None

    def _is_empty_upstream_5xx(exc: AppError) -> bool:
        body_text = str(getattr(exc, "details", {}).get("body", "") or "")
        return getattr(exc, "status", 0) in {500, 502, 503, 504} and not body_text.strip()

    async def _acquire_fallback_account(excluded: list[str] | None = None):
        ts = now_s()
        acct = await _acct_dir.reserve_any(
            pool_candidates=(0, 1, 2),
            exclude_tokens=excluded or None,
            now_s_override=ts,
        )
        if acct is None:
            raise RateLimitError("No available tokens for TTS")
        return acct

    from app.dataplane.reverse.transport.tts import fetch_response_audio

    async def _try_recovery_accounts(
        excluded_tokens: list[str] | None,
        *,
        max_attempts: int,
        reason: str,
    ):
        from app.dataplane.voice import record as _record_voice_session

        excluded = list(excluded_tokens or [])
        last_exc: AppError | None = None
        for attempt in range(1, max_attempts + 1):
            acct = await _acquire_fallback_account(excluded)
            try:
                result = await fetch_response_audio(
                    acct.token,
                    response_id,
                    voice_id=voice_id,
                    range_header=range_header,
                    conversation_id=effective_conv,
                )
                try:
                    _record_voice_session(response_id, acct.token, conversation_id=effective_conv or "")
                except Exception as record_exc:
                    logger.warning("tts mapping recovery record failed: response_id={} error={}", response_id, record_exc)
                logger.info(
                    "tts mapping recovered: response_id={} voice_id={} reason={} attempt={}/{} has_conversation={}",
                    response_id,
                    voice_id,
                    reason,
                    attempt,
                    max_attempts,
                    bool(effective_conv),
                )
                return result, acct
            except AppError as exc:
                last_exc = exc
                await _acct_dir.release(acct)
                excluded.append(acct.token)
                if not _is_empty_upstream_5xx(exc) or attempt >= max_attempts:
                    raise
                logger.warning(
                    "tts mapping recovery retry: response_id={} voice_id={} reason={} attempt={}/{} status={}",
                    response_id,
                    voice_id,
                    reason,
                    attempt,
                    max_attempts,
                    getattr(exc, "status", 0),
                )
        if last_exc is not None:
            raise last_exc
        raise RateLimitError("No available tokens for TTS")

    if mapping is None:
        logger.warning(
            "tts voice session miss: response_id={} requested_conversation_id={}",
            response_id,
            conversation_id or "-",
        )
        max_attempts = max(1, int(get_config("voice.tts_mapping_recovery_attempts", 20) or 20))
        (stream, status, upstream_headers), release_acct = await _try_recovery_accounts(
            [],
            max_attempts=max_attempts,
            reason="mapping_miss",
        )
    else:
        token, mapped_conv_id = mapping
        effective_conv = conversation_id or mapped_conv_id or None
        logger.info(
            "tts voice session hit: response_id={} requested_conversation_id={} mapped_conversation_id={}",
            response_id,
            conversation_id or "-",
            mapped_conv_id or "-",
        )
        try:
            stream, status, upstream_headers = await fetch_response_audio(
                token,
                response_id,
                voice_id=voice_id,
                range_header=range_header,
                conversation_id=effective_conv,
            )
        except AppError as exc:
            fallback_enabled = get_config("voice.tts_account_fallback_on_upstream_error", True)
            if not (fallback_enabled and _is_empty_upstream_5xx(exc)):
                raise
            logger.warning(
                "tts voice session retrying with fallback account: response_id={} voice_id={} status={} requested_conversation_id={} mapped_conversation_id={}",
                response_id,
                voice_id,
                getattr(exc, "status", 0),
                conversation_id or "-",
                mapped_conv_id or "-",
            )
            max_attempts = max(1, int(get_config("voice.tts_mapping_recovery_attempts", 20) or 20))
            (stream, status, upstream_headers), release_acct = await _try_recovery_accounts(
                [token],
                max_attempts=max_attempts,
                reason="mapped_token_empty_5xx",
            )

    media_type = upstream_headers.get("Content-Type", "audio/mpeg")
    passthrough: dict[str, str] = {}
    for key in ("Content-Length", "Content-Range", "Accept-Ranges", "Cache-Control"):
        if key in upstream_headers:
            passthrough[key] = upstream_headers[key]

    async def _wrapper():
        try:
            async for chunk in stream:
                yield chunk
        finally:
            if release_acct is not None:
                await _acct_dir.release(release_acct)

    return StreamingResponse(
        _wrapper(),
        status_code=status,
        media_type=media_type,
        headers=passthrough,
    )


@router.websocket("/webui/api/voice/livekit/rtc")
async def livekit_signal_proxy(websocket: WebSocket):
    """Proxy LiveKit signaling through same-origin WebSocket.

    Browser-side direct ``wss://livekit.grok.com/rtc`` can be rejected before
    WebRTC negotiation on localhost/origin-sensitive environments. The proxy
    keeps the short-lived LiveKit access token in the query string and relays
    binary/text signaling frames with grok.com-like headers; media still flows
    through LiveKit's normal WebRTC ICE path.
    """
    raw_query = websocket.scope.get("query_string", b"").decode("utf-8", errors="ignore")
    upstream_url = LIVEKIT_PROXY_UPSTREAM + (f"?{raw_query}" if raw_query else "")
    await websocket.accept()

    timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=None)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.ws_connect(
                upstream_url,
                headers=LIVEKIT_PROXY_HEADERS,
                autoping=True,
                max_msg_size=0,
            ) as upstream:
                logger.info("livekit signal proxy connected")

                async def _browser_to_upstream():
                    try:
                        while True:
                            message = await websocket.receive()
                            message_type = message.get("type")
                            if message_type == "websocket.disconnect":
                                break
                            data_bytes = message.get("bytes")
                            data_text = message.get("text")
                            if data_bytes is not None:
                                await upstream.send_bytes(data_bytes)
                            elif data_text is not None:
                                await upstream.send_str(data_text)
                    except (WebSocketDisconnect, aiohttp.ClientConnectionResetError, ConnectionResetError):
                        pass
                    finally:
                        await upstream.close()

                async def _upstream_to_browser():
                    try:
                        async for message in upstream:
                            if message.type == aiohttp.WSMsgType.BINARY:
                                await websocket.send_bytes(message.data)
                            elif message.type == aiohttp.WSMsgType.TEXT:
                                await websocket.send_text(message.data)
                            elif message.type in {
                                aiohttp.WSMsgType.CLOSE,
                                aiohttp.WSMsgType.CLOSED,
                                aiohttp.WSMsgType.ERROR,
                            }:
                                break
                    except (WebSocketDisconnect, aiohttp.ClientConnectionResetError, RuntimeError, ConnectionResetError):
                        pass
                    try:
                        await websocket.close()
                    except Exception:
                        pass

                tasks = {
                    asyncio.create_task(_browser_to_upstream()),
                    asyncio.create_task(_upstream_to_browser()),
                }
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                for task in done:
                    try:
                        task.result()
                    except asyncio.CancelledError:
                        pass
                logger.info(
                    "livekit signal proxy closed: upstream_closed={} upstream_code={}",
                    upstream.closed,
                    getattr(upstream, "close_code", None),
                )
    except Exception as exc:
        status = getattr(exc, "status", None)
        logger.warning(
            "livekit signal proxy failed: error_type={} status={}",
            type(exc).__name__,
            status,
        )
        try:
            await websocket.close(code=1011)
        except Exception:
            pass


router.include_router(protected_router)

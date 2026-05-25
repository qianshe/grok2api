"""Voice token endpoint — LiveKit token acquisition."""

from fastapi import APIRouter, Depends, Header, Path, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.platform.errors import AppError, RateLimitError, UpstreamError
from app.platform.runtime.clock import now_s
from app.platform.auth.middleware import verify_webui_key

router = APIRouter(prefix="/webui/api", dependencies=[Depends(verify_webui_key)], tags=["WebUI - Voice"])


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


@router.post("/voice/token", response_model=VoiceTokenResponse)
async def voice_token(request: VoiceTokenRequest):
    """Acquire a LiveKit voice session token."""
    from app.dataplane.account import _directory as _acct_dir
    if _acct_dir is None:
        raise RateLimitError("Account directory not initialised")

    # Voice normally requires super/heavy, but we also try basic to surface
    # any upstream error explicitly instead of pre-rejecting locally.
    from app.control.model.enums import ModeId

    ts = now_s()
    acct = await _acct_dir.reserve(
        pool_candidates=(0, 1, 2),
        mode_id=int(ModeId.AUTO),
        now_s_override=ts,
    )
    if acct is None:
        raise RateLimitError("No available tokens for voice mode")

    token = acct.token
    try:
        from app.dataplane.reverse.transport.livekit import fetch_livekit_token
        data = await fetch_livekit_token(
            token,
            voice=request.voice,
            personality=request.personality,
            speed=request.speed,
            custom_instruction=request.instruction.strip(),
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


@router.get("/voice/read/{response_id}")
async def read_response_audio(
    response_id: str = Path(..., description="Upstream Grok responseId (UUID)"),
    voice_id: str = Query("Ara", alias="voiceId"),
    conversation_id: str | None = Query(None, alias="conversationId"),
    range_header: str | None = Header(None, alias="range"),
):
    """Stream TTS audio for an existing Grok response.

    Looks up the SSO account that originated *response_id* via the in-memory
    voice-session store and proxies grok.com's read-response-audio-file with
    that account's session cookie. Returns 404 if the mapping is missing or
    expired (TTL ~30 min by default).
    """
    from app.dataplane.account import _directory as _acct_dir
    from app.dataplane.voice import lookup as _lookup_voice_session

    if _acct_dir is None:
        raise RateLimitError("Account directory not initialised")

    mapping = _lookup_voice_session(response_id)
    if mapping is None:
        # Fall back to any-account so external callers can still try; if
        # upstream binds to the originating session this will 403, but the
        # error chain stays meaningful.
        ts = now_s()
        acct = await _acct_dir.reserve_any(
            pool_candidates=(0, 1, 2),
            now_s_override=ts,
        )
        if acct is None:
            raise RateLimitError("No available tokens for TTS")
        token = acct.token
        mapped_conv_id = ""
        release_acct = acct
    else:
        token, mapped_conv_id = mapping
        release_acct = None

    effective_conv = conversation_id or mapped_conv_id or None
    try:
        from app.dataplane.reverse.transport.tts import fetch_response_audio
        stream, status, upstream_headers = await fetch_response_audio(
            token,
            response_id,
            voice_id=voice_id,
            range_header=range_header,
            conversation_id=effective_conv,
        )
    except AppError:
        if release_acct is not None:
            await _acct_dir.release(release_acct)
        raise
    except Exception as exc:
        if release_acct is not None:
            await _acct_dir.release(release_acct)
        raise UpstreamError(f"TTS error: {exc}")

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

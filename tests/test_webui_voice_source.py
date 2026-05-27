import unittest
from pathlib import Path


VOICE_PY = Path(__file__).resolve().parents[1] / "app" / "products" / "web" / "webui" / "voice.py"


class WebuiVoiceSourceTests(unittest.TestCase):
    def test_chatkit_token_uses_historical_get_route_and_auto_voice_reservation(self):
        source = VOICE_PY.read_text(encoding="utf-8")

        self.assertIn('@protected_router.get("/voice/token"', source)
        self.assertIn('@protected_router.post("/voice/token"', source)
        self.assertIn("async def _issue_voice_token(", source)
        self.assertIn("Historical working ChatKit Voice path", source)
        self.assertIn("pool_candidates=(1, 0, 2)", source)
        self.assertIn("mode_id=int(ModeId.AUTO)", source)
        self.assertIn("acct = await _acct_dir.reserve_any(", source)
        self.assertIn("voice account reserved via no-quota fallback", source)
        self.assertNotIn("Voice WebRTC sessions are more capability-sensitive", source)

    def test_voice_input_audio_endpoint_does_not_use_paid_or_local_tts(self):
        source = VOICE_PY.read_text(encoding="utf-8")

        self.assertNotIn('@router.post("/voice/input-audio")', source)
        self.assertNotIn("https://api.x.ai/v1/tts", source)
        self.assertNotIn("voice.input_tts_xai_api_key", source)
        self.assertNotIn("XAI_API_KEY", source)
        self.assertNotIn("edge_tts", source)
        self.assertNotIn("input_tts_provider", source)

    def test_tts_read_recovers_missing_or_stale_voice_session_mapping(self):
        source = VOICE_PY.read_text(encoding="utf-8")

        self.assertIn("voice.tts_mapping_recovery_attempts", source)
        self.assertIn("voice.tts_account_fallback_on_upstream_error", source)
        self.assertIn("exclude_tokens=excluded or None", source)
        self.assertIn("reason=\"mapping_miss\"", source)
        self.assertIn("reason=\"mapped_token_empty_5xx\"", source)
        self.assertIn("_record_voice_session(response_id, acct.token", source)

    def test_livekit_signal_proxy_uses_same_origin_websocket_route(self):
        source = VOICE_PY.read_text(encoding="utf-8")

        self.assertIn('@router.websocket("/webui/api/voice/livekit/rtc")', source)
        self.assertIn('LIVEKIT_PROXY_UPSTREAM = "wss://livekit.grok.com/rtc"', source)
        self.assertIn('"Origin": "https://grok.com"', source)
        self.assertIn('session.ws_connect(', source)
        self.assertIn('websocket.receive()', source)
        self.assertIn('upstream.send_bytes', source)
        self.assertIn('websocket.send_bytes', source)
        self.assertIn('router.include_router(protected_router)', source)


if __name__ == "__main__":
    unittest.main()

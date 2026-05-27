import unittest
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAT_JS = ROOT / "app" / "statics" / "js" / "webui" / "chat.js"
CHAT_HTML = ROOT / "app" / "statics" / "webui" / "chat.html"
CHATKIT_JS = ROOT / "app" / "statics" / "js" / "webui" / "chatkit.js"


class WebuiChatJsTests(unittest.TestCase):
    def test_read_aloud_has_no_browser_speech_synthesis_fallback(self):
        source = CHAT_JS.read_text(encoding="utf-8")

        self.assertIn("/webui/api/voice/read/", source)
        self.assertNotIn("speechSynthesis", source)
        self.assertNotIn("SpeechSynthesisUtterance", source)

    def test_default_model_uses_official_free_app_chat_model(self):
        source = CHAT_JS.read_text(encoding="utf-8")

        self.assertIn("const PREFERRED_MODEL = 'grok-4.20-0309-non-reasoning';", source)

    def test_webui_chat_uses_original_chat_completions_endpoint(self):
        source = CHAT_JS.read_text(encoding="utf-8")

        self.assertIn("const CHAT_ENDPOINT = '/webui/api/chat/completions';", source)
        self.assertIn("messages: outgoing", source)
        self.assertNotIn("const CHAT_ENDPOINT = '/webui/api/responses';", source)

    def test_chat_payload_carries_webui_session_metadata(self):
        source = CHAT_JS.read_text(encoding="utf-8")

        self.assertIn('metadata: {', source)
        self.assertIn("webui_session_id: currentSessionId || ''", source)

    def test_stream_parser_captures_root_upstream_conversation_id(self):
        source = CHAT_JS.read_text(encoding="utf-8")

        self.assertIn("typeof json.upstream_conversation_id === 'string'", source)
        self.assertIn("assistantEntry.upstreamConversationId = json.upstream_conversation_id", source)

    def test_model_dropdown_marks_free_web_and_console_routes_without_tts_badge(self):
        source = CHAT_JS.read_text(encoding="utf-8")

        self.assertIn("function modelRouteBadge(item)", source)
        self.assertIn("Free Web", source)
        self.assertIn("Console", source)
        self.assertNotIn("· TTS", source)
        self.assertIn("modelRouteBadge(item)", source)

    def test_read_aloud_button_is_hidden_in_ordinary_chat_ui(self):
        source = CHAT_JS.read_text(encoding="utf-8")

        self.assertIn("const READ_ALOUD_ENABLED = false;", source)
        self.assertIn("const canReadAloud = READ_ALOUD_ENABLED && Boolean(String(entry.upstreamResponseId || '').trim())", source)
        self.assertIn("entry.speakBtn.hidden = !canReadAloud", source)
        self.assertIn("syncAssistantActions(assistantEntry)", source)
        self.assertIn("syncAssistantActions(entry)", source)

    def test_read_aloud_audio_is_cached_for_replay(self):
        source = CHAT_JS.read_text(encoding="utf-8")

        self.assertIn("const readAudioCache = new Map()", source)
        self.assertIn("getCachedReadAudioUrl(cacheKey)", source)
        self.assertIn("putCachedReadAudioUrl(cacheKey, audioUrl)", source)

    def test_read_aloud_uses_visible_audio_controls(self):
        source = CHAT_JS.read_text(encoding="utf-8")

        self.assertIn("audioPlayer.controls = true", source)
        self.assertIn("audio.hidden = false", source)
        self.assertIn("entry.audioPlayer = audioPlayer", source)

    def test_read_aloud_uses_grok_voice_preference_not_chat_bar_selector(self):
        source = CHAT_JS.read_text(encoding="utf-8")
        html = CHAT_HTML.read_text(encoding="utf-8")

        self.assertIn("const VOICE_PREF_KEY = 'grok2api_voice_id'", source)
        self.assertIn("function selectedReadVoiceId()", source)
        self.assertIn("const voiceId = selectedReadVoiceId()", source)
        self.assertNotIn('id="voiceSelect"', html)

    def test_chatkit_persists_voice_preference_for_chat_read_aloud(self):
        source = CHATKIT_JS.read_text(encoding="utf-8")

        self.assertIn("const VOICE_PREF_KEY = 'grok2api_voice_id'", source)
        self.assertIn("persistVoicePreference", source)
        self.assertIn("restoreVoicePreference", source)


if __name__ == "__main__":
    unittest.main()

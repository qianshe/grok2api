import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHAT_HTML = ROOT / "app" / "statics" / "webui" / "chat.html"
CHAT_JS = ROOT / "app" / "statics" / "js" / "webui" / "chat.js"
CHATKIT_JS = ROOT / "app" / "statics" / "js" / "webui" / "chatkit.js"
APP_CSS = ROOT / "app" / "statics" / "css" / "app.css"


class WebuiVoiceHistorySourceTests(unittest.TestCase):
    def test_chat_page_contains_voice_history_panel(self):
        html = CHAT_HTML.read_text(encoding="utf-8")

        self.assertIn('id="voiceHistorySection"', html)
        self.assertIn('id="voiceHistoryList"', html)
        self.assertIn('id="continueVoiceBtn"', html)
        self.assertIn('/webui/chatkit', html)

    def test_chat_js_reads_shared_voice_history_and_renders_continue_action(self):
        source = CHAT_JS.read_text(encoding="utf-8")

        self.assertIn("const VOICE_HISTORY_KEY = 'grok2api_voice_chat_history'", source)
        self.assertIn("const VOICE_RESUME_CONTEXT_KEY = 'grok2api_voice_resume_context'", source)
        self.assertIn("function loadVoiceHistory", source)
        self.assertIn("function renderVoiceHistory", source)
        self.assertIn("function renderVoiceHistoryThread", source)
        self.assertIn("function prepareVoiceResumeContext", source)
        self.assertIn("continueVoiceBtn", source)
        self.assertIn("window.location.href = '/webui/chatkit'", source)
        self.assertIn("VOICE_HISTORY_LIMIT", source)

    def test_chatkit_instruction_and_history_ui_are_scrollable(self):
        css = APP_CSS.read_text(encoding="utf-8")

        self.assertIn(".webui-chatkit-instruction-input", css)
        self.assertIn("overflow-y:auto", css)
        self.assertIn(".webui-voice-history-list", css)
        self.assertIn(".webui-voice-history-item", css)

    def test_chatkit_and_chat_share_voice_history_key(self):
        chat_source = CHAT_JS.read_text(encoding="utf-8")
        chatkit_source = CHATKIT_JS.read_text(encoding="utf-8")

        self.assertIn("const VOICE_HISTORY_KEY = 'grok2api_voice_chat_history'", chat_source)
        self.assertIn("const VOICE_HISTORY_KEY = 'grok2api_voice_chat_history'", chatkit_source)
        self.assertIn("const VOICE_RESUME_CONTEXT_KEY = 'grok2api_voice_resume_context'", chat_source)
        self.assertIn("const VOICE_RESUME_CONTEXT_KEY = 'grok2api_voice_resume_context'", chatkit_source)
        self.assertIn("selectedSessionInstruction", chatkit_source)
        self.assertIn("consumeVoiceResumeContext", chatkit_source)


if __name__ == "__main__":
    unittest.main()

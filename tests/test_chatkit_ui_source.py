import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHATKIT_HTML = ROOT / "app" / "statics" / "webui" / "chatkit.html"
CHATKIT_JS = ROOT / "app" / "statics" / "js" / "webui" / "chatkit.js"


class ChatkitUiSourceTests(unittest.TestCase):
    def test_chatkit_page_has_message_thread_and_text_composer(self):
        html = CHATKIT_HTML.read_text(encoding="utf-8")

        self.assertIn('id="chatkitThread"', html)
        self.assertIn('id="chatkitPromptInput"', html)
        self.assertIn('id="chatkitSendBtn"', html)
        self.assertNotIn('id="rolePresetSelect"', html)
        self.assertIn('value="custom_new"', html)
        self.assertIn('id="instructionPill"', html)
        self.assertIn('id="customPersonalityNameInput"', html)
        self.assertIn('<textarea id="instructionInput"', html)
        self.assertIn('id="saveCustomPersonalityBtn"', html)
        self.assertIn('id="deleteCustomPersonalityBtn"', html)
        self.assertIn('value="Ara" selected>Ara</option>', html)
        self.assertIn('value="Grok">Rex</option>', html)
        self.assertIn('value="xai_sal">Sal</option>', html)
        self.assertIn('助手 Assistant', html)
        self.assertIn('治疗师 &quot;Therapist&quot;', html)
        self.assertIn('value="kids-trivia">儿童问答 Kids Trivia Game</option>', html)
        self.assertIn('放飞 Unhinged · 18+', html)
        self.assertIn('浪漫 Romantic · 18+', html)

    def test_chatkit_custom_personality_uses_persisted_instruction_entries(self):
        source = CHATKIT_JS.read_text(encoding="utf-8")

        self.assertIn("const CUSTOM_PERSONALITIES_KEY = 'grok2api_voice_custom_personalities'", source)
        self.assertIn("const VOICE_HISTORY_KEY = 'grok2api_voice_chat_history'", source)
        self.assertIn("const CUSTOM_NEW_VALUE = 'custom_new'", source)
        self.assertIn("const CUSTOM_PERSONALITY_PREFIX = 'custom:'", source)
        self.assertIn("loadCustomPersonalities", source)
        self.assertIn("loadChatkitMessages", source)
        self.assertIn("persistChatkitMessages", source)
        self.assertIn("saveSelectedCustomPersonality", source)
        self.assertIn("deleteSelectedCustomPersonality", source)
        self.assertIn("personality: selectedPersonality(),", source)
        self.assertIn("instruction: selectedCustomInstruction(),", source)
        self.assertIn("renderInstructionVisibility", source)
        self.assertIn("controlIcon.endSession", source)
        self.assertNotIn("ROLE_PRESETS", source)
        self.assertNotIn("ROLE_PRESET_PREF_KEY", source)
        self.assertNotIn("applyRolePreset", source)

    def test_chatkit_js_uses_official_realtime_voice_events_for_text_and_filters_noise(self):
        source = CHATKIT_JS.read_text(encoding="utf-8")

        self.assertIn("RoomEvent.TranscriptionReceived", source)
        self.assertIn("RoomEvent.DataReceived", source)
        self.assertIn("ParticipantEvent.TranscriptionReceived", source)
        self.assertIn("RoomEvent.ParticipantConnected", source)
        self.assertNotIn("LIVEKIT_PROXY_ENDPOINT", source)
        self.assertNotIn("livekitProxyUrl()", source)
        self.assertIn("const params = new URLSearchParams({", source)
        self.assertIn("fetch(`${VOICE_ENDPOINT}?${params.toString()}`", source)
        self.assertIn("currentRoom.connect(payload.url, payload.token);", source)
        self.assertIn("Microphone publish queued before connect", source)
        self.assertLess(
            source.index("currentRoom.localParticipant.setMicrophoneEnabled(true)"),
            source.index("currentRoom.connect(payload.url, payload.token);"),
        )
        self.assertNotIn("currentRoom.connect(payload.url, payload.token, {", source)
        self.assertNotIn("wss://livekit.grok.com", source)
        self.assertNotIn("INPUT_AUDIO_ENDPOINT", source)
        self.assertNotIn("publishSynthesizedInputTrack", source)
        self.assertIn("const payload = new TextEncoder().encode(content)", source)
        self.assertIn("participant.publishData(payload, options)", source)
        self.assertIn("topic: 'grok.chat'", source)
        self.assertIn("reliable: true", source)
        self.assertIn("Grok Voice text publish retry", source)
        self.assertNotIn("topic: 'grok.ping'", source)
        self.assertIn("destinationIdentities: remoteParticipantIdentities()", source)
        self.assertIn("participant.sendText(content, {", source)
        self.assertIn("topic: 'lk.chat'", source)
        self.assertIn("waitForRemoteParticipant", source)
        self.assertIn("webui.chatkit.agentNotReady", source)
        self.assertNotIn("preflightLiveKitUrl", source)
        self.assertNotIn("currentRoom.prepareConnection(payload.url, payload.token)", source)
        self.assertNotIn("peerConnectionTimeout: 30000", source)
        self.assertNotIn("maxRetries: 2", source)
        self.assertNotIn("connectRoomWithRetry", source)
        self.assertNotIn("Grok Voice pc connection retry", source)
        self.assertIn("conversation.created", source)
        self.assertNotIn("adaptiveStream: true", source)
        self.assertNotIn("dynacast: true", source)
        self.assertNotIn("registerTextStreamHandler", source)
        self.assertNotIn("'lk.transcription'", source)
        self.assertIn("webui.chatkit.noTextResponse", source)
        self.assertIn("normalizeComparableText", source)
        self.assertIn("findDuplicateMessage", source)
        self.assertNotIn("publishTrack(track", source)
        self.assertNotIn("createMediaStreamDestination", source)
        self.assertIn("sendText", source)
        self.assertIn("sendChatMessage", source)
        self.assertNotIn("realtime_client_events", source)
        self.assertNotIn("publishRealtimeClientEvent", source)
        self.assertNotIn("publishResponseCreateVariants", source)
        self.assertNotIn("source: 'grok2api_chatkit_text'", source)
        self.assertIn("response.human_assist_turn.commit", source)
        self.assertIn("response.audio_transcript.delta", source)
        self.assertIn("response.output_text.delta", source)
        self.assertIn("conversation.item.input_audio_transcription.completed", source)
        self.assertIn("input_audio_buffer.speech_started", source)
        self.assertIn("type === 'ping'", source)
        self.assertNotIn("fallbackSendChatMessage", source)


if __name__ == "__main__":
    unittest.main()

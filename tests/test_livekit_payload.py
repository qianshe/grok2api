import json
import unittest

from app.dataplane.reverse.protocol.xai_livekit import build_token_request_payload


class LivekitPayloadTests(unittest.TestCase):
    def test_token_payload_matches_browser_voice_shape(self):
        payload = json.loads(build_token_request_payload(voice="ara", personality="assistant", speed=1.0).decode("utf-8"))
        session_payload = json.loads(payload["sessionPayload"])

        self.assertEqual(session_payload["voice"], "ara")
        self.assertEqual(session_payload["personality"], "assistant")
        self.assertEqual(session_payload["playback_speed"], 1.0)
        self.assertFalse(session_payload["enable_vision"])
        self.assertEqual(session_payload["turn_detection"], {"type": "server_vad"})
        self.assertFalse(payload["requestAgentDispatch"])
        self.assertEqual(payload["livekitUrl"], "wss://livekit.grok.com")
        self.assertEqual(payload["params"], {"enable_markdown_transcript": "true"})

    def test_custom_instruction_uses_raw_instructions_without_personality(self):
        payload = json.loads(build_token_request_payload(
            voice="Eve",
            personality="assistant",
            speed=1.25,
            custom_instruction="Be concise",
        ).decode("utf-8"))
        session_payload = json.loads(payload["sessionPayload"])

        self.assertEqual(session_payload["voice"], "Eve")
        self.assertIsNone(session_payload["personality"])
        self.assertEqual(session_payload["instructions"], "Be concise")
        self.assertTrue(session_payload["is_raw_instructions"])


if __name__ == "__main__":
    unittest.main()

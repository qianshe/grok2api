import unittest

from app.control.model.enums import ModeId
from app.dataplane.reverse.protocol.xai_chat import build_followup_chat_payload
from app.dataplane.reverse.runtime.chat_session import lookup, record


class AppChatReuseTests(unittest.TestCase):
    def test_followup_payload_carries_parent_response_id(self):
        payload = build_followup_chat_payload(
            message="hello again",
            mode_id=ModeId.AUTO,
            parent_response_id="resp-123",
        )

        self.assertEqual(payload["message"], "hello again")
        self.assertEqual(payload["modeId"], ModeId.AUTO.to_api_str())
        self.assertEqual(payload["parentResponseId"], "resp-123")

    def test_session_store_records_last_conversation_and_response(self):
        record(
            "session-a",
            token="token-a",
            model="grok-test",
            mode_id=0,
            conversation_id="conv-1",
            parent_response_id="resp-1",
            ttl_s=60,
        )

        entry = lookup("session-a")

        self.assertIsNotNone(entry)
        self.assertEqual(entry.token, "token-a")
        self.assertEqual(entry.model, "grok-test")
        self.assertEqual(entry.mode_id, 0)
        self.assertEqual(entry.conversation_id, "conv-1")
        self.assertEqual(entry.parent_response_id, "resp-1")
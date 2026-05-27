import unittest

import orjson

from app.dataplane.reverse.protocol.xai_chat import StreamAdapter


class StreamAdapterIdTests(unittest.TestCase):
    def test_captures_flat_followup_stream_ids_and_tokens(self):
        adapter = StreamAdapter(conversation_id="conversation-1")
        payload = {
            "result": {
                "token": "hi",
                "isThinking": False,
                "isSoftStop": False,
                "messageTag": "final",
                "responseId": "response-1",
            }
        }

        events = adapter.feed(orjson.dumps(payload).decode())

        self.assertEqual(adapter.upstream_response_id, "response-1")
        self.assertEqual(adapter.upstream_conversation_id, "conversation-1")
        self.assertEqual([event.content for event in events if event.kind == "text"], ["hi"])

    def test_captures_model_response_id_from_final_metadata_frame(self):
        adapter = StreamAdapter(conversation_id="conversation-1")
        payload = {
            "result": {
                "modelResponse": {"responseId": "response-2"},
                "isThinking": False,
                "isSoftStop": False,
                "responseId": "response-2",
            }
        }

        adapter.feed(orjson.dumps(payload).decode())

        self.assertEqual(adapter.upstream_response_id, "response-2")
        self.assertEqual(adapter.upstream_conversation_id, "conversation-1")

    def test_ignores_user_response_id_and_keeps_assistant_response_id_for_tts(self):
        adapter = StreamAdapter(conversation_id="conversation-1")

        adapter.feed(orjson.dumps({
            "result": {
                "userResponse": {"responseId": "user-response-id"},
                "responseId": "user-response-id",
                "isThinking": False,
                "isSoftStop": False,
            }
        }).decode())
        adapter.feed(orjson.dumps({
            "result": {
                "token": "hello",
                "messageTag": "final",
                "responseId": "assistant-response-id",
                "isThinking": False,
                "isSoftStop": False,
            }
        }).decode())

        self.assertEqual(adapter.upstream_response_id, "assistant-response-id")


    def test_final_assistant_frame_overrides_early_assistant_placeholder_id(self):
        adapter = StreamAdapter(conversation_id="conversation-1")

        adapter.feed(orjson.dumps({
            "result": {
                "uiLayout": {"reasoningUiLayout": "UNIFIED"},
                "responseId": "early-assistant-id",
                "isThinking": False,
                "isSoftStop": False,
            }
        }).decode())
        adapter.feed(orjson.dumps({
            "result": {
                "token": "done",
                "messageTag": "final",
                "responseId": "final-assistant-id",
                "isThinking": False,
                "isSoftStop": False,
            }
        }).decode())

        self.assertEqual(adapter.upstream_response_id, "final-assistant-id")



if __name__ == "__main__":
    unittest.main()

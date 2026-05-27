import unittest

import orjson

from app.dataplane.reverse.protocol.xai_console import (
    ConsoleStreamAdapter,
    extract_console_response_id,
)


class ConsoleResponseIdTests(unittest.TestCase):
    def test_extracts_non_streaming_console_response_id(self):
        body = {
            "id": "resp_console_root",
            "output": [
                {"type": "message", "id": "msg_console", "content": [{"type": "output_text", "text": "hi"}]}
            ],
        }

        self.assertEqual(extract_console_response_id(body), "resp_console_root")

    def test_stream_adapter_captures_created_response_id(self):
        adapter = ConsoleStreamAdapter()
        adapter.feed_event("response.created")
        ev = adapter.feed_data(orjson.dumps({
            "type": "response.created",
            "response": {"id": "resp_console_stream"},
        }).decode())

        self.assertEqual(ev["kind"], "skip")
        self.assertEqual(adapter.upstream_response_id, "resp_console_stream")


if __name__ == "__main__":
    unittest.main()

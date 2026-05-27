import importlib
import importlib
import os
import tempfile
import unittest


class VoiceSessionStoreTests(unittest.TestCase):
    def test_recorded_voice_session_survives_module_reload(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_data_dir = os.environ.get("DATA_DIR")
            os.environ["DATA_DIR"] = tmp
            try:
                import app.dataplane.voice as voice
                voice = importlib.reload(voice)

                self.assertGreaterEqual(voice._DEFAULT_TTL_S, 7 * 24 * 60 * 60)
                voice.record("response-1", "token-1", conversation_id="conversation-1", ttl_s=60)
                self.assertEqual(voice.lookup("response-1"), ("token-1", "conversation-1"))

                voice = importlib.reload(voice)
                self.assertEqual(voice.lookup("response-1"), ("token-1", "conversation-1"))
            finally:
                if old_data_dir is None:
                    os.environ.pop("DATA_DIR", None)
                else:
                    os.environ["DATA_DIR"] = old_data_dir


if __name__ == "__main__":
    unittest.main()

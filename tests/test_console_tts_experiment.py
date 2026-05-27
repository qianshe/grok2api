import unittest
from pathlib import Path

CHAT_PY = Path(__file__).resolve().parents[1] / "app" / "products" / "openai" / "chat.py"


class ConsoleTtsExperimentSourceTests(unittest.TestCase):
    def test_console_tts_mixing_is_not_exposed_to_webui(self):
        source = CHAT_PY.read_text(encoding="utf-8")

        self.assertNotIn("console_upstream_response_id", source)
        self.assertNotIn("tts_experiment=enabled", source)
        self.assertNotIn("console upstream response id captured", source)


if __name__ == "__main__":
    unittest.main()

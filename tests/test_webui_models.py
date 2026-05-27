import unittest

from app.control.model import registry as model_registry
from app.products.web.webui.chat import (
    _model_badge,
    _model_route,
    _is_free_web_model,
    _supports_official_tts,
)


class WebuiModelMetadataTests(unittest.TestCase):
    def test_marks_official_basic_web_models_separately_from_console_models(self):
        free_web = model_registry.resolve("grok-4.20-0309-non-reasoning")
        console = model_registry.resolve("grok-4.20-non-reasoning")

        self.assertEqual(_model_route(free_web), "web")
        self.assertTrue(_is_free_web_model(free_web))
        self.assertTrue(_supports_official_tts(free_web))
        self.assertEqual(_model_badge(free_web), "Free Web")

        self.assertEqual(_model_route(console), "console")
        self.assertFalse(_is_free_web_model(console))
        self.assertFalse(_supports_official_tts(console))
        self.assertEqual(_model_badge(console), "Console")


if __name__ == "__main__":
    unittest.main()

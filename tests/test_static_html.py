import tempfile
import time
import unittest
from pathlib import Path

from app.products.web import static_html


class StaticHtmlVersionTests(unittest.TestCase):
    def test_app_version_token_changes_when_static_asset_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "statics"
            page_dir = root / "webui"
            js_dir = root / "js" / "webui"
            page_dir.mkdir(parents=True)
            js_dir.mkdir(parents=True)
            page = page_dir / "chat.html"
            js = js_dir / "chat.js"
            page.write_text('<script src="/static/js/webui/chat.js?v={{APP_VERSION}}"></script>', encoding="utf-8")
            js.write_text("first", encoding="utf-8")

            old_get_project_version = static_html.get_project_version
            try:
                static_html.get_project_version = lambda: "test-version"
                first = static_html.serve_static_html(page).body.decode("utf-8")
                time.sleep(0.01)
                js.write_text("second", encoding="utf-8")
                second = static_html.serve_static_html(page).body.decode("utf-8")
            finally:
                static_html.get_project_version = old_get_project_version

            self.assertIn("v=test-version.", first)
            self.assertIn("v=test-version.", second)
            self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()

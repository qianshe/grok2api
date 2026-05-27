import unittest

from app.platform.errors import UpstreamError
from app.products.openai.chat import _should_retry_upstream


class ChatRetryPolicyTests(unittest.TestCase):
    def test_retries_curl_tls_transport_502_even_when_502_not_configured(self):
        exc = UpstreamError(
            "Chat transport failed: Failed to perform, curl: (35) TLS connect error",
            status=502,
            body="Failed to perform, curl: (35) TLS connect error",
        )

        self.assertTrue(_should_retry_upstream(exc, frozenset({429, 401, 503})))

    def test_does_not_retry_generic_502_when_502_not_configured(self):
        exc = UpstreamError("Bad gateway", status=502, body="upstream exploded")

        self.assertFalse(_should_retry_upstream(exc, frozenset({429, 401, 503})))


if __name__ == "__main__":
    unittest.main()

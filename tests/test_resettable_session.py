import unittest
from unittest.mock import patch

from curl_cffi.const import CurlECode
from curl_cffi.curl import CurlError

from app.dataplane.proxy.adapters.session import ResettableSession
from app.platform.errors import UpstreamError


class _FakeResponse:
    def __init__(self, status_code: int = 200):
        self.status_code = status_code


class _FakeSession:
    def __init__(self, *, exc: Exception | None = None, response: _FakeResponse | None = None):
        self._exc = exc
        self._response = response or _FakeResponse()
        self.closed = False
        self.calls = 0

    async def get(self, *args, **kwargs):
        self.calls += 1
        if self._exc is not None:
            raise self._exc
        return self._response

    async def close(self):
        self.closed = True


class ResettableSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_once_after_tls_handshake_failure(self):
        first = _FakeSession(exc=RuntimeError("TLS handshake failed"))
        second = _FakeSession(response=_FakeResponse(200))

        with patch.object(ResettableSession, "_create", side_effect=[first, second]):
            session = ResettableSession()
            response = await session.get("https://example.com")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(first.closed)
        self.assertEqual(first.calls, 1)
        self.assertEqual(second.calls, 1)

    async def test_retries_once_after_curl_ssl_connect_error_code(self):
        first = _FakeSession(exc=CurlError("transient curl failure", CurlECode.SSL_CONNECT_ERROR))
        second = _FakeSession(response=_FakeResponse(200))

        with patch.object(ResettableSession, "_create", side_effect=[first, second]):
            session = ResettableSession()
            response = await session.get("https://example.com")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(first.closed)
        self.assertEqual(first.calls, 1)
        self.assertEqual(second.calls, 1)

    async def test_retries_once_after_curl_recv_error_code(self):
        first = _FakeSession(exc=CurlError("transient curl failure", CurlECode.RECV_ERROR))
        second = _FakeSession(response=_FakeResponse(200))

        with patch.object(ResettableSession, "_create", side_effect=[first, second]):
            session = ResettableSession()
            response = await session.get("https://example.com")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(first.closed)
        self.assertEqual(first.calls, 1)
        self.assertEqual(second.calls, 1)

    async def test_does_not_retry_non_tls_transport_errors(self):
        first = _FakeSession(exc=RuntimeError("connection pool exhausted"))

        with patch.object(ResettableSession, "_create", return_value=first):
            session = ResettableSession()
            with self.assertRaises(UpstreamError) as ctx:
                await session.get("https://example.com")

        self.assertEqual(getattr(ctx.exception, "status", None), 502)
        self.assertFalse(first.closed)
        self.assertEqual(first.calls, 1)
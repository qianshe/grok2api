import unittest

from app.dataplane.reverse.transport import tts


class _Lease:
    pass


class _Proxy:
    async def acquire(self, **kwargs):
        return _Lease()

    async def feedback(self, *args, **kwargs):
        return None


class _Response:
    status_code = 200
    headers = {"content-type": "audio/mpeg"}

    async def aiter_content(self):
        yield b"audio"


class _Session:
    last_headers = None

    def __init__(self, **kwargs):
        pass

    async def get(self, *args, **kwargs):
        _Session.last_headers = kwargs.get("headers") or {}
        return _Response()

    async def close(self):
        return None




class _PreparingResponse:
    status_code = 500
    headers = {"content-length": "0", "server": "cloudflare"}
    content = b""


class _RetrySession:
    calls = 0

    def __init__(self, **kwargs):
        pass

    async def get(self, *args, **kwargs):
        _RetrySession.calls += 1
        _Session.last_headers = kwargs.get("headers") or {}
        if _RetrySession.calls == 1:
            return _PreparingResponse()
        return _Response()

    async def close(self):
        return None


class TtsTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_response_audio_defaults_range_header(self):
        old_proxy = tts.get_proxy_runtime
        old_session = tts.ResettableSession
        old_kwargs = tts.build_session_kwargs
        old_headers = tts.build_http_headers
        try:
            async def _get_proxy_runtime():
                return _Proxy()
            tts.get_proxy_runtime = _get_proxy_runtime
            tts.ResettableSession = _Session
            tts.build_session_kwargs = lambda lease=None: {}
            tts.build_http_headers = lambda *args, **kwargs: {"Cookie": "sso=token"}

            stream, status, headers = await tts.fetch_response_audio("token", "rid", voice_id="Ara")
            self.assertEqual(status, 200)
            self.assertEqual(_Session.last_headers.get("Range"), "bytes=0-")
            self.assertEqual(headers.get("content-type"), "audio/mpeg")
            self.assertEqual([chunk async for chunk in stream], [b"audio"])
        finally:
            tts.get_proxy_runtime = old_proxy
            tts.ResettableSession = old_session
            tts.build_session_kwargs = old_kwargs
            tts.build_http_headers = old_headers

    async def test_fetch_response_audio_retries_empty_500_preparing_response(self):
        old_proxy = tts.get_proxy_runtime
        old_session = tts.ResettableSession
        old_kwargs = tts.build_session_kwargs
        old_headers = tts.build_http_headers
        old_sleep = tts.asyncio.sleep
        try:
            async def _get_proxy_runtime():
                return _Proxy()
            async def _sleep(_delay):
                return None
            _RetrySession.calls = 0
            tts.get_proxy_runtime = _get_proxy_runtime
            tts.ResettableSession = _RetrySession
            tts.build_session_kwargs = lambda lease=None: {}
            tts.build_http_headers = lambda *args, **kwargs: {"Cookie": "sso=token"}
            tts.asyncio.sleep = _sleep

            stream, status, headers = await tts.fetch_response_audio("token", "rid", voice_id="Ara")

            self.assertEqual(status, 200)
            self.assertEqual(_RetrySession.calls, 2)
            self.assertEqual(headers.get("content-type"), "audio/mpeg")
            self.assertEqual([chunk async for chunk in stream], [b"audio"])
        finally:
            tts.get_proxy_runtime = old_proxy
            tts.ResettableSession = old_session
            tts.build_session_kwargs = old_kwargs
            tts.build_http_headers = old_headers
            tts.asyncio.sleep = old_sleep


if __name__ == "__main__":
    unittest.main()

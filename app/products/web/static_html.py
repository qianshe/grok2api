"""Helpers for serving static HTML with lightweight version injection."""

from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import HTMLResponse

from app.platform.meta import get_project_version


_VERSION_TOKEN = "{{APP_VERSION}}"


def _statics_root_for(path: Path) -> Path:
    for parent in (path.parent, *path.parents):
        if parent.name == "statics":
            return parent
    return path.parent


def _asset_version_for(path: Path) -> str:
    root = _statics_root_for(path)
    latest_mtime_ns = path.stat().st_mtime_ns
    try:
        for item in root.rglob("*"):
            if item.is_file():
                latest_mtime_ns = max(latest_mtime_ns, item.stat().st_mtime_ns)
    except OSError:
        pass
    return f"{get_project_version()}.{latest_mtime_ns:x}"


def serve_static_html(path: Path) -> HTMLResponse:
    """Serve an HTML file, replacing the version token if present."""
    if not path.exists():
        raise HTTPException(status_code=404, detail="Page not found")

    body = path.read_text(encoding="utf-8")
    if _VERSION_TOKEN in body:
        body = body.replace(_VERSION_TOKEN, _asset_version_for(path))

    return HTMLResponse(body, headers={"Cache-Control": "no-store"})


__all__ = ["serve_static_html"]

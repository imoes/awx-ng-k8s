"""Shared HTTP client for AWX REST API calls that require business logic."""
import os
import httpx


def awx_http() -> httpx.Client:
    """Return a configured httpx client for internal AWX API calls."""
    user = os.environ.get("AWX_ADMIN_USER", "admin")
    pw = os.environ.get("AWX_ADMIN_PASSWORD", "")
    return httpx.Client(
        base_url="http://localhost/api/v2/",
        auth=(user, pw),
        headers={"Content-Type": "application/json"},
        timeout=60.0,
        follow_redirects=True,
    )

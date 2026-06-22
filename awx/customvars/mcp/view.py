import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

log = logging.getLogger("awx.customvars.mcp")

_server = None


def _get_server():
    global _server
    if _server is None:
        from awx.customvars.mcp.server import mcp
        _server = mcp
    return _server


def _resolve_mcp_user(request):
    """Resolve authenticated user from Bearer token or existing session.

    Priority:
    1. Authorization: Bearer <token>  — looks up OAuth2AccessToken in DB
    2. Existing session / request.user (set by Django auth middleware)
    """
    auth_header = request.META.get('HTTP_AUTHORIZATION', '')
    if auth_header.startswith('Bearer '):
        token_str = auth_header[7:].strip()
        try:
            from awx.main.models.oauth import OAuth2AccessToken
            from django.utils import timezone
            tok = OAuth2AccessToken.objects.select_related('user').get(token=token_str)
            if tok.expires and tok.expires < timezone.now():
                return None
            return tok.user
        except Exception:
            return None
    # Fall back to Django session user (browser / already-authenticated requests)
    user = getattr(request, 'user', None)
    if user and user.is_authenticated:
        return user
    return None


@csrf_exempt
def mcp_view(request):
    # GET: health-check endpoint — unauthenticated, returns server info
    if request.method == "GET":
        return JsonResponse({"server": "AWX NextGen MCP", "transport": "HTTP JSON-RPC"})

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

    # Authenticate every POST request
    user = _resolve_mcp_user(request)
    if user is None:
        return JsonResponse(
            {
                "jsonrpc": "2.0",
                "id": None,
                "error": {
                    "code": -32001,
                    "message": "Unauthorized — provide Authorization: Bearer <token>",
                },
            },
            status=401,
        )
    # Make the resolved user available on the request object for downstream checks
    request.user = user

    try:
        body = json.loads(request.body)
    except Exception:
        return JsonResponse(
            {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}},
            status=400,
        )

    try:
        result = _get_server().handle(body)
    except Exception as exc:
        log.exception("MCP dispatch failed")
        return JsonResponse(
            {"jsonrpc": "2.0", "id": body.get("id"), "error": {"code": -32603, "message": str(exc)}},
            status=500,
        )

    return JsonResponse(result)

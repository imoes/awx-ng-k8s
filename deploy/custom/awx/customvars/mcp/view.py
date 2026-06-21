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


@csrf_exempt
def mcp_view(request):
    if request.method == "GET":
        return JsonResponse({"server": "AWX NextGen MCP", "transport": "HTTP JSON-RPC"})

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)

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

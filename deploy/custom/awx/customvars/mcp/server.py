"""
MCP server for AWX NextGen — zero external dependencies.
Implements the MCP JSON-RPC protocol (stateless HTTP transport) natively.
"""
import inspect
import json
import logging

log = logging.getLogger("awx.customvars.mcp")

PROTOCOL_VERSION = "2024-11-05"

INSTRUCTIONS = """
AWX NextGen (AWX-ng) is an AWX 24.6.1 fork with Foreman-style role variable management.

DATA MODEL:
- Organization → Inventories, Projects, Job Templates, Credentials
- Inventory → Hosts, Groups
- Project → Roles → RoleVariable (defaults), RoleTag, RoleHandler
- Job Template → links Inventory + Project + Playbook + Credentials + Location (optional)
- Jobs = execution instances of a Job Template

AWX-NG EXTENSIONS (beyond standard AWX):
- Hosts and Groups support per-object role variable overrides (Foreman-style precedence)
  GET  /api/v2/hosts/{id}/role_variables/         → all vars with default + host override
  PATCH /api/v2/hosts/{id}/role_variables/{var}/  → set a host-level override
  GET  /api/v2/groups/{id}/role_variables/        → group-level overrides
- GET /api/v2/hosts/{id}/aggregated_variables/    → full precedence stack (defaults < group < host)
- Locations (sites) for location-based runner routing
  GET /api/v2/locations/                          → list all sites
  Locations are linked to AWX InstanceGroups (runner pools)
- Execution Nodes can be assigned to Locations
  POST /api/v2/runners/register/                  → register an execution node
  POST /api/v2/execution_node_locations/          → assign node to location
- Project file editor with auto role-scan (watchdog monitors changes)
  GET/PUT /api/v2/projects/{id}/files/content/?path=...  → read/write files
  POST    /api/v2/projects/{id}/files/rename/             → rename files
- POST /api/v2/job_templates/{id}/generate_survey/        → generate survey from role variables
- POST /api/v2/hosts/{id}/clone/                          → clone a host (AWX-ng only)

AUTH: Basic Auth with admin credentials (env: AWX_ADMIN_USER / AWX_ADMIN_PASSWORD).
Internal reads use Django ORM directly — no HTTP overhead.

TYPICAL WORKFLOWS:
1. Add host:     awx_create_host → awx_assign_host_roles → awx_set_host_variable
2. Run job:      awx_launch_job_template → awx_get_job_status (poll until finished)
3. Explore roles: awx_get_project_roles → awx_get_role_variables
4. Check config: awx_get_aggregated_variables(host_id=X)
5. Add runner:   awx_register_execution_node → awx_assign_node_to_location

VARIABLE PRECEDENCE: role defaults < group overrides < host overrides
STATUS VALUES for jobs: pending, waiting, running, successful, failed, error, canceled
"""


class MCPServer:
    """Minimal MCP server — registers tools and handles JSON-RPC dispatch."""

    def __init__(self, name: str, instructions: str = ""):
        self.name = name
        self.instructions = instructions
        self._tools: dict = {}

    # ── Tool registration ────────────────────────────────────────────────────

    def tool(self):
        """Decorator factory: @mcp.tool() registers the function as an MCP tool."""
        def decorator(func):
            self._tools[func.__name__] = func
            return func
        return decorator

    # ── Schema generation ────────────────────────────────────────────────────

    def _annotation_schema(self, annotation) -> dict:
        if annotation == int:
            return {"type": "integer"}
        if annotation == bool:
            return {"type": "boolean"}
        if annotation == float:
            return {"type": "number"}
        if annotation == list:
            return {"type": "array", "items": {"type": "string"}}
        if annotation == dict:
            return {"type": "object"}
        return {"type": "string"}

    def _tool_schema(self, func) -> dict:
        sig = inspect.signature(func)
        properties: dict = {}
        required: list = []

        for param_name, param in sig.parameters.items():
            ann = param.annotation
            prop = (
                self._annotation_schema(ann)
                if ann != inspect.Parameter.empty
                else {"type": "string"}
            ).copy()

            if param.default == inspect.Parameter.empty:
                required.append(param_name)
            elif param.default is not None and param.default is not inspect.Parameter.empty:
                if isinstance(param.default, (bool, int, float, str)):
                    prop["default"] = param.default

            properties[param_name] = prop

        doc = inspect.getdoc(func) or ""
        description = doc.split("\n")[0] if doc else func.__name__

        return {
            "name": func.__name__,
            "description": description,
            "inputSchema": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        }

    # ── MCP JSON-RPC dispatch ────────────────────────────────────────────────

    def handle(self, body: dict) -> dict:
        method = body.get("method", "")
        msg_id = body.get("id")

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": self.name, "version": "1.0.0"},
                    "instructions": self.instructions,
                },
            }

        if method in ("notifications/initialized", "ping"):
            return {"jsonrpc": "2.0", "id": msg_id, "result": {}}

        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "tools": [self._tool_schema(f) for f in self._tools.values()]
                },
            }

        if method == "tools/call":
            params = body.get("params", {})
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {})

            if tool_name not in self._tools:
                return {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "error": {"code": -32601, "message": f"Tool not found: {tool_name}"},
                }

            try:
                result = self._tools[tool_name](**arguments)
                return {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "content": [{"type": "text", "text": json.dumps(result, default=str)}],
                        "isError": False,
                    },
                }
            except Exception as exc:
                log.exception("MCP tool %s failed", tool_name)
                return {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "content": [{"type": "text", "text": str(exc)}],
                        "isError": True,
                    },
                }

        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


# Global server instance — tool modules import this and use @mcp.tool()
mcp = MCPServer("AWX NextGen Admin", instructions=INSTRUCTIONS)

# Import tool modules to trigger @mcp.tool() registrations
from awx.customvars.mcp.tools import system       # noqa: F401, E402
from awx.customvars.mcp.tools import inventory    # noqa: F401, E402
from awx.customvars.mcp.tools import hosts        # noqa: F401, E402
from awx.customvars.mcp.tools import groups       # noqa: F401, E402
from awx.customvars.mcp.tools import projects     # noqa: F401, E402
from awx.customvars.mcp.tools import jobs         # noqa: F401, E402
from awx.customvars.mcp.tools import locations    # noqa: F401, E402
from awx.customvars.mcp.tools import credentials  # noqa: F401, E402

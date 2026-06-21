from awx.main.models import Host
from awx.customvars.mcp.server import mcp
from awx.customvars.mcp.tools._client import awx_http


@mcp.tool()
def awx_list_hosts(inventory_id: int = 0, search: str = "", limit: int = 50) -> list:
    """List hosts. Optionally filter by inventory or search by name.

    Args:
        inventory_id: Filter by inventory (0 = all inventories)
        search:       Substring search on hostname
        limit:        Maximum number of results (default 50, max 500)

    Returns: list of {id, name, inventory, enabled, description, has_active_failures}
    """
    qs = Host.objects.select_related("inventory").order_by("name")
    if inventory_id:
        qs = qs.filter(inventory_id=inventory_id)
    if search:
        qs = qs.filter(name__icontains=search)
    return [
        {
            "id": h.id,
            "name": h.name,
            "description": h.description,
            "inventory": h.inventory.name if h.inventory else None,
            "inventory_id": h.inventory_id,
            "enabled": h.enabled,
            "has_active_failures": h.has_active_failures,
            "variables": h.variables,
        }
        for h in qs[: min(limit, 500)]
    ]


@mcp.tool()
def awx_get_host(host_id: int) -> dict:
    """Get full details for a single host including variables and recent job info.

    Args:
        host_id: ID of the host

    Returns: host details dict with all fields
    """
    try:
        h = Host.objects.select_related("inventory", "inventory__organization").get(pk=host_id)
    except Host.DoesNotExist:
        return {"error": f"Host {host_id} not found"}
    return {
        "id": h.id,
        "name": h.name,
        "description": h.description,
        "inventory": h.inventory.name if h.inventory else None,
        "inventory_id": h.inventory_id,
        "organization": h.inventory.organization.name if h.inventory and h.inventory.organization else None,
        "enabled": h.enabled,
        "variables": h.variables,
        "has_active_failures": h.has_active_failures,
        "last_job": h.last_job_id,
    }


@mcp.tool()
def awx_create_host(name: str, inventory_id: int, description: str = "", variables: str = "", enabled: bool = True) -> dict:
    """Create a new host in an inventory.

    Args:
        name:         Hostname (FQDN recommended)
        inventory_id: ID of the target inventory
        description:  Optional description
        variables:    YAML or JSON string with host variables
        enabled:      Whether the host is active (default True)

    Returns: {id, name, inventory}
    """
    with awx_http() as client:
        resp = client.post("hosts/", json={
            "name": name,
            "inventory": inventory_id,
            "description": description,
            "variables": variables,
            "enabled": enabled,
        })
        resp.raise_for_status()
        data = resp.json()
    return {
        "id": data["id"],
        "name": data["name"],
        "inventory_id": data["inventory"],
    }


@mcp.tool()
def awx_update_host(host_id: int, name: str = "", variables: str = "", enabled: bool = None, description: str = "") -> dict:
    """Update host fields. Only provided non-empty values are changed.

    Args:
        host_id:     ID of the host to update
        name:        New hostname (empty = unchanged)
        variables:   New variables YAML/JSON (empty = unchanged)
        enabled:     Enable/disable the host (None = unchanged)
        description: New description (empty = unchanged)

    Returns: {id, name, enabled}
    """
    payload = {}
    if name:
        payload["name"] = name
    if variables:
        payload["variables"] = variables
    if enabled is not None:
        payload["enabled"] = enabled
    if description:
        payload["description"] = description
    if not payload:
        return {"error": "No fields to update provided"}

    with awx_http() as client:
        resp = client.patch(f"hosts/{host_id}/", json=payload)
        resp.raise_for_status()
        data = resp.json()
    return {"id": data["id"], "name": data["name"], "enabled": data["enabled"]}


@mcp.tool()
def awx_delete_host(host_id: int) -> dict:
    """Delete a host permanently.

    Args:
        host_id: ID of the host to delete

    Returns: {"deleted": true, "id": host_id}
    """
    with awx_http() as client:
        resp = client.delete(f"hosts/{host_id}/")
        resp.raise_for_status()
    return {"deleted": True, "id": host_id}


@mcp.tool()
def awx_clone_host(host_id: int, new_name: str) -> dict:
    """Clone an existing host — copies all role variable overrides (AWX-ng specific).

    Args:
        host_id:  ID of the source host to clone from
        new_name: Name for the new cloned host

    Returns: {id, name, inventory_id} of the new host
    """
    with awx_http() as client:
        resp = client.post(f"hosts/{host_id}/clone/", json={"name": new_name})
        resp.raise_for_status()
        data = resp.json()
    return {
        "id": data["id"],
        "name": data["name"],
        "inventory_id": data.get("inventory"),
    }


@mcp.tool()
def awx_get_host_role_variables(host_id: int) -> list:
    """List all role variable overrides for a host with defaults and current values.

    Args:
        host_id: ID of the host

    Returns: list of {role, variable, default_value, host_value, is_overridden}
    """
    with awx_http() as client:
        resp = client.get(f"hosts/{host_id}/role_variables/")
        resp.raise_for_status()
        data = resp.json()
    return data.get("results", data) if isinstance(data, dict) else data


@mcp.tool()
def awx_set_host_variable(host_id: int, role_name: str, variable_name: str, value: str) -> dict:
    """Set a role variable override on a host (AWX-ng Foreman-style).

    Args:
        host_id:       ID of the host
        role_name:     Name of the Ansible role (e.g. "nginx", "java")
        variable_name: Name of the variable to override (e.g. "nginx_port")
        value:         New value as string (will be stored as YAML)

    Returns: {"role": ..., "variable": ..., "value": ..., "host_id": ...}
    """
    with awx_http() as client:
        resp = client.patch(
            f"hosts/{host_id}/role_variables/{variable_name}/",
            json={"role": role_name, "value": value},
        )
        resp.raise_for_status()
        data = resp.json()
    return data


@mcp.tool()
def awx_get_aggregated_variables(host_id: int) -> dict:
    """Get the full merged variable stack for a host as Ansible would see it.

    Shows variable precedence: role defaults < group overrides < host overrides.

    Args:
        host_id: ID of the host

    Returns: {"host_vars": {...}, "group_vars": {...}, "role_defaults": {...}, "merged": {...}}
    """
    with awx_http() as client:
        resp = client.get(f"hosts/{host_id}/aggregated_variables/")
        resp.raise_for_status()
    return resp.json()

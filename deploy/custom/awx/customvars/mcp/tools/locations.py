from awx.customvars.models import Location, ExecutionNodeLocation
from awx.customvars.mcp.server import mcp
from awx.customvars.mcp.tools._client import awx_http


@mcp.tool()
def awx_list_locations() -> list:
    """List all AWX-ng locations (sites) with their assigned execution nodes.

    Returns: list of {id, name, description, node_count, instance_group_id}
    """
    locations = []
    for loc in Location.objects.prefetch_related("execution_node_locations").order_by("name"):
        node_count = loc.execution_node_locations.count() if hasattr(loc, "execution_node_locations") else 0
        locations.append({
            "id": loc.id,
            "name": loc.name,
            "description": loc.description if hasattr(loc, "description") else "",
            "node_count": node_count,
            "instance_group_id": loc.instance_group_id if hasattr(loc, "instance_group_id") else None,
        })
    return locations


@mcp.tool()
def awx_create_location(name: str, description: str = "", instance_group_id: int = 0) -> dict:
    """Create a new AWX-ng location (site).

    Args:
        name:              Location name (e.g. "MUC-DC1", "Frankfurt")
        description:       Optional description
        instance_group_id: ID of the AWX InstanceGroup to link this location to (0 = none)

    Returns: {id, name, description}
    """
    with awx_http() as client:
        payload: dict = {"name": name, "description": description}
        if instance_group_id:
            payload["instance_group"] = instance_group_id
        resp = client.post("locations/", json=payload)
        resp.raise_for_status()
        data = resp.json()
    return {"id": data["id"], "name": data["name"], "description": data.get("description", "")}


@mcp.tool()
def awx_update_location(location_id: int, name: str = "", description: str = "", instance_group_id: int = 0) -> dict:
    """Update an existing location.

    Args:
        location_id:       ID of the location to update
        name:              New name (empty = unchanged)
        description:       New description (empty = unchanged)
        instance_group_id: New InstanceGroup ID (0 = unchanged)

    Returns: {id, name, description}
    """
    payload = {}
    if name:
        payload["name"] = name
    if description:
        payload["description"] = description
    if instance_group_id:
        payload["instance_group"] = instance_group_id
    if not payload:
        return {"error": "No fields to update provided"}

    with awx_http() as client:
        resp = client.patch(f"locations/{location_id}/", json=payload)
        resp.raise_for_status()
        data = resp.json()
    return {"id": data["id"], "name": data["name"], "description": data.get("description", "")}


@mcp.tool()
def awx_list_execution_nodes() -> list:
    """List all AWX execution nodes with their current capacity and location assignment.

    Returns: list of {id, hostname, node_type, capacity, enabled, location_id}
    """
    with awx_http() as client:
        resp = client.get("instances/")
        resp.raise_for_status()
        data = resp.json()

    node_location_map = {
        enl.instance_id: enl.location_id
        for enl in ExecutionNodeLocation.objects.all()
    } if hasattr(ExecutionNodeLocation, "instance_id") else {}

    return [
        {
            "id": n["id"],
            "hostname": n.get("hostname"),
            "node_type": n.get("node_type"),
            "capacity": n.get("capacity", 0),
            "consumed_capacity": n.get("consumed_capacity", 0),
            "enabled": n.get("enabled", True),
            "managed": n.get("managed", False),
            "location_id": node_location_map.get(n["id"]),
        }
        for n in data.get("results", [])
    ]


@mcp.tool()
def awx_register_execution_node(hostname: str, node_type: str = "execution") -> dict:
    """Register a new execution node with AWX-ng (AWX-ng specific endpoint).

    Args:
        hostname:  FQDN or IP of the node
        node_type: "execution" (default) or "hop"

    Returns: {id, hostname, token} — use token to configure the node
    """
    with awx_http() as client:
        resp = client.post("runners/register/", json={
            "hostname": hostname,
            "node_type": node_type,
        })
        resp.raise_for_status()
    return resp.json()


@mcp.tool()
def awx_assign_node_to_location(execution_node_id: int, location_id: int) -> dict:
    """Assign an execution node to a location (AWX-ng specific).

    Args:
        execution_node_id: ID of the AWX Instance (execution node)
        location_id:       ID of the location to assign to

    Returns: {id, instance_id, location_id}
    """
    with awx_http() as client:
        resp = client.post("execution_node_locations/", json={
            "instance": execution_node_id,
            "location": location_id,
        })
        resp.raise_for_status()
        data = resp.json()
    return {
        "id": data.get("id"),
        "instance_id": data.get("instance"),
        "location_id": data.get("location"),
    }

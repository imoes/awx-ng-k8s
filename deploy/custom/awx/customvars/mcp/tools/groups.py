from awx.customvars.mcp.server import mcp
from awx.customvars.mcp.tools._client import awx_http


@mcp.tool()
def awx_create_group(name: str, inventory_id: int, description: str = "", variables: str = "") -> dict:
    """Create a new group in an inventory.

    Args:
        name:         Group name
        inventory_id: ID of the target inventory
        description:  Optional description
        variables:    YAML or JSON group variables

    Returns: {id, name, inventory_id}
    """
    with awx_http() as client:
        resp = client.post("groups/", json={
            "name": name,
            "inventory": inventory_id,
            "description": description,
            "variables": variables,
        })
        resp.raise_for_status()
        data = resp.json()
    return {"id": data["id"], "name": data["name"], "inventory_id": data["inventory"]}


@mcp.tool()
def awx_add_host_to_group(group_id: int, host_id: int) -> dict:
    """Add an existing host to a group.

    Args:
        group_id: ID of the group
        host_id:  ID of the host to add

    Returns: {"added": true, "group_id": ..., "host_id": ...}
    """
    with awx_http() as client:
        resp = client.post(f"groups/{group_id}/hosts/", json={"id": host_id})
        resp.raise_for_status()
    return {"added": True, "group_id": group_id, "host_id": host_id}


@mcp.tool()
def awx_get_group_role_variables(group_id: int) -> list:
    """List all role variable overrides for a group.

    Args:
        group_id: ID of the group

    Returns: list of {role, variable, default_value, group_value, is_overridden}
    """
    with awx_http() as client:
        resp = client.get(f"groups/{group_id}/role_variables/")
        resp.raise_for_status()
        data = resp.json()
    return data.get("results", data) if isinstance(data, dict) else data


@mcp.tool()
def awx_set_group_variable(group_id: int, role_name: str, variable_name: str, value: str) -> dict:
    """Set a role variable override on a group (AWX-ng Foreman-style).

    Args:
        group_id:      ID of the group
        role_name:     Name of the Ansible role
        variable_name: Variable name to override
        value:         New value as string (stored as YAML)

    Returns: {"role": ..., "variable": ..., "value": ..., "group_id": ...}
    """
    with awx_http() as client:
        resp = client.patch(
            f"groups/{group_id}/role_variables/{variable_name}/",
            json={"role": role_name, "value": value},
        )
        resp.raise_for_status()
    return resp.json()

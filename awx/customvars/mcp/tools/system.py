from awx.customvars.mcp.server import mcp
from awx.customvars.mcp.tools._client import awx_http


@mcp.tool()
def awx_ping() -> dict:
    """Check if AWX-ng is running and return version + HA status.

    Returns: {"version": "24.6.1", "ha_enabled": false, "active_node": "..."}
    """
    with awx_http() as client:
        resp = client.get("ping/")
        resp.raise_for_status()
        data = resp.json()
    return {
        "version": data.get("version", "unknown"),
        "ha_enabled": data.get("ha", False),
        "active_node": data.get("active_node", ""),
        "instances": [
            {"hostname": i.get("node"), "capacity": i.get("capacity")}
            for i in (
                data["instances"].values()
                if isinstance(data.get("instances"), dict)
                else (data.get("instances") or [])
            )
        ],
    }


@mcp.tool()
def awx_get_config() -> dict:
    """Return AWX-ng configuration overview: auth methods, default settings, license.

    Returns key configuration values relevant for administration.
    """
    with awx_http() as client:
        resp = client.get("config/")
        resp.raise_for_status()
        data = resp.json()
    return {
        "version": data.get("version"),
        "eula_accepted": data.get("eula_accepted"),
        "analytics_status": data.get("analytics_status"),
        "become_enabled": data.get("become_enabled"),
        "custom_login_info": data.get("custom_login_info"),
        "project_base_dir": data.get("project_base_dir"),
        "time_zone": data.get("time_zone"),
        "license_type": data.get("license_info", {}).get("license_type"),
    }


@mcp.tool()
def awx_list_instance_groups() -> list:
    """List all AWX instance groups (execution / controller pools) with capacity.

    Returns a list of groups with their execution nodes and current capacity.
    """
    with awx_http() as client:
        resp = client.get("instance_groups/")
        resp.raise_for_status()
        data = resp.json()
    groups = []
    for g in data.get("results", []):
        groups.append({
            "id": g["id"],
            "name": g["name"],
            "capacity": g.get("capacity", 0),
            "consumed_capacity": g.get("consumed_capacity", 0),
            "percent_capacity_remaining": g.get("percent_capacity_remaining", 0),
            "instances": g.get("instances", 0),
            "is_container_group": g.get("is_container_group", False),
            "pod_spec_override": g.get("pod_spec_override", ""),
        })
    return groups

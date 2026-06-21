from awx.main.models import Inventory, Group, Organization
from awx.customvars.mcp.server import mcp
from awx.customvars.mcp.tools._client import awx_http


@mcp.tool()
def awx_list_inventories(organization_name: str = "") -> list:
    """List all inventories. Optionally filter by organization name.

    Args:
        organization_name: Filter by organization name (empty = all organizations)

    Returns: list of {id, name, organization, total_hosts, total_groups, description}
    """
    qs = Inventory.objects.select_related("organization").order_by("name")
    if organization_name:
        qs = qs.filter(organization__name__iexact=organization_name)
    return [
        {
            "id": inv.id,
            "name": inv.name,
            "description": inv.description,
            "organization": inv.organization.name if inv.organization else None,
            "total_hosts": inv.total_hosts,
            "total_groups": inv.total_groups,
            "has_inventory_sources": inv.has_inventory_sources,
            "variables": inv.variables,
        }
        for inv in qs[:200]
    ]


@mcp.tool()
def awx_create_inventory(name: str, organization_id: int, description: str = "", variables: str = "") -> dict:
    """Create a new inventory.

    Args:
        name: Inventory name
        organization_id: ID of the organization to create the inventory in
        description: Optional description
        variables: YAML or JSON string with inventory-level variables

    Returns: {id, name, organization, url}
    """
    with awx_http() as client:
        resp = client.post("inventories/", json={
            "name": name,
            "organization": organization_id,
            "description": description,
            "variables": variables,
        })
        resp.raise_for_status()
        data = resp.json()
    return {"id": data["id"], "name": data["name"], "organization": data.get("summary_fields", {}).get("organization", {}).get("name")}


@mcp.tool()
def awx_list_groups(inventory_id: int) -> list:
    """List all groups in an inventory.

    Args:
        inventory_id: ID of the inventory

    Returns: list of {id, name, description, total_hosts, has_active_failures}
    """
    qs = Group.objects.filter(inventory_id=inventory_id).order_by("name")
    return [
        {
            "id": g.id,
            "name": g.name,
            "description": g.description,
            "total_hosts": g.total_hosts,
            "has_active_failures": g.has_active_failures,
            "variables": g.variables,
        }
        for g in qs[:500]
    ]


@mcp.tool()
def awx_list_organizations() -> list:
    """List all organizations.

    Returns: list of {id, name, description, max_hosts}
    """
    return [
        {
            "id": org.id,
            "name": org.name,
            "description": org.description,
            "max_hosts": org.max_hosts,
        }
        for org in Organization.objects.order_by("name")[:100]
    ]

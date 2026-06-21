from awx.main.models import Credential, CredentialType
from awx.customvars.mcp.server import mcp
from awx.customvars.mcp.tools._client import awx_http


@mcp.tool()
def awx_list_credentials(credential_type_name: str = "") -> list:
    """List all credentials. Optionally filter by credential type name.

    Args:
        credential_type_name: Filter by type (e.g. "Machine", "Source Control", "Vault")

    Returns: list of {id, name, credential_type, organization, username}
    """
    qs = Credential.objects.select_related("credential_type", "organization").order_by("name")
    if credential_type_name:
        qs = qs.filter(credential_type__name__icontains=credential_type_name)
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "credential_type": c.credential_type.name if c.credential_type else None,
            "credential_type_id": c.credential_type_id,
            "organization": c.organization.name if c.organization else None,
            "inputs_redacted": {k: "***" for k in c.inputs if "pass" in k.lower() or "key" in k.lower() or "secret" in k.lower()},
        }
        for c in qs[:200]
    ]


@mcp.tool()
def awx_list_credential_types() -> list:
    """List all available credential types (managed and custom).

    Returns: list of {id, name, kind, managed} where kind is machine/scm/vault/etc.
    """
    return [
        {
            "id": ct.id,
            "name": ct.name,
            "kind": ct.kind,
            "managed": ct.managed,
            "description": ct.description,
        }
        for ct in CredentialType.objects.order_by("managed", "name")
    ]


@mcp.tool()
def awx_create_credential(
    name: str,
    credential_type_id: int,
    inputs: dict,
    organization_id: int = 0,
    description: str = "",
) -> dict:
    """Create a new credential.

    Args:
        name:               Credential name
        credential_type_id: ID of the credential type (use awx_list_credential_types to find it)
        inputs:             Dict of credential inputs (e.g. {"username": "root", "password": "..."})
        organization_id:    Organization ID (0 = no organization)
        description:        Optional description

    Returns: {id, name, credential_type}
    """
    payload: dict = {
        "name": name,
        "credential_type": credential_type_id,
        "inputs": inputs,
        "description": description,
    }
    if organization_id:
        payload["organization"] = organization_id

    with awx_http() as client:
        resp = client.post("credentials/", json=payload)
        resp.raise_for_status()
        data = resp.json()
    return {
        "id": data["id"],
        "name": data["name"],
        "credential_type_id": data["credential_type"],
    }


@mcp.tool()
def awx_generate_survey(template_id: int) -> dict:
    """Generate a survey spec for a job template from its role variable defaults (AWX-ng specific).

    Creates survey questions for each role variable used by the template's associated roles.

    Args:
        template_id: ID of the job template

    Returns: {"survey_spec": {...}, "question_count": N}
    """
    with awx_http() as client:
        resp = client.post(f"job_templates/{template_id}/generate_survey/")
        resp.raise_for_status()
        data = resp.json()
    return {
        "survey_spec": data,
        "question_count": len(data.get("spec", [])),
    }


@mcp.tool()
def awx_hash_password(plaintext: str) -> dict:
    """Hash a plaintext password for use in Ansible role variables (AWX-ng specific).

    Useful for setting hashed passwords in variables like 'user_password'.

    Args:
        plaintext: The password to hash

    Returns: {"hash": "...sha512crypt hash..."} — use this value in set_host_variable
    """
    with awx_http() as client:
        resp = client.post("hash_password/", json={"password": plaintext})
        resp.raise_for_status()
        data = resp.json()
    return {"hash": data.get("hash", data)}

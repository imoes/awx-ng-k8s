from awx.main.models import Project
from awx.customvars.models import RoleVariable, RoleTag, RoleHandler, RoleScan
from awx.customvars.mcp.server import mcp
from awx.customvars.mcp.tools._client import awx_http


@mcp.tool()
def awx_list_projects(organization_name: str = "") -> list:
    """List all projects. Optionally filter by organization name.

    Args:
        organization_name: Filter by organization (empty = all)

    Returns: list of {id, name, organization, scm_type, scm_url, last_updated, status}
    """
    qs = Project.objects.select_related("organization").order_by("name")
    if organization_name:
        qs = qs.filter(organization__name__iexact=organization_name)
    return [
        {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "organization": p.organization.name if p.organization else None,
            "scm_type": p.scm_type,
            "scm_url": p.scm_url,
            "scm_branch": p.scm_branch,
            "local_path": p.local_path,
            "status": p.status,
        }
        for p in qs[:200]
    ]


@mcp.tool()
def awx_sync_project(project_id: int) -> dict:
    """Trigger a git sync for a project (updates roles and playbooks from SCM).

    Args:
        project_id: ID of the project to sync

    Returns: {job_id, status, project_id}  — poll awx_get_job_status(job_id) until done
    """
    with awx_http() as client:
        resp = client.post(f"projects/{project_id}/update/")
        resp.raise_for_status()
        data = resp.json()
    return {
        "job_id": data.get("id"),
        "status": data.get("status", "pending"),
        "project_id": project_id,
    }


@mcp.tool()
def awx_get_project_roles(project_id: int) -> list:
    """List all Ansible roles detected in a project after the last sync.

    Args:
        project_id: ID of the project

    Returns: list of role names with variable/tag/handler counts
    """
    var_qs = (
        RoleVariable.objects
        .filter(project_id=project_id)
        .values("role_name")
        .distinct()
        .order_by("role_name")
    )
    roles = []
    for row in var_qs:
        name = row["role_name"]
        var_count = RoleVariable.objects.filter(project_id=project_id, role_name=name).count()
        tag_count = RoleTag.objects.filter(project_id=project_id, role_name=name).count()
        handler_count = RoleHandler.objects.filter(project_id=project_id, role_name=name).count()
        roles.append({
            "name": name,
            "variable_count": var_count,
            "tag_count": tag_count,
            "handler_count": handler_count,
        })
    return roles


@mcp.tool()
def awx_get_role_variables(project_id: int, role_name: str) -> list:
    """Get all default variables for a specific role in a project.

    Args:
        project_id: ID of the project
        role_name:  Name of the Ansible role

    Returns: list of {name, default_value, source_file} — role defaults before any overrides
    """
    qs = RoleVariable.objects.filter(
        project_id=project_id, role_name=role_name
    ).order_by("name")
    return [
        {
            "name": v.name,
            "default_value": v.default_value,
            "source_file": v.source_file if hasattr(v, "source_file") else None,
        }
        for v in qs
    ]


@mcp.tool()
def awx_get_role_tags(project_id: int, role_name: str) -> list:
    """Get all Ansible tags defined in a role's tasks.

    Args:
        project_id: ID of the project
        role_name:  Name of the Ansible role

    Returns: list of tag names
    """
    return list(
        RoleTag.objects
        .filter(project_id=project_id, role_name=role_name)
        .values_list("name", flat=True)
        .order_by("name")
    )


@mcp.tool()
def awx_list_project_files(project_id: int, path: str = "") -> list:
    """List files and directories in a project's repository.

    Args:
        project_id: ID of the project
        path:       Directory path relative to project root (empty = root)

    Returns: list of {name, type, path} where type is "file" or "directory"
    """
    with awx_http() as client:
        params = {"path": path} if path else {}
        resp = client.get(f"projects/{project_id}/files/", params=params)
        resp.raise_for_status()
    return resp.json()


@mcp.tool()
def awx_read_project_file(project_id: int, path: str) -> dict:
    """Read the content of a file in a project's repository.

    Args:
        project_id: ID of the project
        path:       File path relative to project root (e.g. "roles/nginx/tasks/main.yml")

    Returns: {"path": ..., "content": "...file content..."}
    """
    with awx_http() as client:
        resp = client.get(f"projects/{project_id}/files/content/", params={"path": path})
        resp.raise_for_status()
    return {"path": path, "content": resp.text}


@mcp.tool()
def awx_write_project_file(project_id: int, path: str, content: str) -> dict:
    """Write (create or overwrite) a file in a project's repository.

    Args:
        project_id: ID of the project
        path:       File path relative to project root
        content:    Full file content to write

    Returns: {"path": ..., "written": true}
    """
    with awx_http() as client:
        resp = client.put(
            f"projects/{project_id}/files/content/",
            params={"path": path},
            content=content.encode(),
            headers={"Content-Type": "text/plain"},
        )
        resp.raise_for_status()
    return {"path": path, "written": True}


@mcp.tool()
def awx_trigger_role_scan(project_id: int) -> dict:
    """Trigger an immediate role variable re-scan for a project (without git sync).

    Useful after editing role files via awx_write_project_file to refresh variable metadata.

    Args:
        project_id: ID of the project

    Returns: {"project_id": ..., "triggered": true}
    """
    with awx_http() as client:
        resp = client.post(f"projects/{project_id}/scan_roles/")
        resp.raise_for_status()
    return {"project_id": project_id, "triggered": True}


@mcp.tool()
def awx_create_role(project_id: int, role_name: str) -> dict:
    """Create a new Ansible role scaffold in a project (Ansible standard directory structure).

    Creates: defaults/main.yml, tasks/main.yml, handlers/main.yml, meta/main.yml
    Then triggers a role scan to register the new role in the AWX-ng database.

    Args:
        project_id: ID of the project
        role_name:  Name of the new role (e.g. "nginx", "postgresql")

    Returns: {"role": role_name, "created": [...files...], "scanned": true}
    """
    scaffold = {
        f"roles/{role_name}/defaults/main.yml": "---\n# Default variables for role {role_name}\n{}: {{}}\n".format(role_name, role_name),
        f"roles/{role_name}/tasks/main.yml": "---\n# Tasks for role {}\n".format(role_name),
        f"roles/{role_name}/handlers/main.yml": "---\n# Handlers for role {}\n".format(role_name),
        f"roles/{role_name}/meta/main.yml": "---\ngalaxy_info:\n  role_name: {}\n  author: awx-ng\n  description: ''\n  min_ansible_version: '2.9'\n".format(role_name),
    }
    created = []
    with awx_http() as client:
        for path, content in scaffold.items():
            resp = client.put(
                f"projects/{project_id}/files/content/",
                params={"path": path},
                content=content.encode(),
                headers={"Content-Type": "text/plain"},
            )
            resp.raise_for_status()
            created.append(path)

        # trigger role scan to register variables in DB
        client.post(f"projects/{project_id}/scan_roles/")

    return {"role": role_name, "created": created, "scanned": True}


@mcp.tool()
def awx_create_playbook(project_id: int, name: str, content: str) -> dict:
    """Create a new playbook in the project's playbooks/ directory (Ansible convention).

    Playbooks must live in ./playbooks/ — this tool enforces that convention.
    Appends .yml extension if the name has none.

    Args:
        project_id: ID of the project
        name:       Playbook filename (e.g. "site.yml" or "deploy")
        content:    Full YAML content of the playbook

    Returns: {"path": "playbooks/{name}", "bytes": N}
    """
    if not any(name.endswith(s) for s in ('.yml', '.yaml')):
        name = name + '.yml'
    path = f"playbooks/{name}"
    with awx_http() as client:
        resp = client.put(
            f"projects/{project_id}/files/content/",
            params={"path": path},
            content=content.encode(),
            headers={"Content-Type": "text/plain"},
        )
        resp.raise_for_status()
    return {"path": path, "bytes": len(content.encode())}

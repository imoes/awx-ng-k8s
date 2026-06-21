import json
from awx.main.models import Job, JobTemplate
from awx.customvars.mcp.server import mcp
from awx.customvars.mcp.tools._client import awx_http


@mcp.tool()
def awx_list_job_templates(inventory_id: int = 0, search: str = "") -> list:
    """List all job templates. Optionally filter by inventory or search by name.

    Args:
        inventory_id: Filter by inventory (0 = all)
        search:       Substring search on template name

    Returns: list of {id, name, playbook, inventory, description, ask_limit_on_launch}
    """
    qs = JobTemplate.objects.select_related("inventory", "project").order_by("name")
    if inventory_id:
        qs = qs.filter(inventory_id=inventory_id)
    if search:
        qs = qs.filter(name__icontains=search)
    return [
        {
            "id": jt.id,
            "name": jt.name,
            "description": jt.description,
            "playbook": jt.playbook,
            "inventory": jt.inventory.name if jt.inventory else None,
            "inventory_id": jt.inventory_id,
            "project": jt.project.name if jt.project else None,
            "project_id": jt.project_id,
            "ask_limit_on_launch": jt.ask_limit_on_launch,
            "ask_variables_on_launch": jt.ask_variables_on_launch,
        }
        for jt in qs[:200]
    ]


@mcp.tool()
def awx_get_job_template(template_id: int) -> dict:
    """Get full details of a job template including survey and credential info.

    Args:
        template_id: ID of the job template

    Returns: full template details
    """
    try:
        jt = JobTemplate.objects.select_related("inventory", "project").get(pk=template_id)
    except JobTemplate.DoesNotExist:
        return {"error": f"Job template {template_id} not found"}
    return {
        "id": jt.id,
        "name": jt.name,
        "description": jt.description,
        "playbook": jt.playbook,
        "inventory": jt.inventory.name if jt.inventory else None,
        "inventory_id": jt.inventory_id,
        "project": jt.project.name if jt.project else None,
        "project_id": jt.project_id,
        "extra_vars": jt.extra_vars,
        "limit": jt.limit,
        "verbosity": jt.verbosity,
        "forks": jt.forks,
        "job_tags": jt.job_tags,
        "skip_tags": jt.skip_tags,
        "ask_limit_on_launch": jt.ask_limit_on_launch,
        "ask_variables_on_launch": jt.ask_variables_on_launch,
        "ask_tags_on_launch": jt.ask_tags_on_launch,
        "survey_enabled": jt.survey_enabled,
        "become_enabled": jt.become_enabled,
    }


@mcp.tool()
def awx_launch_job_template(
    template_id: int,
    limit: str = "",
    extra_vars: str = "",
    job_tags: str = "",
    skip_tags: str = "",
) -> dict:
    """Launch a job template and return the job ID to track progress.

    Args:
        template_id: ID of the job template to launch
        limit:       Ansible limit pattern (e.g. "webservers" or "host1,host2")
        extra_vars:  Extra variables as YAML/JSON string
        job_tags:    Comma-separated tags to run (empty = all tags)
        skip_tags:   Comma-separated tags to skip

    Returns: {job_id, status, url}  — poll awx_get_job_status(job_id) until done
    """
    payload = {}
    if limit:
        payload["limit"] = limit
    if extra_vars:
        payload["extra_vars"] = extra_vars
    if job_tags:
        payload["job_tags"] = job_tags
    if skip_tags:
        payload["skip_tags"] = skip_tags

    with awx_http() as client:
        resp = client.post(f"job_templates/{template_id}/launch/", json=payload)
        resp.raise_for_status()
        data = resp.json()
    return {
        "job_id": data.get("id"),
        "status": data.get("status", "pending"),
        "template_id": template_id,
    }


@mcp.tool()
def awx_launch_for_host(template_id: int, host_name: str, extra_vars: str = "") -> dict:
    """Launch a job template targeting a single host by name.

    Args:
        template_id: ID of the job template
        host_name:   Exact hostname (used as Ansible limit)
        extra_vars:  Optional extra variables as YAML/JSON string

    Returns: {job_id, status, host_name}
    """
    payload = {"limit": host_name}
    if extra_vars:
        payload["extra_vars"] = extra_vars

    with awx_http() as client:
        resp = client.post(f"job_templates/{template_id}/launch/", json=payload)
        resp.raise_for_status()
        data = resp.json()
    return {
        "job_id": data.get("id"),
        "status": data.get("status", "pending"),
        "host_name": host_name,
    }


@mcp.tool()
def awx_get_job_status(job_id: int) -> dict:
    """Get the current status of a running or completed job.

    Status values: pending, waiting, running, successful, failed, error, canceled

    Args:
        job_id: ID of the job

    Returns: {id, status, started, finished, elapsed, failed, result_traceback}
    """
    try:
        j = Job.objects.get(pk=job_id)
    except Job.DoesNotExist:
        return {"error": f"Job {job_id} not found"}
    return {
        "id": j.id,
        "status": j.status,
        "started": j.started.isoformat() if j.started else None,
        "finished": j.finished.isoformat() if j.finished else None,
        "elapsed": j.elapsed,
        "failed": j.failed,
        "result_traceback": j.result_traceback or "",
        "job_explanation": j.job_explanation or "",
        "limit": j.limit,
    }


@mcp.tool()
def awx_cancel_job(job_id: int) -> dict:
    """Cancel a running or pending job.

    Args:
        job_id: ID of the job to cancel

    Returns: {"canceled": true, "job_id": ...}
    """
    with awx_http() as client:
        resp = client.post(f"jobs/{job_id}/cancel/")
        resp.raise_for_status()
    return {"canceled": True, "job_id": job_id}


@mcp.tool()
def awx_list_recent_jobs(template_id: int = 0, status: str = "", limit: int = 20) -> list:
    """List recent jobs. Optionally filter by template or status.

    Args:
        template_id: Filter by job template (0 = all templates)
        status:      Filter by status: pending/waiting/running/successful/failed/canceled
        limit:       Maximum number of results (default 20, max 100)

    Returns: list of {id, status, started, finished, limit, template_name}
    """
    qs = (
        Job.objects
        .select_related("job_template")
        .order_by("-created")
    )
    if template_id:
        qs = qs.filter(job_template_id=template_id)
    if status:
        qs = qs.filter(status=status)
    return [
        {
            "id": j.id,
            "status": j.status,
            "started": j.started.isoformat() if j.started else None,
            "finished": j.finished.isoformat() if j.finished else None,
            "elapsed": j.elapsed,
            "limit": j.limit,
            "template": j.job_template.name if j.job_template else None,
            "template_id": j.job_template_id,
            "failed": j.failed,
        }
        for j in qs[: min(limit, 100)]
    ]

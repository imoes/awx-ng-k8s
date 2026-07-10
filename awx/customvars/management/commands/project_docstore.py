"""
awx-manage project_docstore <import|export> <project_id>

import: parse the project's on-disk git checkout into the DB JSON-IR doc store (git → DB).
export: render the DB doc store back into the working tree (DB → git); commit separately.

The DB is the source of truth for editing; git is the import/export boundary (see docstore.py).
"""
from django.core.management.base import BaseCommand

from awx.customvars import docstore
from awx.customvars.api import _get_project_path


class Command(BaseCommand):
    help = "Import a project's files into the DB doc store, or export the DB back to the working tree."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["import", "export"])
        parser.add_argument("project_id", type=int)

    def handle(self, *args, **opts):
        project_path = _get_project_path(opts["project_id"])
        if opts["action"] == "import":
            result = docstore.import_project(opts["project_id"], project_path)
        else:
            result = docstore.export_project(opts["project_id"], project_path)
        self.stdout.write(self.style.SUCCESS(f"{opts['action']}: {result}"))

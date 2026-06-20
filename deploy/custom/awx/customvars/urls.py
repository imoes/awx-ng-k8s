from django.urls import re_path

from awx.customvars.api import (
    LocationListView,
    LocationDetailView,
)

urls = [
    re_path(r'^$', LocationListView.as_view(), name='location_list'),
    re_path(r'^(?P<pk>[0-9a-f-]+)/$', LocationDetailView.as_view(), name='location_detail'),
]

__all__ = ['urls']

from django.urls import re_path

from awx.customvars.api import (
    LocationListView,
    LocationDetailView,
    SubnetListView,
)

urls = [
    re_path(r'^$', LocationListView.as_view(), name='location_list'),
    re_path(r'^(?P<pk>[0-9a-f-]+)/$', LocationDetailView.as_view(), name='location_detail'),
    re_path(r'^(?P<location_id>[0-9a-f-]+)/subnets/$', SubnetListView.as_view(), name='location_subnet_list'),
]

__all__ = ['urls']

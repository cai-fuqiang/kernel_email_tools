"""Smoke tests for app route registration."""

from src.api.server import app


def test_tag_assignment_routes_are_registered():
    paths = {getattr(route, "path", "") for route in app.routes}

    assert "/api/tag-assignments" in paths
    assert "/api/tag-assignments/{assignment_id}" in paths

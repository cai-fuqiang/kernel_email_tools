"""Smoke tests for app route registration."""

from src.api.server import app


def test_tag_assignment_routes_are_registered():
    paths = {getattr(route, "path", "") for route in app.routes}

    assert "/api/tag-assignments" in paths
    assert "/api/tag-assignments/{assignment_id}" in paths


def test_annotation_relation_routes_are_registered_before_annotations_catchall():
    paths = [getattr(route, "path", "") for route in app.routes]

    assert "/api/annotations/{annotation_id}/relations" in paths
    assert "/api/annotation-relations/{relation_id}" in paths
    assert paths.index("/api/annotations/{annotation_id}/relations") < paths.index(
        "/api/annotations/{thread_id:path}"
    )

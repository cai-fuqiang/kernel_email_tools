"""Tests for kernel commit browser response enrichment."""

import asyncio

from src.api.routers import kernel


def test_parse_commit_patch_groups_lines_by_file_and_hunk():
    patch = """diff --git a/mm/mmap.c b/mm/mmap.c
index 1111111..2222222 100644
--- a/mm/mmap.c
+++ b/mm/mmap.c
@@ -10,2 +10,3 @@ static int demo(void)
 line_a
-line_b
+line_b2
+line_c
"""

    files = kernel._parse_commit_patch(patch, context_radius=3)

    assert len(files) == 1
    assert files[0]["path"] == "mm/mmap.c"
    assert files[0]["status"] == "modified"
    assert files[0]["hunks"][0]["header"] == "@@ -10,2 +10,3 @@ static int demo(void)"
    assert [line["kind"] for line in files[0]["hunks"][0]["lines"]] == ["context", "del", "add", "add"]
    assert files[0]["hunks"][0]["context_preview"]["focus_start_line"] == 11
    assert "line_b2" in files[0]["hunks"][0]["context_preview"]["snippet"]


def test_parse_commit_patch_marks_rename_and_binary_sections():
    patch = """diff --git a/old.c b/new.c
similarity index 98%
rename from old.c
rename to new.c
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
"""

    files = kernel._parse_commit_patch(patch, context_radius=3)

    assert files[0]["status"] == "renamed"
    assert files[0]["old_path"] == "old.c"
    assert files[0]["new_path"] == "new.c"
    assert files[1]["is_binary"] is True
    assert files[1]["hunks"] == []


def test_attach_hunk_targets_prefers_new_path_and_line():
    files = [{
        "path": "mm/mmap.c",
        "old_path": "mm/mmap.c",
        "new_path": "mm/mmap.c",
        "status": "modified",
        "added": "1",
        "deleted": "1",
        "is_binary": False,
        "truncated": False,
        "hunks": [{
            "header": "@@ -10,1 +20,1 @@",
            "old_start": 10,
            "old_count": 1,
            "new_start": 20,
            "new_count": 1,
            "lines": [],
            "context_preview": {"focus_start_line": 20, "focus_end_line": 20, "snippet": ""},
            "current_version_target": None,
            "nearest_tag_target": None,
        }],
    }]

    resolved = kernel._attach_hunk_targets(files, current_version="v6.6", nearest_tag_version="v6.5")

    hunk = resolved[0]["hunks"][0]
    assert hunk["current_version_target"] == {
        "available": True,
        "version": "v6.6",
        "path": "mm/mmap.c",
        "line": 20,
        "reason": None,
    }
    assert hunk["nearest_tag_target"] == {
        "available": True,
        "version": "v6.5",
        "path": "mm/mmap.c",
        "line": 20,
        "reason": None,
    }


def test_attach_hunk_targets_marks_unavailable_when_no_path_can_open():
    files = [{
        "path": "",
        "old_path": "",
        "new_path": "",
        "status": "deleted",
        "added": "0",
        "deleted": "4",
        "is_binary": False,
        "truncated": False,
        "hunks": [{
            "header": "@@ -40,4 +0,0 @@",
            "old_start": 40,
            "old_count": 4,
            "new_start": 0,
            "new_count": 0,
            "lines": [],
            "context_preview": {"focus_start_line": 40, "focus_end_line": 43, "snippet": ""},
            "current_version_target": None,
            "nearest_tag_target": None,
        }],
    }]

    resolved = kernel._attach_hunk_targets(files, current_version="v6.6", nearest_tag_version=None)

    assert resolved[0]["hunks"][0]["nearest_tag_target"] == {
        "available": False,
        "version": "",
        "path": "",
        "line": 0,
        "reason": "No browsable tag mapping found",
    }


def test_kernel_commit_returns_structured_files_and_nearest_tag(monkeypatch):
    async def _fake_run_local_git(_source, *args, **_kwargs):
        if args[:3] == ("show", "--no-patch", "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%B"):
            return (
                "abcd1234abcd1234abcd1234abcd1234abcd1234"
                "\x1fabcd123\x1fAlice\x1falice@example.com\x1f2026-05-19T00:00:00+00:00"
                "\x1fSubject\x1fBody"
            )
        if args[:3] == ("show", "--numstat", "--format="):
            return "1\t1\tmm/mmap.c\n"
        if args[:4] == ("show", "--no-ext-diff", "--find-renames", "--format="):
            return """diff --git a/mm/mmap.c b/mm/mmap.c
index 1111111..2222222 100644
--- a/mm/mmap.c
+++ b/mm/mmap.c
@@ -10,1 +10,1 @@
-old
+new
"""
        if args[:2] == ("describe", "--tags"):
            return "v6.5\n"
        raise AssertionError(f"Unexpected git args: {args}")

    monkeypatch.setattr(kernel, "_local_git_source", lambda: object())
    monkeypatch.setattr(kernel, "_run_local_git", _fake_run_local_git)

    response = asyncio.run(kernel.kernel_commit(version="v6.6", commit_hash="abcd1234"))

    assert response["nearest_tag_version"] == "v6.5"
    assert response["patch"].startswith("diff --git")
    assert response["files"][0]["path"] == "mm/mmap.c"
    assert response["files"][0]["added"] == "1"
    assert response["files"][0]["hunks"][0]["lines"][0]["kind"] == "del"
    assert response["files"][0]["hunks"][0]["current_version_target"] == {
        "available": True,
        "version": "v6.6",
        "path": "mm/mmap.c",
        "line": 10,
        "reason": None,
    }
    assert response["files"][0]["hunks"][0]["nearest_tag_target"] == {
        "available": True,
        "version": "v6.5",
        "path": "mm/mmap.c",
        "line": 10,
        "reason": None,
    }

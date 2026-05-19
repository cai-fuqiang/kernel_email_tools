"""Tests for kernel commit browser response enrichment."""

import asyncio

from src.api.routers import kernel


def test_parse_commit_patch_builds_rows_with_inline_expanders():
    patch = """diff --git a/mm/mmap.c b/mm/mmap.c
index 1111111..2222222 100644
--- a/mm/mmap.c
+++ b/mm/mmap.c
@@ -10,4 +10,5 @@ static int demo(void)
line_a
line_b
-line_b
+line_b2
+line_c
line_d
"""

    files = kernel._parse_commit_patch(patch, context_radius=3, commit_hash="abcd1234")

    assert len(files) == 1
    assert files[0]["path"] == "mm/mmap.c"
    assert files[0]["status"] == "modified"
    hunk = files[0]["hunks"][0]

    assert hunk["header"] == "@@ -10,4 +10,5 @@ static int demo(void)"
    assert hunk["rows"][0] == {
        "type": "expander",
        "id": "mm/mmap.c:@@ -10,4 +10,5 @@ static int demo(void):up",
        "direction": "up",
        "hidden_count": 9,
        "step_size": 20,
        "old_start": 1,
        "old_end": 9,
        "new_start": 1,
        "new_end": 9,
        "expand_key": "abcd1234:mm/mmap.c:10:10:up",
    }
    assert [row["type"] for row in hunk["rows"][1:7]] == ["line", "line", "line", "line", "line", "line"]
    assert hunk["rows"][-1]["type"] == "expander"


def test_parse_commit_patch_preserves_line_numbers_inside_line_rows():
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

    files = kernel._parse_commit_patch(patch, context_radius=3, commit_hash="abcd1234")
    rows = files[0]["hunks"][0]["rows"]
    line_rows = [row for row in rows if row["type"] == "line"]

    assert line_rows == [
        {"type": "line", "kind": "context", "text": "line_a", "old_line": 10, "new_line": 10},
        {"type": "line", "kind": "del", "text": "-line_b", "old_line": 11, "new_line": None},
        {"type": "line", "kind": "add", "text": "+line_b2", "old_line": None, "new_line": 11},
        {"type": "line", "kind": "add", "text": "+line_c", "old_line": None, "new_line": 12},
    ]


def test_parse_commit_patch_marks_rename_and_binary_sections():
    patch = """diff --git a/old.c b/new.c
similarity index 98%
rename from old.c
rename to new.c
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
"""

    files = kernel._parse_commit_patch(patch, context_radius=3, commit_hash="abcd1234")

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
            "rows": [],
            "current_version_target": None,
            "nearest_tag_target": None,
        }],
    }]

    resolved = kernel._attach_hunk_targets(files, current_version="v6.6", nearest_tag_version="v6.5")

    file_entry = resolved[0]
    assert file_entry["current_version_target"] == {
        "available": True,
        "version": "v6.6",
        "path": "mm/mmap.c",
        "line": 20,
        "reason": None,
    }
    assert file_entry["nearest_tag_target"] == {
        "available": True,
        "version": "v6.5",
        "path": "mm/mmap.c",
        "line": 20,
        "reason": None,
    }

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
            "rows": [],
            "current_version_target": None,
            "nearest_tag_target": None,
        }],
    }]

    resolved = kernel._attach_hunk_targets(files, current_version="v6.6", nearest_tag_version=None)

    assert resolved[0]["current_version_target"] == {
        "available": False,
        "version": "",
        "path": "",
        "line": 0,
        "reason": "No navigable file target",
    }
    assert resolved[0]["nearest_tag_target"] == {
        "available": False,
        "version": "",
        "path": "",
        "line": 0,
        "reason": "No browsable tag mapping found",
    }
    assert resolved[0]["hunks"][0]["nearest_tag_target"] == {
        "available": False,
        "version": "",
        "path": "",
        "line": 0,
        "reason": "No browsable tag mapping found",
    }


def test_expand_commit_hunk_returns_inserted_rows_and_remaining_up_expander(monkeypatch):
    patch = """diff --git a/mm/mmap.c b/mm/mmap.c
index 1111111..2222222 100644
--- a/mm/mmap.c
+++ b/mm/mmap.c
@@ -30,2 +30,3 @@ static int demo(void)
 line_a
-line_b
+line_b2
+line_c
"""

    async def _fake_run_local_git(_source, *args, **_kwargs):
        if args[:4] == ("show", "--no-ext-diff", "--find-renames", "--format="):
            return patch
        if args[:2] == ("show", "abcd1234:mm/mmap.c"):
            return "\n".join([f"line_{index}" for index in range(1, 40)]) + "\n"
        raise AssertionError(args)

    monkeypatch.setattr(kernel, "_local_git_source", lambda: object())
    monkeypatch.setattr(kernel, "_run_local_git", _fake_run_local_git)

    response = asyncio.run(kernel.kernel_commit_patch_expand(
        payload=kernel.KernelCommitPatchExpandRequest(
            version="v6.6",
            commit_hash="abcd1234",
            file_path="mm/mmap.c",
            hunk_header="@@ -30,2 +30,3 @@ static int demo(void)",
            expander_id="mm/mmap.c:@@ -30,2 +30,3 @@ static int demo(void):up",
            direction="up",
        ),
    ))

    assert response["expander_id"].endswith(":up")
    assert response["remaining_expander"] == {
        "type": "expander",
        "id": "mm/mmap.c:@@ -30,2 +30,3 @@ static int demo(void):up",
        "direction": "up",
        "hidden_count": 9,
        "step_size": 20,
        "old_start": 1,
        "old_end": 9,
        "new_start": 1,
        "new_end": 9,
        "expand_key": "abcd1234:mm/mmap.c:30:30:up",
    }
    assert response["inserted_rows"][0] == {
        "type": "line",
        "kind": "context",
        "text": "line_10",
        "old_line": 10,
        "new_line": 10,
    }
    assert response["inserted_rows"][-1]["type"] == "line"


def test_expand_commit_hunk_returns_inserted_rows_and_remaining_down_expander(monkeypatch):
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

    async def _fake_run_local_git(_source, *args, **_kwargs):
        if args[:4] == ("show", "--no-ext-diff", "--find-renames", "--format="):
            return patch
        if args[:2] == ("show", "abcd1234:mm/mmap.c"):
            return "\n".join([f"line_{index}" for index in range(1, 40)]) + "\n"
        raise AssertionError(args)

    monkeypatch.setattr(kernel, "_local_git_source", lambda: object())
    monkeypatch.setattr(kernel, "_run_local_git", _fake_run_local_git)

    response = asyncio.run(kernel.kernel_commit_patch_expand(
        payload=kernel.KernelCommitPatchExpandRequest(
            version="v6.6",
            commit_hash="abcd1234",
            file_path="mm/mmap.c",
            hunk_header="@@ -10,2 +10,3 @@ static int demo(void)",
            expander_id="mm/mmap.c:@@ -10,2 +10,3 @@ static int demo(void):down",
            direction="down",
        ),
    ))

    assert response["expander_id"].endswith(":down")
    assert response["inserted_rows"][0]["type"] == "line"
    assert response["remaining_expander"] == {
        "type": "expander",
        "id": "mm/mmap.c:@@ -10,2 +10,3 @@ static int demo(void):down",
        "direction": "down",
        "hidden_count": 7,
        "step_size": 20,
        "old_start": 32,
        "old_end": None,
        "new_start": 33,
        "new_end": None,
        "expand_key": "abcd1234:mm/mmap.c:10:10:down",
    }


def test_expand_commit_hunk_uses_expand_key_when_hunk_headers_repeat(monkeypatch):
    patch = """diff --git a/mm/mmap.c b/mm/mmap.c
index 1111111..2222222 100644
--- a/mm/mmap.c
+++ b/mm/mmap.c
@@ -10,1 +10,1 @@ static int demo(void)
-line_10_old
+line_10_new
@@ -30,1 +30,1 @@ static int demo(void)
-line_30_old
+line_30_new
"""

    async def _fake_run_local_git(_source, *args, **_kwargs):
        if args[:4] == ("show", "--no-ext-diff", "--find-renames", "--format="):
            return patch
        if args[:2] == ("show", "abcd1234:mm/mmap.c"):
            return "\n".join([f"line_{index}" for index in range(1, 60)]) + "\n"
        raise AssertionError(args)

    monkeypatch.setattr(kernel, "_local_git_source", lambda: object())
    monkeypatch.setattr(kernel, "_run_local_git", _fake_run_local_git)

    response = asyncio.run(kernel.kernel_commit_patch_expand(
        payload=kernel.KernelCommitPatchExpandRequest(
            version="v6.6",
            commit_hash="abcd1234",
            file_path="mm/mmap.c",
            hunk_header="@@ -30,1 +30,1 @@ static int demo(void)",
            expander_id="abcd1234:mm/mmap.c:30:30:up",
            direction="up",
        ),
    ))

    assert response["hunk_header"] == "@@ -30,1 +30,1 @@ static int demo(void)"
    assert response["inserted_rows"][0] == {
        "type": "line",
        "kind": "context",
        "text": "line_11",
        "old_line": 11,
        "new_line": 11,
    }
    assert response["inserted_rows"][-1] == {
        "type": "line",
        "kind": "context",
        "text": "line_29",
        "old_line": 29,
        "new_line": 29,
    }
    assert response["remaining_expander"] is None


def test_attach_hunk_targets_uses_first_hunk_as_file_level_anchor():
    files = [{
        "path": "mm/mmap.c",
        "old_path": "mm/mmap.c",
        "new_path": "mm/mmap.c",
        "status": "modified",
        "added": "2",
        "deleted": "1",
        "is_binary": False,
        "truncated": False,
        "hunks": [
            {
                "header": "@@ -10,1 +10,1 @@",
                "old_start": 10,
                "old_count": 1,
                "new_start": 10,
                "new_count": 1,
                "rows": [],
                "current_version_target": None,
                "nearest_tag_target": None,
            },
            {
                "header": "@@ -23,1 +23,1 @@",
                "old_start": 23,
                "old_count": 1,
                "new_start": 23,
                "new_count": 1,
                "rows": [],
                "current_version_target": None,
                "nearest_tag_target": None,
            },
        ],
    }]

    resolved = kernel._attach_hunk_targets(files, current_version="v6.6", nearest_tag_version="v6.5")

    assert resolved[0]["current_version_target"]["line"] == 10
    assert resolved[0]["nearest_tag_target"]["line"] == 10


def test_kernel_commit_returns_rows_and_not_context_preview(monkeypatch):
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
    assert response["files"][0]["current_version_target"] == {
        "available": True,
        "version": "v6.6",
        "path": "mm/mmap.c",
        "line": 10,
        "reason": None,
    }
    assert response["files"][0]["nearest_tag_target"] == {
        "available": True,
        "version": "v6.5",
        "path": "mm/mmap.c",
        "line": 10,
        "reason": None,
    }
    hunk = response["files"][0]["hunks"][0]
    assert "rows" in hunk
    assert "context_preview" not in hunk
    assert hunk["rows"][0]["type"] in {"expander", "line"}
    assert hunk["current_version_target"] == {
        "available": True,
        "version": "v6.6",
        "path": "mm/mmap.c",
        "line": 10,
        "reason": None,
    }
    assert hunk["nearest_tag_target"] == {
        "available": True,
        "version": "v6.5",
        "path": "mm/mmap.c",
        "line": 10,
        "reason": None,
    }

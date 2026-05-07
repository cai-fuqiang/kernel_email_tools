"""Tests for translation router helpers."""

from src.api.routers import translations


def test_translation_job_to_response_defaults():
    response = translations._translation_job_to_response(
        {
            "job_id": "job:test",
            "thread_id": "thread:test",
            "status": "running",
            "total": 4,
            "completed": 1,
            "items": [
                {
                    "source_text": "hello",
                    "translated_text": "你好",
                    "message_id": "m1",
                    "cached": True,
                    "error": "",
                }
            ],
            "created_at": "2026-05-07T00:00:00",
            "updated_at": "2026-05-07T00:00:01",
        }
    )

    assert response.job_id == "job:test"
    assert response.progress_percent == 25
    assert response.items[0].cached is True


def test_thread_translation_paragraphs_skip_quotes_diff_and_signature():
    body = """Please translate this paragraph.

> quoted old reply
> should stay hidden

Signed-off-by: Someone <s@example.com>

diff --git a/foo.c b/foo.c
--- a/foo.c
+++ b/foo.c
@@ -1 +1 @@
-old
+new

This should be skipped after diff starts.
"""

    stripped = translations._strip_diff_and_signature(body)
    paragraphs = translations._parse_translatable_paragraphs(stripped)

    assert paragraphs == ["Please translate this paragraph."]

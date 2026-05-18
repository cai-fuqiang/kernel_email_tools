from src.storage.models import AnnotationCreate


def test_annotation_create_accepts_claim_and_link_types():
    data = AnnotationCreate(
        annotation_type="claim",
        body="mmap_lock is held on this path",
        target_type="symbol",
        target_ref="symbol:do_mmap",
    )
    assert data.annotation_type == "claim"


def test_annotation_create_preserves_legacy_annotation_types():
    code_annotation = AnnotationCreate(
        annotation_type="code",
        body="legacy code annotation",
        target_type="kernel_file",
        target_ref="v6.8:mm/mmap.c",
    )
    email_annotation = AnnotationCreate(
        annotation_type="email",
        body="legacy email annotation",
        target_type="email_thread",
        target_ref="thread:legacy",
    )

    assert code_annotation.annotation_type == "code"
    assert email_annotation.annotation_type == "email"


def test_annotation_create_defaults_to_email_for_legacy_callers():
    data = AnnotationCreate(
        body="backward compatible default",
        target_type="email_thread",
        target_ref="thread:legacy-default",
    )

    assert data.annotation_type == "email"


def test_annotation_create_allows_short_label_only_for_link_annotations():
    data = AnnotationCreate(
        annotation_type="link",
        body="",
        short_label="Fix commit",
        target_type="commit",
        target_ref="commit:deadbeef",
    )
    assert data.short_label == "Fix commit"


def test_annotation_create_requires_meaningful_content():
    try:
        AnnotationCreate(
            annotation_type="link",
            body="",
            short_label="",
            target_type="commit",
            target_ref="commit:deadbeef",
            meta={},
        )
    except Exception as exc:
        assert "short_label" in str(exc) or "body" in str(exc)
    else:
        raise AssertionError("expected validation failure")


def test_annotation_create_exposes_phase2_annotation_defaults():
    data = AnnotationCreate(
        annotation_type="note",
        body="note body",
        target_type="symbol",
        target_ref="symbol:do_mmap",
    )
    assert data.short_label == ""
    assert data.pinned is False
    assert data.related_targets == []

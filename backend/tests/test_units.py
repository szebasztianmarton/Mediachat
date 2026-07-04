import time

from app.bots.telegram_bot import _truncate_bytes
from app.services.ranking import rank_local_results
from app.services.ratelimit import RateLimiter
from app.services.search import SearchService
from app.services.session import hash_password, verify_password


def test_rate_limiter_allows_up_to_max():
    limiter = RateLimiter(max_requests=3, window_seconds=60.0)
    assert limiter.allow("k")
    assert limiter.allow("k")
    assert limiter.allow("k")
    assert not limiter.allow("k")
    # Másik kulcsot nem érint
    assert limiter.allow("masik")


def test_rate_limiter_window_expiry():
    limiter = RateLimiter(max_requests=1, window_seconds=0.05)
    assert limiter.allow("k")
    assert not limiter.allow("k")
    time.sleep(0.06)
    assert limiter.allow("k")


def test_password_hash_roundtrip():
    stored = hash_password("titkos-jelszo")
    assert stored.startswith("pbkdf2_sha256$")
    assert verify_password("titkos-jelszo", stored)
    assert not verify_password("rossz", stored)
    assert not verify_password("titkos-jelszo", "hibás-formátum")


def test_looks_like_description():
    assert not SearchService._looks_like_description("Eredet")
    assert SearchService._looks_like_description("olyan film mint a Mátrix")
    assert SearchService._looks_like_description(
        "űrhajós film ahol a főhős egyedül marad a Marson és krumplit termeszt"
    )


def test_rank_local_results_does_not_mutate_input():
    items = [
        {"match_score": 0.2, "title": "b"},
        {"match_score": 0.9, "title": "a"},
    ]
    original_order = [row["title"] for row in items]
    ranked = rank_local_results(items, "a", limit=10)
    assert [row["title"] for row in items] == original_order  # bemenet érintetlen
    assert ranked[0]["title"] == "a"
    assert ranked[0]["suggested"] is True
    assert ranked[1]["suggested"] is False


def test_truncate_bytes_utf8_safe():
    # Ékezetes cím: bájtra vágva sem törhet szét multi-byte karaktert
    title = "Árvíztűrő tükörfúrógép" * 3
    truncated = _truncate_bytes(title, 30)
    assert len(truncated.encode("utf-8")) <= 30
    truncated.encode("utf-8").decode("utf-8")  # nem dob hibát
    assert _truncate_bytes("abc", 0) == ""

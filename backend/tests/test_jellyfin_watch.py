"""A Jellyfin-alapú nézettség (stale-media + folytatás) egységtesztjei.

A hálózati hívásokat monkeypatch-eljük — a lényeg az aggregáló/kategorizáló
logika, nem a HTTP-réteg."""

import asyncio
from datetime import UTC, datetime, timedelta

from app.services.jellyfin import JellyfinClient, _parse_jellyfin_dt, _provider_id
from app.services.storage import StorageService


def test_parse_jellyfin_dt_seven_digit_fraction():
    # Jellyfin 7 jegyű tört-másodperceit a fromisoformat magától nem eszi meg.
    dt = _parse_jellyfin_dt("2024-01-15T20:30:00.0000000Z")
    assert dt is not None
    assert dt.tzinfo is not None
    assert (dt.year, dt.month, dt.day, dt.hour) == (2024, 1, 15, 20)


def test_parse_jellyfin_dt_invalid_and_empty():
    assert _parse_jellyfin_dt(None) is None
    assert _parse_jellyfin_dt("") is None
    assert _parse_jellyfin_dt("nem-datum") is None


def test_provider_id_case_insensitive_and_typed():
    assert _provider_id({"Tmdb": "603"}, "Tmdb") == 603
    assert _provider_id({"tmdb": 603}, "Tmdb") == 603  # kisbetűs kulcs is
    assert _provider_id({"Tvdb": "abc"}, "Tvdb") is None  # nem szám
    assert _provider_id({}, "Tmdb") is None
    assert _provider_id(None, "Tmdb") is None


def test_last_watched_map_aggregates_latest_across_users(monkeypatch):
    client = JellyfinClient()
    client.base_url, client.api_key = "http://jf.test", "key"

    async def fake_users():
        return [{"Id": "u1"}, {"Id": "u2"}]

    # u1 nézte a filmet régen, u2 nézte frissebben — a MAX kell nyerjen.
    per_user = {
        "u1": [
            {"Type": "Movie", "ProviderIds": {"Tmdb": "10"},
             "UserData": {"LastPlayedDate": "2024-01-01T10:00:00Z"}},
            {"Type": "Series", "ProviderIds": {"Tvdb": "20"},
             "UserData": {"LastPlayedDate": "2024-02-01T10:00:00Z"}},
        ],
        "u2": [
            {"Type": "Movie", "ProviderIds": {"Tmdb": "10"},
             "UserData": {"LastPlayedDate": "2024-06-01T10:00:00Z"}},
            # provider id nélküli elem — kimarad
            {"Type": "Movie", "ProviderIds": {},
             "UserData": {"LastPlayedDate": "2024-06-01T10:00:00Z"}},
        ],
    }

    monkeypatch.setattr(client, "list_users", fake_users)

    async def fake_playdata(uid):
        return per_user[uid]

    monkeypatch.setattr(client, "_user_library_playdata", fake_playdata)

    result = asyncio.run(client.last_watched_map())
    assert result[("movie", 10)] == datetime(2024, 6, 1, 10, tzinfo=UTC)
    assert result[("series", 20)] == datetime(2024, 2, 1, 10, tzinfo=UTC)
    # A provider id nélküli elem nem kerülhetett be
    assert len(result) == 2


def test_continue_watching_dedupes_and_resolves_series(monkeypatch):
    client = JellyfinClient()
    client.base_url, client.api_key = "http://jf.test", "key"

    async def fake_users():
        return [{"Id": "u1"}]

    async def fake_resume(uid):
        return [
            {"Type": "Movie", "Name": "Dűne", "ProductionYear": 2021,
             "ProviderIds": {"Tmdb": "438631"}, "RunTimeTicks": 1000,
             "UserData": {"PlaybackPositionTicks": 500}},  # 50%
            {"Type": "Episode", "SeriesName": "Alapítvány", "SeriesId": "s1",
             "RunTimeTicks": 1000, "UserData": {"PlaybackPositionTicks": 250}},  # 25%
        ]

    async def fake_series_providers(ids):
        assert ids == ["s1"]
        return {"s1": {"Tvdb": "12345"}}

    monkeypatch.setattr(client, "list_users", fake_users)
    monkeypatch.setattr(client, "_user_resume", fake_resume)
    monkeypatch.setattr(client, "_series_provider_ids", fake_series_providers)

    result = asyncio.run(client.continue_watching())
    # Legnagyobb haladás elöl → a film (50%) az első
    assert result[0]["media_type"] == "movie"
    assert result[0]["external_id"] == 438631
    assert result[0]["percent"] == 50
    series = next(r for r in result if r["media_type"] == "series")
    assert series["external_id"] == 12345  # a batch-ből feloldott TVDB
    assert series["title"] == "Alapítvány"


def _evaluate(**overrides):
    now = datetime(2024, 6, 1, tzinfo=UTC)
    cutoff = now - timedelta(days=30)
    base = dict(
        title="X",
        media_type="movie",
        arr_id=1,
        external_id=10,
        on_disk=True,
        last_download=now - timedelta(days=200),
        last_watched=None,
        have_watch_data=True,
        now=now,
        cutoff=cutoff,
    )
    base.update(overrides)
    return StorageService._evaluate_stale(**base)


def test_evaluate_stale_never_watched_on_disk_is_unwatched():
    item = _evaluate(last_watched=None)
    assert item is not None
    assert item["category"] == "unwatched"
    assert item["watch_status"] == "never_watched"


def test_evaluate_stale_recently_grabbed_gets_grace_period():
    # Lemezen van, sose nézték, DE frissen töltötték le → még ne legyen stale.
    now = datetime(2024, 6, 1, tzinfo=UTC)
    assert _evaluate(last_download=now - timedelta(days=2)) is None


def test_evaluate_stale_watched_recently_excluded():
    now = datetime(2024, 6, 1, tzinfo=UTC)
    assert _evaluate(last_watched=now - timedelta(days=3)) is None


def test_evaluate_stale_not_watched_recently_is_unwatched():
    now = datetime(2024, 6, 1, tzinfo=UTC)
    item = _evaluate(last_watched=now - timedelta(days=90))
    assert item is not None
    assert item["watch_status"] == "not_watched_recently"
    assert item["watch_days_idle"] == 90


def test_evaluate_stale_not_on_disk_excluded_with_watch_data():
    assert _evaluate(on_disk=False, last_watched=None) is None


def test_evaluate_stale_without_jellyfin_falls_back_to_download_date():
    now = datetime(2024, 6, 1, tzinfo=UTC)
    # Nincs nézettségi adat → a régi letöltés-alapú viselkedés
    item = _evaluate(have_watch_data=False, last_download=now - timedelta(days=200))
    assert item is not None
    assert item["category"] == "stale_download"
    assert item["watch_status"] == "no_data"
    # Friss letöltés nézettségi adat nélkül → nem stale
    assert _evaluate(have_watch_data=False, last_download=now - timedelta(days=5)) is None

"""A magyar (lokalizált) cím-felismerés javítására írt tesztek: a fallback
cím-tisztítás (Ollama nélkül) és a search_by_title párhuzamos variáns-kezelése."""

import asyncio

import pytest

from app.models import SearchResult
from app.services.ollama import OllamaClient
from app.services.search import SearchService


def test_fallback_title_strips_command_and_quality_words():
    client = OllamaClient()
    result = client._fallback_title("Add hozzá a Mesterséges kegyelem 1080p felbontásba")
    assert result["title"] == "Mesterséges kegyelem"
    assert result["title_en"] == "Mesterséges kegyelem"  # fordítás nélkül ugyanaz
    assert result["media_type_hint"] is None


def test_fallback_title_detects_series_hint():
    client = OllamaClient()
    result = client._fallback_title("keresd meg a Breaking Bad sorozatot")
    assert result["media_type_hint"] == "series"


def test_fallback_title_handles_empty_after_stripping():
    client = OllamaClient()
    # Ha minden szó parancsszó, a nyers üzenetre esik vissza (nem ürül ki)
    result = client._fallback_title("add hozzá")
    assert result["title"]


def test_resolve_title_uses_fallback_when_unconfigured():
    client = OllamaClient()
    assert not client.configured  # a teszt-env-ben nincs OLLAMA_BASE_URL
    result = asyncio.run(client.resolve_title("Add hozzá a Mesterséges kegyelem 1080p felbontásba"))
    assert result["title"] == "Mesterséges kegyelem"


def test_search_by_title_raises_when_nothing_configured():
    from app.services.cache import CacheService

    service = SearchService(CacheService())
    # Más tesztek (config-mentés) a folyamat-szintű `settings` singletont
    # módosíthatják — ne arra támaszkodjunk, hanem a service saját
    # kliens-példányait állítsuk kifejezetten "nincs konfigurálva" állapotba.
    service.sonarr.base_url = ""
    service.sonarr.api_key = ""
    service.radarr.base_url = ""
    service.radarr.api_key = ""
    service.tmdb.api_key = ""
    with pytest.raises(ValueError):
        asyncio.run(service.search_by_title("Mesterséges kegyelem", "Artificial Grace"))


def test_search_by_title_dedupes_identical_variants():
    """Ha a fordítás megegyezik az eredetivel, csak EGY variánst keresünk —
    ne fusson feleslegesen kétszer ugyanaz a Sonarr/Radarr lekérdezés."""
    from app.services.cache import CacheService

    service = SearchService(CacheService())
    calls: list[str] = []

    async def fake_title_search(query):
        calls.append(query)
        return [], None

    service._title_search = fake_title_search  # type: ignore[method-assign]
    # Sem Sonarr/Radarr, sem TMDB nincs konfigurálva a teszt-env-ben, de a
    # _title_search-t lecseréltük — a configured-guardot kerüljük meg közvetlen
    # hívással a service belső metódusán:
    service.sonarr.api_key = "x"  # configured=True trigger a guard átugrásához
    service.sonarr.base_url = "http://sonarr.test"

    asyncio.run(service.search_by_title("Ugyanaz a cím", "Ugyanaz a cím"))
    assert calls == ["Ugyanaz a cím"]  # nem duplán


def test_search_by_title_tries_both_variants_when_different():
    from app.services.cache import CacheService

    service = SearchService(CacheService())
    calls: list[str] = []

    async def fake_title_search(query):
        calls.append(query)
        return [], None

    service._title_search = fake_title_search  # type: ignore[method-assign]
    service.sonarr.api_key = "x"
    service.sonarr.base_url = "http://sonarr.test"

    asyncio.run(service.search_by_title("Mesterséges kegyelem", "Artificial Grace"))
    assert set(calls) == {"Mesterséges kegyelem", "Artificial Grace"}


def test_search_by_title_mode_is_translated_when_only_translation_matches():
    """Ha az LLM félrefordít (pl. 'Mesterséges kegyelem' -> 'Artificial
    Intelligence'), és a fordítás-jelöltre a könyvtárban véletlenül létezik
    egy teljesen független, pontos egyezés, a search_by_title-nek
    'translated' módot kell visszaadnia — ez jelzi a hívónak, hogy NE
    adja hozzá automatikusan, mert a találat nem az eredeti (felhasználó
    által írt) kifejezésből jött."""
    from app.services.cache import CacheService

    service = SearchService(CacheService())

    async def fake_title_search(query):
        if query == "Artificial Intelligence":
            return (
                [
                    SearchResult(
                        result_id="local-1",
                        title="Artificial Intelligence",
                        year=2016,
                        media_type="movie",
                        external_id=1,
                        match_score=1.0,
                        lookup_source="local",
                    )
                ],
                "movie",
            )
        return [], None

    service._title_search = fake_title_search  # type: ignore[method-assign]
    service.sonarr.api_key = "x"
    service.sonarr.base_url = "http://sonarr.test"

    results, suggested_type, mode = asyncio.run(
        service.search_by_title("Mesterséges kegyelem", "Artificial Intelligence")
    )
    assert mode == "translated"
    assert results[0].title == "Artificial Intelligence"


def test_search_by_title_mode_is_title_when_original_matches_strongly():
    """Ha maga az EREDETI kifejezés is erős találatot ad, biztonságos az
    auto-hozzáadás — 'title' módot kell visszakapni, még akkor is, ha a
    fordítás-jelölt egy másik (gyengébb) találatot is hozott."""
    from app.services.cache import CacheService

    service = SearchService(CacheService())

    async def fake_title_search(query):
        if query == "Breaking Bad":
            return (
                [
                    SearchResult(
                        result_id="local-2",
                        title="Breaking Bad",
                        year=2008,
                        media_type="series",
                        external_id=2,
                        match_score=1.0,
                        lookup_source="local",
                    )
                ],
                "series",
            )
        return [], None

    service._title_search = fake_title_search  # type: ignore[method-assign]
    service.sonarr.api_key = "x"
    service.sonarr.base_url = "http://sonarr.test"

    results, suggested_type, mode = asyncio.run(
        service.search_by_title("Breaking Bad", "Breaking Bad")
    )
    assert mode == "title"
    assert results[0].title == "Breaking Bad"

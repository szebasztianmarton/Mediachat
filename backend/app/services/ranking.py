from difflib import SequenceMatcher
from typing import Any, Literal

from app.services.tmdb import TmdbClient


def title_score(query_terms: list[str], title: str) -> float:
    title_lower = title.lower()
    if not query_terms:
        return 0.0
    scores = []
    for term in query_terms:
        if term.lower() in title_lower:
            scores.append(1.0)
        else:
            scores.append(SequenceMatcher(None, term.lower(), title_lower).ratio())
    return sum(scores) / len(scores)


def rank_tmdb_results(
    items: list[dict[str, Any]],
    intent: dict[str, Any],
    limit: int = 10,
) -> list[dict[str, Any]]:
    query_terms = intent.get("search_terms") or []
    genres = [g.lower() for g in intent.get("genres") or []]
    actors = [a.lower() for a in intent.get("actors") or []]
    target_year = intent.get("year")
    media_hint = intent.get("media_type_hint")
    mood = intent.get("mood") or ""

    ranked: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item in items:
        media_type = TmdbClient.media_type(item)
        if media_type is None:
            continue
        tmdb_id = item.get("id")
        if not tmdb_id:
            continue
        dedupe_key = f"{media_type}:{tmdb_id}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        title = TmdbClient.title(item)
        overview = item.get("overview") or ""
        year = TmdbClient.year(item)
        score = 0.0

        score += title_score(query_terms, title) * 0.35
        if target_year and year:
            diff = abs(int(target_year) - int(year))
            score += max(0.0, 1.0 - diff / 20.0) * 0.15

        popularity = float(item.get("popularity") or 0.0)
        score += min(popularity / 100.0, 1.0) * 0.1

        vote = float(item.get("vote_average") or 0.0)
        score += (vote / 10.0) * 0.1

        overview_lower = overview.lower()
        item_genre_names = [g.get("name", "").lower() for g in (item.get("genres") or [])]
        item_genre_ids = {str(g) for g in (item.get("genre_ids") or [])}
        if mood and mood in overview_lower:
            score += 0.08
        if genres and any(g in item_genre_names or g in item_genre_ids for g in genres):
            score += 0.08
        if actors and any(actor in overview_lower for actor in actors):
            score += 0.08

        if media_hint and media_type == media_hint:
            score += 0.06

        ranked.append(
            {
                "result_id": dedupe_key,
                "title": title,
                "year": year,
                "overview": overview,
                "poster_url": TmdbClient.poster_url(item),
                "media_type": media_type,
                "external_id": tmdb_id,
                "title_slug": None,
                "match_score": round(min(score, 1.0), 3),
                "tmdb_id": tmdb_id,
                "raw_tmdb": item,
            }
        )

    ranked.sort(key=lambda row: row["match_score"], reverse=True)
    for index, row in enumerate(ranked[:limit]):
        row["suggested"] = index == 0
    return ranked[:limit]


def rank_local_results(items: list[dict[str, Any]], query: str, limit: int = 10) -> list[dict[str, Any]]:
    ranked = sorted(items, key=lambda row: row["match_score"], reverse=True)[:limit]
    for index, row in enumerate(ranked):
        row["suggested"] = index == 0
    return ranked

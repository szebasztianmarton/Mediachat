from typing import Any, Literal

import httpx

from app.config import settings


class TmdbError(Exception):
    pass


class TmdbClient:
    IMAGE_BASE = "https://image.tmdb.org/t/p/w500"

    def __init__(self) -> None:
        self.api_key = settings.tmdb_api_key
        self.language = settings.tmdb_language

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def search_multi(self, query: str, page: int = 1) -> list[dict[str, Any]]:
        data = await self._get(
            "/search/multi",
            {"query": query, "include_adult": "false", "page": page},
        )
        return data.get("results") or []

    async def search_movies(self, query: str, page: int = 1) -> list[dict[str, Any]]:
        data = await self._get("/search/movie", {"query": query, "page": page})
        return data.get("results") or []

    async def search_tv(self, query: str, page: int = 1) -> list[dict[str, Any]]:
        data = await self._get("/search/tv", {"query": query, "page": page})
        return data.get("results") or []

    async def discover_movies(self, **params: Any) -> list[dict[str, Any]]:
        data = await self._get("/discover/movie", params)
        return data.get("results") or []

    async def discover_tv(self, **params: Any) -> list[dict[str, Any]]:
        data = await self._get("/discover/tv", params)
        return data.get("results") or []

    async def similar_movies(self, tmdb_id: int) -> list[dict[str, Any]]:
        data = await self._get(f"/movie/{tmdb_id}/similar")
        return data.get("results") or []

    async def similar_tv(self, tmdb_id: int) -> list[dict[str, Any]]:
        data = await self._get(f"/tv/{tmdb_id}/similar")
        return data.get("results") or []

    async def movie_details(self, tmdb_id: int) -> dict[str, Any]:
        return await self._get(f"/movie/{tmdb_id}", {"append_to_response": "credits"})

    async def tv_details(self, tmdb_id: int) -> dict[str, Any]:
        return await self._get(f"/tv/{tmdb_id}", {"append_to_response": "credits,external_ids"})

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.configured:
            raise TmdbError("TMDb API key is not configured.")
        query = {"api_key": self.api_key, "language": self.language, **(params or {})}
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"https://api.themoviedb.org/3{path}", params=query)
            if response.status_code >= 400:
                raise TmdbError(f"TMDb request failed: {response.status_code}")
            return response.json()

    @staticmethod
    def poster_url(item: dict[str, Any]) -> str | None:
        path = item.get("poster_path")
        return f"{TmdbClient.IMAGE_BASE}{path}" if path else None

    @staticmethod
    def media_type(item: dict[str, Any]) -> Literal["movie", "series"] | None:
        media_type = item.get("media_type")
        if media_type == "movie":
            return "movie"
        if media_type in {"tv", "series"}:
            return "series"
        if item.get("title"):
            return "movie"
        if item.get("name"):
            return "series"
        return None

    @staticmethod
    def title(item: dict[str, Any]) -> str:
        return item.get("title") or item.get("name") or "Ismeretlen"

    @staticmethod
    def year(item: dict[str, Any]) -> int | None:
        date = item.get("release_date") or item.get("first_air_date") or ""
        if len(date) >= 4 and date[:4].isdigit():
            return int(date[:4])
        return None

    @staticmethod
    def external_id(item: dict[str, Any]) -> int | None:
        return item.get("id")

from typing import Any

import httpx

from app.config import settings
from app.services.sonarr import _match_score, _poster_url


class RadarrError(Exception):
    pass


class RadarrClient:
    def __init__(self) -> None:
        self.base_url = settings.radarr_url.rstrip("/")
        self.api_key = settings.radarr_api_key

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _headers(self) -> dict[str, str]:
        return {"X-Api-Key": self.api_key}

    async def ping(self) -> tuple[bool, str | None]:
        if not self.configured:
            return False, "Nincs konfigurálva (URL vagy API kulcs hiányzik)"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(
                    f"{self.base_url}/api/v3/system/status",
                    headers=self._headers(),
                )
                if r.status_code == 200:
                    return True, None
                return False, f"HTTP {r.status_code}"
        except httpx.ConnectError:
            return False, "Kapcsolódási hiba"
        except httpx.TimeoutException:
            return False, "Időtúllépés (10 s)"
        except httpx.HTTPError as exc:
            return False, str(exc)

    async def lookup(self, term: str) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/movie/lookup",
                headers=self._headers(),
                params={"term": term},
            )
            if response.status_code >= 400:
                raise RadarrError(f"Radarr lookup failed: {response.status_code} {response.text}")
            return response.json()

    async def lookup_by_tmdb(self, tmdb_id: int) -> dict[str, Any] | None:
        if not self.configured:
            return None
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/movie/lookup/tmdb",
                headers=self._headers(),
                params={"tmdbId": tmdb_id},
            )
            if response.status_code >= 400:
                raise RadarrError(f"Radarr TMDb lookup failed: {response.status_code} {response.text}")
            data = response.json()
            if isinstance(data, list):
                return data[0] if data else None
            return data

    async def list_movies(self) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/movie",
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def get_history(self, page_size: int = 200) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/history",
                headers=self._headers(),
                params={"pageSize": page_size, "sortKey": "date", "sortDirection": "descending"},
            )
            response.raise_for_status()
            return response.json().get("records") or []

    async def get_diskspace(self) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(f"{self.base_url}/api/v3/diskspace", headers=self._headers())
            response.raise_for_status()
            return response.json()

    async def get_calendar(self, start: str, end: str) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/calendar",
                headers=self._headers(),
                params={"start": start, "end": end},
            )
            response.raise_for_status()
            return response.json()

    async def get_movie(self, movie_id: int) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/movie/{movie_id}",
                headers=self._headers(),
            )
            if response.status_code >= 400:
                raise RadarrError(f"Radarr get movie failed: {response.status_code} {response.text}")
            return response.json()

    async def update_movie(self, movie: dict[str, Any]) -> None:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.put(
                f"{self.base_url}/api/v3/movie/{movie['id']}",
                headers=self._headers(),
                json=movie,
            )
            if response.status_code >= 400:
                raise RadarrError(f"Radarr update failed: {response.status_code} {response.text}")

    async def delete_movie(self, movie_id: int, delete_files: bool = False) -> None:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                f"{self.base_url}/api/v3/movie/{movie_id}",
                headers=self._headers(),
                params={"deleteFiles": str(delete_files).lower()},
            )
            if response.status_code >= 400:
                raise RadarrError(f"Radarr delete failed: {response.status_code} {response.text}")

    async def get_root_folder(self) -> str:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/rootfolder",
                headers=self._headers(),
            )
            response.raise_for_status()
            folders = response.json()
            if not folders:
                raise RadarrError("No Radarr root folder configured.")
            return folders[0]["path"]

    async def get_quality_profile_id(self) -> int:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/qualityprofile",
                headers=self._headers(),
            )
            response.raise_for_status()
            profiles = response.json()
            if not profiles:
                raise RadarrError("No Radarr quality profiles found.")
            return profiles[0]["id"]

    async def add_movie(self, lookup_item: dict[str, Any]) -> dict[str, Any]:
        root_folder = await self.get_root_folder()
        quality_profile_id = await self.get_quality_profile_id()

        payload = {
            **lookup_item,
            "rootFolderPath": root_folder,
            "qualityProfileId": quality_profile_id,
            "monitored": True,
            "minimumAvailability": "released",
            "addOptions": {
                "searchForMovie": True,
            },
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.base_url}/api/v3/movie",
                headers=self._headers(),
                json=payload,
            )
            if response.status_code >= 400:
                raise RadarrError(f"Radarr add failed: {response.status_code} {response.text}")
            return response.json()

    def to_search_results(self, query: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for item in items[:10]:
            title = item.get("title") or ""
            tmdb_id = item.get("tmdbId")
            if not tmdb_id:
                continue
            year = item.get("year")
            score = _match_score(query, title)
            results.append(
                {
                    "result_id": f"movie-{tmdb_id}",
                    "title": title,
                    "year": year,
                    "overview": item.get("overview") or "",
                    "poster_url": _poster_url(item),
                    "media_type": "movie",
                    "external_id": tmdb_id,
                    "title_slug": item.get("titleSlug"),
                    "match_score": score,
                    "tmdb_id": tmdb_id,
                    "lookup_source": "local",
                    "raw": item,
                }
            )
        return results

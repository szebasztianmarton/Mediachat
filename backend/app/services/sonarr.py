from difflib import SequenceMatcher
from typing import Any

import httpx

from app.config import settings


class SonarrError(Exception):
    pass


def _match_score(query: str, title: str) -> float:
    return SequenceMatcher(None, query.lower().strip(), title.lower().strip()).ratio()


def _poster_url(item: dict[str, Any]) -> str | None:
    for image in item.get("images") or []:
        if image.get("coverType") == "poster":
            url = image.get("remoteUrl") or image.get("url")
            if url:
                return url
    return None


class SonarrClient:
    def __init__(self) -> None:
        self.base_url = settings.sonarr_url.rstrip("/")
        self.api_key = settings.sonarr_api_key

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
                f"{self.base_url}/api/v3/series/lookup",
                headers=self._headers(),
                params={"term": term},
            )
            if response.status_code >= 400:
                raise SonarrError(f"Sonarr lookup failed: {response.status_code} {response.text}")
            return response.json()

    async def lookup_by_tvdb(self, tvdb_id: int) -> dict[str, Any] | None:
        items = await self.lookup(f"tvdb:{tvdb_id}")
        for item in items:
            if item.get("tvdbId") == tvdb_id:
                return item
        return None

    async def list_series(self) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/series",
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
                params={"start": start, "end": end, "includeSeries": "true"},
            )
            response.raise_for_status()
            return response.json()

    async def get_series(self, series_id: int) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/series/{series_id}",
                headers=self._headers(),
            )
            if response.status_code >= 400:
                raise SonarrError(f"Sonarr get series failed: {response.status_code} {response.text}")
            return response.json()

    async def update_series(self, series: dict[str, Any]) -> None:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.put(
                f"{self.base_url}/api/v3/series/{series['id']}",
                headers=self._headers(),
                json=series,
            )
            if response.status_code >= 400:
                raise SonarrError(f"Sonarr update failed: {response.status_code} {response.text}")

    async def delete_series(self, series_id: int, delete_files: bool = False) -> None:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                f"{self.base_url}/api/v3/series/{series_id}",
                headers=self._headers(),
                params={"deleteFiles": str(delete_files).lower()},
            )
            if response.status_code >= 400:
                raise SonarrError(f"Sonarr delete failed: {response.status_code} {response.text}")

    async def get_root_folder(self) -> str:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/rootfolder",
                headers=self._headers(),
            )
            response.raise_for_status()
            folders = response.json()
            if not folders:
                raise SonarrError("No Sonarr root folder configured.")
            return folders[0]["path"]

    async def get_quality_profile_id(self) -> int:
        target = settings.max_series_quality.lower()
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/qualityprofile",
                headers=self._headers(),
            )
            response.raise_for_status()
            profiles = response.json()

        for profile in profiles:
            name = profile.get("name", "").lower()
            if target in name:
                return profile["id"]

        for profile in profiles:
            cutoff = profile.get("cutoff", {})
            cutoff_name = str(cutoff.get("name", "")).lower()
            if target.replace("p", "") in cutoff_name.replace("p", ""):
                return profile["id"]

        if profiles:
            return profiles[0]["id"]
        raise SonarrError("No Sonarr quality profiles found.")

    async def get_language_profile_id(self) -> int:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{self.base_url}/api/v3/languageprofile",
                headers=self._headers(),
            )
            if response.status_code == 404:
                return 1
            response.raise_for_status()
            profiles = response.json()
            if profiles:
                return profiles[0]["id"]
            return 1

    async def add_series(self, lookup_item: dict[str, Any]) -> dict[str, Any]:
        root_folder = await self.get_root_folder()
        quality_profile_id = await self.get_quality_profile_id()
        language_profile_id = await self.get_language_profile_id()

        payload = {
            **lookup_item,
            "rootFolderPath": root_folder,
            "qualityProfileId": quality_profile_id,
            "languageProfileId": language_profile_id,
            "monitored": True,
            "seasonFolder": True,
            "addOptions": {
                "searchForMissingEpisodes": True,
                "searchForCutoffUnmetEpisodes": False,
            },
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.base_url}/api/v3/series",
                headers=self._headers(),
                json=payload,
            )
            if response.status_code >= 400:
                raise SonarrError(f"Sonarr add failed: {response.status_code} {response.text}")
            return response.json()

    def to_search_results(self, query: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for item in items[:10]:
            title = item.get("title") or ""
            tvdb_id = item.get("tvdbId")
            if not tvdb_id:
                continue
            year = item.get("year")
            score = _match_score(query, title)
            results.append(
                {
                    "result_id": f"series-{tvdb_id}",
                    "title": title,
                    "year": year,
                    "overview": item.get("overview") or "",
                    "poster_url": _poster_url(item),
                    "media_type": "series",
                    "external_id": tvdb_id,
                    "title_slug": item.get("titleSlug"),
                    "match_score": score,
                    "tmdb_id": item.get("tmdbId"),
                    "lookup_source": "local",
                    "raw": item,
                }
            )
        return results

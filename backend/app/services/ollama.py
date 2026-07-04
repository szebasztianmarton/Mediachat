import json
import logging
import re
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class OllamaError(Exception):
    pass


class OllamaClient:
    def __init__(self) -> None:
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model = settings.ollama_model

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.model)

    async def ping(self) -> tuple[bool, str | None]:
        """Kétlépéses ellenőrzés: /api/tags (gyors), fallback: /api/generate (funkcionális)."""
        if not self.configured:
            reason = "Nincs konfigurálva (OLLAMA_BASE_URL vagy OLLAMA_MODEL hiányzik)"
            logger.warning("Ollama ping FAIL — %s", reason)
            return False, reason

        # 1. lépés: gyors tag-lista lekérdezés (5 s)
        stage1_err: str | None = None
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{self.base_url}/api/tags")
                if r.status_code == 200:
                    logger.debug("Ollama ping OK via /api/tags")
                    return True, None
                stage1_err = f"/api/tags → HTTP {r.status_code}"
                logger.warning("Ollama /api/tags nem 200: %s", stage1_err)
        except httpx.ConnectError as exc:
            reason = f"Kapcsolódási hiba ({exc})"
            logger.warning("Ollama ping FAIL — %s", reason)
            return False, reason
        except httpx.TimeoutException:
            stage1_err = "/api/tags 5 s timeout"
            logger.warning("Ollama /api/tags timeout — fallback ellenőrzés indul")
        except httpx.HTTPError as exc:
            stage1_err = f"/api/tags hiba: {exc}"
            logger.warning("Ollama %s — fallback ellenőrzés indul", stage1_err)

        # 2. lépés: funkcionális próba — /api/generate (30 s)
        # Ha az Ollama modell épp tölt be, a /api/tags lassú lehet, de a chat
        # végül sikerül (180 s timeout). Ez a fallback ugyanazt ellenőrzi.
        logger.info("Ollama fallback ping: POST /api/generate (30 s timeout, num_predict=1)")
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": "ping",
                        "stream": False,
                        "options": {"num_predict": 1},
                    },
                )
                if r.status_code == 200:
                    logger.info(
                        "Ollama OK (fallback /api/generate) — /api/tags problémás volt: %s",
                        stage1_err,
                    )
                    return True, None
                reason = f"{stage1_err} + fallback /api/generate → HTTP {r.status_code}"
                logger.error("Ollama ping FAIL — %s", reason)
                return False, reason
        except httpx.TimeoutException:
            reason = f"{stage1_err}; fallback /api/generate 30 s timeout — modell valóban nem válaszol"
            logger.error("Ollama ping FAIL — %s", reason)
            return False, reason
        except httpx.HTTPError as exc:
            reason = f"{stage1_err}; fallback hiba: {exc}"
            logger.error("Ollama ping FAIL — %s", reason)
            return False, reason

    async def extract_search_intent(self, description: str) -> dict[str, Any]:
        if not self.configured:
            return self._fallback_extract(description)

        prompt = (
            "Extract structured search metadata from the user request about movies or TV series. "
            "Return ONLY valid JSON with keys: "
            "search_terms (array of strings), genres (array), mood (string), actors (array), "
            "year (number or null), language (string or null), media_type_hint (movie|series|null). "
            f"User request: {description}"
        )

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False,
                        "format": "json",
                    },
                )
                if response.status_code >= 400:
                    return self._fallback_extract(description)
                body = response.json()
                parsed = json.loads(body.get("response") or "{}")
                return self._normalize(parsed, description)
        except (httpx.HTTPError, json.JSONDecodeError, TypeError, ValueError):
            return self._fallback_extract(description)

    def _normalize(self, parsed: dict[str, Any], description: str) -> dict[str, Any]:
        search_terms = parsed.get("search_terms") or []
        if isinstance(search_terms, str):
            search_terms = [search_terms]
        if not search_terms:
            search_terms = [description.strip()]
        return {
            "search_terms": [str(term).strip() for term in search_terms if str(term).strip()],
            "genres": [str(g).lower() for g in (parsed.get("genres") or [])],
            "mood": str(parsed.get("mood") or "").lower(),
            "actors": [str(a).lower() for a in (parsed.get("actors") or [])],
            "year": parsed.get("year"),
            "language": (parsed.get("language") or "").lower() or None,
            "media_type_hint": parsed.get("media_type_hint"),
        }

    def _fallback_extract(self, description: str) -> dict[str, Any]:
        words = re.findall(r"[A-Za-zÀ-ÿ0-9']+", description.lower())
        stopwords = {
            "a", "az", "egy", "és", "vagy", "hogy", "van", "volt", "film", "sorozat",
            "keresek", "szeretnék", "mutass", "olyan", "mint", "about", "the", "and",
        }
        keywords = [word for word in words if word not in stopwords and len(word) > 2]
        year_match = re.search(r"\b(19|20)\d{2}\b", description)
        media_hint = None
        lower = description.lower()
        if any(token in lower for token in ("sorozat", "series", "season", "évad")):
            media_hint = "series"
        elif any(token in lower for token in ("film", "movie")):
            media_hint = "movie"
        return {
            "search_terms": keywords[:8] or [description.strip()],
            "genres": [],
            "mood": "",
            "actors": [],
            "year": int(year_match.group()) if year_match else None,
            "language": "hu" if any(ch in description for ch in "áéíóöőúüű") else None,
            "media_type_hint": media_hint,
        }

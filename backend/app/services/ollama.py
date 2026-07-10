import json
import logging
import re
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class OllamaError(Exception):
    pass


class OllamaTimeout(OllamaError):
    pass


class OllamaUnavailable(OllamaError):
    pass


# Meddig maradjon a modell a memóriában két kérés között (nincs hidegindítás).
KEEP_ALIVE = "30m"


class OllamaClient:
    def __init__(self) -> None:
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model = settings.ollama_model

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.model)

    def _chat_body(self, system_prompt: str, message: str, num_predict: int) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message},
            ],
            "stream": False,
            "keep_alive": KEEP_ALIVE,
            "options": {"num_predict": num_predict, "num_ctx": 4096, "temperature": 0.4},
        }
        # A gemma4 "thinking" modellek minden válasz elé hosszú belső érvelést
        # generálnak — ezeknél kikapcsoljuk. A nem thinking-modellek hibát adnának
        # a "think" paraméterre, ezért nekik nem küldjük.
        if "gemma4" in self.model.lower():
            body["think"] = False
        return body

    async def chat(
        self,
        message: str,
        system_prompt: str,
        num_predict: int = 400,
        timeout: float = 180.0,
    ) -> str:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(
                    f"{self.base_url}/api/chat",
                    json=self._chat_body(system_prompt, message, num_predict),
                )
        except httpx.TimeoutException as exc:
            raise OllamaTimeout(str(exc)) from exc
        except httpx.HTTPError as exc:
            raise OllamaUnavailable(str(exc)) from exc
        if res.status_code >= 400:
            logger.warning("Ollama chat hiba: %s %s", res.status_code, res.text[:300])
            raise OllamaError(f"HTTP {res.status_code}")
        body = res.json()
        content = (body.get("message") or {}).get("content") or ""
        return content.strip()

    async def chat_stream(
        self,
        message: str,
        system_prompt: str,
        num_predict: int = 400,
        timeout: float = 180.0,
    ):
        """Token-streamet ad vissza (async generátor) — SSE-hez."""
        body = self._chat_body(system_prompt, message, num_predict)
        body["stream"] = True
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", f"{self.base_url}/api/chat", json=body) as res:
                    if res.status_code >= 400:
                        raise OllamaError(f"HTTP {res.status_code}")
                    async for line in res.aiter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        chunk = (data.get("message") or {}).get("content") or ""
                        if chunk:
                            yield chunk
                        if data.get("done"):
                            return
        except httpx.TimeoutException as exc:
            raise OllamaTimeout(str(exc)) from exc
        except httpx.HTTPError as exc:
            raise OllamaUnavailable(str(exc)) from exc

    async def warmup(self) -> None:
        """Előmelegíti a modellt induláskor, hogy az első chat ne legyen lassú."""
        try:
            await self.chat("ping", "ping", num_predict=1, timeout=120.0)
            logger.info("Ollama modell előmelegítve: %s", self.model)
        except OllamaError as exc:
            logger.warning("Ollama előmelegítés sikertelen: %s", exc)

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

    async def list_models(self) -> list[str]:
        """A szerveren ténylegesen telepített modellek nevei (GET /api/tags)."""
        if not self.base_url:
            raise OllamaUnavailable("Nincs konfigurálva (OLLAMA_BASE_URL hiányzik)")
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{self.base_url}/api/tags")
        except httpx.ConnectError as exc:
            raise OllamaUnavailable(f"Kapcsolódási hiba ({exc})") from exc
        except httpx.TimeoutException as exc:
            raise OllamaTimeout("/api/tags 5 s timeout") from exc
        except httpx.HTTPError as exc:
            raise OllamaError(f"/api/tags hiba: {exc}") from exc
        if r.status_code != 200:
            raise OllamaError(f"/api/tags → HTTP {r.status_code}")
        body = r.json()
        return [m["name"] for m in body.get("models", []) if m.get("name")]

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

    async def resolve_title(self, message: str) -> dict[str, Any]:
        """Egyetlen célzott extrakció közvetlen cím/hozzáadás kérésekhez: a pontos
        cím (ahogy a user írta, parancs- és minőség-szavak nélkül) ÉS egy angol/
        eredeti nyelvű fordítás-jelölt. A Sonarr/Radarr/TMDB elsősorban angol vagy
        eredeti nyelvű címeket indexel — egy tisztán magyar cím önmagában
        (fordítás nélkül) gyakran nem ad találatot, még ha helyesen van is
        felismerve."""
        if not self.configured:
            return self._fallback_title(message)

        prompt = (
            "Extract the movie or TV series title from this user message, which may be "
            "in Hungarian or another language and may include extra command words "
            "(add/download/search) or quality specs (1080p, 4K, felbontás). "
            "Return ONLY valid JSON with keys: "
            "title (the exact title as written, original spelling/diacritics, WITHOUT the "
            "command or quality words), "
            "title_en (your best-guess English or original-language title of this specific "
            "work if you recognize it or can translate it; if unsure, repeat the same value "
            "as title), "
            "year (number or null), media_type_hint (movie|series|null). "
            f"User message: {message}"
        )
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json={"model": self.model, "prompt": prompt, "stream": False, "format": "json"},
                )
                if response.status_code >= 400:
                    return self._fallback_title(message)
                body = response.json()
                parsed = json.loads(body.get("response") or "{}")
        except (httpx.HTTPError, json.JSONDecodeError, TypeError, ValueError):
            return self._fallback_title(message)

        title = str(parsed.get("title") or "").strip() or message.strip()
        title_en = str(parsed.get("title_en") or "").strip() or title
        return {
            "title": title,
            "title_en": title_en,
            "year": parsed.get("year"),
            "media_type_hint": parsed.get("media_type_hint"),
        }

    def _fallback_title(self, message: str) -> dict[str, Any]:
        """Offline (Ollama nélküli) tisztítás: parancs- és minőség-szavak levágása
        reguláris kifejezéssel. Fordítást nem tud adni — csak a tisztított cím
        marad mindkét mezőben."""
        text = message
        strip_patterns = (
            r"\b(add|adj|tedd|rakd|vedd)\s+hozz[áa]\b", r"\bhozz[áa]add?\b",
            r"\blet[öo]lt(sd|s)?\b", r"\bt[öo]lts[dh]?\s+le\b",
            r"\bkeress?d?\s+meg\b", r"\bmutasd\s+(meg|a)\b",
            r"\bdownload\b", r"\bsearch\b", r"\bfind\b",
            r"\b\d{3,4}p\b", r"\b4k\b", r"felbont[áa]s(ba|ban|[úu])?",
        )
        for pat in strip_patterns:
            text = re.sub(pat, " ", text, flags=re.IGNORECASE)
        title = re.sub(r"\s+", " ", text).strip(" .,!?\"'")
        # A vezető magyar névelőt ("a"/"az X...") levágjuk — középen maradhat
        # (pl. "Frank és a Halálcsillag"), csak az elején zavaró.
        title = re.sub(r"^(a|az)\s+", "", title, flags=re.IGNORECASE).strip()
        if not title:
            title = message.strip()
        year_match = re.search(r"\b(19|20)\d{2}\b", message)
        media_hint = None
        lower = message.lower()
        if any(t in lower for t in ("sorozat", "series", "season", "évad")):
            media_hint = "series"
        elif any(t in lower for t in ("film", "movie")):
            media_hint = "movie"
        return {
            "title": title,
            "title_en": title,
            "year": int(year_match.group()) if year_match else None,
            "media_type_hint": media_hint,
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

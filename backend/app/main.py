import asyncio
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.database import get_db, init_db
from app.db.models import UserSession
from app.deps import get_optional_session, get_required_session
from app.models import (
    AddRequest,
    AddResponse,
    AgentChatRequest,
    AgentChatResponse,
    AgentMediaAdded,
    ChatRequest,
    ChatResponse,
    FeedbackRequest,
    HealthResponse,
    JobResponse,
    RecommendationResponse,
    SearchRequest,
    SearchResponse,
    SessionCreateRequest,
    SessionResponse,
    StaleActionRequest,
    StorageStatusResponse,
    TrainingFileContent,
    TrainingFileMeta,
    TrainingFilesResponse,
    TrainingSaveRequest,
)
from app.services.cache import CacheService
from app.services.queue import QueueService
from app.services.recommendations import RecommendationService
from app.services.search import SearchService
from app.services.session import SessionService
from app.services.storage import StorageService
from app.state import AppState, app_state

logger = logging.getLogger(__name__)

_NOT_READY = HTTPException(status_code=503, detail="A szerver még nem áll készen.")

# Meddig maradjon az Ollama modell a memóriában két kérés között (nincs hidegindítás).
OLLAMA_KEEP_ALIVE = "30m"


async def _warmup_ollama() -> None:
    """Előmelegíti az Ollama modellt induláskor, hogy az első chat ne legyen lassú."""
    url = f"{settings.ollama_base_url.rstrip('/')}/api/chat"
    body: dict = {
        "model": settings.ollama_model,
        "messages": [{"role": "user", "content": "ping"}],
        "stream": False,
        "keep_alive": OLLAMA_KEEP_ALIVE,
        "options": {"num_predict": 1},
    }
    if "gemma4" in settings.ollama_model.lower():
        body["think"] = False
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            await client.post(url, json=body)
        logger.info("Ollama modell előmelegítve: %s", settings.ollama_model)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Ollama előmelegítés sikertelen: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global app_state

    cache = CacheService()
    await cache.connect()
    search = SearchService(cache)
    queue = QueueService(search)
    recommendations = RecommendationService(search)
    storage = StorageService()
    session_service = SessionService()

    app_state = AppState(
        cache=cache,
        search=search,
        queue=queue,
        recommendations=recommendations,
        storage=storage,
        session=session_service,
    )

    await init_db()
    await queue.start()

    # Ollama modell előmelegítése háttérben (nem blokkolja az indulást).
    asyncio.create_task(_warmup_ollama())

    bot_tasks: list[asyncio.Task] = []
    if settings.telegram_enabled and settings.telegram_bot_token:
        from app.bots.telegram_bot import run_telegram_bot

        bot_tasks.append(asyncio.create_task(run_telegram_bot()))
    if settings.discord_enabled and settings.discord_bot_token:
        from app.bots.discord_bot import run_discord_bot

        bot_tasks.append(asyncio.create_task(run_discord_bot()))

    yield

    for task in bot_tasks:
        task.cancel()
    await queue.stop()
    await cache.close()
    app_state = None


app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    if app_state is None:
        raise _NOT_READY
    checks = await app_state.search.health()
    healthy = checks["sonarr"] or checks["radarr"]
    if not healthy:
        logger.warning(
            "Health: degraded — Sonarr %s, Radarr %s",
            "OK" if checks["sonarr"] else f"FAIL ({checks.get('sonarr_error', '?')})",
            "OK" if checks["radarr"] else f"FAIL ({checks.get('radarr_error', '?')})",
        )
    return HealthResponse(
        status="ok" if healthy else "degraded",
        sonarr=checks["sonarr"],
        radarr=checks["radarr"],
        ollama=checks["ollama"],
        tmdb=checks["tmdb"],
        redis=app_state.cache.connected,
        sonarr_error=checks.get("sonarr_error"),
        radarr_error=checks.get("radarr_error"),
        ollama_error=checks.get("ollama_error"),
    )


@app.post("/api/session", response_model=SessionResponse)
async def create_session(
    payload: SessionCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    if app_state is None:
        raise _NOT_READY
    user, session = await app_state.session.create_session(
        db,
        display_name=payload.display_name,
        platform=payload.platform,
    )
    return SessionResponse(
        session_token=session.token,
        user_id=user.id,
        display_name=user.display_name,
    )


@app.post("/api/search", response_model=SearchResponse)
async def search_media(payload: SearchRequest) -> SearchResponse:
    if app_state is None:
        raise _NOT_READY
    try:
        results, suggested_type, search_mode = await app_state.search.search(payload.query, payload.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return SearchResponse(
        query=payload.query.strip(),
        suggested_type=suggested_type,
        search_mode=search_mode,  # type: ignore[arg-type]
        results=results,
    )


@app.post("/api/add", response_model=AddResponse)
async def add_media(
    payload: AddRequest,
    db: AsyncSession = Depends(get_db),
    session: UserSession | None = Depends(get_optional_session),
) -> AddResponse:
    if app_state is None:
        raise _NOT_READY

    if payload.async_job:
        if session is None:
            raise HTTPException(status_code=401, detail="Async hozzáadáshoz session szükséges.")
        job = await app_state.queue.enqueue_add(
            db,
            session.user_id,
            payload.media_type,
            payload.external_id,
            payload.title,
            tmdb_id=payload.tmdb_id,
        )
        return AddResponse(
            success=True,
            message="A hozzáadás sorba került.",
            media_type=payload.media_type,
            title=payload.title,
            job_id=job.id,
        )

    try:
        added_title, quality_note = await app_state.search.add(
            media_type=payload.media_type,
            external_id=payload.external_id,
            title=payload.title,
            tmdb_id=payload.tmdb_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if session is not None:
        await app_state.search.record_event(
            db,
            session.user_id,
            payload.media_type,
            payload.external_id,
            added_title,
            "added",
            tmdb_id=payload.tmdb_id,
        )

    arr = "Radarrhoz" if payload.media_type == "movie" else "Sonarrhoz"
    message = f"„{added_title}” hozzáadva {arr}."
    return AddResponse(
        success=True,
        message=message,
        media_type=payload.media_type,
        title=added_title,
        quality_note=quality_note,
    )


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str, db: AsyncSession = Depends(get_db)) -> JobResponse:
    if app_state is None:
        raise _NOT_READY
    job = await app_state.queue.get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="A feladat nem található.")
    return JobResponse(
        id=job.id,
        status=job.status,
        message=job.message,
        title=job.title,
        media_type=job.media_type,  # type: ignore[arg-type]
    )


@app.get("/api/recommendations/{catalog}", response_model=RecommendationResponse)
async def get_recommendations(
    catalog: str,
    session: UserSession = Depends(get_required_session),
    db: AsyncSession = Depends(get_db),
) -> RecommendationResponse:
    if app_state is None:
        raise _NOT_READY
    if catalog not in {"watched", "liked", "continue"}:
        raise HTTPException(status_code=400, detail="Ismeretlen katalógus.")
    items = await app_state.recommendations.get_catalog(
        db,
        session.user_id,
        catalog,  # type: ignore[arg-type]
    )
    return RecommendationResponse(catalog=catalog, items=items)  # type: ignore[arg-type]


@app.post("/api/feedback")
async def submit_feedback(
    payload: FeedbackRequest,
    session: UserSession = Depends(get_required_session),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    if app_state is None:
        raise _NOT_READY
    await app_state.recommendations.record_feedback(
        db,
        session.user_id,
        payload.media_type,
        payload.external_id,
        payload.title,
        payload.tmdb_id,
        payload.liked,
    )
    return {"success": True}


@app.get("/api/media/sessions")
async def media_sessions() -> dict:
    return {"sessions": []}


@app.get("/api/torrents")
async def torrents() -> dict:
    return {"torrents": []}


@app.get("/api/storage/status", response_model=StorageStatusResponse)
async def storage_status() -> StorageStatusResponse:
    if app_state is None:
        raise _NOT_READY
    data = app_state.storage.get_status()
    return StorageStatusResponse(**data)


@app.post("/api/storage/cleanup")
async def storage_cleanup() -> dict:
    if app_state is None:
        raise _NOT_READY
    cache_result = app_state.storage.cleanup_cache()
    deleted = await app_state.cache.delete_prefix("search:")
    return {"cache_files": cache_result, "search_cache_keys_deleted": deleted}


@app.get("/api/storage/stale")
async def storage_stale() -> dict:
    if app_state is None:
        raise _NOT_READY
    items = await app_state.storage.list_stale_media()
    return {"items": items, "days": settings.stale_media_days}


TRAINING_DIR = Path("./data/training")
_FILENAME_RE = re.compile(r"^[a-zA-Z0-9_\-]+\.(md)$")


def _safe_filename(name: str) -> bool:
    return bool(_FILENAME_RE.match(name)) and ".." not in name


def _load_training_context() -> str:
    if not TRAINING_DIR.exists():
        return ""
    parts: list[str] = []
    system_file = TRAINING_DIR / "_system.txt"
    if system_file.exists():
        parts.append(system_file.read_text(encoding="utf-8").strip())
    for md in sorted(TRAINING_DIR.glob("*.md")):
        text = md.read_text(encoding="utf-8").strip()
        if text:
            parts.append(f"### {md.stem}\n{text}")
    return "\n\n".join(parts)


# ── Intent detection ─────────────────────────────────────────────────────────

_ADD_KW = (
    "add ", "hozzáadd", "hozzáad", "letölts", "letöltsd", "töltsd le", "tölts le",
    "download", "rakd hozzá", "vedd fel", "adj hozzá", "tedd hozzá", "add hozzá",
    "akarom letölteni", "szeretném letölteni",
)
_SEARCH_KW = (
    "keressd", "keresd meg", "search ", "find ", "mutasd meg", "mutasd a",
)
_CHAT_KW = (
    "miért ", "hogyan ", "mi a különbség", "magyarázd", "mesélj ",
    "explain ", "tell me", "mi az a ", "mi az az ", "ki az a ",
)


def _detect_intent(msg: str) -> Literal["add", "search", "chat"]:
    lower = msg.lower()
    for kw in _ADD_KW:
        if kw in lower:
            return "add"
    for kw in _CHAT_KW:
        if kw in lower:
            return "chat"
    for kw in _SEARCH_KW:
        if kw in lower:
            return "search"
    if any(kw in lower for kw in ("film", "sorozat", "movie", "series", "évad", "season", "epizód")):
        return "search"
    if len(msg.split()) <= 6 and "?" not in msg:
        return "search"
    return "chat"


@app.post("/api/chat/agent", response_model=AgentChatResponse)
async def chat_agent(payload: AgentChatRequest) -> AgentChatResponse:
    if app_state is None:
        raise _NOT_READY

    intent = _detect_intent(payload.message)
    logger.info("Agent | intent=%s | msg=%r", intent, payload.message[:80])

    if intent in ("search", "add"):
        intent_data = await app_state.search.ollama.extract_search_intent(payload.message)
        query = " ".join(intent_data["search_terms"][:2]).strip() or payload.message.strip()
        logger.info("Agent | search query=%r", query)

        try:
            results, suggested_type, _ = await app_state.search.search(query, "auto")
        except (ValueError, RuntimeError) as exc:
            logger.warning("Agent | search failed: %s", exc)
            return AgentChatResponse(
                action="chat",
                message=f"Sajnos nem sikerült keresni: {exc}",
            )

        if not results:
            return AgentChatResponse(
                action="search",
                message=f'Nem találtam semmit erre: „{query}".',
                results=[],
            )

        if intent == "add":
            best = results[0]
            if best.match_score >= 0.45 or len(results) == 1:
                try:
                    added_title, quality_note = await app_state.search.add(
                        media_type=best.media_type,
                        external_id=best.external_id,
                        title=best.title,
                        tmdb_id=best.tmdb_id,
                    )
                    type_label = "sorozat" if best.media_type == "series" else "film"
                    logger.info("Agent | added %r (%s)", added_title, type_label)
                    return AgentChatResponse(
                        action="add",
                        message=f'„{added_title}" sikeresen hozzáadva! ({type_label})',
                        added=AgentMediaAdded(
                            title=added_title,
                            media_type=best.media_type,
                            quality_note=quality_note,
                        ),
                    )
                except ValueError as exc:
                    logger.warning("Agent | auto-add failed: %s", exc)
                    return AgentChatResponse(
                        action="search",
                        message=f'Megtaláltam, de nem sikerült hozzáadni: {exc}\n\nVálassz egyet manuálisan:',
                        results=results[:5],
                    )
            return AgentChatResponse(
                action="search",
                message="Több találat is van. Melyiket adjam hozzá?",
                results=results[:5],
            )

        type_label = {"movie": "film", "series": "sorozat"}.get(suggested_type or "", "tartalom")
        count = len(results)
        return AgentChatResponse(
            action="search",
            message=f'{count} találat. A legjobb találat egy {type_label}:',
            results=results[:5],
        )

    # intent == "chat" → Ollama szabad válasz
    training_ctx = _load_training_context()
    system_prompt = training_ctx if training_ctx else (
        "Te egy média asszisztens vagy. Segítesz filmeket és sorozatokat keresni és hozzáadni. "
        "Ha a felhasználó egy konkrét filmet vagy sorozatot említ, azt automatikusan meg tudom keresni és hozzáadni — "
        "csak írja be a nevét, és elvégzem a többit. Röviden és magyarul válaszolj."
    )
    ollama_url = settings.ollama_base_url.rstrip("/")
    request_body: dict = {
        "model": settings.ollama_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": payload.message},
        ],
        "stream": False,
        "keep_alive": OLLAMA_KEEP_ALIVE,
        "options": {"num_predict": 400, "num_ctx": 4096, "temperature": 0.4},
    }
    if "gemma4" in settings.ollama_model.lower():
        request_body["think"] = False

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            res = await client.post(f"{ollama_url}/api/chat", json=request_body)
            if res.status_code >= 400:
                return AgentChatResponse(
                    action="chat",
                    message="Az Ollama szerver hibát adott. Ellenőrizd a modell beállításokat.",
                )
            body = res.json()
            content = (body.get("message") or {}).get("content") or ""
            return AgentChatResponse(action="chat", message=content.strip() or "Üres válasz érkezett.")
    except httpx.TimeoutException:
        return AgentChatResponse(
            action="chat",
            message="Az Ollama túl lassan válaszolt. Próbálj rövidebb kérdést, vagy kisebb modellt.",
        )
    except httpx.HTTPError:
        return AgentChatResponse(
            action="chat",
            message="A chat nem érhető el. Ellenőrizd, hogy az Ollama fut-e.",
        )


@app.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    if app_state is None:
        raise _NOT_READY
    training_ctx = _load_training_context()
    system_prompt = training_ctx if training_ctx else (
        "Te egy média asszisztens vagy. Segítesz filmeket és sorozatokat keresni, "
        "hozzáadni Sonarrhoz és Radarrhoz, és válaszolsz a médiagyűjteménnyel kapcsolatos kérdésekre."
    )
    ollama_url = settings.ollama_base_url.rstrip("/")
    request_body: dict = {
        "model": settings.ollama_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": payload.message},
        ],
        "stream": False,
        # A modell maradjon a memóriában (nincs hidegindítás minden üzenetnél).
        "keep_alive": OLLAMA_KEEP_ALIVE,
        "options": {
            "num_predict": 400,
            "num_ctx": 4096,
            "temperature": 0.4,
        },
    }
    # A gemma4 "thinking" modellek minden válasz elé hosszú belső érvelést
    # generálnak (~3x lassabb + zajos kimenet) — ezeknél kikapcsoljuk. A nem
    # thinking-modellek (qwen2.5, llama3.1) viszont hibát adnának a "think"
    # paraméterre, ezért nekik nem küldjük.
    if "gemma4" in settings.ollama_model.lower():
        request_body["think"] = False

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            res = await client.post(f"{ollama_url}/api/chat", json=request_body)
            if res.status_code >= 400:
                logger.warning("Ollama chat hiba: %s %s", res.status_code, res.text[:300])
                return ChatResponse(
                    response="Az Ollama szerver hibát adott. Ellenőrizd, hogy a beállított "
                    f"modell ('{settings.ollama_model}') létezik-e a szerveren."
                )
            body = res.json()
            content = (body.get("message") or {}).get("content") or ""
            return ChatResponse(response=content.strip() or "Üres válasz érkezett.")
    except httpx.TimeoutException:
        return ChatResponse(
            response="Az Ollama túl lassan válaszolt (időtúllépés). A modell valószínűleg "
            "GPU nélkül, CPU-n fut — próbálj rövidebb kérdést, vagy egy kisebb modellt."
        )
    except httpx.HTTPError:
        return ChatResponse(response="A chat nem érhető el. Ellenőrizd, hogy az Ollama fut-e.")


@app.get("/api/training/files", response_model=TrainingFilesResponse)
async def list_training_files() -> TrainingFilesResponse:
    if app_state is None:
        raise _NOT_READY
    TRAINING_DIR.mkdir(parents=True, exist_ok=True)
    files = [
        TrainingFileMeta(name=f.name, stem=f.stem, size=f.stat().st_size)
        for f in sorted(TRAINING_DIR.glob("*.md"))
    ]
    return TrainingFilesResponse(
        files=files,
        has_system_prompt=(TRAINING_DIR / "_system.txt").exists(),
    )


@app.get("/api/training/files/{filename}", response_model=TrainingFileContent)
async def get_training_file(filename: str) -> TrainingFileContent:
    if app_state is None:
        raise _NOT_READY
    if filename != "_system.txt" and not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Érvénytelen fájlnév.")
    fp = TRAINING_DIR / filename
    if not fp.exists():
        return TrainingFileContent(name=filename, content="")
    return TrainingFileContent(name=filename, content=fp.read_text(encoding="utf-8"))


@app.put("/api/training/files/{filename}")
async def save_training_file(filename: str, payload: TrainingSaveRequest) -> dict[str, bool]:
    if app_state is None:
        raise _NOT_READY
    if filename != "_system.txt" and not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Érvénytelen fájlnév.")
    TRAINING_DIR.mkdir(parents=True, exist_ok=True)
    (TRAINING_DIR / filename).write_text(payload.content, encoding="utf-8")
    return {"saved": True}


@app.delete("/api/training/files/{filename}")
async def delete_training_file(filename: str) -> dict[str, bool]:
    if app_state is None:
        raise _NOT_READY
    if not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Érvénytelen fájlnév.")
    fp = TRAINING_DIR / filename
    if not fp.exists():
        raise HTTPException(status_code=404, detail="A fájl nem található.")
    fp.unlink()
    return {"deleted": True}


@app.post("/api/storage/stale/action")
async def storage_stale_action(payload: StaleActionRequest) -> dict[str, str]:
    if app_state is None:
        raise _NOT_READY
    try:
        message = await app_state.storage.apply_stale_action(
            payload.media_type,
            payload.arr_id,
            payload.action,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": message}

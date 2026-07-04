import asyncio
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

from app import state
from app.config import settings
from app.db.database import SessionLocal, get_db, init_db
from app.db.models import User, UserSession
from app.deps import get_admin_session, get_required_session
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
    LoginRequest,
    LoginResponse,
    PasswordUpdateRequest,
    RecommendationResponse,
    SearchRequest,
    SearchResponse,
    StaleActionRequest,
    StorageStatusResponse,
    TrainingFileContent,
    TrainingFileMeta,
    TrainingFilesResponse,
    TrainingSaveRequest,
    UserCreateRequest,
    UserInfo,
    UsersResponse,
)
from app.services.cache import CacheService
from app.services.ollama import OllamaError, OllamaTimeout, OllamaUnavailable
from app.services.queue import QueueService
from app.services.recommendations import RecommendationService
from app.services.search import SearchService
from app.services.session import SessionService
from app.services.storage import StorageService
from app.state import AppState

logger = logging.getLogger(__name__)

_NOT_READY = HTTPException(status_code=503, detail="A szerver még nem áll készen.")


def _state() -> AppState:
    if state.app_state is None:
        raise _NOT_READY
    return state.app_state


def _log_bot_exception(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Bot task hibával leállt: %s", exc, exc_info=exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    cache = CacheService()
    await cache.connect()
    search = SearchService(cache)
    queue = QueueService(search)
    recommendations = RecommendationService(search)
    storage = StorageService()
    session_service = SessionService()

    # A state modul attribútumát írjuk (nem modul-lokális globált), így a
    # deps.py és a botok is a friss értéket látják.
    state.app_state = AppState(
        cache=cache,
        search=search,
        queue=queue,
        recommendations=recommendations,
        storage=storage,
        session=session_service,
    )

    await init_db()
    async with SessionLocal() as db:
        await session_service.ensure_admin(db, settings.admin_username, settings.admin_password)
    await queue.start()

    # Ollama modell előmelegítése háttérben (nem blokkolja az indulást).
    warmup_task = asyncio.create_task(search.ollama.warmup())

    bot_tasks: list[asyncio.Task] = []
    if settings.telegram_enabled and settings.telegram_bot_token:
        from app.bots.telegram_bot import run_telegram_bot

        task = asyncio.create_task(run_telegram_bot())
        task.add_done_callback(_log_bot_exception)
        bot_tasks.append(task)
    if settings.discord_enabled and settings.discord_bot_token:
        from app.bots.discord_bot import run_discord_bot

        task = asyncio.create_task(run_discord_bot())
        task.add_done_callback(_log_bot_exception)
        bot_tasks.append(task)

    yield

    for task in bot_tasks:
        task.cancel()
    await asyncio.gather(*bot_tasks, return_exceptions=True)
    warmup_task.cancel()
    await queue.stop()
    await cache.close()
    state.app_state = None


app = FastAPI(title=settings.app_name, version="0.3.0", lifespan=lifespan)

_cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
_cors_allow_all = "*" in _cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _cors_allow_all else _cors_origins,
    # Wildcard origin + credentials érvénytelen (és veszélyes) kombináció.
    allow_credentials=not _cors_allow_all,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _user_info(user: User) -> UserInfo:
    return UserInfo(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role or "user",
        created_at=user.created_at.isoformat() if user.created_at else None,
    )


# ── Health ───────────────────────────────────────────────────────────────────


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    st = _state()
    checks = await st.search.health()
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
        redis=st.cache.connected,
        sonarr_error=checks.get("sonarr_error"),
        radarr_error=checks.get("radarr_error"),
        ollama_error=checks.get("ollama_error"),
    )


# ── Auth ─────────────────────────────────────────────────────────────────────


@app.post("/api/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    st = _state()
    auth = await st.session.authenticate(db, payload.username, payload.password)
    if auth is None:
        raise HTTPException(status_code=401, detail="Hibás felhasználónév vagy jelszó.")
    user, session = auth
    return LoginResponse(token=session.token, user=_user_info(user))


@app.post("/api/auth/logout")
async def logout(
    session: UserSession = Depends(get_required_session),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await _state().session.revoke(db, session.token)
    return {"success": True}


@app.get("/api/auth/me", response_model=UserInfo)
async def me(session: UserSession = Depends(get_required_session)) -> UserInfo:
    return _user_info(session.user)


# ── Users (admin) ────────────────────────────────────────────────────────────


@app.get("/api/users", response_model=UsersResponse)
async def list_users(
    _: UserSession = Depends(get_admin_session),
    db: AsyncSession = Depends(get_db),
) -> UsersResponse:
    users = await _state().session.list_users(db)
    return UsersResponse(users=[_user_info(user) for user in users])


@app.post("/api/users", response_model=UserInfo)
async def create_user(
    payload: UserCreateRequest,
    _: UserSession = Depends(get_admin_session),
    db: AsyncSession = Depends(get_db),
) -> UserInfo:
    try:
        user = await _state().session.create_user(db, payload.username, payload.password, payload.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _user_info(user)


@app.delete("/api/users/{user_id}")
async def delete_user(
    user_id: str,
    session: UserSession = Depends(get_admin_session),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    if user_id == session.user_id:
        raise HTTPException(status_code=400, detail="A saját fiókod nem törölheted.")
    st = _state()
    if await st.session.get_user(db, user_id) is None:
        raise HTTPException(status_code=404, detail="A felhasználó nem található.")
    await st.session.delete_user(db, user_id)
    return {"deleted": True}


@app.put("/api/users/{user_id}/password")
async def update_user_password(
    user_id: str,
    payload: PasswordUpdateRequest,
    _: UserSession = Depends(get_admin_session),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    try:
        await _state().session.update_password(db, user_id, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"updated": True}


# ── Search / Add ─────────────────────────────────────────────────────────────


@app.post("/api/search", response_model=SearchResponse)
async def search_media(
    payload: SearchRequest,
    _: UserSession = Depends(get_required_session),
) -> SearchResponse:
    st = _state()
    try:
        results, suggested_type, search_mode = await st.search.search(payload.query, payload.mode)
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
    session: UserSession = Depends(get_required_session),
) -> AddResponse:
    st = _state()

    if payload.async_job:
        job = await st.queue.enqueue_add(
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
        added_title, quality_note = await st.search.add(
            media_type=payload.media_type,
            external_id=payload.external_id,
            title=payload.title,
            tmdb_id=payload.tmdb_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await st.search.record_event(
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
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    _: UserSession = Depends(get_required_session),
) -> JobResponse:
    job = await _state().queue.get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="A feladat nem található.")
    return JobResponse(
        id=job.id,
        status=job.status,
        message=job.message,
        title=job.title,
        media_type=job.media_type,  # type: ignore[arg-type]
    )


# ── Recommendations / Feedback ───────────────────────────────────────────────


@app.get("/api/recommendations/{catalog}", response_model=RecommendationResponse)
async def get_recommendations(
    catalog: str,
    session: UserSession = Depends(get_required_session),
    db: AsyncSession = Depends(get_db),
) -> RecommendationResponse:
    st = _state()
    if catalog not in {"watched", "liked", "continue"}:
        raise HTTPException(status_code=400, detail="Ismeretlen katalógus.")
    items = await st.recommendations.get_catalog(
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
    await _state().recommendations.record_feedback(
        db,
        session.user_id,
        payload.media_type,
        payload.external_id,
        payload.title,
        payload.tmdb_id,
        payload.liked,
    )
    return {"success": True}


# ── Dashboard stubok ─────────────────────────────────────────────────────────


@app.get("/api/media/sessions")
async def media_sessions(_: UserSession = Depends(get_required_session)) -> dict:
    return {"sessions": []}


@app.get("/api/torrents")
async def torrents(_: UserSession = Depends(get_required_session)) -> dict:
    return {"torrents": []}


# ── Storage (admin) ──────────────────────────────────────────────────────────


@app.get("/api/storage/status", response_model=StorageStatusResponse)
async def storage_status(_: UserSession = Depends(get_admin_session)) -> StorageStatusResponse:
    st = _state()
    # Lemez-I/O (disk_usage, mkdir) — ne blokkolja az event loopot.
    data = await asyncio.to_thread(st.storage.get_status)
    return StorageStatusResponse(**data)


@app.post("/api/storage/cleanup")
async def storage_cleanup(_: UserSession = Depends(get_admin_session)) -> dict:
    st = _state()
    cache_result = await asyncio.to_thread(st.storage.cleanup_cache)
    deleted = await st.cache.delete_prefix("search:")
    return {"cache_files": cache_result, "search_cache_keys_deleted": deleted}


@app.get("/api/storage/stale")
async def storage_stale(_: UserSession = Depends(get_admin_session)) -> dict:
    items = await _state().storage.list_stale_media()
    return {"items": items, "days": settings.stale_media_days}


@app.post("/api/storage/stale/action")
async def storage_stale_action(
    payload: StaleActionRequest,
    _: UserSession = Depends(get_admin_session),
) -> dict[str, str]:
    try:
        message = await _state().storage.apply_stale_action(
            payload.media_type,
            payload.arr_id,
            payload.action,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": message}


# ── Training fájlok (admin) ──────────────────────────────────────────────────

TRAINING_DIR = Path("./data/training")
_FILENAME_RE = re.compile(r"^[a-zA-Z0-9_\-]+\.(md)$")

# A training kontextus cache-elve — mtime-aláírás alapján frissül, így nem
# olvassuk újra az összes fájlt minden chat kérésnél.
_training_cache: dict = {"signature": None, "content": ""}


def _safe_filename(name: str) -> bool:
    return bool(_FILENAME_RE.match(name)) and ".." not in name


def _training_signature() -> tuple:
    if not TRAINING_DIR.exists():
        return ()
    files = [TRAINING_DIR / "_system.txt", *sorted(TRAINING_DIR.glob("*.md"))]
    signature = []
    for fp in files:
        try:
            stat = fp.stat()
            signature.append((fp.name, stat.st_mtime_ns, stat.st_size))
        except OSError:
            continue
    return tuple(signature)


def _read_training_context() -> str:
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


async def _load_training_context() -> str:
    def _load() -> str:
        signature = _training_signature()
        if signature == _training_cache["signature"]:
            return _training_cache["content"]
        content = _read_training_context()
        _training_cache["signature"] = signature
        _training_cache["content"] = content
        return content

    return await asyncio.to_thread(_load)


@app.get("/api/training/files", response_model=TrainingFilesResponse)
async def list_training_files(_: UserSession = Depends(get_admin_session)) -> TrainingFilesResponse:
    def _list() -> tuple[list[TrainingFileMeta], bool]:
        TRAINING_DIR.mkdir(parents=True, exist_ok=True)
        files = [
            TrainingFileMeta(name=f.name, stem=f.stem, size=f.stat().st_size)
            for f in sorted(TRAINING_DIR.glob("*.md"))
        ]
        return files, (TRAINING_DIR / "_system.txt").exists()

    files, has_system = await asyncio.to_thread(_list)
    return TrainingFilesResponse(files=files, has_system_prompt=has_system)


@app.get("/api/training/files/{filename}", response_model=TrainingFileContent)
async def get_training_file(
    filename: str,
    _: UserSession = Depends(get_admin_session),
) -> TrainingFileContent:
    if filename != "_system.txt" and not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Érvénytelen fájlnév.")
    fp = TRAINING_DIR / filename

    def _read() -> str | None:
        return fp.read_text(encoding="utf-8") if fp.exists() else None

    content = await asyncio.to_thread(_read)
    return TrainingFileContent(name=filename, content=content or "")


@app.put("/api/training/files/{filename}")
async def save_training_file(
    filename: str,
    payload: TrainingSaveRequest,
    _: UserSession = Depends(get_admin_session),
) -> dict[str, bool]:
    if filename != "_system.txt" and not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Érvénytelen fájlnév.")

    def _write() -> None:
        TRAINING_DIR.mkdir(parents=True, exist_ok=True)
        (TRAINING_DIR / filename).write_text(payload.content, encoding="utf-8")

    await asyncio.to_thread(_write)
    return {"saved": True}


@app.delete("/api/training/files/{filename}")
async def delete_training_file(
    filename: str,
    _: UserSession = Depends(get_admin_session),
) -> dict[str, bool]:
    if not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Érvénytelen fájlnév.")
    fp = TRAINING_DIR / filename

    def _delete() -> bool:
        if not fp.exists():
            return False
        fp.unlink()
        return True

    if not await asyncio.to_thread(_delete):
        raise HTTPException(status_code=404, detail="A fájl nem található.")
    return {"deleted": True}


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

DEFAULT_AGENT_PROMPT = (
    "Te egy média asszisztens vagy. Segítesz filmeket és sorozatokat keresni és hozzáadni. "
    "Ha a felhasználó egy konkrét filmet vagy sorozatot említ, azt automatikusan meg tudom keresni és hozzáadni — "
    "csak írja be a nevét, és elvégzem a többit. Röviden és magyarul válaszolj."
)
DEFAULT_CHAT_PROMPT = (
    "Te egy média asszisztens vagy. Segítesz filmeket és sorozatokat keresni, "
    "hozzáadni Sonarrhoz és Radarrhoz, és válaszolsz a médiagyűjteménnyel kapcsolatos kérdésekre."
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


async def _ollama_reply(message: str, fallback_prompt: str) -> str:
    st = _state()
    training_ctx = await _load_training_context()
    system_prompt = training_ctx if training_ctx else fallback_prompt
    try:
        content = await st.search.ollama.chat(message, system_prompt)
        return content or "Üres válasz érkezett."
    except OllamaTimeout:
        return (
            "Az Ollama túl lassan válaszolt (időtúllépés). Próbálj rövidebb kérdést, "
            "vagy egy kisebb modellt."
        )
    except OllamaUnavailable:
        return "A chat nem érhető el. Ellenőrizd, hogy az Ollama fut-e."
    except OllamaError:
        return (
            "Az Ollama szerver hibát adott. Ellenőrizd, hogy a beállított modell "
            f"('{settings.ollama_model}') létezik-e a szerveren."
        )


@app.post("/api/chat/agent", response_model=AgentChatResponse)
async def chat_agent(
    payload: AgentChatRequest,
    _: UserSession = Depends(get_required_session),
) -> AgentChatResponse:
    st = _state()

    intent = _detect_intent(payload.message)
    logger.info("Agent | intent=%s | msg=%r", intent, payload.message[:80])

    if intent in ("search", "add"):
        intent_data = await st.search.ollama.extract_search_intent(payload.message)
        query = " ".join(intent_data["search_terms"][:2]).strip() or payload.message.strip()
        logger.info("Agent | search query=%r", query)

        try:
            results, suggested_type, _mode = await st.search.search(query, "auto")
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
                    added_title, quality_note = await st.search.add(
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
    reply = await _ollama_reply(payload.message, DEFAULT_AGENT_PROMPT)
    return AgentChatResponse(action="chat", message=reply)


@app.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    _: UserSession = Depends(get_required_session),
) -> ChatResponse:
    reply = await _ollama_reply(payload.message, DEFAULT_CHAT_PROMPT)
    return ChatResponse(response=reply)

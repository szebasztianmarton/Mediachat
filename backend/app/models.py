from typing import Any, Literal

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    mode: Literal["auto", "title", "description"] = "auto"


class SearchResult(BaseModel):
    result_id: str
    title: str
    year: int | None = None
    overview: str = ""
    poster_url: str | None = None
    media_type: Literal["movie", "series"]
    external_id: int
    title_slug: str | None = None
    match_score: float = 0.0
    suggested: bool = False
    tmdb_id: int | None = None
    lookup_source: Literal["local", "tmdb"] = "local"


class AddRequest(BaseModel):
    media_type: Literal["movie", "series"]
    external_id: int
    title_slug: str | None = None
    title: str
    tmdb_id: int | None = None
    async_job: bool = False


class AddResponse(BaseModel):
    success: bool
    message: str
    media_type: Literal["movie", "series"]
    title: str
    quality_note: str | None = None
    job_id: str | None = None


class SearchResponse(BaseModel):
    query: str
    suggested_type: Literal["movie", "series"] | None = None
    search_mode: Literal["title", "description"] = "title"
    results: list[SearchResult]


class HealthResponse(BaseModel):
    status: str
    sonarr: bool
    radarr: bool
    ollama: bool = False
    tmdb: bool = False
    redis: bool = False
    sonarr_error: str | None = None
    radarr_error: str | None = None
    ollama_error: str | None = None


class AgentChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class AgentMediaAdded(BaseModel):
    title: str
    media_type: str
    quality_note: str | None = None


class AgentChatResponse(BaseModel):
    action: str  # "search" | "add" | "chat"
    message: str
    results: list[SearchResult] | None = None
    added: AgentMediaAdded | None = None


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class UserInfo(BaseModel):
    id: str
    username: str | None = None
    display_name: str
    role: str = "user"
    created_at: str | None = None


class LoginResponse(BaseModel):
    token: str
    user: UserInfo


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=4, max_length=128)
    role: Literal["admin", "user"] = "user"


class PasswordUpdateRequest(BaseModel):
    password: str = Field(..., min_length=4, max_length=128)


class UsersResponse(BaseModel):
    users: list[UserInfo]


class JobResponse(BaseModel):
    id: str
    status: str
    message: str
    title: str
    media_type: Literal["movie", "series"]


class RecommendationItem(BaseModel):
    title: str
    year: int | None = None
    overview: str = ""
    poster_url: str | None = None
    media_type: Literal["movie", "series"]
    external_id: int
    tmdb_id: int | None = None
    reason: str = ""


class RecommendationResponse(BaseModel):
    catalog: Literal["watched", "liked", "continue"]
    items: list[RecommendationItem]


class FeedbackRequest(BaseModel):
    media_type: Literal["movie", "series"]
    external_id: int
    title: str
    tmdb_id: int | None = None
    liked: bool = True


class StorageStatusResponse(BaseModel):
    volumes: list[dict[str, Any]]
    warnings: list[str]
    min_free_gb: float


class StaleActionRequest(BaseModel):
    media_type: Literal["movie", "series"]
    arr_id: int
    action: Literal["delete", "unmonitor"] = "delete"


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    response: str


class TrainingFileMeta(BaseModel):
    name: str
    stem: str
    size: int


class TrainingFilesResponse(BaseModel):
    files: list[TrainingFileMeta]
    has_system_prompt: bool


class TrainingFileContent(BaseModel):
    name: str
    content: str


class TrainingSaveRequest(BaseModel):
    content: str = ""

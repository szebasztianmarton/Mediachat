# Media Assistant Chatbot

![Stack](https://img.shields.io/badge/Stack-FastAPI%20%7C%20Ollama%20%7C%20Vite-0f172a?style=flat-square)
![Media](https://img.shields.io/badge/Media-Sonarr%20%7C%20Radarr%20%7C%20Jellyfin-7c3aed?style=flat-square)
![AI](https://img.shields.io/badge/AI-Local%20LLM-16a34a?style=flat-square)

A natural-language chatbot for your home media stack. It takes movie and TV requests,
searches by **title or free-text description** (TMDb + a local LLM), and after your
confirmation automatically adds the content to **Radarr** (movies) or **Sonarr**
(series). Series are capped at **1080p** by default. On top of the assistant it ships a
full admin dashboard: live "Now Playing" sessions, per-user watch analytics, storage
management, recommendations, backups, torrent cleanup, and more.

Detailed design notes (Hungarian): [Media Assistant Chatbot.md](./Media%20Assistant%20Chatbot.md).

---

## Features

### Assistant
- **Title search** – the bot decides movie vs. series and looks it up.
- **Description search** – the LLM extracts keywords and searches TMDb.
- **Automatic add** – via the Radarr / Sonarr API, with the 1080p cap and a background job queue.
- **Chat agent** – a single conversational endpoint that detects intent (search / add / chat) and streams LLM replies over SSE.

### Accounts & security
- **Real authentication** – PBKDF2-hashed passwords, hashed session tokens, admin/user roles.
- **Two-factor (TOTP)** – optional authenticator-app 2FA (dependency-free, RFC 6238), with a two-step login.
- **Passkeys (WebAuthn)** – optional passwordless login alongside the password.
- **Rate limiting** – brute-force and LLM-abuse protection on login and chat.

### Media & library
- **Recommendations** – `watched`, `liked`, and `continue` catalogs with like/dislike feedback. The `continue` catalog is fed by real Jellyfin resume progress.
- **Now Playing** – live Plex/Jellyfin sessions with per-stream detail: transcode vs. direct, device/client, local vs. remote, audio/subtitle track, resolution, and a server-load summary.
- **Jellyfin watch analytics** – per-user watch time, in-progress items, and recently watched.
- **Storage management** – disk status, cache cleanup, and stale-content detection (Jellyfin-watch-aware) with delete/unmonitor actions.
- **Calendar** – upcoming releases from Sonarr/Radarr.
- **Backups** – scheduled and manual JSON backups with a restore preview.
- **Torrents** – qBittorrent / Transmission listing and automatic cleanup of finished downloads.

### Integrations & UI
- **Webhooks** – Sonarr/Radarr "download imported" events → Telegram/Discord notifications.
- **Bots** – optional Telegram and Discord integration.
- **Audit log** – who added/liked/dropped what, plus automatic torrent deletions.
- **Web UI** – reMarkable e-ink–inspired React interface with multiple themes, **i18n (Hungarian / English)**, and PWA support (chat, dashboard, recommendations, storage, users, training, logs).

---

## Architecture

```
frontend (Vite PWA / nginx, :3000)
        │  REST + SSE
        ▼
backend (FastAPI, :8000) ──► Sonarr / Radarr / Jellyfin / Plex APIs
   │        │        │
   ▼        ▼        ▼
PostgreSQL  Redis    Ollama (:11434)  ──► TMDb API
(or SQLite) (cache)  (local LLM)
```

Backend source: [backend/app/](./backend/app/) — `services/` (search, ranking,
recommendations, storage, backups, media sessions, Jellyfin, TOTP/WebAuthn, and the
Sonarr/Radarr/TMDb/Ollama clients), `bots/`, `db/`.

Frontend source: [frontend/src/](./frontend/src/) — `pages/`, `components/`, `hooks/`,
`utils/`, and `i18n/` (the translation layer).

---

## Quick start (pnpm)

The recommended dev workflow starts the backend and the frontend **together with a
single command** from the repo root.

### Prerequisites
- Node.js + **pnpm**
- Python 3.11+
- A reachable **Sonarr** and **Radarr** instance (with API keys)
- Optionally a **TMDb** API key (for description search) and **Ollama** (for the LLM)

### 1. Configuration

```bash
cp .env.example .env
```

Fill in `.env` — the most important fields:

| Variable | Description |
| --- | --- |
| `SONARR_URL`, `SONARR_API_KEY` | Sonarr access |
| `RADARR_URL`, `RADARR_API_KEY` | Radarr access |
| `OLLAMA_MODEL` | LLM model in use (default: `llama3.2:3b`) |
| `TMDB_API_KEY` | TMDb metadata key |
| `MAX_SERIES_QUALITY` | series quality cap (default: `1080p`) |
| `REDIS_ENABLED` | Redis on/off (can be `false` locally) |
| `JELLYFIN_URL`, `JELLYFIN_API_KEY` | Jellyfin (sessions, analytics, provisioning) |
| `PLEX_URL`, `PLEX_TOKEN` | Plex (Now Playing sessions) |
| `TELEGRAM_ENABLED` / `DISCORD_ENABLED` | bots on/off |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | first-run admin account |

> Without a database URL the backend falls back to SQLite
> (`sqlite+aiosqlite:///./data/media_bot.db`), so it runs without Postgres.
> Never commit real API keys — `.env` is in `.gitignore`.

### 2. Install (one-time)

```bash
pnpm setup
# = pnpm install (frontend deps) + pip install -r backend/requirements.txt
```

### 3. Pull the Ollama model

```bash
ollama pull llama3.2:3b
```

### 4. Start with one command

```bash
pnpm dev
```

This starts, in parallel:

- **backend** → http://localhost:8000 (`uvicorn --reload`)
- **frontend** → http://localhost:3100 (`vite`)

Logs appear labelled (`backend` / `frontend`) in the same terminal; `Ctrl+C` stops both.

### pnpm scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | backend + frontend together |
| `pnpm dev:backend` | FastAPI backend only (`:8000`) |
| `pnpm dev:frontend` | Vite frontend only (`:3100`) |
| `pnpm build` | frontend production build |
| `pnpm setup` | install dependencies (frontend + backend) |

> `dev:backend` calls `python -m uvicorn` — if you use a virtualenv, activate it first
> so the right `python` is on the PATH.

---

## Usage

### Web UI

Open http://localhost:3100 and sign in (default: `admin / media2024` — override with
`ADMIN_USERNAME` / `ADMIN_PASSWORD`; **change it before real use**). Type a request
(e.g. *"Inception from 2010"* or *"a sci-fi where an astronaut is stranded on Mars"*).
The bot lists results as cards — pick one and hit add. Switch the interface language
(Hungarian / English) and theme from the sidebar; enable TOTP or a passkey from your
profile.

### REST API

Main backend endpoints (full list + Swagger: http://localhost:8000/docs):

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| `GET`  | `/health` | service status | public |
| `POST` | `/api/auth/login` | login (returns token, or a TOTP ticket) | public |
| `POST` | `/api/auth/login/totp` | second step of TOTP login | public |
| `POST` | `/api/auth/logout` | revoke session | session |
| `GET`  | `/api/auth/me` | current user | session |
| `POST` | `/api/auth/totp/setup/{begin,finish}` | enable TOTP | session |
| `POST` | `/api/auth/webauthn/...` | passkey register / login | session / public |
| `GET/POST/DELETE` | `/api/users[...]` | user management | admin |
| `POST` | `/api/search` | search (title or description) | session |
| `POST` | `/api/add` | add content to Sonarr/Radarr | session |
| `GET`  | `/api/jobs/{job_id}` | async add status | session |
| `GET`  | `/api/recommendations/{catalog}` | recommendations (`watched`/`liked`/`continue`) | session |
| `POST` | `/api/feedback` | like/dislike feedback | session |
| `POST` | `/api/chat/agent[/stream]` | chat agent (search/add/LLM, SSE) | session |
| `GET`  | `/api/media/sessions` | live Now Playing sessions | session |
| `GET`  | `/api/jellyfin/analytics` | per-user watch analytics | admin |
| `GET`  | `/api/storage/status` | storage status | admin |
| `POST` | `/api/storage/cleanup` | cache cleanup | admin |
| `GET`  | `/api/storage/stale` | stale content list | admin |
| `POST` | `/api/storage/stale/action` | manage stale content (delete/unmonitor) | admin |
| `GET`  | `/api/backups` + restore | backup list / create / restore | admin |
| `GET`  | `/api/audit` | audit log | admin |
| `GET/PUT/DELETE` | `/api/training/files[...]` | LLM training files | admin |

Protected endpoints expect the token in the `X-Session-Token` header.

#### Example flow

```bash
# 1. Login
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "media2024"}'
# → { "token": "abc...", "user": { "id": "...", "role": "admin", ... } }
#   (for a TOTP-enabled account: { "totp_required": true, "ticket": "..." })

# 2. Search
curl -X POST http://localhost:8000/api/search \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: <token>" \
  -d '{"query": "Inception", "mode": "auto"}'

# 3. Add (using external_id / media_type from a result)
curl -X POST http://localhost:8000/api/add \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: <token>" \
  -d '{"media_type": "movie", "external_id": 27205, "title": "Inception", "tmdb_id": 27205}'
```

> `mode` can be `auto` (default), `title`, or `description`.

---

## Internationalization (i18n)

The UI ships a **dependency-free** i18n layer in [frontend/src/i18n/](./frontend/src/i18n/)
(no external library, matching the project's minimal-dependency approach). Hungarian is
the default; English is bundled; the language is switchable from the sidebar and
persisted in `localStorage`.

Adding or translating a string:

```tsx
import { useT } from "../i18n";

function MyComponent() {
  const t = useT();
  return <p>{t("nav.settings")}</p>;          // "Beállítások" / "Settings"
  // with variables: t("analytics.daysAgo", { n: 3 })
}
```

Add the key to **both** dictionaries (`hu` and `en`) in `src/i18n/index.tsx`. A missing
key falls back to Hungarian, then to the raw key, so partial migration is safe — new
screens can adopt `t()` incrementally without breaking existing ones.

---

## Alternative: Docker Compose

For a containerized "all in one" setup (PostgreSQL, Redis, Ollama, backend, frontend),
use [docker-compose.yml](./docker-compose.yml):

```bash
cp .env.example .env          # fill it in
docker compose up -d --build
docker exec -it media-chatbot-ollama ollama pull llama3.2:3b
```

Useful commands:

```bash
docker compose ps               # container status
docker compose logs -f backend  # backend logs
docker compose down             # stop
```

> To reach a Sonarr/Radarr running on the host from inside Docker, use
> `http://host.docker.internal:8989`; `SONARR_URL` must not contain a double `http://`.

A TrueNAS SCALE build is available in [docker-compose.truenas.yml](./docker-compose.truenas.yml)
(see [TRUENAS_DEPLOY.md](./TRUENAS_DEPLOY.md)).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| 401/403 towards Sonarr/Radarr | check the API key and URL in `.env` |
| `/health` → `degraded` | neither Sonarr nor Radarr is reachable |
| `pnpm dev:backend` fails | is the venv active? is `python -m uvicorn` available? |
| Slow / hanging LLM | switch to a smaller, quantized model (`OLLAMA_MODEL`) |
| Empty title search | try description search (`mode: description`) |
| Blank page in dev after a code change | a stale service worker — hard-reload once (`Ctrl+Shift+R`); the SW only registers in production builds |

More detail and roadmap: see the [design document](./Media%20Assistant%20Chatbot.md).

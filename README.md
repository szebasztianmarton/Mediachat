# Media Assistant Chatbot

![Stack](https://img.shields.io/badge/Stack-FastAPI%20%7C%20Ollama%20%7C%20Vite-0f172a?style=flat-square)
![Media](https://img.shields.io/badge/Media-Sonarr%20%7C%20Radarr-7c3aed?style=flat-square)
![AI](https://img.shields.io/badge/AI-Local%20LLM-16a34a?style=flat-square)

Természetes nyelvű chatbot, amely film- és sorozatkéréseket fogad, cím vagy körülírás
alapján keres (TMDb + lokális LLM), majd jóváhagyás után automatikusan hozzáadja a
tartalmat **Radarrhoz** (film) vagy **Sonarrhoz** (sorozat). Sorozatoknál legfeljebb
**1080p** minőség engedélyezett.

A részletes tervezési dokumentáció: [Media Assistant Chatbot.md](./Media%20Assistant%20Chatbot.md).

---

## Funkciók

- **Cím alapú keresés** – a bot eldönti, film vagy sorozat, és megkeresi.
- **Leírás alapú keresés** – az LLM kulcsszavakat nyer ki, a TMDb-ben keres.
- **Automatikus hozzáadás** – Radarr / Sonarr API-n keresztül, 1080p korláttal.
- **Több felhasználó** – session-token alapú azonosítás.
- **Ajánlórendszer** – `watched`, `liked`, `continue` katalógusok.
- **Tárhelymenedzsment** – állapot, cache takarítás, elavult tartalom kezelése.
- **Botok** – opcionális Telegram és Discord integráció.
- **PWA frontend** – mobilbarát webes chat felület.

---

## Architektúra

```
frontend (Vite PWA, :3000)
        │  REST
        ▼
backend (FastAPI, :8000) ──► Sonarr / Radarr API
   │        │        │
   ▼        ▼        ▼
PostgreSQL  Redis    Ollama (:11434)  ──► TMDb API
```

A backend forrása: [backend/app/](./backend/app/) – `services/` (keresés, ranking,
ajánlás, tárhely, sonarr/radarr/tmdb/ollama kliensek), `bots/`, `db/`.

---

## Gyors indulás (pnpm)

Az ajánlott fejlesztői út: a backend és a frontend **egyetlen paranccsal, egyszerre**
indul a gyökérben lévő pnpm szkripttel.

### Előfeltételek

- Node.js + **pnpm**
- Python 3.11+
- Elérhető **Sonarr** és **Radarr** példány (API kulccsal)
- Opcionálisan **TMDb** API kulcs (leírás alapú kereséshez)

### 1. Konfiguráció

```bash
cp .env.example .env
```

Töltsd ki az `.env` fájlt – a legfontosabb mezők:

| Változó | Leírás |
| --- | --- |
| `SONARR_URL`, `SONARR_API_KEY` | Sonarr elérés |
| `RADARR_URL`, `RADARR_API_KEY` | Radarr elérés |
| `OLLAMA_MODEL` | használt LLM modell (alap: `llama3.2:3b`) |
| `TMDB_API_KEY` | TMDb metaadat kulcs |
| `MAX_SERIES_QUALITY` | sorozat minőségkorlát (alap: `1080p`) |
| `REDIS_ENABLED` | Redis ki/be (lokálisan `false` is lehet) |
| `TELEGRAM_ENABLED` / `DISCORD_ENABLED` | botok be-/kikapcsolása |

> Konfiguráció nélkül a backend SQLite-ra esik vissza
> (`sqlite+aiosqlite:///./data/media_bot.db`), így Postgres nélkül is indítható.
> Soha ne commitold az éles API kulcsokat – a `.env` a `.gitignore`-ban van.

### 2. Telepítés (egyszeri)

```bash
pnpm setup
# = pnpm install (frontend függőségek) + pip install -r backend/requirements.txt
```

### 3. Ollama modell letöltése

```bash
ollama pull llama3.2:3b
```

### 4. Indítás egy paranccsal

```bash
pnpm dev
```

Ez párhuzamosan elindítja:

- **backend** → http://localhost:8000 (`uvicorn --reload`)
- **frontend** → http://localhost:3000 (`vite`)

A logok címkézve (`backend` / `frontend`) jelennek meg ugyanabban a terminálban;
`Ctrl+C` mindkettőt leállítja.

### pnpm parancsok

| Parancs | Leírás |
| --- | --- |
| `pnpm dev` | backend + frontend egyszerre |
| `pnpm dev:backend` | csak a FastAPI backend (`:8000`) |
| `pnpm dev:frontend` | csak a Vite frontend (`:3000`) |
| `pnpm build` | frontend production build |
| `pnpm setup` | függőségek telepítése (frontend + backend) |

> A `dev:backend` `python -m uvicorn`-t hív – ha virtuális környezetet használsz,
> előbb aktiváld, hogy a megfelelő `python` legyen a PATH-on.

---

## Használat

### Webes felület

Nyisd meg a http://localhost:3000 címet, írd be a kérést (pl. *„a 2010-es Eredet”*
vagy *„űrhajós film ahol egyedül marad a Marson”*). A bot kártyákban listázza a
találatokat – válassz, és nyomd meg a hozzáadás gombot.

### REST API

A backend főbb végpontjai (teljes lista + Swagger: http://localhost:8000/docs):

| Metódus | Útvonal | Funkció |
| --- | --- | --- |
| `GET`  | `/health` | szolgáltatások állapota |
| `POST` | `/api/session` | session létrehozása |
| `POST` | `/api/search` | keresés (cím vagy leírás) |
| `POST` | `/api/add` | tartalom hozzáadása Sonarr/Radarr-hoz |
| `GET`  | `/api/jobs/{job_id}` | aszinkron hozzáadás állapota |
| `GET`  | `/api/recommendations/{catalog}` | ajánlások (`watched`/`liked`/`continue`) |
| `POST` | `/api/feedback` | like/dislike visszajelzés |
| `GET`  | `/api/storage/status` | tárhely állapot |
| `POST` | `/api/storage/cleanup` | cache takarítás |
| `GET`  | `/api/storage/stale` | elavult tartalmak listája |
| `POST` | `/api/storage/stale/action` | elavult tartalom kezelése |

A session- és felhasználói végpontok `Authorization` fejlécben várják a session-tokent.

#### Példa folyamat

```bash
# 1. Session létrehozása
curl -X POST http://localhost:8000/api/session \
  -H "Content-Type: application/json" \
  -d '{"display_name": "Szeba", "platform": "web"}'
# → { "session_token": "abc...", "user_id": 1, "display_name": "Szeba" }

# 2. Keresés
curl -X POST http://localhost:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "Eredet", "mode": "auto"}'

# 3. Hozzáadás (a találatból kapott external_id / media_type alapján)
curl -X POST http://localhost:8000/api/add \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session_token>" \
  -d '{"media_type": "movie", "external_id": "27205", "title": "Eredet", "tmdb_id": 27205}'
```

> A `mode` lehet `auto` (alapértelmezett), `title` vagy `description`.

---

## Alternatíva: Docker Compose

Ha konténerizált, „mindent egyben” telepítést szeretnél (PostgreSQL, Redis, Ollama,
backend, frontend), használd a [docker-compose.yml](./docker-compose.yml)-t:

```bash
cp .env.example .env          # töltsd ki
docker compose up -d --build
docker exec -it media-chatbot-ollama ollama pull llama3.2:3b
```

Hasznos parancsok:

```bash
docker compose ps               # konténerek állapota
docker compose logs -f backend  # backend log
docker compose down             # leállítás
```

> Dockerből egy hoston futó Sonarr/Radarr eléréséhez használd a
> `http://host.docker.internal:8989` formát; a `SONARR_URL` ne tartalmazzon dupla
> `http://`-t.

---

## Hibaelhárítás

| Tünet | Megoldás |
| --- | --- |
| 401/403 a Sonarr/Radarr felé | ellenőrizd az API kulcsot és az URL-t az `.env`-ben |
| `/health` → `degraded` | sem a Sonarr, sem a Radarr nem elérhető |
| `pnpm dev:backend` hibázik | aktív venv? `python -m uvicorn` elérhető? |
| Lassú / kiakadó LLM | válts kisebb, quantized modellre (`OLLAMA_MODEL`) |
| Üres találat cím alapján | próbáld a leírás alapú keresést (`mode: description`) |

További részletek és tervek: lásd a [tervezési dokumentumot](./Media%20Assistant%20Chatbot.md).

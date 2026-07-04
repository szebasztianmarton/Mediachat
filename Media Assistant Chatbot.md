# Sonarr/Radarr alapú, 1080p korláttal működő chatbot rendszer

![Project](https://img.shields.io/badge/Project-Homelab-111827?style=for-the-badge)
![Stack](https://img.shields.io/badge/Stack-FastAPI%20%7C%20Ollama%20%7C%20Docker-0f172a?style=for-the-badge)
![Storage](https://img.shields.io/badge/Storage-TrueNAS%20SCALE-2563eb?style=for-the-badge)
![Media](https://img.shields.io/badge/Media-Sonarr%20%7C%20Radarr%20%7C%20Prowlarr-7c3aed?style=for-the-badge)
![AI](https://img.shields.io/badge/AI-Local%20LLM-16a34a?style=for-the-badge)

## Rövid leírás

A projekt célja egy olyan chatbot rendszer létrehozása, amely természetes nyelven fogad film- és sorozatkéréseket, képes cím alapján és körülírás alapján is keresni, majd a kiválasztott tartalmat automatikusan hozzáadja Sonarrhoz vagy Radarrhoz.

A rendszer mobilbarát felületet, több felhasználós működést, cache-t, és tárhelymenedzsmentet is tartalmaz. Sorozatok esetén legfeljebb **1080p** minőséget engedélyez.

Ez a leírás **TrueNAS SCALE** környezetre van optimalizálva, mert a docker-compose alapú telepítés ehhez illeszkedik a legjobban.

---

## Célok

- Cím alapú és leírás alapú keresés
- Automatikus címfelismerés: film vagy sorozat
- Poszteres, kártyás találati lista
- Jóváhagyás után automatikus hozzáadás Sonarrhoz vagy Radarrhoz
- 1080p korlátozás sorozatoknál
- Több felhasználó, külön sessionökkel
- Tárhelyfigyelés és automatikus takarítás
- Később ajánlórendszer: nézett, kedvelt és félbehagyott tartalmak alapján

---

## Hardverelemzés a megadott gépre

**Gép:**
- TrueNAS
- 2 × 1 TB SSD
- 1 × 500 GB SSD
- 1 × 500 GB HDD
- 1 × 256 GB SSD
- Intel i3-10100F
- 32 GB RAM

### Ajánlott szerepkörök

- **256 GB SSD**: boot / rendszer, ha erre van szükség
- **2 × 1 TB SSD**: app data, adatbázis, metadata cache, gyors műveletek
- **500 GB SSD**: Ollama modellek, temporary download cache, indexer cache
- **500 GB HDD**: hideg tárolás, archivált tartalom, kevésbé aktív állományok

### Mit bír ez a konfiguráció?

- A **backend, Redis, PostgreSQL, Sonarr, Radarr, Prowlarr** gond nélkül elfér.
- Egy **kisebb lokális LLM** is működhet, de érdemes **1B–7B** méret körül maradni, quantized modellel.
- A rendszer alkalmas a metaadat-keresésre, ajánlásra és automatikus orchestration-re.
- A 32 GB RAM jó kiindulás, de a nagyobb modellekhez kevés lehet.

---

## Tech stack

### Backend
- Python
- FastAPI
- PostgreSQL vagy SQLite
- Redis session-kezeléshez és cache-hez

### AI / LLM
- Ollama lokális futtatáshoz
- kisebb modell az alap működéshez
- nagyobb modell csak erősebb hardver esetén

### Média automatizálás
- Sonarr a sorozatokhoz
- Radarr a filmekhez
- Prowlarr az indexerekhez
- qBittorrent vagy más letöltő kliens

### Frontend / Chat
- Webes chat UI
- Telegram bot
- Discord bot
- PWA mobilos használathoz

---

## Internetes körülírás alapú keresés

A rendszer nem csak címre keres, hanem leírásból is megpróbálja megtalálni a megfelelő filmet vagy sorozatot.

### Folyamat

1. A felhasználó körülírja a tartalmat.
2. Az LLM kinyeri a kulcsszavakat:
   - műfaj
   - hangulat
   - szereplők
   - időszak
   - nyelv
   - évszám
3. A backend külső metaadat-forrásokban keres.
4. A találatok pontozást kapnak.
5. A bot a legjobb 3–10 találatot kártyákban mutatja meg.
6. A felhasználó kiválasztja a megfelelőt.
7. Jóváhagyás után a rendszer hozzáadja Sonarrhoz vagy Radarrhoz.

### Keresési logika

- cím egyezés
- alternatív címek
- évszám
- szereplők
- hasonló műfajok
- népszerűség
- nyelv
- runtime
- sorozatoknál évad / epizód logika

### Javasolt külső források

- TMDb a metaadatokra
- Trakt a nézési előzményekhez és kedvelésekhez
- Sonarr / Radarr saját API a tényleges hozzáadáshoz

---

## Step by step megoldás

### 1. TrueNAS előkészítése

- Hozz létre külön datasetet az appoknak.
- Külön datasetet adj az adatbázisnak és a cache-nek.
- A letöltéseknek és a médiának külön storage útvonalat használj.
- Ha van rá mód, a boot meghajtó legyen elkülönítve az app storage-tól.

### 2. Docker és Compose struktúra

- Készíts egy projektmappát.
- Tegyél bele `backend`, `frontend`, `docker-compose.yml` és `.env.example` fájlt.
- Használj fix, jól átlátható volume útvonalakat.

### 3. Core szolgáltatások indítása

- PostgreSQL vagy SQLite
- Redis
- Ollama
- Backend API
- Frontend UI
- Sonarr
- Radarr
- Prowlarr

### 4. API kulcsok bekötése

- Sonarr API Key
- Radarr API Key
- Prowlarr API Key
- Ollama elérés
- TMDb / Trakt kulcs, ha használsz külső ajánlóréteget

### 5. Keresési és ranking réteg

- Először próbálj cím alapján keresni.
- Ha nincs találat, menj át körülírás alapú keresésre.
- Tárold a korábbi kereséseket cache-ben.
- Rangsort adj a találatoknak.

### 6. Hozzáadás a megfelelő rendszerbe

- Film → Radarr
- Sorozat → Sonarr
- Sorozatoknál maximum 1080p profile
- A backend mindig ellenőrizze a felhasználó jóváhagyását

### 7. Storage és retention

- Figyeld a szabad helyet
- Cache tisztítás
- Régi ideiglenes fájlok törlése
- Archiválás, ha nem akarsz végleges törlést

### 8. Tesztelés

- Címes keresés
- Leírásos keresés
- Hibás címek
- Több felhasználó
- API kulcs hiba
- Alacsony tárhely eset
- 1080p korlát ellenőrzése

---

## MVP-ek

### MVP 1 — Cím alapú keresés

- Felhasználó megadja a címet.
- A bot eldönti, hogy film vagy sorozat.
- A backend keres Sonarrban vagy Radarrban.
- A bot megmutatja a találatot.
- Jóváhagyás után hozzáadja a tartalmat.
- Sorozatoknál 1080p korlát érvényes.

### MVP 2 — Leírás alapú keresés

- A felhasználó csak körülírja a tartalmat.
- Az LLM kinyeri a kulcsszavakat és entitásokat.
- Külső metadata API-k segítségével a rendszer keres.
- Poszterekkel és rövid leírásokkal jelennek meg a találatok.
- A felhasználó kiválasztja a megfelelőt.

### MVP 3 — Mobil és több user támogatás

- Mobilbarát webes UI.
- Telegram és/vagy Discord integráció.
- Session-kezelés.
- Több egyidejű user támogatás queue-val.
- Ajánlórendszer, amely figyeli a nézett és kedvelt tartalmakat.

### MVP 4 — Tárhelymenedzsment

- Tárhelyfigyelés.
- Cache tisztítás.
- 30 napja nem nézett tartalom kezelése.
- Automatikus törlés vagy archiválás.

---

## 3 okos katalógus MVP 3-hoz

### 1. „Nézted már?” katalógus

A felhasználó korábbi nézései alapján épül.

**Bemenet:**
- megtekintett filmek és sorozatok
- befejezett évadok
- pozitív értékelések

**Kimenet:**
- hasonló hangulatú tartalmak
- azonos rendező / színész / műfaj
- folytatásként ajánlott címek

### 2. „Tetszett neked” katalógus

A kedvelt vagy felmentett listák alapján ajánl.

**Bemenet:**
- like / favorite
- mentett listák
- pozitív visszajelzés a botnak

**Kimenet:**
- erősebb súlyozás a hasonló tartalmakra
- jobb személyre szabás
- ritkán nézett, de releváns címek

### 3. „Folytatnád?” katalógus

Az el nem végzett vagy friss epizódos tartalmakra fókuszál.

**Bemenet:**
- félbehagyott sorozatok
- új évad megjelenés
- franchise-ok új részei

**Kimenet:**
- visszatérő ajánlások
- új évad figyelő lista
- automatikus emlékeztetők

---

## Előforduló hibák és megoldások

### 1. API key hibás vagy hiányzik

**Tünet:** 401 / 403 válasz, a bot nem éri el Sonarrt vagy Radarrt.

**Megoldás:**
- generáld újra az API key-t
- ellenőrizd a `.env` fájlt
- nézd meg, hogy a fejlécek helyesen vannak-e beállítva

### 2. Rossz volume jogosultság

**Tünet:** a konténer nem tud írni a mappába.

**Megoldás:**
- ellenőrizd a dataset owner / group beállításokat
- add meg a megfelelő UID/GID értékeket
- használj egységes app usert

### 3. Docker Compose YAML hiba

**Tünet:** a stack nem indul el.

**Megoldás:**
- ellenőrizd az indentálást
- validáld a YAML-t
- nézd meg a `docker compose config` kimenetét

### 4. Ollama modell túl nagy

**Tünet:** lassú válasz, memóriahiány, swap terhelés.

**Megoldás:**
- kisebb modellt válassz
- quantized verziót használj
- csak egy modellt tarts aktívan

### 5. Prowlarr és Sonarr/Radarr nincs összekötve

**Tünet:** az indexerek nem jelennek meg a végpontokban.

**Megoldás:**
- ellenőrizd az app beállításokat
- add meg újra az API key-ket
- teszteld a kapcsolatot mindkét oldalon

### 6. Kevés a hely

**Tünet:** letöltés megakad, cache megtelik.

**Megoldás:**
- cache törlés
- átmeneti fájlok átpakolása HDD-re
- külön tárhely a temp és az archive számára

### 7. Nem talál semmit a cím alapján

**Tünet:** a keresés üres találatot ad.

**Megoldás:**
- válts leírás alapú keresésre
- engedj alternatív címeket
- használd az évszámot és a műfajt a rankingben

---

## Telepítés

### Előfeltételek

- Docker és Docker Compose
- TrueNAS SCALE környezet
- külön apps dataset
- Sonarr, Radarr, Prowlarr elérhetőség
- Ollama, ha lokális LLM-et használsz

### Gyors indulás

```bash
git clone <YOUR_REPO_URL> media-chatbot
cd media-chatbot
cp .env.example .env
docker compose pull
docker compose up -d
```

### Ollama modell letöltése

```bash
docker exec -it media-chatbot-ollama-1 ollama pull llama3.2:3b
```

### Hasznos ellenőrző parancsok

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f ollama
curl http://localhost:11434/api/tags
```

---

## `.env.example`

```env
APP_NAME=media-chatbot
APP_ENV=production
APP_SECRET=change-me-long-random-string
APP_URL=http://localhost:8000

POSTGRES_DB=media_bot
POSTGRES_USER=media_bot
POSTGRES_PASSWORD=change-me
POSTGRES_HOST=postgres
POSTGRES_PORT=5432

REDIS_URL=redis://redis:6379/0

OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:3b

SONARR_URL=http://sonarr:8989
SONARR_API_KEY=change-me-sonarr

RADARR_URL=http://radarr:7878
RADARR_API_KEY=change-me-radarr

PROWLARR_URL=http://prowlarr:9696
PROWLARR_API_KEY=change-me-prowlarr

TMDB_API_KEY=change-me-tmdb
TRAKT_CLIENT_ID=change-me-trakt-id
TRAKT_CLIENT_SECRET=change-me-trakt-secret
TRAKT_ACCESS_TOKEN=change-me-trakt-token

MAX_SERIES_QUALITY=1080p
DOWNLOAD_TEMP_DIR=/data/downloads
MEDIA_ROOT=/data/media
CACHE_DIR=/data/cache
```

---

## `docker-compose.yml` vázlat

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    container_name: media-chatbot-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - /mnt/<POOL>/apps/media-chatbot/postgres:/var/lib/postgresql/data
    networks:
      - media-net

  redis:
    image: redis:7-alpine
    container_name: media-chatbot-redis
    restart: unless-stopped
    volumes:
      - /mnt/<POOL>/apps/media-chatbot/redis:/data
    networks:
      - media-net

  ollama:
    image: ollama/ollama:latest
    container_name: media-chatbot-ollama
    restart: unless-stopped
    volumes:
      - /mnt/<POOL>/apps/media-chatbot/ollama:/root/.ollama
    ports:
      - "11434:11434"
    networks:
      - media-net

  backend:
    build:
      context: ./backend
    container_name: media-chatbot-backend
    restart: unless-stopped
    env_file:
      - .env
    environment:
      POSTGRES_HOST: postgres
      REDIS_URL: ${REDIS_URL}
      OLLAMA_BASE_URL: ${OLLAMA_BASE_URL}
    volumes:
      - /mnt/<POOL>/apps/media-chatbot/data:/data
    ports:
      - "8000:8000"
    depends_on:
      - postgres
      - redis
      - ollama
    networks:
      - media-net

  frontend:
    build:
      context: ./frontend
    container_name: media-chatbot-frontend
    restart: unless-stopped
    environment:
      VITE_API_BASE_URL: http://localhost:8000
    ports:
      - "3000:3000"
    depends_on:
      - backend
    networks:
      - media-net

networks:
  media-net:
    driver: bridge
```

---

## Ajánlott API-hívás minta

### Sonarr / Radarr

- Az API kulcsot `X-Api-Key` headerben add át.
- Használj külön service réteget a backendben.
- A keresés és a hozzáadás két külön lépés legyen.

Példa logika:

```text
1. search(title)
2. rank(results)
3. show 3–10 candidates
4. user select
5. add_to_sonarr_or_radarr(selected_item)
```

---

## Future work

- Több metadata provider integrációja
- Magyar nyelv jobb támogatása
- Intelligensebb fuzzy matching
- Automatikus archiválás törlés helyett
- Role-based access control
- Audit logok
- Személyre szabott ajánlórendszer
- Natív mobilapp
- Hangalapú parancsok

---

## Hasznos linkek

- [TrueNAS Custom Apps](https://apps.truenas.com/managing-apps/installing-custom-apps)
- [TrueNAS API dokumentáció](https://www.truenas.com/docs/scale/api/)
- [Sonarr főoldal](https://sonarr.tv)
- [Sonarr API docs](https://sonarr.tv/docs/api/)
- [Radarr főoldal](https://radarr.video)
- [Radarr API docs](https://radarr.video/docs/api/)
- [Prowlarr főoldal](https://prowlarr.com)
- [Prowlarr API docs](https://prowlarr.com/docs/api/)
- [Ollama API bevezető](https://docs.ollama.com/api/introduction)
- [Ollama model listázás](https://docs.ollama.com/api/tags)
- [TMDb API getting started](https://developer.themoviedb.org/docs/getting-started)
- [Trakt appok és API](https://trakt.tv/apps)

---

## Záró megjegyzés

Ez a rendszer akkor lesz igazán erős, ha a keresés, a metaadatok és a személyre szabott ajánlás külön rétegben működik. Így a felhasználó egyszerűen írhatja le, mit keres, a háttér pedig eldönti, mit kell találni, hová kell adni, és mit érdemes legközelebb ajánlani.

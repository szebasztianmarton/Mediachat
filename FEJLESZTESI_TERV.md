# Mediachat — Fejlesztési terv és állapotjelentés

*Utolsó frissítés: 2026-07-04 (2. kör — P0 + P1 nagy része kész)*

---

## 1. Eddig elkészült — összefoglaló

A 2026. júliusi nagy javítási kör (3 commit: `b8a4a13` → `70de1ef` → `ba5e3b0`) eredménye:

### Repo és infrastruktúra
- Git repo inicializálva, tiszta baseline (titkok és build-artifactok nélkül)
- Éles API kulcsok eltávolítva a `.env.example`-ből, `.gitignore` teljessé téve
- 18 fordított `.js` artifact + halott kód (`NavBar.tsx`, `utils/users.ts`) törölve
- `tsconfig` `noEmit`, Docker non-root user

### Backend (FastAPI)
- **`app_state` global-rebind bug javítva** — a session-kezelés, ajánlások, feedback, async add és mindkét bot (Telegram/Discord) korábban némán halott volt, most működik
- **Valódi autentikáció**: PBKDF2 jelszó-hash, `/api/auth/login|logout|me`, admin/user szerepkörök, session TTL (30 nap), token-visszavonás
- **Users API**: felhasználók listázása/létrehozása/törlése/jelszócseréje (admin)
- Védett végpontok: training/storage/users = admin; search/add/chat/ajánlások = session
- Telegram bot `run_polling` crash javítva + byte-biztos `callback_data`
- Queue-recovery: restart után a függő jobok visszakerülnek a sorba
- Blokkoló I/O kihordva az event loopból (`asyncio.to_thread`), training-kontextus mtime-cache
- Redis-kiesésnél memória-cache fallback (nem 500-as hiba)
- TMDB kulcs nélkül a keresés cím-alapúra esik vissza (nem 400)
- Automatikus séma-mini-migráció, SQLite WAL + busy_timeout
- Sonarr/Radarr **unmonitor** akció implementálva
- Ollama chat logika deduplikálva (`OllamaClient.chat()` + warmup)

### Frontend (React + TS)
- **Közös API kliens** (`utils/api.ts`): token-injektálás, timeout, 401-nél auto-logout
- Login a backendet hívja — **plaintext jelszavak eltűntek a bundle-ből**
- UsersPage a szerveroldali API-ra kötve
- Javított bugok: Settings kapcsolatteszt (mindig offline-t mutatott), Training törlés gomb (láthatatlan volt), chat textarea nem zsugorodott, átfedő health-fetchek, React key ütközések
- ErrorBoundary, LogsPage billentyűzet-kezelhetőség, bootstrap-log spam fix
- **Új oldal: Ajánlások** (`/recommendations`) — watched/liked/continue katalógusok + like/dislike
- **Új oldal: Tárhely** (`/storage`) — volume-ok, cache-takarítás, elavult tartalmak delete/unmonitor
- Chat hozzáadás háttér-jobbal + job-pollinggal
- reMarkable e-ink design konzisztensen (monokróm, snap-invert, zéró animáció)

### Verifikáció
- Backend: élő smoke test (login → 401/403 → token-revoke lánc OK)
- Frontend: `tsc --noEmit` 0 hiba, production build OK
- Új végpontok élőben tesztelve (a stale-lista valódi Radarr-adatot adott)

### 2. kör (P0 + P1 tételek) — 2026-07-04
- **Rate limiting**: login 5/perc/IP (429 + Retry-After), chat 20/perc/user — saját, függőségmentes csúszóablakos limiter
- **Bot allowlist**: `TELEGRAM_ALLOWED_CHAT_IDS` és `DISCORD_ALLOWED_GUILD_IDS` env-változók; üresen figyelmeztető log
- **qBittorrent integráció**: a `/api/torrents` valódi adatot ad (auth + állapot-mapping), a Dashboard widget él
- **Plex/Jellyfin sessions**: a `/api/media/sessions` mindkét szerverből olvas, "Most nézi" widget él
- **Streaming chat (SSE)**: `/api/chat/agent/stream` — chat intentnél token-stream, search/add intentnél result-esemény; a ChatPage folyamatosan írja ki a választ
- **Tesztek**: 16 pytest (auth flow, RBAC, rate limit, unit) + 11 Vitest (api kliens, auth util) — mind zöld
- **CI**: GitHub Actions workflow (frontend: typecheck+test+build; backend: pytest)
- UI: `tabular-nums`, EB Garamond a Login címen, `configured:false` őszinte widget-üzenetek

---

## 2. Ismert hibaforrások és kockázatok

Amit a átvizsgálás feltárt, de **tudatosan még nincs javítva**:

| # | Probléma | Súlyosság | Megjegyzés |
|---|---|---|---|
| 1 | **Nincs rate limiting** a loginon és az LLM végpontokon | Magas | Brute-force és erőforrás-kimerítés ellen védtelen |
| 2 | **Botok auth nélkül** használják a search/add-ot | Magas | Bárki, aki írhat a botnak, hozzáadhat médiát — Telegram chat-ID / Discord szerver allowlist kell |
| 3 | **Nincs egyetlen teszt sem** (backend/frontend) | Magas | Minden refaktor vakrepülés — pytest + Vitest alapkészlet kell |
| 4 | `/api/media/sessions` és `/api/torrents` **stubok** | Közepes | A Dashboard "Most nézi" és "Torrent" widgetek mindig üresek |
| 5 | Settings oldal titkai localStorage-ban | Közepes | Ha a user beírja a kulcsokat, azok plaintext a böngészőben — de már van figyelmeztető banner |
| 6 | Session tokenek plaintextben a DB-ben | Közepes | Token-hash tárolás lenne az ideális (DB-lopásnál a tokenek azonnal használhatók) |
| 7 | Chat előzmények nem perzisztensek | Közepes | Oldalfrissítéskor elveszik a beszélgetés |
| 8 | Mini-migráció ≠ valódi migrációs eszköz | Közepes | Oszlop-hozzáadást tud, átnevezést/törlést nem — Alembic ajánlott |
| 9 | Per-request httpx kliensek | Alacsony | Nincs connection pooling a Sonarr/Radarr/TMDB hívásoknál |
| 10 | SQLite több párhuzamos írónál | Alacsony | WAL segít, de éles TrueNAS telepítésnél Postgres ajánlott |
| 11 | Kézi `renderMarkdown` sanitizer (TrainingPage) | Alacsony | Egy regex-módosításra van az XSS-től — `marked` + `DOMPurify` biztosabb |
| 12 | Bleeding-edge verziók (Vite 8, TS 6, React 19) | Alacsony | Ökoszisztéma-kompatibilitási kockázat |
| 13 | Nincs mobil nézet | Alacsony | Fix 240px sidebar, nincs reszponzív töréspont |
| 14 | Sonarr v4: `languageProfileId` küldése | Alacsony | v4 ignorálja, v3-nak kell — vegyes környezetben rendben |

---

## 3. Fejlesztési terv (prioritási sorrendben)

### P0 — Biztonság és stabilitás (első kör)

1. ~~**Rate limiting**~~ ✅ KÉSZ — saját csúszóablakos limiter (login 5/perc/IP, chat 20/perc/user)
2. ~~**Bot allowlist**~~ ✅ KÉSZ — `TELEGRAM_ALLOWED_CHAT_IDS` / `DISCORD_ALLOWED_GUILD_IDS`
3. ~~**Teszt-alapkészlet**~~ ✅ KÉSZ — 16 pytest + 11 Vitest
4. ~~**CI**~~ ✅ KÉSZ — `.github/workflows/ci.yml` (remote hozzáadásakor aktiválódik)
5. **Alembic** bevezetése a mini-migráció helyett — *elhalasztva: a mini-migráció homelab méretben elég; akkor éri meg, ha oszlop-átnevezés/törlés is kell*

### P1 — Hiányzó magfunkciók

6. ~~**qBittorrent integráció**~~ ✅ KÉSZ — `/api/torrents` élesítve (auth, állapot-mapping); pause/resume még nincs
7. ~~**Plex/Jellyfin sessions**~~ ✅ KÉSZ — `/api/media/sessions` mindkét forrásból
8. ~~**Streaming chat (SSE)**~~ ✅ KÉSZ — `/api/chat/agent/stream` + folyamatosan íródó válasz a UI-ban
9. **Chat előzmények perzisztálása** — beszélgetések DB-be mentése user-enként, beszélgetés-lista a chat oldalsávjában
10. **Backend config API** — a Settings oldal tényleges összekötése a szerverrel: admin-védett `GET/PUT /api/config`, env-felülírások DB-ben tárolva, kliensek újrainicializálása mentéskor. (Amíg nincs, a Settings marad "megjelenítés + figyelmeztetés".)

### P2 — Bővítések

11. **Értesítések** — Telegram/web push, amikor egy hozzáadott film/sorozat ténylegesen letöltődött (Sonarr/Radarr webhook → backend → értesítés)
12. **Jobs oldal** — a queue állapotának admin nézete (futó/kész/hibás jobok, újrapróbálás)
13. **Trakt integráció** — a config mezők már léteznek; watch-history szinkron az ajánló pontosításához
14. **PWA** — manifest + service worker (a README ígéri, de nincs); offline shell + telepíthetőség mobilra
15. **i18n** — a beégetett magyar szövegek kiszervezése (hu/en), pl. `react-i18next`
16. **Prowlarr health** — indexer-állapot a Dashboardon

### P3 — Hosszabb táv

17. **Okosabb ajánló** — embedding-alapú hasonlóság (a TMDB műfaj-egyezés helyett), Plex watch-history mint jel
18. **Modellválasztó a UI-ból** — Ollama `/api/tags` lista, modellváltás chat közben
19. **Felhasználói kvóták** — user-enkénti napi/heti hozzáadási limit
20. **Audit log** — ki mit adott hozzá/törölt, admin nézettel

---

## 4. UI/UX brainstorm

### A motion-kérdés (Framer Motion?)

A jelenlegi design **szándékosan zéró animációjú** (reMarkable e-ink "snap" esztétika). Két konzisztens irány van — a kettő keverése lenne a hiba:

**A) Maradás a tiszta snapnél** *(jelenlegi)* — a brutális azonnaliság maga a design statement. Ekkor Framer Motion nem kell; a pénzt/időt a tipográfiára és a térközökre érdemes költeni.

**B) "E-ink kompatibilis" mikro-motion** — Framer Motion bevezetése szigorú szabályokkal:
- csak `opacity` és `transform` (GPU-barát), **max 120–150 ms**, `ease-out`
- chat üzenet megjelenése: fade + 2px felfelé csúszás (`AnimatePresence`)
- skeleton → tartalom: crossfade a "beugrás" helyett
- oldalváltás: 100 ms fade (layout shift nélkül)
- kártya hover: **marad** a snap-invert (ott az azonnaliság a lényeg)
- `prefers-reduced-motion`-nél minden animáció kikapcsol (már van ilyen CSS-blokk)
- a lapozó/lista átrendezésekhez `layout` prop — az e-ink "újrarajzolás" érzést adja

Ajánlás: **B**, mert a chat-alkalmazásoknál a tartalom-megjelenés hirtelensége zavaró tud lenni — de csak a fenti korlátokkal, különben elvész a karakter.

### Konkrét UI ötletek

| Ötlet | Hatás | Effort |
|---|---|---|
| **Streaming szöveg a chatben** (SSE-vel együtt) — karakterenként megjelenő válasz, e-ink "gépelés" érzés | Nagy | Közepes |
| **Toast-rendszer** — a szétszórt inline hibaüzenetek (Settings, Storage, Users) helyett egységes, jobb felső sarokban megjelenő monokróm toastok | Nagy | Kicsi |
| **Command palette (Ctrl+K)** — gyorskeresés/navigáció: oldalak, "add <cím>", felhasználók | Nagy | Közepes |
| **Mobil: összecsukható sidebar** — 768px alatt hamburger + overlay, vagy alsó tab-bar (Chat/Ajánlások/Dashboard) | Nagy | Közepes |
| **Poszter-rács nézet az Ajánlásoknál** — lista helyett 2:3 arányú poszter-grid, hoverre fekete keret-invert | Közepes | Kicsi |
| **Job progress a topbarban** — futó hozzáadásoknál diszkrét számláló/pötty, kattintva a Jobs oldalra | Közepes | Kicsi |
| **Üres állapot illusztrációk** — 1.5px stroke line-art rajzok (üres chat, üres ajánlások) az ikonok helyett | Közepes | Kicsi |
| **Chat üzenet-akciók** — hoverre másolás/újraküldés ikonok az üzenetbuborékon | Közepes | Kicsi |
| **Billentyű-navigáció a találatkártyákon** — ↑↓ választás, Enter hozzáadás | Közepes | Közepes |
| **Aria-live a chatre** — képernyőolvasó bemondja az új üzenetet; skip-link a sidebarra | Közepes | Kicsi |
| **Dark mode audit** — az inline hex-színek (#F0F0F0 stb.) egy része nem vált dark módban; CSS-változókra (`--surface`, `--border`, `--ink`) érdemes kivezetni | Közepes | Közepes |
| **Onboarding üres rendszernél** — első admin-belépéskor 3 lépéses checklist (env kitöltve? Ollama modell letöltve? első keresés) | Kicsi | Közepes |
| **Egyetlen akcentusszín megfontolása** — pl. a reMarkable-ös halvány kék (#3B82C4) CSAK a fókusz-állapotokra és linkekre; minden más marad monokróm | Ízlés kérdése | Kicsi |

### Tipográfia és részletek

- Az `EB Garamond` most csak a topbar címekben él — a nagy üres állapotok címeiben és a Login címben is használható lenne (több "papír" karakter)
- Inter **variable font** betöltése a 4 külön súly helyett (kisebb, finomabb súlyozás)
- Táblázatos adatoknál (Tárhely, Users) `font-variant-numeric: tabular-nums` — nem ugrálnak a számok
- A `.card` border-radius 4px vs. a chat-buborékok 10px — érdemes egységesíteni (a reMarkable inkább 2–4px)
- Fókusz-gyűrű: az 1.5px fekete outline jó, de a fekete gombokon láthatatlan — ott fehér/dupla outline kell

---

*Ez a dokumentum élő — új kör után frissítendő a 1–2. szakasz, és húzandók ki a kész tételek a 3.-ból.*

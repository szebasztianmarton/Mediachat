# Mediachat — Fejlesztési terv és állapotjelentés

*Utolsó frissítés: 2026-07-10 (ötletlista bővítve — l. 3. szakasz P4 és 4. szakasz vége; a 6. kör óta munkakönyvtárban: passkey/WebAuthn, backup-restore, Ollama modell-lista végpont, 3 új téma — még nincs commitolva)*

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

### 7. kör (Jellyfin analitika, naptár-nézetek, multi-user, össztárhely) — 2026-07-05
- **Jellyfin nézési analitika**: per-user statisztika a Jellyfin natív API-ból (ki mit nézett, mikor, össz/átlag perc, film/epizód bontás, utolsó aktivitás, „épp nézi" %-kal, legutóbb nézett lista) — Dashboard szekció, 60s cache; `GET /api/jellyfin/analytics`
- **Multi-user provisioning**: az admin felület felhasználó-létrehozásakor opcionálisan a Jellyfinben is létrejön (`POST /Users/New`, ugyanaz a jelszó); Plex nem támogatott (plex.tv OAuth kell — jelezve); `GET /api/provisioning/targets`, `provision_jellyfin` flag
- **Naptár 5 nézet** (Sonarr-stílus): Hónap (rács), Hét (7 oszlop), Nap (idővonal), Előrejelzés (14 nap), Lista (agenda dátum szerint csoportosítva) — idő-tartomány, epizód-kód (3x03), runtime; a backend calendar gazdagítva (`code`, `runtime`)
- **Össztárhely**: a média-lemezek összegzése (össz/használt/szabad) + halmozott sáv (film/sorozat/egyéb/szabad) színesen a Dashboardon; `GET /api/library/storage` bővítve
- Tesztek: 48 pytest + 11 Vitest; tsc 0 hiba, build OK. Élő: 7 Jellyfin user 8091 perc, Szeba 44 nézett (78p átlag), 3.2 TB össztárhely

### 6. kör (analitika, naptár, Settings-hub, backup) — 2026-07-05
- **Jellyfin-fix**: a Settings `isConfigured` mostantól a SZERVER állapotát nézi (nem a titkos mezőt, ami újratöltéskor kiürül) — a Jellyfin (és minden titok-alapú szolgáltatás) helyesen konfiguráltnak látszik; a szerveren beállított szolgáltatások automatikusan bekapcsolnak és betöltéskor pingelődnek (zöld/piros)
- **Dashboard analitika**: film/sorozat külön statisztikák (darab, tárhely, évad/epizód, átlag), CSP-biztos inline SVG chartok — donut (film vs sorozat tárhely-arány), area (14 napos hozzáadás-idősor), vízszintes bar (top műfajok); `GET /api/library/stats`
- **Storage bővítés**: Sonarr/Radarr lemez-adatok (diskspace), film/sorozat összméret, top helyfoglalók vízszintes bar-charttal — sorozatoknál **évad-átlaggal** (méret/évad), filmeknél nem (egy fájl); `GET /api/library/storage`
- **Naptár oldal** (`/calendar`): havi rács Sonarr/Radarr megjelenésekkel (film/epizód, letöltve-jelzés), hónap-navigáció; `GET /api/calendar`
- **Settings-hub**: almenü (Szolgáltatások / Értesítések / Biztonsági mentés / Tanítás / Felhasználók) — a Tanítás és Felhasználók kikerült a fő sidebarból; a már beállított kulcsok maszkolva, nem üres mezőként
- **Auto-backup**: napi automatikus mentés (users hash-elt jelszóval, config, tanítófájlok, beszélgetések) a `data/backups`-ba (utolsó 14), kézi indítás + lista a Settingsben; `GET /api/backups`, `POST /api/backups/create`
- Chart-komponensek: `components/Charts.tsx` (DonutChart, AreaChart, HBarChart, UsageBar, fmtBytes)
- Tesztek: 43 pytest (library, backup, calendar RBAC) + 11 Vitest; tsc 0 hiba, build OK

### 5. kör (P2 + biztonság + mobil/PWA) — 2026-07-05
- **Letöltés-kész értesítés**: Sonarr/Radarr webhook (`POST /api/webhooks/{titok}/{sonarr|radarr}`) → Telegram/Discord bot + DB-napló; titok-alapú védelem; teszt gomb és cél-chat/csatorna mezők a Settingsben; `GET /api/notifications`
- **Session token hash-elve**: a DB-ben csak SHA-256 hash tárolódik (a kliens a nyers tokent kapja) — DB-lopásnál a tokenek nem használhatók azonnal; `revoke_session` id alapján
- **Jobs oldal** (`/jobs`, admin): a hozzáadási queue admin nézete (állapotok, időbélyegek, hibás jobok újrapróbálása); `GET /api/jobs`, `POST /api/jobs/{id}/retry`
- **Toast-rendszer**: egységes jobb-felső értesítések (`useToast`), bekötve a Settings mentésbe/teszt-értesítésbe és a Storage akciókba
- **Mobil nézet**: off-canvas sidebar hamburger gombbal + overlay (<768px), reszponzív topbar; a nav-linkek zárják a menüt
- **PWA**: helyes manifest (monokróm ikon, e-ink színek), API-mentes service worker (network-first navigáció, cache-first asset), telepíthető ikon; a régi API-t is cache-elő SW lecserélve
- Tesztek: 37 pytest (token-hash, jobs RBAC, webhook titok/formátum) + 11 Vitest; tsc 0 hiba, build OK

### 4. kör (torrent auto-delete, témák, statisztika) — 2026-07-05
- **Torrent auto-törlés**: befejezett letöltés N óra után automatikusan törlődik (10 percenkénti háttérciklus), minden törlés a `torrent_cleanup_log` táblába kerül; kézi törlés a Dashboard widgetből; visszaszámláló a torrent sorokon; napló a Tárhely oldalon; óra-beállítás a Settings Torrent kártyáján
- **Téma-rendszer**: CSS-változós tokenek, 4 téma (E-ink, Sötét, 3D, Modern) — a sötét mód rendesen kidolgozva; témaválasztó popover a sidebarban
- **Setup wizard**: első bejelentkezéskor témaválasztó képernyő élő előnézettel (userenként egyszer)
- **Training**: súgó panel, MD-fájl feltöltés, formázó toolbar (B/I/H2/lista/kód), Szerkesztés/Osztott/Előnézet nézetek
- **Settings**: valódi zöld/piros/sárga státuszjelzések (badge + pötty)
- **Dashboard statisztika**: könyvtárméret (film/sorozat), torrentek, hozzáadások, felhasználók, beszélgetések + 14 napos hozzáadás-oszlopdiagram (`GET /api/stats`)

### 3. kör (P1 lezárása) — 2026-07-04
- **Chat előzmények**: `conversations` + `conversation_messages` táblák, user-enkénti tulajdonjog-ellenőrzés; a stream végpont automatikusan létrehozza/folytatja a beszélgetést (`meta` esemény), a válaszok — találat-kártyákkal együtt — perzisztálódnak; ChatPage oldalsáv (új/megnyitás/törlés)
- **Backend config API**: `config_overrides` tábla, admin-védett `GET/PUT /api/config`, induláskor betöltött felülírások, mentéskor azonnali kliens-újraépítés; titkok maszkolva (`****xxxx`), sosem utaznak vissza teljes értékkel
- **Settings oldal élesítve**: a 7 támogatott szolgáltatás beállításai a szerverre mentenek és azonnal érvénybe lépnek; titkos mezőknél a placeholder jelzi a beállított értéket
- Tesztek: 22 pytest + 11 Vitest (perzisztencia, tulajdonjog, config-maszkolás, regressziós teszt)

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
9. ~~**Chat előzmények perzisztálása**~~ ✅ KÉSZ — beszélgetések DB-ben user-enként, oldalsáv a ChatPage-ben (megnyitás/törlés/új), a találat-kártyák is visszatöltődnek
10. ~~**Backend config API**~~ ✅ KÉSZ — admin-védett `GET/PUT /api/config`, DB-ben tárolt env-felülírások, kliens-újraépítés mentéskor, maszkolt titkok; a Settings oldal Sonarr/Radarr/Ollama/TMDB/qBittorrent/Plex/Jellyfin szekciói a szerverre mentenek

### P2 — Bővítések

11. ~~**Értesítések**~~ ✅ KÉSZ — Sonarr/Radarr webhook → Telegram/Discord bot + napló, teszt gomb a Settingsben
12. ~~**Jobs oldal**~~ ✅ KÉSZ — admin queue-nézet állapotokkal, hibás jobok újrapróbálásával (`/jobs`)
13. **Trakt integráció** — a config mezők már léteznek; watch-history szinkron az ajánló pontosításához
14. ~~**PWA**~~ ✅ KÉSZ — manifest + API-mentes service worker + telepíthető ikon
15. **i18n** — a beégetett magyar szövegek kiszervezése (hu/en), pl. `react-i18next` — *homelab projektnél alacsony prioritás*
16. **Prowlarr health** — indexer-állapot a Dashboardon
17. ~~**Mobil nézet**~~ ✅ KÉSZ — off-canvas sidebar hamburgerrel, reszponzív töréspontok (<768px)
18. ~~**Session token hash**~~ ✅ KÉSZ — SHA-256 a DB-ben, a kliens a nyers tokent kapja
19. ~~**Toast-rendszer**~~ ✅ KÉSZ — egységes jobb-felső értesítések (`useToast`)

### P3 — Hosszabb táv

20. **Okosabb ajánló** — embedding-alapú hasonlóság (a TMDB műfaj-egyezés helyett), Plex watch-history mint jel
21. **Modellválasztó a UI-ból** — Ollama `/api/tags` lista, modellváltás chat közben
22. **Felhasználói kvóták** — user-enkénti napi/heti hozzáadási limit
23. **Audit log** — ki mit adott hozzá/törölt, admin nézettel

### P4 — Új ötletek (backlog, még nincs priorizálva) — 2026-07-10

**Biztonság**

24. 🔧 **Passkey (WebAuthn) login** — folyamatban a munkakönyvtárban (`webauthn_service.py`, `webauthn_credentials` tábla, register/login/list/delete végpontok, `SessionService.create_session_for_user` jelszó nélküli session-kiadáshoz); hátra van: frontend UI (Login gomb, Settings-kártya a regisztrált kulcsokhoz), és a `webauthn_origin`/`webauthn_rp_id` élesben a tényleges domainre állítása
25. **Aktív session-ek / eszközök kezelése** — Settings-kártya a bejelentkezett eszközökről (platform, utolsó aktivitás, IP), egyenkénti kirúgás — logikus párja a passkey-nek, mert onnantól több hitelesítési mód fut egyszerre
26. **TOTP mint második faktor** — jelszó/passkey mellé opcionális időalapú kód, admin fiókra kötelezővé tehető
27. **Mentés-titkosítás** — a `data/backups/*.json` jelszó-hasheket, session-tokent és API-kulcsokat (config overrides) is tartalmaz; egy külön mentési jelszóval AES-titkosítás, mielőtt lemezre kerül

**Backup & restore**

28. **Backup visszaállítás előnézete** — a most implementált `POST /api/backups/{filename}/restore` jelenleg vakon felülír; egy `GET .../restore/preview` diffet mutathatna (hány user/beszélgetés/config-kulcs változna) commitolás előtt
29. **Off-site mentés** — rclone/S3-kompatibilis célra másolás a helyi 14 mentés mellett, homelab-lemezhiba esetére

**Integrációk**

30. 🔧 **Modellválasztó a UI-ból** (l. P3 #21) — a `GET /api/ollama/models` végpont kész a munkakönyvtárban, csak a UI-kötés (Settings dropdown vagy ChatPage modellváltó) hiányzik még
31. **Overseerr/Ombi-stílusú kérés-jóváhagyás** — nem-admin userek "kérhetnek" médiát ahelyett, hogy közvetlen hozzáadási jogot kapnának; admin egy kattintással jóváhagy/elutasít a Jobs oldal mintájára
32. **Web Push értesítés** — Telegram/Discord mellett natív böngésző-push a letöltés-kész eseményre; a PWA infrastruktúra (service worker) már megvan hozzá

**Infrastruktúra**

33. **Strukturált logging** — jelenleg `logging.basicConfig` sima szöveges kimenettel; homelab Grafana/Loki-integrációhoz JSON-log formátum hasznos lenne
34. **Docker healthcheck** — a compose-ban egészség-ellenőrzés + auto-restart policy a backend/worker konténerekre

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

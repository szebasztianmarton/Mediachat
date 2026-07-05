# Mediachat — TrueNAS SCALE telepítés (lépésről lépésre)

Ez az útmutató a **TrueNAS SCALE 24.10 (Electric Eel) vagy újabb** verzióra
készült, amely natív **Docker**-t használ. A telepítés forrásból buildel — nincs
szükség előre feltöltött registry-image-ekre.

> Régebbi TrueNAS SCALE (k3s/Helm alapú, 24.04 vagy korábbi) esetén a Docker
> Compose nem elérhető natívan — frissíts 24.10+-ra, vagy futtasd egy külön
> Linux VM-ben / jailban.

---

## 1. Előfeltételek

- TrueNAS SCALE **24.10+**
- Egy **dataset** az alkalmazás adatainak, pl. `tank/apps/mediachat`
- SSH-hozzáférés bekapcsolva (**System Settings → Services → SSH**), vagy a
  beépített **Shell** (System Settings → Shell)
- Elérhető **Sonarr** és **Radarr** (API kulccsal). Opcionálisan Jellyfin/Plex,
  qBittorrent/Transmission, TMDB kulcs.

---

## 2. A repó a poolra

SSH-val lépj be a NAS-ra, majd klónozd a projektet a datasetbe:

```bash
cd /mnt/tank/apps          # a saját pool/dataset útvonalad
git clone https://github.com/szebasztianmarton/Mediachat.git mediachat
cd mediachat
```

> **A repó privát** — a sima `git clone` felhasználónevet/jelszót fog kérni, a
> GitHub pedig jelszóval már nem enged be, **Personal Access Tokent** (PAT) kér
> jelszó helyett:
> 1. GitHubon: **Settings → Developer settings → Personal access tokens →
>    Fine-grained tokens → Generate new token**, csak a `Mediachat` repóra,
>    `Contents: Read-only` joggal.
> 2. A klónozásnál felhasználónévnek add meg a GitHub felhasználóneved, jelszónak
>    a generált tokent.
> 3. Vagy egyszerűbben, írd bele a tokent az URL-be (ne oszd meg máshol, mert a
>    shell historyban is megmarad):
>    `git clone https://<TOKEN>@github.com/szebasztianmarton/Mediachat.git mediachat`
>
> `git pull`-nál (frissítéskor) a token ugyanígy szükséges, hacsak nem
> `git config credential.helper store`-ral elmentetted egyszer.

> Ha a NAS-on nincs `git` parancs: **System Settings → Advanced → Init/Shutdown
> Scripts**-szel sem éri meg bajlódni — a legtöbb TrueNAS SCALE image-ben git
> már eleve telepítve van. Ha mégsem, `apt install git` nem működik (a NAS
> read-only base OS-en fut) — ilyenkor tölts le egy git-tartalmazó Docker
> image-et, vagy csomagold zip-be a repót és töltsd fel SMB/SCP-vel.

---

## 3. A `.env` kitöltése

```bash
cp .env.example .env
nano .env
```

A legfontosabb mezők:

| Változó | Érték |
| --- | --- |
| `POSTGRES_PASSWORD` | erős jelszó (a Postgreshez) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | az első admin fiók — **változtasd meg!** |
| `APP_SECRET` | hosszú véletlen szöveg |
| `SONARR_URL` / `SONARR_API_KEY` | Sonarr elérés (lásd lentebb az URL-ről) |
| `RADARR_URL` / `RADARR_API_KEY` | Radarr elérés |
| `TMDB_API_KEY` | TMDb kulcs (leírás-alapú kereséshez) |
| `OLLAMA_MODEL` | pl. `llama3.2:3b` vagy `gemma2:2b` |
| `CORS_ORIGINS` | `http://<NAS_IP>:3000` |

**Sonarr/Radarr URL a konténerből:** ha a Sonarr/Radarr **ugyanezen a NAS-on**
fut másik appként, a `host.docker.internal` már be van kötve:
`SONARR_URL=http://host.docker.internal:8989`. Ha külön gépen van, add meg az
IP-jét: `http://192.168.1.57:8989`.

> A Jellyfin/Plex/torrent kulcsokat **nem kötelező** ide beírni — bejelentkezés
> után a **Beállítások** oldalon is megadhatod őket (a szerverre mentődnek).

---

## 4. Jogosultságok (fontos!)

A backend a konténerben `uid 1000` felhasználóként fut. Az adat-mappáknak
írhatónak kell lenniük számára:

```bash
mkdir -p data/postgres data/redis data/ollama data/app data/backend
chown -R 1000:1000 data/app data/backend
```

> TrueNAS-on a dataset ACL-je felülírhatja ezt. Ha „permission denied" hibát
> látsz a backend logban, a Datasets → (a dataset) → Edit ACL alatt adj írási
> jogot a `1000`-es UID-nak, vagy állítsd a dataset ownert `1000:1000`-re.

---

## 5. Indítás

```bash
docker compose -f docker-compose.truenas.yml up -d --build
```

Az első build pár percig tart (letölti a Node/Python image-eket, buildel). Nézd
a logokat:

```bash
docker compose -f docker-compose.truenas.yml logs -f backend
```

Amikor a backend elindult, a felület elérhető: **`http://<NAS_IP>:3000`**

---

## 6. Ollama modell letöltése

Az AI chathez le kell tölteni a modellt (egyszeri):

```bash
docker exec -it media-chatbot-ollama ollama pull llama3.2:3b
```

> A modellnek egyeznie kell a `.env`-beli `OLLAMA_MODEL` értékkel. Kisebb gép
> esetén maradj 1B–3B körül (pl. `gemma2:2b`). GPU-hoz lásd a compose-ban a
> kikommentelt `deploy:` blokkot.

---

## 7. Első belépés

1. Nyisd meg: `http://<NAS_IP>:3000`
2. Jelentkezz be a `.env`-ben megadott `ADMIN_USERNAME` / `ADMIN_PASSWORD`-del
3. Első belépéskor a **téma-varázsló** fogad — válassz témát
4. **Beállítások → Szolgáltatások**: itt ellenőrizheted/beállíthatod a
   kapcsolatokat (zöld = OK, piros = hiba). A „Kapcsolat tesztelése" gomb élőben
   pingeli a szolgáltatást.

---

## 8. Letöltés-kész értesítés (opcionális)

A **Beállítások → Értesítések** alatt adj meg egy webhook titkot, majd a
Sonarr/Radarrban: **Settings → Connect → Webhook**,
URL: `http://<NAS_IP>:8000/api/webhooks/<TITOK>/sonarr` (ill. `/radarr`),
metódus POST, trigger: **On Import**. Így a bot (Telegram/Discord) szól, amikor
egy tartalom ténylegesen letöltődött.

---

## 9. Frissítés (új verzió)

```bash
cd /mnt/tank/apps/mediachat
git pull
docker compose -f docker-compose.truenas.yml up -d --build
```

Az adatok (Postgres, tanítófájlok, mentések, Ollama modellek) a `./data`
mappákban maradnak — a frissítés nem törli őket.

---

## 10. Hasznos parancsok

```bash
# állapot
docker compose -f docker-compose.truenas.yml ps

# logok
docker compose -f docker-compose.truenas.yml logs -f backend
docker compose -f docker-compose.truenas.yml logs -f frontend

# leállítás
docker compose -f docker-compose.truenas.yml down

# újraindítás egy szolgáltatásra
docker compose -f docker-compose.truenas.yml restart backend
```

---

## 11. Hibaelhárítás

| Tünet | Megoldás |
| --- | --- |
| A felület nem jön be | `docker compose ... ps` — fut a `frontend` és `backend`? Tűzfal/port 3000 nyitva? |
| Backend „permission denied" | 4. lépés — `chown 1000:1000 data/app data/backend`, vagy dataset ACL |
| Sonarr/Radarr offline a UI-ban | Rossz URL/kulcs. Ugyanazon NAS-on: `host.docker.internal`; külön gépen: IP. A `.env` módosítás után `restart backend` |
| A chat „időtúllépés" | Az Ollama modell CPU-n lassú — válts kisebb modellre (`gemma2:2b`), vagy adj GPU-t |
| Nem streamel a chat | A javított `nginx.conf` kell (SSE puffer ki) — friss build (`up -d --build`) |
| Az értesítés nem megy | A `WEBHOOK_SECRET` üres, vagy nincs cél Telegram/Discord chat beállítva |

---

## Alternatíva: TrueNAS „Custom App" (web UI)

Ha nem SSH-t szeretnél: **Apps → Discover Apps → Custom App → Install via YAML**,
és illeszd be a `docker-compose.truenas.yml` tartalmát. Ehhez a repónak elérhető
kell lennie a build contextekhez (`./backend`, `./frontend`) — a legmegbízhatóbb
mégis az SSH-s `docker compose ... up -d --build` a klónozott repóból.

# Home Assistant – Media Assistant Integráció terv

## Áttekintés

Ez a dokumentum leírja, hogyan lehet a Media Assistantet Home Assistanthoz integrálni. Az integráció három fő részből áll:
1. **Állapot monitorozás** – HA sensorok a szolgáltatások státuszának megjelenítéséhez
2. **Vezérlés** – HA scriptek és automatizálások Sonarr/Radarr parancsokhoz
3. **Chat interface** – Media Assistant UI megjelenítése HA dashboardon belül

---

## 1. Előfeltételek

- Home Assistant OS vagy Supervised (2024.x+)
- Media Assistant backend fut a hálózaton (pl. `http://192.168.1.x:8000`)
- Home Assistant és Media Assistant ugyanazon a lokális hálózaton

---

## 2. REST Sensorok – Szolgáltatás állapot monitorozás

A `/health` endpoint JSON-t ad vissza, amelyet HA REST sensorként olvashat.

### `configuration.yaml`

```yaml
sensor:
  - platform: rest
    name: "Media Assistant Health"
    resource: "http://192.168.1.100:8000/health"
    scan_interval: 30
    value_template: "{{ value_json.status }}"
    json_attributes:
      - checks

  - platform: template
    sensors:
      media_sonarr_status:
        friendly_name: "Sonarr"
        value_template: >
          {% if state_attr('sensor.media_assistant_health', 'checks') %}
            {% if state_attr('sensor.media_assistant_health', 'checks').sonarr %}online{% else %}offline{% endif %}
          {% else %}unknown{% endif %}
        icon_template: mdi:television-play

      media_radarr_status:
        friendly_name: "Radarr"
        value_template: >
          {% if state_attr('sensor.media_assistant_health', 'checks') %}
            {% if state_attr('sensor.media_assistant_health', 'checks').radarr %}online{% else %}offline{% endif %}
          {% else %}unknown{% endif %}
        icon_template: mdi:movie-open

      media_ollama_status:
        friendly_name: "Ollama AI"
        value_template: >
          {% if state_attr('sensor.media_assistant_health', 'checks') %}
            {% if state_attr('sensor.media_assistant_health', 'checks').ollama %}online{% else %}offline{% endif %}
          {% else %}unknown{% endif %}
        icon_template: mdi:brain
```

---

## 3. Dashboard Panel – Iframe megjelenítés

A Media Assistant UI közvetlenül beágyazható egy HA Lovelace panelbe.

### `configuration.yaml`

```yaml
panel_iframe:
  media_assistant:
    title: "Media Assistant"
    icon: mdi:movie-play
    url: "http://192.168.1.100:5173"
```

> **Megjegyzés:** Éles használathoz `https`-t javasolt beállítani, különben a böngésző blokkolhatja a mixed content-et. Megoldás: reverse proxy (Nginx Proxy Manager) SSL-lel.

---

## 4. RESTful Commandok – Sonarr / Radarr vezérlés

HA scriptek segítségével közvetlenül lehet parancsokat küldeni a Media Assistant backend felé.

### `configuration.yaml`

```yaml
rest_command:
  media_chat_message:
    url: "http://192.168.1.100:8000/chat"
    method: POST
    headers:
      Content-Type: "application/json"
    payload: '{"message": "{{ message }}"'
    content_type: "application/json"

  sonarr_search:
    url: "http://192.168.1.100:8989/api/v3/series/lookup"
    method: GET
    headers:
      X-Api-Key: !secret sonarr_api_key
    params:
      term: "{{ term }}"
```

### `secrets.yaml`

```yaml
sonarr_api_key: "abc123..."
radarr_api_key: "def456..."
```

---

## 5. HA Script – Media lekérdezés chatből

```yaml
script:
  kérdezd_meg_media_assistant:
    alias: "Kérdezd meg a Media Assistantet"
    description: "Üzenetet küld a chat API-nak és értesítést jelenít meg a válaszról"
    fields:
      uzenet:
        description: "Az üzenet szövege"
        example: "Add hozzá a Dune 2-t a Radarrhoz"
    sequence:
      - service: rest_command.media_chat_message
        data:
          message: "{{ uzenet }}"
        response_variable: chat_valasz
      - service: notify.persistent_notification
        data:
          title: "Media Assistant válasz"
          message: "{{ chat_valasz.content.response }}"
```

---

## 6. Automatizálások

### Értesítés, ha valamelyik szolgáltatás leáll

```yaml
automation:
  - alias: "Media szolgáltatás leállt"
    trigger:
      - platform: state
        entity_id: sensor.media_sonarr_status
        to: "offline"
      - platform: state
        entity_id: sensor.media_radarr_status
        to: "offline"
      - platform: state
        entity_id: sensor.media_ollama_status
        to: "offline"
    action:
      - service: notify.mobile_app
        data:
          title: "⚠️ Media Assistant"
          message: "{{ trigger.to_state.attributes.friendly_name }} leállt!"
```

### Napi összefoglaló – hány sorozat/film vár letöltésre (Sonarr API)

```yaml
automation:
  - alias: "Napi media összefoglaló"
    trigger:
      - platform: time
        at: "08:00:00"
    action:
      - service: rest_command.media_chat_message
        data:
          message: "Mi a mai nap legfontosabb médiaeseménye?"
        response_variable: valasz
      - service: notify.mobile_app
        data:
          title: "🎬 Media Assistant"
          message: "{{ valasz.content.response }}"
```

---

## 7. Lovelace Dashboard kártya

```yaml
type: vertical-stack
cards:
  - type: markdown
    content: "## 🎬 Media Assistant"

  - type: entities
    title: Szolgáltatások állapota
    entities:
      - entity: sensor.media_sonarr_status
        name: Sonarr (TV)
      - entity: sensor.media_radarr_status
        name: Radarr (Filmek)
      - entity: sensor.media_ollama_status
        name: Ollama (AI)

  - type: iframe
    url: "http://192.168.1.100:5173/chat"
    aspect_ratio: "16:9"
    title: Chat
```

---

## 8. HACS Custom Component (jövőbeli fejlesztés)

Hosszú távon érdemes egy dedikált HACS integrációt fejleszteni, amely:

- Automatikusan felderíti a Media Assistant backended a hálózaton (mDNS/Zeroconf)
- Config flow-t biztosít HA felületén (nincs kézi YAML szerkesztés)
- Natív entitásokat hoz létre (switch az egyes szolgáltatásokhoz, sensor a letöltési állapothoz)
- Valós idejű Websocket kapcsolatot tart fenn

### Szükséges fájlok:
```
custom_components/media_assistant/
├── __init__.py          # Integráció belépési pont
├── config_flow.py       # Setup wizard
├── coordinator.py       # DataUpdateCoordinator (polling /health)
├── sensor.py            # Állapot sensorok
├── switch.py            # Szolgáltatás ki/be kapcsolás
├── manifest.json        # HACS metaadatok
└── strings.json         # Fordítások
```

---

## 9. Biztonsági megfontolások

| Kockázat | Megoldás |
|---|---|
| Media Assistant HTTP-n fut | Nginx Proxy Manager + Let's Encrypt SSL |
| API kulcsok HA config-ban | `secrets.yaml` használata + HA Vault addon |
| Iframe cross-origin | `X-Frame-Options: ALLOWALL` header a backenden |
| Nyílt hálózati elérés | HA mögé tenni, Nabu Casa vagy VPN tunnelen elérni |

---

## 10. Gyors start checklist

- [ ] Media Assistant backend elérhető a HA-val azonos hálózaton
- [ ] `/health` endpoint válaszol JSON-nel
- [ ] REST sensor hozzáadva `configuration.yaml`-hoz
- [ ] `configuration.yaml` újratöltve (`Developer Tools → YAML → Reload`)
- [ ] Panel iframe beállítva
- [ ] API kulcsok `secrets.yaml`-ba kerültek
- [ ] SSL beállítva éles használathoz (opcionális, de ajánlott)

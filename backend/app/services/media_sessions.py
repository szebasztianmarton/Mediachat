import ipaddress
import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_PLEX_TYPE_MAP = {"movie": "movie", "episode": "episode", "track": "music"}
_JELLYFIN_TYPE_MAP = {"Movie": "movie", "Episode": "episode", "Audio": "music"}

# Magasság (px) → ember-olvasható felbontás-címke.
_RES_LABELS = [(2160, "4K"), (1440, "1440p"), (1080, "1080p"), (720, "720p"), (480, "480p")]


def _res_label(height: int | None) -> str | None:
    if not height:
        return None
    for threshold, label in _RES_LABELS:
        if height >= threshold:
            return label
    return f"{height}p"


def _is_remote(endpoint: str | None) -> bool | None:
    """True, ha a lejátszás LAN-on kívülről (távolról) jön. None, ha nem
    dönthető el az IP-ből."""
    if not endpoint:
        return None
    host = endpoint.strip()
    if host.startswith("["):  # [IPv6]:port
        host = host[1:].split("]", 1)[0]
    elif host.count(":") == 1:  # IPv4:port
        host = host.split(":", 1)[0]
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return None
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    return not (ip.is_private or ip.is_loopback or ip.is_link_local)


def _norm_decision(decision: str | None) -> str:
    """Plex/Jellyfin sáv-döntés → egységes: direct | copy | transcode."""
    d = (decision or "").lower()
    if d in ("transcode", "burn"):
        return "transcode"
    if d == "copy":
        return "copy"
    return "direct"


def _decision_target(decision: str, target_codec: str | None) -> str:
    """Ember-olvasható cél-címke a sáv-döntéshez (a ↳ sor a UI-ban)."""
    if decision == "transcode":
        return f"{target_codec.upper()} — Átkódolás" if target_codec else "Átkódolás"
    if decision == "copy":
        return "Közvetlen adatfolyam"
    return "Közvetlen lejátszás"


def _stream_entry(source: str, decision: str, target_codec: str | None) -> dict[str, Any]:
    norm = _norm_decision(decision)
    return {"source": source or "?", "decision": norm, "target": _decision_target(norm, target_codec)}


def _overall_play_method(streams: dict[str, Any]) -> str:
    return "transcode" if any(s and s["decision"] == "transcode" for s in streams.values()) else "direct"


# ── Jellyfin sáv-forrás címke ─────────────────────────────────────────────────


def _jf_stream_source(stream: dict[str, Any]) -> str:
    if stream.get("DisplayTitle"):
        return stream["DisplayTitle"]
    lang = (stream.get("DisplayLanguage") or stream.get("Language") or "").title()
    codec = (stream.get("Codec") or "").upper()
    if stream.get("Type") == "Video":
        res = _res_label(stream.get("Height")) or ""
        return " ".join(p for p in (res, f"({codec})" if codec else "") if p) or "?"
    layout = stream.get("ChannelLayout") or (f"{stream.get('Channels')}ch" if stream.get("Channels") else "")
    inner = " ".join(p for p in (codec, layout) if p)
    if lang and inner:
        return f"{lang} ({inner})"
    return lang or inner or "?"


class MediaSessionsService:
    """Aktív lejátszási munkamenetek Plexből és/vagy Jellyfinből, a "Most nézi"
    widget gazdag (Tautulli-szerű) kártyáihoz: sávonkénti forrás→döntés
    (videó/hang/felirat), átkódolás, eszköz/kliens, hálózat, poszter, avatar."""

    @property
    def configured(self) -> bool:
        return bool(settings.plex_url and settings.plex_token) or bool(
            settings.jellyfin_url and settings.jellyfin_api_key
        )

    async def list_sessions(self) -> list[dict[str, Any]]:
        sessions: list[dict[str, Any]] = []
        if settings.plex_url and settings.plex_token:
            try:
                sessions.extend(await self._plex_sessions())
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                logger.warning("Plex sessions lekérdezés sikertelen: %s", exc)
        if settings.jellyfin_url and settings.jellyfin_api_key:
            try:
                sessions.extend(await self._jellyfin_sessions())
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                logger.warning("Jellyfin sessions lekérdezés sikertelen: %s", exc)
        return sessions

    @staticmethod
    def summarize(sessions: list[dict[str, Any]]) -> dict[str, Any]:
        """Szerver-terhelés összesítő: hány stream megy, ebből mennyi
        átkódolás/távoli, és mennyi az átkódolási sávszélesség."""
        playing = sum(1 for s in sessions if s.get("state") == "playing")
        transcoding = sum(1 for s in sessions if s.get("play_method") == "transcode")
        remote = sum(1 for s in sessions if s.get("remote"))
        transcode_bitrate = sum(
            int(s.get("bitrate_kbps") or 0) for s in sessions if s.get("play_method") == "transcode"
        )
        return {
            "total": len(sessions),
            "playing": playing,
            "paused": len(sessions) - playing,
            "transcoding": transcoding,
            "direct": len(sessions) - transcoding,
            "remote": remote,
            "transcode_bitrate_kbps": transcode_bitrate,
        }

    async def fetch_image(self, source: str, path: str) -> tuple[bytes, str] | None:
        """Poszter/avatar letöltése a konfigurált média-szerverről (a token
        szerver-oldalon marad). A hívó validálja, hogy a path relatív."""
        if source == "plex":
            if not (settings.plex_url and settings.plex_token):
                return None
            url = f"{settings.plex_url.rstrip('/')}{path}"
            params: dict[str, str] = {"X-Plex-Token": settings.plex_token}
            headers: dict[str, str] = {}
        elif source == "jellyfin":
            if not (settings.jellyfin_url and settings.jellyfin_api_key):
                return None
            url = f"{settings.jellyfin_url.rstrip('/')}{path}"
            params = {}
            headers = {"X-Emby-Token": settings.jellyfin_api_key}
        else:
            return None
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(url, params=params, headers=headers)
        except httpx.HTTPError as exc:
            logger.warning("Média kép proxy hiba (%s): %s", source, exc)
            return None
        if r.status_code >= 400:
            return None
        return r.content, r.headers.get("content-type", "image/jpeg")

    # ── Plex ─────────────────────────────────────────────────────────────────

    async def _plex_sessions(self) -> list[dict[str, Any]]:
        base = settings.plex_url.rstrip("/")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{base}/status/sessions",
                headers={"X-Plex-Token": settings.plex_token, "Accept": "application/json"},
            )
            response.raise_for_status()
            metadata = (response.json().get("MediaContainer") or {}).get("Metadata") or []

        return [s for item in metadata if (s := self._parse_plex_session(item)) is not None]

    @staticmethod
    def _parse_plex_session(item: dict[str, Any]) -> dict[str, Any] | None:
        media_type = _PLEX_TYPE_MAP.get(item.get("type") or "")
        if media_type is None:
            return None

        if media_type == "episode":
            title = item.get("grandparentTitle") or "?"
            season, episode = item.get("parentIndex"), item.get("index")
            code = f"S{season} · E{episode}" if season is not None and episode is not None else ""
            subtitle = f"{code} {item.get('title') or ''}".strip() or None
            poster = item.get("grandparentThumb") or item.get("thumb")
        else:
            year = item.get("year")
            title = f"{item.get('title') or '?'}{f' ({year})' if year else ''}"
            subtitle = None
            poster = item.get("thumb") or item.get("art")

        player = item.get("Player") or {}
        session_info = item.get("Session") or {}
        transcode = item.get("TranscodeSession") or {}

        media = (item.get("Media") or [{}])[0]
        part = (media.get("Part") or [{}])[0]
        raw_streams = part.get("Stream") or []

        def _selected(stype: int) -> dict[str, Any] | None:
            typed = [s for s in raw_streams if s.get("streamType") == stype]
            for s in typed:
                if str(s.get("selected")) in ("1", "True", "true"):
                    return s
            return typed[0] if typed and stype == 1 else None

        def _src(stream: dict[str, Any]) -> str:
            return stream.get("extendedDisplayTitle") or stream.get("displayTitle") or "?"

        streams: dict[str, Any] = {}
        video_s = _selected(1)
        if video_s:
            streams["video"] = _stream_entry(
                _src(video_s), video_s.get("decision") or transcode.get("videoDecision"), transcode.get("videoCodec")
            )
        audio_s = _selected(2)
        if audio_s:
            streams["audio"] = _stream_entry(
                _src(audio_s), audio_s.get("decision") or transcode.get("audioDecision"), transcode.get("audioCodec")
            )
        subtitle_s = _selected(3)
        if subtitle_s:
            streams["subtitle"] = _stream_entry(
                _src(subtitle_s), subtitle_s.get("decision") or transcode.get("subtitleDecision"), None
            )

        duration_ms = int(item.get("duration") or 0)
        offset_ms = int(item.get("viewOffset") or 0)
        player_state = (player.get("state") or "").lower()

        location = (session_info.get("location") or "").lower()
        if location:
            remote = location == "wan"
        elif player.get("local") is not None:
            remote = str(player.get("local")).lower() not in ("1", "true")
        else:
            remote = _is_remote(player.get("address"))

        avatar = (item.get("User") or {}).get("thumb")
        bandwidth = session_info.get("bandwidth")

        return {
            "id": f"plex-{item.get('sessionKey') or title}",
            "username": (item.get("User") or {}).get("title") or "Ismeretlen",
            "user_avatar": avatar,
            "title": title,
            "subtitle": subtitle,
            "poster": poster,
            "type": media_type,
            "source": "plex",
            "state": "paused" if player_state == "paused" else "playing",
            "progressPercent": round(offset_ms / duration_ms * 100) if duration_ms else 0,
            "position_sec": offset_ms // 1000,
            "duration_sec": duration_ms // 1000,
            "runtime_min": round(duration_ms / 60000) if duration_ms else None,
            "device": player.get("platform") or player.get("device") or player.get("title"),
            "client": player.get("product"),
            "secure": str(player.get("secure")).lower() in ("1", "true"),
            "remote": remote,
            "address": player.get("address"),
            "bitrate_kbps": int(bandwidth) if bandwidth else None,
            "play_method": _overall_play_method(streams),
            "transcode_reasons": [],
            "streams": streams,
        }

    # ── Jellyfin ─────────────────────────────────────────────────────────────

    async def _jellyfin_sessions(self) -> list[dict[str, Any]]:
        base = settings.jellyfin_url.rstrip("/")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{base}/Sessions",
                headers={"X-Emby-Token": settings.jellyfin_api_key},
            )
            response.raise_for_status()
            data = response.json()

        return [s for entry in data if (s := self._parse_jellyfin_session(entry)) is not None]

    @staticmethod
    def _parse_jellyfin_session(entry: dict[str, Any]) -> dict[str, Any] | None:
        item = entry.get("NowPlayingItem")
        if not item:
            return None
        media_type = _JELLYFIN_TYPE_MAP.get(item.get("Type") or "")
        if media_type is None:
            return None

        if media_type == "episode":
            title = item.get("SeriesName") or "?"
            season, episode = item.get("ParentIndexNumber"), item.get("IndexNumber")
            code = f"S{season} · E{episode}" if season is not None and episode is not None else ""
            subtitle = f"{code} {item.get('Name') or ''}".strip() or None
            poster_id = item.get("SeriesId") or item.get("Id")
        else:
            year = item.get("ProductionYear")
            title = f"{item.get('Name') or '?'}{f' ({year})' if year else ''}"
            subtitle = None
            poster_id = item.get("Id")
        poster = f"/Items/{poster_id}/Images/Primary" if poster_id else None

        play_state = entry.get("PlayState") or {}
        transcoding = entry.get("TranscodingInfo") or {}
        is_transcoding = (play_state.get("PlayMethod") == "Transcode") or bool(entry.get("TranscodingInfo"))
        raw_streams = item.get("MediaStreams") or []

        def _decision(is_direct: Any) -> str:
            if is_transcoding and not is_direct:
                return "transcode"
            if is_transcoding:
                return "copy"
            return "direct"

        streams: dict[str, Any] = {}
        video = next((s for s in raw_streams if s.get("Type") == "Video"), None)
        if video:
            streams["video"] = _stream_entry(
                _jf_stream_source(video), _decision(transcoding.get("IsVideoDirect")), transcoding.get("VideoCodec")
            )

        audio_idx = play_state.get("AudioStreamIndex")
        audio = None
        if audio_idx is not None and 0 <= audio_idx < len(raw_streams) and raw_streams[audio_idx].get("Type") == "Audio":
            audio = raw_streams[audio_idx]
        else:
            audio = next((s for s in raw_streams if s.get("Type") == "Audio" and s.get("IsDefault")), None) \
                or next((s for s in raw_streams if s.get("Type") == "Audio"), None)
        if audio:
            streams["audio"] = _stream_entry(
                _jf_stream_source(audio), _decision(transcoding.get("IsAudioDirect")), transcoding.get("AudioCodec")
            )

        sub_idx = play_state.get("SubtitleStreamIndex")
        if sub_idx is not None and 0 <= sub_idx < len(raw_streams) and raw_streams[sub_idx].get("Type") == "Subtitle":
            # A Jellyfin nem jelzi megbízhatóan a felirat-átkódolást → forrás + közvetlen.
            streams["subtitle"] = _stream_entry(_jf_stream_source(raw_streams[sub_idx]), "direct", None)

        reasons = transcoding.get("TranscodeReasons") or []
        if isinstance(reasons, str):
            reasons = [reasons]
        bitrate = transcoding.get("Bitrate")
        runtime_ticks = int(item.get("RunTimeTicks") or 0)
        position_ticks = int(play_state.get("PositionTicks") or 0)

        return {
            "id": f"jellyfin-{entry.get('Id') or title}",
            "username": entry.get("UserName") or "Ismeretlen",
            "user_avatar": None,
            "title": title,
            "subtitle": subtitle,
            "poster": poster,
            "type": media_type,
            "source": "jellyfin",
            "state": "paused" if bool(play_state.get("IsPaused")) else "playing",
            "progressPercent": round(position_ticks / runtime_ticks * 100) if runtime_ticks else 0,
            "position_sec": position_ticks // 10_000_000,
            "duration_sec": runtime_ticks // 10_000_000,
            "runtime_min": runtime_ticks // (10_000_000 * 60) if runtime_ticks else None,
            "device": entry.get("DeviceName"),
            "client": entry.get("Client"),
            "secure": True,  # Jellyfin session-lista nem jelzi; ne mutassunk hamis "nem biztonságos"-at
            "remote": _is_remote(entry.get("RemoteEndPoint")),
            "address": (entry.get("RemoteEndPoint") or "").split(":")[0] or None,
            "bitrate_kbps": int(bitrate) // 1000 if bitrate else None,
            "play_method": _overall_play_method(streams),
            "transcode_reasons": list(reasons),
            "streams": streams,
        }

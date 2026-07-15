"""A gazdag (Tautulli-szerű) lejátszási session-parser egységtesztjei — HTTP
nélkül, közvetlenül a tiszta parser/aggregáló függvényeken."""

from app.services.media_sessions import MediaSessionsService, _is_remote

_TRANSCODE = {
    "Id": "sess1",
    "UserName": "anna",
    "DeviceName": "Living Room TV",
    "Client": "Jellyfin Android TV",
    "RemoteEndPoint": "192.168.1.20",
    "PlayState": {
        "PositionTicks": 3_000_000_000,
        "IsPaused": False,
        "PlayMethod": "Transcode",
        "AudioStreamIndex": 2,
        "SubtitleStreamIndex": 3,
    },
    "TranscodingInfo": {
        "VideoCodec": "h264",
        "AudioCodec": "aac",
        "Height": 720,
        "Bitrate": 4_000_000,
        "TranscodeReasons": ["ContainerNotSupported"],
    },
    "NowPlayingItem": {
        "Type": "Episode",
        "Name": "Pilot",
        "SeriesName": "Teszt Sorozat",
        "SeriesId": "serie1",
        "ParentIndexNumber": 1,
        "IndexNumber": 7,
        "RunTimeTicks": 6_000_000_000,
        "MediaStreams": [
            {"Type": "Video", "Codec": "hevc", "Height": 2160, "DisplayTitle": "4K HEVC"},
            {"Type": "Audio", "Codec": "aac", "DisplayLanguage": "English", "IsDefault": True,
             "DisplayTitle": "English (AAC Stereo)"},
            {"Type": "Audio", "Codec": "ac3", "DisplayLanguage": "Hungarian",
             "DisplayTitle": "Hungarian (AC3 5.1)"},
            {"Type": "Subtitle", "DisplayLanguage": "Hungarian", "DisplayTitle": "Hungarian (SRT)"},
        ],
    },
}

_DIRECT_REMOTE = {
    "Id": "sess2",
    "UserName": "bob",
    "DeviceName": "iPhone",
    "Client": "Jellyfin iOS",
    "RemoteEndPoint": "8.8.8.8:443",
    "PlayState": {"PositionTicks": 0, "IsPaused": True, "PlayMethod": "DirectPlay"},
    "NowPlayingItem": {
        "Type": "Movie",
        "Name": "Dűne",
        "Id": "movie1",
        "ProductionYear": 2021,
        "RunTimeTicks": 6_000_000_000,
        "MediaStreams": [{"Type": "Video", "Codec": "h264", "Height": 1080, "DisplayTitle": "1080p (H.264)"}],
    },
}


def test_parse_transcode_session_full_context():
    s = MediaSessionsService._parse_jellyfin_session(_TRANSCODE)
    assert s is not None
    assert s["title"] == "Teszt Sorozat"
    assert s["subtitle"] == "S1 · E7 Pilot"
    assert s["poster"] == "/Items/serie1/Images/Primary"
    assert s["state"] == "playing"
    assert s["progressPercent"] == 50
    assert s["position_sec"] == 300
    assert s["duration_sec"] == 600
    assert s["runtime_min"] == 10
    assert s["play_method"] == "transcode"
    assert s["device"] == "Living Room TV"
    assert s["client"] == "Jellyfin Android TV"
    assert s["bitrate_kbps"] == 4000
    assert s["transcode_reasons"] == ["ContainerNotSupported"]
    assert s["remote"] is False  # 192.168.x = LAN

    # Videó: forrás 4K HEVC → cél H264 átkódolással
    assert s["streams"]["video"]["source"] == "4K HEVC"
    assert s["streams"]["video"]["decision"] == "transcode"
    assert s["streams"]["video"]["target"] == "H264 — Átkódolás"
    # Hang: az AudioStreamIndex=2 → a magyar AC3 5.1, átkódolva AAC-ba
    assert s["streams"]["audio"]["source"] == "Hungarian (AC3 5.1)"
    assert s["streams"]["audio"]["target"] == "AAC — Átkódolás"
    # Felirat: a kiválasztott magyar SRT, közvetlen
    assert s["streams"]["subtitle"]["source"] == "Hungarian (SRT)"
    assert s["streams"]["subtitle"]["decision"] == "direct"


def test_parse_direct_remote_session():
    s = MediaSessionsService._parse_jellyfin_session(_DIRECT_REMOTE)
    assert s is not None
    assert s["title"] == "Dűne (2021)"
    assert s["subtitle"] is None
    assert s["state"] == "paused"
    assert s["play_method"] == "direct"
    assert s["streams"]["video"]["source"] == "1080p (H.264)"
    assert s["streams"]["video"]["decision"] == "direct"
    assert s["streams"]["video"]["target"] == "Közvetlen lejátszás"
    assert "audio" not in s["streams"]  # nincs hang-sáv
    assert "subtitle" not in s["streams"]
    assert s["bitrate_kbps"] is None
    assert s["remote"] is True  # publikus IP


def test_parse_idle_session_returns_none():
    assert MediaSessionsService._parse_jellyfin_session({"Id": "x"}) is None


def test_parse_plex_session_per_stream_decisions():
    # Videó direct-stream (copy), hang átkódolás MP3-ba, felirat átkódolás — a
    # példaképen látott eset (Plex Web / Chrome, Local, 2 Mbps).
    plex_item = {
        "type": "episode",
        "grandparentTitle": "Avatar: The Last Airbender",
        "title": "Észak",
        "parentIndex": 1,
        "index": 7,
        "duration": 2_827_000,
        "viewOffset": 2_456_000,
        "grandparentThumb": "/library/metadata/10/thumb/1",
        "User": {"title": "szebaszti", "thumb": "https://plex.tv/users/abc/avatar"},
        "Player": {"product": "Plex Web", "platform": "Chrome", "state": "playing",
                   "local": "1", "secure": "1", "address": "192.168.1.144"},
        "Session": {"location": "lan", "bandwidth": 2000},
        "TranscodeSession": {"videoDecision": "copy", "audioDecision": "transcode",
                             "subtitleDecision": "transcode", "audioCodec": "mp3"},
        "Media": [{"Part": [{"Stream": [
            {"streamType": 1, "decision": "copy", "displayTitle": "720p (H.264)"},
            {"streamType": 2, "decision": "transcode", "selected": "1",
             "extendedDisplayTitle": "Hungarian (EAC3 5.1)"},
            {"streamType": 3, "decision": "transcode", "selected": "1",
             "extendedDisplayTitle": "Hungarian Forced (SRT)"},
        ]}]}],
    }
    s = MediaSessionsService._parse_plex_session(plex_item)
    assert s is not None
    assert s["title"] == "Avatar: The Last Airbender"
    assert s["subtitle"] == "S1 · E7 Észak"
    assert s["client"] == "Plex Web"
    assert s["device"] == "Chrome"
    assert s["secure"] is True
    assert s["remote"] is False  # location lan
    assert s["address"] == "192.168.1.144"
    assert s["bitrate_kbps"] == 2000
    assert s["user_avatar"] == "https://plex.tv/users/abc/avatar"
    assert s["play_method"] == "transcode"  # a hang átkódol
    assert s["streams"]["video"]["target"] == "Közvetlen adatfolyam"  # copy
    assert s["streams"]["audio"]["source"] == "Hungarian (EAC3 5.1)"
    assert s["streams"]["audio"]["target"] == "MP3 — Átkódolás"
    assert s["streams"]["subtitle"]["source"] == "Hungarian Forced (SRT)"
    assert s["streams"]["subtitle"]["decision"] == "transcode"


def test_summarize_load():
    sessions = [
        MediaSessionsService._parse_jellyfin_session(_TRANSCODE),
        MediaSessionsService._parse_jellyfin_session(_DIRECT_REMOTE),
    ]
    summary = MediaSessionsService.summarize(sessions)
    assert summary["total"] == 2
    assert summary["playing"] == 1
    assert summary["paused"] == 1
    assert summary["transcoding"] == 1
    assert summary["direct"] == 1
    assert summary["remote"] == 1
    assert summary["transcode_bitrate_kbps"] == 4000


def test_is_remote_detection():
    assert _is_remote("192.168.1.20") is False
    assert _is_remote("10.0.0.5") is False
    assert _is_remote("127.0.0.1") is False
    assert _is_remote("[::1]:8096") is False
    assert _is_remote("8.8.8.8") is True
    assert _is_remote("8.8.8.8:443") is True
    assert _is_remote(None) is None
    assert _is_remote("nem-ip") is None

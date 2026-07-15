"""TOTP (RFC 6238) második faktor — függőségmentes, stdlib-only implementáció,
a rate limiterhez hasonló szellemben. A titok Base32 formátumú (a hitelesítő
appok ezt várják), a kód 6 számjegyű, 30 másodperces időablakkal.

A setup kétlépcsős: a begin egy FÜGGŐBEN lévő titkot ad (cache, 5 perc TTL),
és csak az első érvényes kód beírása után (finish) kerül a userre — így nem
lehet félbehagyott setuppal kizárni magad a fiókból."""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

TOTP_PERIOD_SECONDS = 30
TOTP_DIGITS = 6
# ±1 időablak elfogadva — az eszközök órája ritkán jár tökéletesen együtt.
TOTP_WINDOW = 1


def generate_secret() -> str:
    """20 véletlen bájt Base32-ben (padding nélkül) — a hitelesítő appok formátuma."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def provisioning_uri(secret: str, username: str, issuer: str = "Mediachat") -> str:
    """otpauth:// URI — QR-kódba vagy kézi bevitelhez a hitelesítő appnak."""
    label = f"{quote(issuer)}:{quote(username)}"
    return (
        f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}"
        f"&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_PERIOD_SECONDS}"
    )


def _code_at(secret: str, counter: int) -> str:
    # Base32 padding visszapótlása dekódoláshoz
    padded = secret + "=" * (-len(secret) % 8)
    key = base64.b32decode(padded, casefold=True)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** TOTP_DIGITS)).zfill(TOTP_DIGITS)


def current_code(secret: str, at_time: float | None = None) -> str:
    """A jelenlegi érvényes kód — tesztekhez és ellenőrzéshez."""
    counter = int((at_time if at_time is not None else time.time()) // TOTP_PERIOD_SECONDS)
    return _code_at(secret, counter)


def verify_code(secret: str, code: str, at_time: float | None = None) -> bool:
    code = code.strip().replace(" ", "")
    if len(code) != TOTP_DIGITS or not code.isdigit():
        return False
    now = at_time if at_time is not None else time.time()
    counter = int(now // TOTP_PERIOD_SECONDS)
    for offset in range(-TOTP_WINDOW, TOTP_WINDOW + 1):
        if hmac.compare_digest(_code_at(secret, counter + offset), code):
            return True
    return False

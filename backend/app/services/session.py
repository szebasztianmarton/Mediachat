import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db.models import User, UserSession

logger = logging.getLogger(__name__)

_PBKDF2_ITERATIONS = 390_000
_LAST_SEEN_UPDATE_INTERVAL = timedelta(minutes=5)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, iterations, salt, expected = stored.split("$", 3)
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


def hash_token(token: str) -> str:
    """A session tokent nem plaintextben tároljuk — DB-lopásnál a tokenek ne
    legyenek azonnal használhatók. A kliens a nyers tokent kapja, a DB a hash-t."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


class SessionService:
    async def verify_credentials(
        self, db: AsyncSession, username: str, password: str
    ) -> User | None:
        """Felhasználónév+jelszó ellenőrzése SESSION KIADÁSA NÉLKÜL — a login
        végpont ebből dönt, hogy azonnal tokent ad, vagy TOTP-kódot kér előbb."""
        result = await db.execute(select(User).where(User.username == username.strip().lower()))
        user = result.scalar_one_or_none()
        if user is None or not user.password_hash:
            # Konstans idejű viselkedéshez akkor is hash-elünk, ha nincs ilyen user.
            verify_password(password, hash_password("dummy"))
            return None
        if not verify_password(password, user.password_hash):
            return None
        return user

    async def authenticate(
        self,
        db: AsyncSession,
        username: str,
        password: str,
        platform: str = "web",
    ) -> tuple[User, UserSession, str] | None:
        """Siker esetén (user, session, plaintext_token) — a plaintext tokent CSAK
        itt adjuk ki egyszer, a DB-ben a hash-e tárolódik."""
        user = await self.verify_credentials(db, username, password)
        if user is None:
            return None
        session, plaintext = await self.create_session_for_user(db, user, platform)
        return user, session, plaintext

    async def create_session_for_user(
        self, db: AsyncSession, user: User, platform: str = "web"
    ) -> tuple[UserSession, str]:
        """Session kiadása egy MÁR ellenőrzött felhasználónak (pl. sikeres
        passkey-hitelesítés után, jelszó nélkül)."""
        plaintext = secrets.token_urlsafe(32)
        session = UserSession(user_id=user.id, token=hash_token(plaintext), platform=platform)
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return session, plaintext

    async def get_session(self, db: AsyncSession, token: str) -> UserSession | None:
        result = await db.execute(
            select(UserSession)
            .where(UserSession.token == hash_token(token))
            .options(selectinload(UserSession.user))
        )
        session = result.scalar_one_or_none()
        if session is None:
            return None

        now = datetime.now(UTC)
        last_seen = _as_aware(session.last_seen_at) or _as_aware(session.created_at)
        if last_seen is not None and now - last_seen > timedelta(days=settings.session_ttl_days):
            await db.delete(session)
            await db.commit()
            return None

        # Ne írjunk minden kérésnél — csak ha az utolsó frissítés régebbi 5 percnél.
        if last_seen is None or now - last_seen > _LAST_SEEN_UPDATE_INTERVAL:
            session.last_seen_at = now
            await db.commit()
        return session

    async def revoke_session(self, db: AsyncSession, session_id: str) -> None:
        await db.execute(delete(UserSession).where(UserSession.id == session_id))
        await db.commit()

    async def list_sessions(self, db: AsyncSession, user_id: str) -> list[UserSession]:
        result = await db.execute(
            select(UserSession)
            .where(UserSession.user_id == user_id)
            .order_by(UserSession.last_seen_at.desc())
        )
        return list(result.scalars().all())

    async def revoke_own_session(self, db: AsyncSession, user_id: str, session_id: str) -> bool:
        """Csak a SAJÁT session-jeit engedi kirúgni egy usernek — ownership-ellenőrzéssel,
        hogy más felhasználó munkamenetét ne lehessen az azonosító kitalálásával törölni."""
        result = await db.execute(
            delete(UserSession).where(UserSession.id == session_id, UserSession.user_id == user_id)
        )
        await db.commit()
        return result.rowcount > 0

    async def create_user(
        self,
        db: AsyncSession,
        username: str,
        password: str,
        role: str = "user",
    ) -> User:
        username = username.strip().lower()
        result = await db.execute(select(User).where(User.username == username))
        if result.scalar_one_or_none() is not None:
            raise ValueError("Ez a felhasználónév már foglalt.")
        user = User(
            username=username,
            display_name=username,
            password_hash=hash_password(password),
            role=role,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user

    async def list_users(self, db: AsyncSession) -> list[User]:
        result = await db.execute(
            select(User).where(User.username.is_not(None)).order_by(User.created_at)
        )
        return list(result.scalars().all())

    async def get_user(self, db: AsyncSession, user_id: str) -> User | None:
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def delete_user(self, db: AsyncSession, user_id: str) -> None:
        await db.execute(delete(UserSession).where(UserSession.user_id == user_id))
        await db.execute(delete(User).where(User.id == user_id))
        await db.commit()

    async def update_password(self, db: AsyncSession, user_id: str, password: str) -> None:
        user = await self.get_user(db, user_id)
        if user is None:
            raise ValueError("A felhasználó nem található.")
        user.password_hash = hash_password(password)
        # Jelszócsere után minden meglévő session érvénytelen.
        await db.execute(delete(UserSession).where(UserSession.user_id == user_id))
        await db.commit()

    async def ensure_admin(self, db: AsyncSession, username: str, password: str) -> None:
        """Első indításkor létrehozza az admin fiókot, ha még nincs bejelentkezésre
        alkalmas admin felhasználó."""
        result = await db.execute(
            select(User).where(User.role == "admin", User.password_hash.is_not(None))
        )
        if result.scalars().first() is not None:
            return
        await self.create_user(db, username, password, role="admin")
        logger.info("Admin felhasználó létrehozva: %s", username)

import secrets
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User, UserSession


class SessionService:
    async def create_session(
        self,
        db: AsyncSession,
        display_name: str = "Felhasználó",
        platform: str = "web",
    ) -> tuple[User, UserSession]:
        user = User(display_name=display_name.strip() or "Felhasználó")
        session = UserSession(user=user, token=secrets.token_urlsafe(32), platform=platform)
        db.add(user)
        db.add(session)
        await db.commit()
        await db.refresh(user)
        await db.refresh(session)
        return user, session

    async def get_session(self, db: AsyncSession, token: str) -> UserSession | None:
        result = await db.execute(select(UserSession).where(UserSession.token == token))
        session = result.scalar_one_or_none()
        if session is None:
            return None
        session.last_seen_at = datetime.now(UTC)
        await db.commit()
        return session

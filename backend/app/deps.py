from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import UserSession
from app.state import app_state


async def get_optional_session(
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
) -> UserSession | None:
    if not x_session_token or app_state is None:
        return None
    return await app_state.session.get_session(db, x_session_token)


async def get_required_session(
    session: UserSession | None = Depends(get_optional_session),
) -> UserSession:
    if session is None:
        raise HTTPException(status_code=401, detail="Érvénytelen vagy hiányzó session.")
    return session

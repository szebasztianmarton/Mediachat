from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import state
from app.db.database import get_db
from app.db.models import UserSession


async def get_optional_session(
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    db: AsyncSession = Depends(get_db),
) -> UserSession | None:
    # A state modulon keresztül érjük el az app_state-et — import-időben elkapott
    # referencia a lifespan-beli rebindet nem látná (mindig None maradna).
    if not x_session_token or state.app_state is None:
        return None
    return await state.app_state.session.get_session(db, x_session_token)


async def get_required_session(
    session: UserSession | None = Depends(get_optional_session),
) -> UserSession:
    if session is None:
        raise HTTPException(status_code=401, detail="Érvénytelen vagy hiányzó session.")
    return session


async def get_admin_session(
    session: UserSession = Depends(get_required_session),
) -> UserSession:
    if session.user is None or session.user.role != "admin":
        raise HTTPException(status_code=403, detail="Ehhez admin jogosultság szükséges.")
    return session

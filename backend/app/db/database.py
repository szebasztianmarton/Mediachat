from collections.abc import AsyncGenerator

from pathlib import Path

from sqlalchemy import event, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.db.models import Base

if settings.database_url.startswith("sqlite"):
    Path("./data").mkdir(parents=True, exist_ok=True)

engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _connection_record) -> None:
        # WAL + busy_timeout: több párhuzamos író (queue workerek + kérések)
        # mellett ne dobjon "database is locked" hibát.
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()


def _migrate_schema(sync_conn) -> None:
    """create_all nem ad hozzá oszlopot meglévő táblához — mini-migráció: minden
    modell-oszlop, ami hiányzik a meglévő táblából, ALTER TABLE-lel jön létre."""
    inspector = inspect(sync_conn)
    existing_tables = set(inspector.get_table_names())
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # az új táblát a create_all hozza létre
        existing_columns = {col["name"] for col in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing_columns:
                continue
            column_type = column.type.compile(dialect=sync_conn.dialect)
            ddl = f"ALTER TABLE {table.name} ADD COLUMN {column.name} {column_type}"
            default = column.default
            if default is not None and getattr(default, "is_scalar", False):
                value = default.arg
                if isinstance(value, str):
                    ddl += f" DEFAULT '{value}'"
                elif isinstance(value, bool):
                    ddl += f" DEFAULT {int(value)}"
                elif isinstance(value, (int, float)):
                    ddl += f" DEFAULT {value}"
            sync_conn.execute(text(ddl))
    if "users" in existing_tables:
        sync_conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)")
        )


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(_migrate_schema)
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session

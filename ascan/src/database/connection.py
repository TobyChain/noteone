"""
数据库连接管理
"""

import time
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import NullPool
from loguru import logger

from src.config.settings import get_settings


def get_engine():
    """创建数据库引擎"""
    settings = get_settings()

    if settings.database_url.startswith("sqlite"):
        engine = create_engine(
            settings.database_url,
            connect_args={"timeout": 30},
            poolclass=NullPool,
            echo=settings.log_level == "DEBUG"
        )

        @event.listens_for(engine, "connect")
        def _set_wal(dbapi_conn, connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()
    else:
        engine = create_engine(settings.database_url)

    @event.listens_for(engine, "before_cursor_execute")
    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        context._query_start_time = time.time()

    @event.listens_for(engine, "after_cursor_execute")
    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        total_time = time.time() - context._query_start_time
        if total_time > 1.0:
            logger.warning(f"慢查询 ({total_time:.2f}s): {statement[:100]}...")

    return engine


_engine = None
_SessionLocal = None


def init_database():
    """初始化数据库"""
    global _engine, _SessionLocal

    _engine = get_engine()
    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

    from src.database.models import Base
    Base.metadata.create_all(bind=_engine)
    logger.success("数据库初始化完成")


def get_db_session() -> Session:
    """直接获取数据库会话（调用方负责 close）"""
    global _SessionLocal

    if _SessionLocal is None:
        init_database()

    return _SessionLocal()


class DBSession:
    """数据库会话上下文管理器，自动 close 防止泄漏"""
    def __init__(self):
        self._session: Session | None = None

    def __enter__(self) -> Session:
        self._session = get_db_session()
        return self._session

    def __exit__(self, *args):
        if self._session:
            self._session.close()

    @property
    def session(self) -> Session:
        if self._session is None:
            self._session = get_db_session()
        return self._session

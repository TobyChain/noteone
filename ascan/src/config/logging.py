"""
Shared bootstrapping: SSL truststore injection + loguru configuration.
Import from all entry points to eliminate duplication.
"""

import sys
from pathlib import Path

from loguru import logger

try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass


def setup_logging(log_name: str = "ascan", level: str = "INFO"):
    """Configure loguru: stderr + daily rotating file."""
    logger.remove()
    logger.add(
        sys.stderr,
        level=level,
        format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>",
    )
    log_dir = Path("./logs")
    log_dir.mkdir(exist_ok=True)
    logger.add(
        log_dir / f"{log_name}_{{time:YYYY-MM-DD}}.log",
        rotation="00:00",
        retention="30 days",
        level="DEBUG",
        encoding="utf-8",
    )

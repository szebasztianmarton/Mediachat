"""Strukturált (JSON) vagy sima szöveges logging beállítása.

Homelab Grafana/Loki-integrációhoz a JSON-sorok könnyebben parse-olhatók, mint
a `logging.basicConfig` alapértelmezett szöveges kimenete. A formátum a
LOG_FORMAT env-változóval (settings.log_format) váltható "text" és "json"
között — élesben "json", fejlesztéskor "text" a kényelmesebb.
"""

import json
import logging
from datetime import UTC, datetime


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(log_format: str) -> None:
    handler = logging.StreamHandler()
    if log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    root.addHandler(handler)

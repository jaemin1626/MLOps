import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def _load_connection_file() -> dict:
    configured = os.getenv("MLOPS_CONNECTION_FILE", "connection.json").strip()
    connection_path = Path(configured)
    if not connection_path.is_absolute():
        connection_path = Path.cwd() / connection_path
    if not connection_path.exists():
        return {}
    try:
        return json.loads(connection_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


_CONNECTION_FILE = _load_connection_file()
WORKSPACE_ROOT = Path(os.getenv("WORKSPACE_ROOT", "/workspace")).resolve()
AGENT_HOST = os.getenv("AGENT_HOST", "0.0.0.0")
AGENT_PORT = int(os.getenv("AGENT_PORT", "9011"))
CONDA_ENV_NAME = os.getenv("CONDA_ENV_NAME", "vlm")
USE_CONDA = os.getenv("USE_CONDA", "0").strip().lower() in {"1", "true", "yes", "on"}
CONNECTION_ID = os.getenv("MLOPS_CONNECTION_ID", _CONNECTION_FILE.get("connection_id", "")).strip()
MONITORING_SERVER = os.getenv(
    "MLOPS_MONITORING_SERVER",
    _CONNECTION_FILE.get("monitoring_server", ""),
).strip()
CONNECTION_TOKEN = os.getenv(
    "MLOPS_CONNECTION_TOKEN",
    _CONNECTION_FILE.get("token", ""),
).strip()
AUTH_TOKEN = os.getenv("AUTH_TOKEN", CONNECTION_TOKEN).strip()
CALLBACK_TIMEOUT_SEC = int(os.getenv("CALLBACK_TIMEOUT_SEC", "10"))
JOBS_DIR = WORKSPACE_ROOT / ".mlops-vlm-agent" / "jobs"
VLM_SCRIPT = Path(__file__).resolve().parents[1] / "train_vlm.py"


def agent_log(message: str, task_id: str | None = None) -> None:
    timestamp = datetime.now(timezone.utc).astimezone().strftime("%H:%M:%S")
    prefix = f"[vlm-agent][{task_id}]" if task_id else "[vlm-agent]"
    print(f"{timestamp} {prefix} {message}", flush=True)
    sys.stdout.flush()


def log_request(method: str, path: str, remote_addr: str, status_code: int | None = None) -> None:
    if path == "/api/v1/health":
        return
    if status_code is None:
        agent_log(f"← REST 요청 수신: {method} {path} (from {remote_addr})")
        return
    agent_log(f"→ REST 응답 전송: {method} {path} HTTP {status_code}")


def log_startup(host: str, port: int, workspace_root: str, supported_commands: list[str]) -> None:
    agent_log("MLOps VLM Training Server Agent 시작")
    agent_log(f"workspace: {workspace_root}")
    agent_log(f"REST API 대기 중: http://{host}:{port}")
    agent_log(f"health check: http://127.0.0.1:{port}/api/v1/health")
    agent_log(f"지원 명령: {', '.join(supported_commands)}")

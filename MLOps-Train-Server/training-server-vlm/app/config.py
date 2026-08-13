import os
import sys
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE_ROOT = Path(os.getenv("WORKSPACE_ROOT", "/workspace")).resolve()
AGENT_HOST = os.getenv("AGENT_HOST", "0.0.0.0")
AGENT_PORT = int(os.getenv("AGENT_PORT", "9011"))
CONDA_ENV_NAME = os.getenv("CONDA_ENV_NAME", "vlm")
USE_CONDA = os.getenv("USE_CONDA", "0").strip().lower() in {"1", "true", "yes", "on"}
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "").strip()
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
    agent_log("Intellivix VLM Training Server Agent 시작")
    agent_log(f"workspace: {workspace_root}")
    agent_log(f"REST API 대기 중: http://{host}:{port}")
    agent_log(f"health check: http://127.0.0.1:{port}/api/v1/health")
    agent_log(f"지원 명령: {', '.join(supported_commands)}")

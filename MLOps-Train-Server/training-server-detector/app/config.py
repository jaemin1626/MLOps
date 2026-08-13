import os
import sys
from datetime import datetime, timezone
from pathlib import Path


WORKSPACE_ROOT = Path(os.getenv("WORKSPACE_ROOT", "/workspace")).resolve()
AGENT_HOST = os.getenv("AGENT_HOST", "0.0.0.0")
AGENT_PORT = int(os.getenv("AGENT_PORT", "9010"))
CONDA_ENV_NAME = os.getenv("CONDA_ENV_NAME", "yolo")
USE_CONDA = os.getenv("USE_CONDA", "0").strip().lower() in {"1", "true", "yes", "on"}
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "").strip()
CALLBACK_TIMEOUT_SEC = int(os.getenv("CALLBACK_TIMEOUT_SEC", "10"))
JOBS_DIR = WORKSPACE_ROOT / ".mlops-agent" / "jobs"
EXPORTS_DIR = WORKSPACE_ROOT / ".mlops-agent" / "exports"
DETECTOR_SCRIPT = Path(__file__).resolve().parents[1] / "train_detector.py"
EXPORT_SCRIPT = Path(__file__).resolve().parents[1] / "export_onnx.py"


def agent_log(message: str, task_id: str | None = None) -> None:
    timestamp = datetime.now(timezone.utc).astimezone().strftime("%H:%M:%S")
    prefix = f"[agent][{task_id}]" if task_id else "[agent]"
    print(f"{timestamp} {prefix} {message}", flush=True)
    sys.stdout.flush()


def log_request(method: str, path: str, remote_addr: str, status_code: int | None = None) -> None:
    if path == "/api/v1/health":
        return
    if status_code is None:
        agent_log(f"← REST 요청 수신: {method} {path} (from {remote_addr})")
        return
    agent_log(f"→ REST 응답 전송: {method} {path} HTTP {status_code}")


def log_command_received(command_type: str, task_id: str, callback_url: str | None = None) -> None:
    agent_log(f"명령 접수: {command_type} · taskId={task_id}", task_id)
    if callback_url:
        agent_log(f"callback URL 등록: {callback_url}", task_id)
    else:
        agent_log("callback URL 없음 (폴링만 사용)", task_id)


def log_command_execute(command_type: str, task_id: str) -> None:
    agent_log(f"명령 수행 시작: {command_type}", task_id)


def log_command_finished(task_id: str, status: str) -> None:
    agent_log(f"명령 종료: status={status}", task_id)


def log_callback(task_id: str, callback_url: str, status: str) -> None:
    agent_log(f"↪ MLOps callback 전송: {status} → {callback_url}", task_id)


def log_callback_error(task_id: str, error: Exception) -> None:
    agent_log(f"callback 전송 실패: {error}", task_id)


def log_startup(host: str, port: int, workspace_root: str, supported_commands: list[str]) -> None:
    agent_log("MLOps Training Server Agent 시작")
    agent_log(f"workspace: {workspace_root}")
    agent_log(f"REST API 대기 중: http://{host}:{port}")
    agent_log(f"health check: http://127.0.0.1:{port}/api/v1/health")
    agent_log("상태: REST 명령 대기 중 (waitingForCommands=true)")
    agent_log(f"지원 명령: {', '.join(supported_commands)}")
    agent_log("MLOps에서 명령이 오면 이 터미널에 접수/수행 로그가 표시됩니다.")

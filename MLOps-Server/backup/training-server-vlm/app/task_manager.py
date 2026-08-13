from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

import requests

from .config import CALLBACK_TIMEOUT_SEC, JOBS_DIR, WORKSPACE_ROOT, agent_log
from .job_manager import job_manager


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


CommandHandler = Callable[[dict[str, Any], "AgentTask"], dict[str, Any]]


@dataclass
class AgentTask:
    task_id: str
    command_type: str
    payload: dict[str, Any]
    callback_url: str | None = None
    status: str = "queued"
    logs: list[str] = field(default_factory=list)
    result: dict[str, Any] | None = None
    error_message: str | None = None
    created_at: str = field(default_factory=now_iso)
    started_at: str | None = None
    finished_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "taskId": self.task_id,
            "commandType": self.command_type,
            "status": self.status,
            "logs": self.logs,
            "logText": "\n".join(self.logs),
            "result": self.result,
            "errorMessage": self.error_message,
            "callbackUrl": self.callback_url,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "waitingForCommands": self.status in {"queued", "accepted"},
        }


class TaskManager:
    SUPPORTED_COMMANDS = ("training.start",)

    def __init__(self) -> None:
        self.tasks: dict[str, AgentTask] = {}
        self._lock = threading.Lock()
        JOBS_DIR.mkdir(parents=True, exist_ok=True)

    def health_snapshot(self) -> dict[str, Any]:
        with self._lock:
            active = sum(1 for task in self.tasks.values() if task.status == "running")
            queued = sum(1 for task in self.tasks.values() if task.status in {"queued", "accepted"})
        return {
            "agentState": "busy" if active > 0 else "idle",
            "waitingForCommands": True,
            "activeTaskCount": active,
            "queuedTaskCount": queued,
            "supportedCommands": list(self.SUPPORTED_COMMANDS),
        }

    def list_tasks(self) -> list[dict[str, Any]]:
        with self._lock:
            return [task.to_dict() for task in sorted(self.tasks.values(), key=lambda item: item.created_at, reverse=True)]

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            task = self.tasks.get(task_id)
            return task.to_dict() if task else None

    def submit(
        self,
        command_type: str,
        payload: dict[str, Any] | None = None,
        callback_url: str | None = None,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        normalized_type = str(command_type or "").strip()
        if normalized_type not in self.SUPPORTED_COMMANDS:
            raise ValueError(f"지원하지 않는 commandType 입니다: {normalized_type}")

        resolved_task_id = str(task_id or f"cmd_{int(time.time())}_{uuid.uuid4().hex[:6]}")
        task = AgentTask(
            task_id=resolved_task_id,
            command_type=normalized_type,
            payload=dict(payload or {}),
            callback_url=callback_url,
            status="accepted",
        )
        self._append_log(task, f"[ACCEPT] command={normalized_type} taskId={resolved_task_id}")
        agent_log(f"명령 접수: {normalized_type} taskId={resolved_task_id}", resolved_task_id)

        with self._lock:
            self.tasks[resolved_task_id] = task

        self._send_callback(task, {"status": "accepted", "log": "[vlm-agent] command accepted\n"})
        worker = threading.Thread(target=self._run_task, args=(task,), daemon=True)
        worker.start()

        body = task.to_dict()
        body["message"] = "명령을 접수했습니다. callback 또는 GET /api/v1/commands/{taskId} 로 상태를 확인하세요."
        return body

    def _run_task(self, task: AgentTask) -> None:
        task.status = "running"
        task.started_at = now_iso()
        self._append_log(task, "[START] VLM training job 시작")
        self._send_callback(task, {"status": "running", "log": "[vlm-agent] command running\n"})
        try:
            result = self._handle_training_start(task.payload, task)
            task.result = result
            task.status = "completed"
            task.finished_at = now_iso()
            self._append_log(task, "[ OK ] VLM training job started")
            self._send_callback(task, {"status": "completed", "result": result, "log": "[vlm-agent] command completed\n"})
        except Exception as error:
            task.status = "failed"
            task.error_message = str(error)
            task.finished_at = now_iso()
            self._append_log(task, f"[ERR ] {error}")
            self._send_callback(task, {"status": "failed", "errorMessage": str(error), "log": f"[vlm-agent] command failed: {error}\n"})

    def _handle_training_start(self, payload: dict[str, Any], task: AgentTask) -> dict[str, Any]:
        result = job_manager.start_job(payload)
        self._append_log(task, f"[INFO] remoteJobId={result.get('remoteJobId') or result.get('id')}")
        return result

    def _append_log(self, task: AgentTask, line: str) -> None:
        task.logs.append(line)
        agent_log(line, task.task_id)

    def _send_callback(self, task: AgentTask, payload: dict[str, Any]) -> None:
        if not task.callback_url:
            return
        body = {
            "taskId": task.task_id,
            "commandType": task.command_type,
            "logs": task.logs,
            "logText": "\n".join(task.logs),
            **payload,
        }
        try:
            requests.post(task.callback_url, json=body, timeout=CALLBACK_TIMEOUT_SEC)
        except Exception as error:
            self._append_log(task, f"[callback-error] {error}")


task_manager = TaskManager()

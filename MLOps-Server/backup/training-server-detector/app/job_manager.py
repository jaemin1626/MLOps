from __future__ import annotations

import json
import os
import re
import shlex
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from .config import (
    CALLBACK_TIMEOUT_SEC,
    CONDA_ENV_NAME,
    DETECTOR_SCRIPT,
    JOBS_DIR,
    USE_CONDA,
    WORKSPACE_ROOT,
    agent_log,
)
from .yaml_utils import extract_arg_value, write_dataset_yaml


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def build_command_preview(executable: str, args: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in [executable, *args])


@dataclass
class TrainingJob:
    job_id: str
    remote_job_id: str
    executable: str
    args: list[str]
    callback_url: str | None
    parameters: dict[str, Any]
    metadata: dict[str, Any]
    command: str
    status: str = "running"
    pid: int | None = None
    created_at: str = field(default_factory=now_iso)
    started_at: str = field(default_factory=now_iso)
    finished_at: str | None = None
    progress: dict[str, Any] = field(default_factory=dict)
    log_path: Path | None = None
    model_file: str | None = None
    error_message: str | None = None
    exit_code: int | None = None
    cancel_requested: bool = False
    process: subprocess.Popen[str] | None = field(default=None, repr=False)

    def to_dict(self) -> dict[str, Any]:
        progress = dict(self.progress or {})
        return {
            "id": self.job_id,
            "remoteJobId": self.remote_job_id,
            "name": self.metadata.get("name") or self.parameters.get("name"),
            "trainingType": self.metadata.get("trainingType") or self.parameters.get("trainingType"),
            "status": progress.get("status") or self.status,
            "command": self.command,
            "parameters": self.parameters,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "pid": self.pid,
            "progress": progress,
            **progress,
            "modelFile": self.model_file,
            "errorMessage": self.error_message,
            "exitCode": self.exit_code,
            "logPath": str(self.log_path) if self.log_path else None,
        }


class JobManager:
    def __init__(self) -> None:
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, TrainingJob] = {}
        self._lock = threading.Lock()

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            return [job.to_dict() for job in sorted(self.jobs.values(), key=lambda item: item.started_at, reverse=True)]

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self.jobs.get(job_id)
            return job.to_dict() if job else None

    def _normalize_command_payload(self, payload: dict[str, Any]) -> tuple[dict[str, Any], list[str], str]:
        parameters = dict(payload.get("parameters") or {})
        args = list(payload.get("args") or [])
        executable = str(payload.get("executable") or "python")
        ignored = {
            "commandType",
            "callbackUrl",
            "taskId",
            "async",
            "sync",
            "commandMode",
            "executable",
            "args",
            "parameters",
            "metadata",
            "jobId",
            "id",
        }
        if not parameters and not args:
            parameters = {
                key: value
                for key, value in payload.items()
                if key not in ignored
            }
        if not args and parameters:
            args = self._build_args_from_parameters(parameters)
            executable = "python"
        return parameters, args, executable

    def preview_command(self, payload: dict[str, Any]) -> dict[str, Any]:
        parameters, args, executable = self._normalize_command_payload(payload)
        command = build_command_preview(str(executable), list(args))
        return {"command": command, "parameters": parameters or payload}

    def start_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        job_id = str(payload.get("jobId") or payload.get("id") or f"train_{int(time.time())}")
        parameters, args, executable = self._normalize_command_payload(payload)
        metadata = dict(payload.get("metadata") or {})
        callback_url = payload.get("callbackUrl")

        self._prepare_dataset_yaml(parameters, args)

        command = build_command_preview(executable, args)
        job_dir = JOBS_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        log_path = job_dir / "train.log"
        command_path = job_dir / "command.txt"
        command_path.write_text(f"{command}\n", encoding="utf-8")

        resolved_executable, resolved_args = self._resolve_training_command(executable, args)
        shell_command = self._build_shell_command(resolved_executable, resolved_args)

        log_file = log_path.open("a", encoding="utf-8")
        log_file.write(f"[{now_iso()}] command: {shell_command}\n")
        log_file.flush()

        process = subprocess.Popen(
            shell_command,
            cwd=str(WORKSPACE_ROOT),
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            preexec_fn=os.setsid,
        )

        job = TrainingJob(
            job_id=job_id,
            remote_job_id=job_id,
            executable=resolved_executable,
            args=resolved_args,
            callback_url=callback_url,
            parameters=parameters,
            metadata=metadata,
            command=command,
            pid=process.pid,
            log_path=log_path,
            progress={
                "status": "running",
                "epoch": 0,
                "totalEpoch": int(parameters.get("epochs") or metadata.get("epochs") or 1),
                "step": 0,
                "totalStep": 0,
                "loss": None,
                "progress": 0,
                "elapsedSeconds": 0,
                "updatedAt": now_iso(),
            },
        )

        with self._lock:
            self.jobs[job_id] = job
        job.process = process

        thread = threading.Thread(
            target=self._watch_process,
            args=(job, process, log_file),
            daemon=True,
        )
        thread.start()
        return {"remoteJobId": job_id, "pid": process.pid, "id": job_id}

    def stop_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            current_status = str(job.progress.get("status") or job.status)
            if current_status != "running":
                return job.to_dict()
            job.cancel_requested = True
            job.status = "cancelled"
            job.progress["status"] = "cancelled"
            job.error_message = "사용자에 의해 학습이 중지되었습니다."
            process = job.process

        if process and process.poll() is None:
            self._terminate_process(process)
        return job.to_dict()

    def _terminate_process(self, process: subprocess.Popen[str]) -> None:
        if process.poll() is not None:
            return
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        except Exception:
            try:
                process.terminate()
            except Exception:
                pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass

    def _prepare_dataset_yaml(self, parameters: dict[str, Any], args: list[str]) -> None:
        yaml_content = parameters.get("datasetConfigYaml")
        if not yaml_content:
            return
        config_path = parameters.get("datasetConfigAbsolutePath") or extract_arg_value(args, "--data-config")
        if not config_path:
            raise ValueError("datasetConfigYaml은 있지만 --data-config 경로를 찾지 못했습니다.")
        write_dataset_yaml(str(yaml_content), Path(config_path))

    def _build_args_from_parameters(self, parameters: dict[str, Any]) -> list[str]:
        from .command_builder import build_training_args

        return build_training_args(parameters, str(WORKSPACE_ROOT))

    def _resolve_training_command(self, executable: str, args: list[str]) -> tuple[str, list[str]]:
        if Path(executable).name == "train_detector.py" or args and Path(args[0]).name == "train_detector.py":
            script = str(DETECTOR_SCRIPT)
            if args and Path(args[0]).name == "train_detector.py":
                return "python", [script, *args[1:]]
            return "python", [script, *args]
        if executable.endswith("train_detector.py"):
            return "python", [executable, *args]
        return executable, args

    def _build_shell_command(self, executable: str, args: list[str]) -> str:
        quoted = " ".join(shlex.quote(part) for part in [executable, *args])
        if USE_CONDA:
            return f"conda run -n {shlex.quote(CONDA_ENV_NAME)} --no-capture-output {quoted}"
        return quoted

    def _watch_process(self, job: TrainingJob, process: subprocess.Popen[str], log_file) -> None:
        started = time.time()
        try:
            assert process.stdout is not None
            for line in process.stdout:
                log_file.write(line)
                log_file.flush()
                stripped = line.rstrip()
                if stripped:
                    agent_log(stripped, job.job_id)
                self._send_callback(job, {"log": line, "status": "running"})
                parsed = self._parse_progress_line(line)
                if parsed:
                    job.progress.update(parsed)
                    job.progress["elapsedSeconds"] = int(time.time() - started)
                    job.progress["updatedAt"] = now_iso()
                    self._send_callback(job, {"status": "running", "progress": job.progress})
        finally:
            exit_code = process.wait()
            log_file.write(f"[{now_iso()}] process exit code: {exit_code}\n")
            log_file.close()

            job.exit_code = exit_code
            job.finished_at = now_iso()
            if getattr(job, "cancel_requested", False):
                job.status = "cancelled"
                job.progress["status"] = "cancelled"
                job.error_message = job.error_message or "사용자에 의해 학습이 중지되었습니다."
            elif exit_code == 0:
                job.status = "completed"
                job.progress["status"] = "completed"
                job.progress["progress"] = 100
                job.model_file = self._guess_model_file(job)
            else:
                job.status = "failed"
                job.progress["status"] = "failed"
                job.error_message = f"학습 프로세스 종료 코드: {exit_code}"

            self._send_callback(job, {
                "status": job.status,
                "progress": job.progress,
                "modelFile": job.model_file,
                "errorMessage": job.error_message,
                "exitCode": exit_code,
                "finishedAt": job.finished_at,
                "log": f"[agent] elapsed={int(time.time() - started)}s exit={exit_code}\n",
            })

    _ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

    def _strip_ansi(self, line: str) -> str:
        return self._ANSI_ESCAPE.sub("", line)

    def _parse_progress_line(self, line: str) -> dict[str, Any] | None:
        cleaned = self._strip_ansi(line).strip()
        if not cleaned:
            return None

        starting = re.search(r"Starting training for (\d+) epochs?", cleaned, re.IGNORECASE)
        if starting:
            return {"totalEpoch": int(starting.group(1))}

        # Ultralytics train line: "1/5  5.66G  0.8966  5.39  ... 640: 7% ... 12/155 5.8it/s"
        epoch_match = re.match(r"^(\d+)/(\d+)\s+\S+\s+([\d.]+)", cleaned)
        if not epoch_match:
            return None

        epoch = int(epoch_match.group(1))
        total_epoch = int(epoch_match.group(2))
        box_loss = float(epoch_match.group(3))

        step = 0
        total_step = 0
        batch_match = re.search(r":\s*\d+%[^0-9/]*(\d+)/(\d+)\s+\d", cleaned)
        if batch_match:
            step = int(batch_match.group(1))
            total_step = int(batch_match.group(2))

        if total_step > 0:
            epoch_progress = (epoch - 1 + (step / total_step)) / max(total_epoch, 1)
        else:
            epoch_progress = epoch / max(total_epoch, 1)
        progress = min(100, round(epoch_progress * 100, 2))

        return {
            "epoch": epoch,
            "totalEpoch": total_epoch,
            "step": step,
            "totalStep": total_step,
            "loss": box_loss,
            "progress": progress,
        }

    def _guess_model_file(self, job: TrainingJob) -> str | None:
        output_dir = extract_arg_value(job.args, "--output-dir")
        if not output_dir:
            return None
        candidate = Path(output_dir) / f"{job.parameters.get('name') or job.metadata.get('name') or 'train'}" / "weights" / "best.pt"
        if candidate.exists():
            return str(candidate)
        runs_root = Path(output_dir)
        if runs_root.exists():
            best_files = list(runs_root.rglob("best.pt"))
            if best_files:
                return str(sorted(best_files, key=lambda path: path.stat().st_mtime)[-1])
        return None

    def _send_callback(self, job: TrainingJob, payload: dict[str, Any]) -> None:
        if not job.callback_url:
            return
        try:
            requests.post(job.callback_url, json=payload, timeout=CALLBACK_TIMEOUT_SEC)
        except Exception as error:
            if job.log_path:
                with job.log_path.open("a", encoding="utf-8") as handle:
                    handle.write(f"[callback-error] {error}\n")


job_manager = JobManager()

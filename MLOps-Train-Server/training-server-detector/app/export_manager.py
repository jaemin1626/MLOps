from __future__ import annotations

import shlex
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
    EXPORT_SCRIPT,
    EXPORTS_DIR,
    USE_CONDA,
    WORKSPACE_ROOT,
    agent_log,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def build_command_preview(executable: str, args: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in [executable, *args])


def as_bool(value: Any, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


@dataclass
class ExportJob:
    export_id: str
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
    output_path: str | None = None
    error_message: str | None = None
    exit_code: int | None = None
    log_path: Path | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.export_id,
            "remoteJobId": self.export_id,
            "modelName": self.metadata.get("modelName") or self.parameters.get("modelName"),
            "status": self.status,
            "command": self.command,
            "parameters": self.parameters,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "pid": self.pid,
            "outputPath": self.output_path,
            "errorMessage": self.error_message,
            "exitCode": self.exit_code,
            "logPath": str(self.log_path) if self.log_path else None,
            **self.metadata,
        }


class ExportManager:
    def __init__(self) -> None:
        EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
        self.exports: dict[str, ExportJob] = {}
        self._lock = threading.Lock()
        self._log_buffers: dict[str, list[str]] = {}
        self._log_flush_timers: dict[str, threading.Timer] = {}

    def list_exports(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                job.to_dict()
                for job in sorted(self.exports.values(), key=lambda item: item.started_at, reverse=True)
            ]

    def get_export(self, export_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self.exports.get(export_id)
            return job.to_dict() if job else None

    def preview_command(self, payload: dict[str, Any]) -> dict[str, Any]:
        parameters, args, executable = self._normalize_command_payload(payload)
        command = build_command_preview(str(executable), list(args))
        return {"command": command, "parameters": parameters or payload}

    def start_export(self, payload: dict[str, Any]) -> dict[str, Any]:
        export_id = str(payload.get("exportId") or payload.get("id") or f"export_{int(time.time())}")
        parameters, args, executable = self._normalize_command_payload(payload)
        metadata = dict(payload.get("metadata") or {})
        callback_url = payload.get("callbackUrl")

        resolved_executable, resolved_args = self._resolve_export_command(executable, args)
        shell_command = self._build_shell_command(resolved_executable, resolved_args)
        command = build_command_preview(resolved_executable, resolved_args)

        export_dir = EXPORTS_DIR / export_id
        export_dir.mkdir(parents=True, exist_ok=True)
        log_path = export_dir / "export.log"
        log_file = log_path.open("a", encoding="utf-8")

        process = subprocess.Popen(
            shell_command,
            cwd=str(WORKSPACE_ROOT),
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        job = ExportJob(
            export_id=export_id,
            executable=resolved_executable,
            args=resolved_args,
            callback_url=callback_url,
            parameters=parameters,
            metadata=metadata,
            command=command,
            pid=process.pid,
            log_path=log_path,
            output_path=str(parameters.get("outputPath") or metadata.get("outputPath") or ""),
        )

        with self._lock:
            self.exports[export_id] = job

        log_file.write(f"[{now_iso()}] command: {shell_command}\n")
        log_file.flush()

        thread = threading.Thread(
            target=self._watch_process,
            args=(job, log_file, process),
            daemon=True,
        )
        thread.start()
        return {"remoteJobId": export_id, "pid": process.pid, "id": export_id, "command": command}

    def _normalize_command_payload(self, payload: dict[str, Any]) -> tuple[dict[str, Any], list[str], str]:
        parameters = dict(payload.get("parameters") or {})
        args = list(payload.get("args") or [])
        executable = str(payload.get("executable") or "python")
        ignored = {
            "exportId",
            "id",
            "callbackUrl",
            "metadata",
            "executable",
            "args",
            "parameters",
        }
        if not parameters and not args:
            parameters = {key: value for key, value in payload.items() if key not in ignored}
        parameters = self._complete_parameters(parameters)
        if not args and parameters:
            args = self._build_args_from_parameters(parameters)
            executable = "python"
        return parameters, args, executable

    def _complete_parameters(self, parameters: dict[str, Any]) -> dict[str, Any]:
        completed = dict(parameters)

        raw_source = completed.get("sourcePtPath") or completed.get("sourcePtRelativePath")
        if raw_source:
            source_text = str(raw_source).strip().replace("\\", "/")
            source_path = Path(source_text)
            if not source_path.is_absolute():
                source_path = (WORKSPACE_ROOT / source_path).resolve()
            else:
                source_path = source_path.resolve()
            completed["sourcePtPath"] = str(source_path)
            if not completed.get("sourcePtRelativePath"):
                try:
                    completed["sourcePtRelativePath"] = str(source_path.relative_to(WORKSPACE_ROOT)).replace("\\", "/")
                except ValueError:
                    completed["sourcePtRelativePath"] = source_text.lstrip("/")

        if not completed.get("outputPath"):
            output_dir = str(
                completed.get("outputDirectory")
                or completed.get("outputRelativeDirectory")
                or "detector/exports"
            ).strip().replace("\\", "/")
            output_name = str(completed.get("outputFileName") or "model.onnx").strip()
            output_dir_path = Path(output_dir)
            if not output_dir_path.is_absolute():
                output_dir_path = (WORKSPACE_ROOT / output_dir_path).resolve()
            else:
                output_dir_path = output_dir_path.resolve()
            completed["outputDirectory"] = str(output_dir_path)
            completed["outputRelativeDirectory"] = completed.get("outputRelativeDirectory") or output_dir.lstrip("/")
            completed["outputFileName"] = output_name
            completed["outputPath"] = str((output_dir_path / output_name).resolve())

        return completed

    def _build_args_from_parameters(self, parameters: dict[str, Any]) -> list[str]:
        source_pt_path = parameters.get("sourcePtPath")
        output_path = parameters.get("outputPath")
        if not source_pt_path:
            raise ValueError("sourcePtPath (.pt 모델)가 필요합니다.")
        if not output_path:
            raise ValueError("outputPath가 필요합니다. outputDirectory와 outputFileName을 확인하세요.")
        img_size = str(parameters.get("imgSize") or parameters.get("inputSize") or "512,896")
        args = [
            "--weights", str(source_pt_path),
            "--output", str(output_path),
            "--img-size", img_size,
            "--batch-size", str(parameters.get("batchSize", 1)),
            "--opset", str(parameters.get("opset", 17)),
            "--max-det", str(parameters.get("maxDet", 300)),
            "--conf-thres", str(parameters.get("confThres", 0.25)),
            "--iou-thres", str(parameters.get("iouThres", 0.5)),
        ]
        if as_bool(parameters.get("end2end") or parameters.get("eNms"), True):
            args.append("--end2end")
        if as_bool(parameters.get("dynamicBatch"), True):
            args.append("--dynamic-batch")
        if as_bool(parameters.get("simplify"), True):
            args.append("--simplify")
        return args

    def _resolve_export_command(self, executable: str, args: list[str]) -> tuple[str, list[str]]:
        if Path(executable).name == "export_onnx.py" or args and Path(args[0]).name == "export_onnx.py":
            script = str(EXPORT_SCRIPT)
            if args and Path(args[0]).name == "export_onnx.py":
                return "python", [script, *args[1:]]
            return "python", [script, *args]
        if executable.endswith("export_onnx.py"):
            return "python", [executable, *args]
        return executable, args

    def _build_shell_command(self, executable: str, args: list[str]) -> str:
        quoted = " ".join(shlex.quote(part) for part in [executable, *args])
        if USE_CONDA:
            return f"conda run -n {shlex.quote(CONDA_ENV_NAME)} --no-capture-output {quoted}"
        return quoted

    def _watch_process(self, job: ExportJob, log_file, process: subprocess.Popen[str]) -> None:
        started = time.time()
        try:
            assert process.stdout is not None
            for line in process.stdout:
                log_file.write(line)
                log_file.flush()
                stripped = line.rstrip()
                if stripped:
                    agent_log(stripped, job.export_id)
                self._buffer_log_callback(job, line)
        finally:
            exit_code = process.wait()
            self._flush_log_callback(job, force=True)
            log_file.write(f"[{now_iso()}] process exit code: {exit_code}\n")
            log_file.close()

            with self._lock:
                job.exit_code = exit_code
                job.finished_at = now_iso()
                output_path = Path(job.output_path) if job.output_path else None
                output_exists = bool(output_path and output_path.exists())
                if exit_code == 0 and output_exists:
                    job.status = "completed"
                else:
                    job.status = "failed"
                    job.error_message = (
                        f"ONNX export process exit code: {exit_code}"
                        if exit_code != 0
                        else "ONNX output file was not created"
                    )

            self._send_callback(job, {
                "status": job.status,
                "outputPath": str(output_path) if output_path else job.output_path,
                "errorMessage": job.error_message,
                "exitCode": exit_code,
                "completedAt": job.finished_at,
                "log": f"[agent] elapsed={int(time.time() - started)}s exit={exit_code}\n",
            })

    def _buffer_log_callback(self, job: ExportJob, line: str) -> None:
        if not job.callback_url:
            return
        buffer = self._log_buffers.setdefault(job.export_id, [])
        buffer.append(line)
        if len(buffer) >= 24:
            self._flush_log_callback(job)
            return
        existing = self._log_flush_timers.pop(job.export_id, None)
        if existing:
            existing.cancel()

        def flush_later() -> None:
            self._flush_log_callback(job)

        timer = threading.Timer(0.25, flush_later)
        timer.daemon = True
        self._log_flush_timers[job.export_id] = timer
        timer.start()

    def _flush_log_callback(self, job: ExportJob, force: bool = False) -> None:
        timer = self._log_flush_timers.pop(job.export_id, None)
        if timer:
            timer.cancel()
        lines = self._log_buffers.pop(job.export_id, [])
        if not lines and not force:
            return
        if lines:
            self._send_callback(job, {"log": "".join(lines), "status": "running"})

    def _send_callback(self, job: ExportJob, payload: dict[str, Any]) -> None:
        if not job.callback_url:
            return
        body = {
            "exportId": job.export_id,
            "taskId": job.export_id,
            **payload,
        }
        try:
            requests.post(job.callback_url, json=body, timeout=CALLBACK_TIMEOUT_SEC)
        except Exception as error:
            agent_log(f"callback failed: {error}", job.export_id)


export_manager = ExportManager()

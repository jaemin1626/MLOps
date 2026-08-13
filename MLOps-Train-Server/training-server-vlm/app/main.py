from __future__ import annotations

from typing import Any

from flask import Flask, jsonify, request, send_file

from .config import AGENT_HOST, AGENT_PORT, AUTH_TOKEN, WORKSPACE_ROOT, agent_log, log_request, log_startup
from .job_manager import job_manager
from .task_manager import task_manager
from .weights_catalog import list_base_models


def _extract_command_payload(payload: dict[str, Any]) -> dict[str, Any]:
    inner = payload.get("payload")
    if isinstance(inner, dict) and inner:
        return dict(inner)
    ignored = {"commandType", "callbackUrl", "taskId", "async", "sync", "commandMode"}
    return {key: value for key, value in payload.items() if key not in ignored}


def create_app() -> Flask:
    app = Flask(__name__)

    @app.before_request
    def log_incoming_request() -> None:
        log_request(request.method, request.path, request.remote_addr or "-")

    @app.after_request
    def log_outgoing_response(response):
        log_request(request.method, request.path, request.remote_addr or "-", response.status_code)
        return response

    def authorize() -> tuple[dict, int] | None:
        if not AUTH_TOKEN:
            return None
        auth_header = request.headers.get("Authorization", "")
        expected = f"Bearer {AUTH_TOKEN}"
        if auth_header != expected:
            return {"error": "Unauthorized"}, 401
        return None

    @app.get("/api/v1/health")
    def health():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        snapshot = task_manager.health_snapshot()
        return jsonify({
            "status": "ok",
            "workspaceRoot": str(WORKSPACE_ROOT),
            "service": "mlops-training-server-vlm",
            **snapshot,
        })

    @app.get("/api/v1/commands")
    def list_commands():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        return jsonify({"tasks": task_manager.list_tasks()})

    @app.get("/api/v1/commands/<task_id>")
    def get_command(task_id: str):
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        task = task_manager.get_task(task_id)
        if not task:
            return jsonify({"error": "작업을 찾을 수 없습니다."}), 404
        return jsonify(task)

    @app.post("/api/v1/commands")
    def submit_command():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        payload = request.get_json(silent=True) or {}
        command_type = str(payload.get("commandType") or "")
        task_id = str(payload.get("taskId") or "")
        agent_log(f"POST /api/v1/commands: commandType={command_type} taskId={task_id or '(auto)'}")
        try:
            result = task_manager.submit(
                command_type=command_type,
                payload=_extract_command_payload(payload),
                callback_url=payload.get("callbackUrl"),
                task_id=payload.get("taskId"),
            )
            return jsonify(result), 202
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @app.get("/api/v1/workspace/file")
    def workspace_file():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        relative_path = str(request.args.get("path", "")).strip().replace("\\", "/")
        if not relative_path:
            return jsonify({"error": "path가 필요합니다."}), 400
        if ".." in relative_path.split("/"):
            return jsonify({"error": "허용되지 않은 경로입니다."}), 400
        file_path = (WORKSPACE_ROOT / relative_path.lstrip("/")).resolve()
        try:
            file_path.relative_to(WORKSPACE_ROOT.resolve())
        except ValueError:
            return jsonify({"error": "허용되지 않은 경로입니다."}), 403
        if not file_path.is_file():
            return jsonify({"error": "파일을 찾을 수 없습니다."}), 404
        allowed_suffixes = {".json", ".txt", ".log", ".safetensors"}
        if file_path.suffix.lower() not in allowed_suffixes and not file_path.name.endswith(".json"):
            return jsonify({"error": "다운로드할 수 없는 파일 형식입니다."}), 403
        return send_file(
            file_path,
            as_attachment=True,
            download_name=file_path.name,
            mimetype="application/octet-stream",
        )

    @app.get("/api/v1/weights")
    def base_weights():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        return jsonify(list_base_models())

    @app.get("/api/v1/training/jobs")
    def list_training_jobs():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        return jsonify({"jobs": job_manager.list_jobs()})

    @app.get("/api/v1/training/jobs/<job_id>")
    def get_training_job(job_id: str):
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        job = job_manager.get_job(job_id)
        if not job:
            return jsonify({"error": "학습 작업을 찾을 수 없습니다."}), 404
        return jsonify(job)

    @app.post("/api/v1/training/command-preview")
    def preview_training_command():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        payload = request.get_json(silent=True) or {}
        return jsonify(job_manager.preview_command(payload))

    @app.post("/api/v1/training/jobs")
    def start_training_job():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        payload = request.get_json(silent=True) or {}
        try:
            if payload.get("async") is True or payload.get("commandMode") == "async":
                result = task_manager.submit(
                    command_type="training.start",
                    payload=payload,
                    callback_url=payload.get("callbackUrl"),
                    task_id=payload.get("jobId") or payload.get("taskId"),
                )
                return jsonify(result), 202
            result = job_manager.start_job(payload)
            return jsonify(result), 201
        except Exception as error:
            return jsonify({"error": str(error)}), 400

    @app.post("/api/v1/training/jobs/<job_id>/stop")
    def stop_training_job(job_id: str):
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        job = job_manager.stop_job(job_id)
        if not job:
            return jsonify({"error": "학습 작업을 찾을 수 없습니다."}), 404
        return jsonify(job)

    return app


def main() -> None:
    import logging
    import sys

    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout, force=True)
    logging.getLogger("werkzeug").setLevel(logging.INFO)
    log_startup(AGENT_HOST, AGENT_PORT, str(WORKSPACE_ROOT), list(task_manager.SUPPORTED_COMMANDS))
    app = create_app()
    app.run(host=AGENT_HOST, port=AGENT_PORT, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()

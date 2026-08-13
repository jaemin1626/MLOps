from __future__ import annotations

from typing import Any

from flask import Flask, jsonify, request, send_file

from .config import AGENT_HOST, AGENT_PORT, AUTH_TOKEN, WORKSPACE_ROOT, agent_log, log_request, log_startup
from .export_manager import export_manager
from .job_manager import job_manager
from .pseudo_label_manager import list_weights, preview_command as preview_pseudo_label_command, run_pseudo_label
from .task_manager import task_manager

EXPORT_ONNX_VERSION = "1"
EXPORT_ONNX_IMPORT_ERROR: str | None = None

try:
    from export_onnx import EXPORT_ONNX_VERSION as _EXPORT_ONNX_VERSION
    EXPORT_ONNX_VERSION = _EXPORT_ONNX_VERSION
except Exception as error:
    EXPORT_ONNX_IMPORT_ERROR = str(error)


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
        body = {
            "status": "ok",
            "workspaceRoot": str(WORKSPACE_ROOT),
            "service": "intellivix-training-server-detector",
            "exportOnnxVersion": EXPORT_ONNX_VERSION,
            **snapshot,
        }
        if EXPORT_ONNX_IMPORT_ERROR:
            body["exportOnnxImportError"] = EXPORT_ONNX_IMPORT_ERROR
        return jsonify(body)

    @app.get("/api/v1/runs/folders")
    def runs_folders():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        return jsonify(list_run_folders())

    @app.get("/api/v1/runs/pt-files")
    def runs_pt_files():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        folder = request.args.get("folder", "")
        try:
            return jsonify(list_run_pt_files(folder))
        except FileNotFoundError as error:
            return jsonify({"error": str(error)}), 404
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

    @app.get("/api/v1/weights")
    def base_weights():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        return jsonify(list_weights())

    @app.post("/api/v1/tagging/pseudo-label")
    def pseudo_label():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        payload = request.get_json(silent=True) or {}
        agent_log(
            f"POST /api/v1/tagging/pseudo-label: weights={payload.get('sourcePtPath') or payload.get('weightsPath')} "
            f"scope={payload.get('scope') or 'all'}",
        )
        try:
            result = run_pseudo_label(payload)
            return jsonify(result)
        except FileNotFoundError as error:
            return jsonify({"error": str(error)}), 404
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    @app.post("/api/v1/tagging/pseudo-label/preview")
    def pseudo_label_preview():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        payload = request.get_json(silent=True) or {}
        try:
            return jsonify({"command": preview_pseudo_label_command(payload)})
        except Exception as error:
            return jsonify({"error": str(error)}), 400

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

    @app.get("/api/v1/exports")
    def list_exports():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        return jsonify({"exports": export_manager.list_exports()})

    @app.get("/api/v1/exports/<export_id>")
    def get_export(export_id: str):
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        export_job = export_manager.get_export(export_id)
        if not export_job:
            return jsonify({"error": "Export 작업을 찾을 수 없습니다."}), 404
        return jsonify(export_job)

    @app.post("/api/v1/exports/command-preview")
    def preview_export_command():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        payload = request.get_json(silent=True) or {}
        return jsonify(export_manager.preview_command(payload))

    @app.post("/api/v1/exports")
    def start_export():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        payload = request.get_json(silent=True) or {}
        agent_log(f"POST /api/v1/exports: exportId={payload.get('exportId') or payload.get('id') or '(auto)'}")
        try:
            result = export_manager.start_export(payload)
            return jsonify(result), 201
        except Exception as error:
            return jsonify({"error": str(error)}), 400

    @app.get("/api/v1/workspace/file/stat")
    def workspace_file_stat():
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
            return jsonify({"error": "파일을 찾을 수 없습니다.", "exists": False, "sizeBytes": 0}), 404
        return jsonify({
            "path": relative_path,
            "exists": True,
            "sizeBytes": file_path.stat().st_size,
        })

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
        allowed_suffixes = {".onnx", ".pt", ".txt", ".yaml", ".yml", ".log"}
        if file_path.suffix.lower() not in allowed_suffixes:
            return jsonify({"error": "다운로드할 수 없는 파일 형식입니다."}), 403
        return send_file(
            file_path,
            as_attachment=True,
            download_name=file_path.name,
            mimetype="application/octet-stream",
        )

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

    @app.post("/api/v1/datasets/split")
    def split_dataset():
        denied = authorize()
        if denied:
            body, status = denied
            return jsonify(body), status
        payload = request.get_json(silent=True) or {}
        sync_mode = request.args.get("sync") == "1" or payload.get("sync") is True
        if not sync_mode:
            agent_log(
                "POST /api/v1/datasets/split (async): "
                f"modelName={payload.get('modelName')} taskId={payload.get('taskId') or '(auto)'}"
            )
        try:
            if sync_mode:
                from .dataset_split import create_dataset_split

                result = create_dataset_split(WORKSPACE_ROOT, payload)
                return jsonify(result), 200
            result = task_manager.submit(
                command_type="dataset.split",
                payload=_extract_command_payload(payload),
                callback_url=payload.get("callbackUrl"),
                task_id=payload.get("taskId"),
            )
            return jsonify(result), 202
        except FileNotFoundError as error:
            return jsonify({"error": str(error)}), 404
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        except Exception as error:
            return jsonify({"error": str(error)}), 500

    return app


def main() -> None:
    import logging
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(message)s",
        stream=sys.stdout,
        force=True,
    )
    logging.getLogger("werkzeug").setLevel(logging.INFO)

    log_startup(
        AGENT_HOST,
        AGENT_PORT,
        str(WORKSPACE_ROOT),
        list(task_manager.SUPPORTED_COMMANDS),
    )
    app = create_app()
    app.run(host=AGENT_HOST, port=AGENT_PORT, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()

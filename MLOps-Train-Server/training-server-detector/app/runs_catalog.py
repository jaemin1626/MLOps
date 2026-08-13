from __future__ import annotations

from pathlib import Path

from .config import WORKSPACE_ROOT


RUNS_ROOT = Path(
    __import__("os").getenv("RUNS_ROOT", "detector/runs").strip().lstrip("/"),
)


def get_runs_root() -> Path:
    return (WORKSPACE_ROOT / RUNS_ROOT).resolve()


def _assert_folder_name(folder_name: str) -> str:
    normalized = str(folder_name or "").strip().replace("\\", "/").strip("/")
    if not normalized or ".." in normalized.split("/") or normalized.startswith("."):
        raise ValueError("Run 폴더명이 올바르지 않습니다.")
    if "/" in normalized:
        raise ValueError("Run 폴더는 runsRoot 바로 아래 폴더명만 선택할 수 있습니다.")
    return normalized


def list_run_folders() -> dict:
    runs_root = get_runs_root()
    folders = []
    if runs_root.exists():
        for entry in sorted(runs_root.iterdir(), key=lambda item: item.name.lower()):
            if entry.is_dir():
                folders.append({
                    "name": entry.name,
                    "path": str(entry.relative_to(WORKSPACE_ROOT)).replace("\\", "/"),
                })
    return {
        "runsRoot": str(RUNS_ROOT).replace("\\", "/"),
        "runsAbsolutePath": str(runs_root),
        "folders": folders,
    }


def list_run_pt_files(folder_name: str) -> dict:
    folder = _assert_folder_name(folder_name)
    runs_root = get_runs_root()
    folder_path = (runs_root / folder).resolve()
    if not str(folder_path).startswith(str(runs_root)):
        raise ValueError("허용되지 않은 Run 폴더 경로입니다.")
    if not folder_path.exists() or not folder_path.is_dir():
        raise FileNotFoundError(f"Run 폴더를 찾을 수 없습니다: {folder}")

    files = []
    for pt_file in sorted(folder_path.rglob("*.pt"), key=lambda item: str(item).lower()):
        if not pt_file.is_file():
            continue
        relative_path = str(pt_file.relative_to(WORKSPACE_ROOT)).replace("\\", "/")
        files.append({
            "name": pt_file.name,
            "relativePath": relative_path,
            "path": str(pt_file),
            "sizeBytes": pt_file.stat().st_size,
        })

    return {
        "folder": folder,
        "folderPath": str(folder_path.relative_to(WORKSPACE_ROOT)).replace("\\", "/"),
        "files": files,
    }

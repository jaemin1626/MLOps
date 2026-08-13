from __future__ import annotations

from pathlib import Path

from .config import WORKSPACE_ROOT

WEIGHTS_ROOT = Path(
    __import__("os").getenv("WEIGHTS_ROOT", "detector/weights").strip().lstrip("/"),
)


def get_weights_root() -> Path:
    return (WORKSPACE_ROOT / WEIGHTS_ROOT).resolve()


def list_base_weights() -> dict:
    weights_root = get_weights_root()
    weights = []
    if weights_root.exists():
        for pt_file in sorted(weights_root.glob("*.pt"), key=lambda item: item.name.lower()):
            if not pt_file.is_file():
                continue
            relative_path = str(pt_file.relative_to(WORKSPACE_ROOT)).replace("\\", "/")
            weights.append({
                "name": pt_file.name,
                "relativePath": relative_path,
                "path": str(pt_file),
                "sizeBytes": pt_file.stat().st_size,
            })
    return {
        "weightsRoot": str(WEIGHTS_ROOT).replace("\\", "/"),
        "weightsAbsolutePath": str(weights_root),
        "weights": weights,
    }

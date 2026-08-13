from __future__ import annotations

import shlex
from pathlib import Path
from typing import Any

from .config import CONDA_ENV_NAME, USE_CONDA, WORKSPACE_ROOT, agent_log
from .weights_catalog import list_base_weights

try:
    from pseudo_label import pseudo_label_images
except ImportError:
    pseudo_label_images = None

PSEUDO_LABEL_SCRIPT = Path(__file__).resolve().parents[1] / "pseudo_label.py"
IMAGE_EXTENSIONS = {".jpg", ".jpeg"}


def _resolve_workspace_path(raw_path: str) -> Path:
    text = str(raw_path or "").strip().replace("\\", "/")
    if not text:
        raise ValueError("경로가 비어 있습니다.")
    candidate = Path(text)
    if not candidate.is_absolute():
        candidate = (WORKSPACE_ROOT / text.lstrip("/")).resolve()
    else:
        candidate = candidate.resolve()
    if not str(candidate).startswith(str(WORKSPACE_ROOT.resolve())):
        raise ValueError(f"workspace 밖 경로는 사용할 수 없습니다: {candidate}")
    return candidate


def _resolve_weights_path(raw_path: str) -> Path:
    resolved = _resolve_workspace_path(raw_path)
    if resolved.suffix.lower() != ".pt":
        raise ValueError(".pt 가중치 파일만 선택할 수 있습니다.")
    if not resolved.is_file():
        raise FileNotFoundError(f"가중치 파일을 찾을 수 없습니다: {resolved}")
    return resolved


def _collect_image_paths(image_directory: Path, image_paths: list[str] | None, scope: str) -> list[Path]:
    if image_paths:
        resolved = []
        for raw in image_paths:
            path = _resolve_workspace_path(raw)
            if path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            if not path.is_file():
                raise FileNotFoundError(f"이미지를 찾을 수 없습니다: {path}")
            resolved.append(path)
        return resolved

    if not image_directory.is_dir():
        raise FileNotFoundError(f"이미지 폴더를 찾을 수 없습니다: {image_directory}")

    images: list[Path] = []
    for image_path in sorted(image_directory.rglob("*")):
        if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        label_path = image_path.with_suffix(".txt")
        if scope == "unlabeled" and label_path.exists() and label_path.stat().st_size > 0:
            continue
        images.append(image_path)
    return images


def run_pseudo_label(payload: dict[str, Any]) -> dict[str, Any]:
    if pseudo_label_images is None:
        raise RuntimeError("pseudo_label.py 를 import하지 못했습니다. agent Docker를 재빌드하세요.")

    source_pt_path = payload.get("sourcePtPath") or payload.get("weightsPath")
    if not source_pt_path:
        raise ValueError("sourcePtPath (.pt 모델)가 필요합니다.")

    image_directory_raw = payload.get("imageDirectory") or payload.get("imageRoot")
    if not image_directory_raw:
        raise ValueError("imageDirectory 가 필요합니다.")

    image_directory = _resolve_workspace_path(str(image_directory_raw))
    weights_path = _resolve_weights_path(str(source_pt_path))
    scope = str(payload.get("scope") or "all").strip().lower()
    if scope not in {"all", "unlabeled", "current"}:
        raise ValueError("scope 는 all, unlabeled, current 중 하나여야 합니다.")

    image_paths_raw = payload.get("imagePaths") or payload.get("images")
    image_paths_list = list(image_paths_raw) if isinstance(image_paths_raw, list) else None
    if scope == "current" and not image_paths_list:
        raise ValueError("scope=current 는 imagePaths 가 필요합니다.")

    image_paths = _collect_image_paths(image_directory, image_paths_list, scope)
    if not image_paths:
        raise ValueError("pseudo labeling 대상 이미지가 없습니다.")

    conf = float(payload.get("conf") or payload.get("confThres") or 0.25)
    iou = float(payload.get("iou") or payload.get("iouThres") or 0.45)
    overwrite = bool(payload.get("overwrite"))
    target_class_names = payload.get("classNames")
    if isinstance(target_class_names, list):
        target_class_names = [str(name).strip() for name in target_class_names if str(name).strip()]
    else:
        target_class_names = None

    agent_log(
        f"pseudo-label start weights={weights_path.name} images={len(image_paths)} scope={scope}",
        "pseudo-label",
    )
    result = pseudo_label_images(
        weights_path,
        image_paths,
        conf=conf,
        iou=iou,
        overwrite=overwrite,
        target_class_names=target_class_names,
    )
    result["imageDirectory"] = str(image_directory)
    result["scope"] = scope
    return result


def preview_command(payload: dict[str, Any]) -> str:
    weights_path = _resolve_weights_path(str(payload.get("sourcePtPath") or payload.get("weightsPath")))
    image_paths = payload.get("imagePaths") or []
    if not isinstance(image_paths, list):
        image_paths = []
    args = [
        "python",
        str(PSEUDO_LABEL_SCRIPT),
        "--weights",
        str(weights_path),
        "--conf",
        str(payload.get("conf") or payload.get("confThres") or 0.25),
        "--iou",
        str(payload.get("iou") or payload.get("iouThres") or 0.45),
    ]
    if payload.get("overwrite"):
        args.append("--overwrite")
    for image_path in image_paths[:3]:
        args.extend(["--image", str(_resolve_workspace_path(str(image_path)))])
    if len(image_paths) > 3:
        args.append("...")
    quoted = " ".join(shlex.quote(part) for part in args if part != "...")
    if len(image_paths) > 3:
        quoted += " ..."
    if USE_CONDA:
        return f"conda run -n {shlex.quote(CONDA_ENV_NAME)} --no-capture-output {quoted}"
    return quoted


def list_weights() -> dict[str, Any]:
    return list_base_weights()
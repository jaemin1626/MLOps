from __future__ import annotations

import hashlib
import random
import re
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
DEFAULT_TRAIN_RATIO = 0.9
DEFAULT_DATA_LISTS_ROOT = "detector/data"
TRAIN_LIST_NAME = "train.txt"
VAL_LIST_NAME = "valid.txt"


class SplitLogger:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def info(self, message: str) -> SplitLogger:
        self.lines.append(f"[INFO] {message}")
        return self

    def step(self, message: str) -> SplitLogger:
        self.lines.append(f"[STEP] {message}")
        return self

    def ok(self, message: str) -> SplitLogger:
        self.lines.append(f"[ OK ] {message}")
        return self

    def warn(self, message: str) -> SplitLogger:
        self.lines.append(f"[WARN] {message}")
        return self

    def error(self, message: str) -> SplitLogger:
        self.lines.append(f"[ERR ] {message}")
        return self

    def to_array(self) -> list[str]:
        return list(self.lines)

    def text(self) -> str:
        return "\n".join(self.lines)


def _assert_relative_path(text: str, field_name: str) -> str:
    normalized = str(text or "").strip().replace("\\", "/").lstrip("/")
    if not normalized:
        raise ValueError(f"{field_name} 항목은 필수입니다.")
    if normalized.startswith("/") or ".." in normalized.split("/"):
        raise ValueError(f"{field_name} 항목은 workspace 기준 상대 경로만 입력할 수 있습니다.")
    return normalized


def _sanitize_model_folder_name(model_name: str) -> str:
    sanitized = re.sub(r"[^\w.-]+", "_", str(model_name or "model").strip())
    sanitized = sanitized.strip("_")
    return sanitized or "model"


def _get_data_lists_root(payload: dict) -> str:
    return str(payload.get("dataListsRoot") or DEFAULT_DATA_LISTS_ROOT).strip().strip("/")


def _build_split_relative_paths(model_folder_name: str, data_lists_root: str) -> dict[str, str]:
    base = f"{data_lists_root}/{model_folder_name}"
    return {
        "modelFolderName": model_folder_name,
        "splitDirectory": base,
        "trainPath": f"{base}/{TRAIN_LIST_NAME}",
        "valPath": f"{base}/{VAL_LIST_NAME}",
    }


def _resolve_available_model_folder(data_lists_directory: Path, model_name: str) -> str:
    sanitized = _sanitize_model_folder_name(model_name)
    candidate = sanitized
    suffix = 2
    while (data_lists_directory / candidate).exists():
        candidate = f"{sanitized}_{suffix}"
        suffix += 1
    return candidate


def _resolve_dataset_path(workspace_root: Path, relative_dataset_path: str) -> Path:
    normalized = _assert_relative_path(relative_dataset_path, "학습 데이터셋 경로")
    dataset_root = workspace_root / normalized
    if not dataset_root.exists():
        raise FileNotFoundError(f"데이터셋 폴더를 찾을 수 없습니다: {normalized}")
    return dataset_root


def _list_images_recursively(root_path: Path, maximum_images: int = 50000) -> list[Path]:
    images: list[Path] = []
    for file_path in root_path.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if file_path.name.startswith("."):
            continue
        images.append(file_path)
        if len(images) >= maximum_images:
            break
    return sorted(images)


def _seed_from_dataset(relative_dataset_path: str, model_folder_name: str, explicit_seed: int | None) -> int:
    if explicit_seed is not None:
        return int(explicit_seed)
    digest = hashlib.md5(f"{relative_dataset_path}:{model_folder_name}".encode("utf-8")).hexdigest()[:8]
    return int(digest, 16)


def _find_scan_for_image(image_path: Path, scan_pairs: list[tuple[str, Path]]) -> tuple[str, Path]:
    resolved = image_path.resolve()
    best = scan_pairs[0]
    best_root_len = -1
    for relative_path, dataset_root in scan_pairs:
        root = dataset_root.resolve()
        try:
            resolved.relative_to(root)
            if len(str(root)) > best_root_len:
                best = (relative_path, dataset_root)
                best_root_len = len(str(root))
        except ValueError:
            if resolved == root and len(str(root)) > best_root_len:
                best = (relative_path, dataset_root)
                best_root_len = len(str(root))
    return best


def _to_workspace_relative_image_path(relative_dataset_path: str, dataset_root: Path, image_path: Path) -> str:
    relative_within_dataset = image_path.relative_to(dataset_root).as_posix()
    if relative_within_dataset:
        return f"{relative_dataset_path}/{relative_within_dataset}"
    return relative_dataset_path


def _count_nonempty_lines(file_path: Path) -> int:
    if not file_path.exists():
        return 0
    return sum(1 for line in file_path.read_text(encoding="utf-8").splitlines() if line.strip())


def _folder_has_split_files(folder_path: Path) -> bool:
    return _count_nonempty_lines(folder_path / TRAIN_LIST_NAME) > 0 \
        and (folder_path / VAL_LIST_NAME).exists()


def _build_reused_split_result(
    workspace_root: Path,
    log: SplitLogger,
    *,
    relative_dataset_path: str,
    model_name: str,
    model_folder_name: str,
    data_lists_root: str,
    train_list_path: Path,
    val_list_path: Path,
) -> dict:
    split_paths = _build_split_relative_paths(model_folder_name, data_lists_root)
    train_count = _count_nonempty_lines(train_list_path)
    val_count = _count_nonempty_lines(val_list_path)
    log.ok(f"기존 split 재사용: {split_paths['splitDirectory']}")
    log.info(f"train {train_count} · valid {val_count}")
    return {
        "relativeDatasetPath": relative_dataset_path,
        "modelName": model_name,
        "modelFolderName": model_folder_name,
        "dataListsRoot": data_lists_root,
        "splitDirectory": split_paths["splitDirectory"],
        "trainPath": split_paths["trainPath"],
        "valPath": split_paths["valPath"],
        "trainListPath": str(train_list_path),
        "valListPath": str(val_list_path),
        "trainCount": train_count,
        "valCount": val_count,
        "totalCount": train_count + val_count,
        "trainRatio": DEFAULT_TRAIN_RATIO,
        "seed": None,
        "warnings": [],
        "logs": log.to_array(),
        "logText": log.text(),
        "status": "completed",
        "reusedExistingSplit": True,
        "executionTarget": "remote-agent",
        "message": f"기존 split 사용 · {split_paths['splitDirectory']} (train {train_count}, valid {val_count})",
    }


def create_dataset_split(workspace_root: Path, payload: dict) -> dict:
    log = SplitLogger()
    model_name = str(payload.get("name") or payload.get("modelName") or "").strip()
    if not model_name:
        log.error("학습명(name)이 필요합니다.")
        raise ValueError("학습명(name)이 필요합니다. split 폴더명으로 사용됩니다.")

    log.info(f"학습명: {model_name}")
    raw_dataset_path = str(payload.get("datasetPath") or "").strip()
    dataset_paths = payload.get("datasetPaths")
    if isinstance(dataset_paths, list):
        relative_dataset_paths = [
            _assert_relative_path(item, "학습 데이터셋 경로")
            for item in dataset_paths
            if str(item or "").strip()
        ]
    elif raw_dataset_path:
        relative_dataset_paths = [
            _assert_relative_path(item, "학습 데이터셋 경로")
            for item in raw_dataset_path.split(",")
            if item.strip()
        ]
    else:
        relative_dataset_paths = []
    if not relative_dataset_paths:
        log.error("학습 데이터셋 경로가 필요합니다.")
        raise ValueError("학습 데이터셋 경로를 하나 이상 선택하세요.")
    relative_dataset_path = ",".join(relative_dataset_paths)
    log.info(f"데이터셋: {relative_dataset_path}")
    data_lists_root = _get_data_lists_root(payload)
    sanitized = _sanitize_model_folder_name(model_name)
    data_lists_directory = workspace_root / data_lists_root
    data_lists_directory.mkdir(parents=True, exist_ok=True)

    force_recreate = payload.get("forceRecreate") is True
    if not force_recreate:
        exact_dir = data_lists_directory / sanitized
        if _folder_has_split_files(exact_dir):
            return _build_reused_split_result(
                workspace_root,
                log,
                relative_dataset_path=relative_dataset_path,
                model_name=model_name,
                model_folder_name=sanitized,
                data_lists_root=data_lists_root,
                train_list_path=exact_dir / TRAIN_LIST_NAME,
                val_list_path=exact_dir / VAL_LIST_NAME,
            )

    log.step("데이터셋 폴더 확인 중...")
    dataset_scan_pairs: list[tuple[str, Path]] = []
    image_paths: set[Path] = set()
    for item in relative_dataset_paths:
        dataset_root = _resolve_dataset_path(workspace_root, item)
        dataset_scan_pairs.append((item, dataset_root))
        log.ok(f"데이터셋 경로 확인: {item}")
        for image_path in _list_images_recursively(dataset_root):
            image_paths.add(image_path.resolve())
    images = sorted(image_paths)
    if not images:
        log.error("split할 이미지가 없습니다.")
        raise ValueError("split할 이미지가 없습니다.")
    log.ok(f"이미지 {len(images)}장 발견")

    train_ratio = float(payload.get("trainRatio") or DEFAULT_TRAIN_RATIO)
    if train_ratio <= 0 or train_ratio >= 1:
        log.error("trainRatio는 0과 1 사이여야 합니다.")
        raise ValueError("trainRatio는 0과 1 사이의 값이어야 합니다.")

    exact_dir = data_lists_directory / sanitized
    if exact_dir.exists() and _folder_has_split_files(exact_dir) and force_recreate:
        model_folder_name = _resolve_available_model_folder(data_lists_directory, model_name)
    elif exact_dir.exists() and not _folder_has_split_files(exact_dir):
        model_folder_name = sanitized
    elif exact_dir.exists():
        model_folder_name = _resolve_available_model_folder(data_lists_directory, model_name)
    else:
        model_folder_name = sanitized
    split_paths = _build_split_relative_paths(model_folder_name, data_lists_root)
    split_directory = workspace_root / split_paths["splitDirectory"]
    split_directory.mkdir(parents=True, exist_ok=True)
    train_list_path = split_directory / TRAIN_LIST_NAME
    val_list_path = split_directory / VAL_LIST_NAME

    if model_folder_name != sanitized:
        log.warn(f"동일 학습명 폴더 존재 → {model_folder_name} 폴더 사용")
    else:
        log.ok(f"출력 폴더: {split_paths['splitDirectory']}")

    log.step(
        f"9:1 비율로 분할 중 (train {round(train_ratio * 100)}% / valid {round((1 - train_ratio) * 100)}%)..."
    )
    seed = _seed_from_dataset(relative_dataset_path, model_folder_name, payload.get("seed"))
    random_generator = random.Random(seed)
    shuffled = images[:]
    random_generator.shuffle(shuffled)

    val_count = 0 if len(shuffled) < 2 else max(1, round(len(shuffled) * (1 - train_ratio)))
    train_images = shuffled[: len(shuffled) - val_count]
    val_images = shuffled[len(shuffled) - val_count :]

    train_lines = [
        _to_workspace_relative_image_path(rel_path, root, image)
        for image in train_images
        for rel_path, root in [_find_scan_for_image(image, dataset_scan_pairs)]
    ]
    val_lines = [
        _to_workspace_relative_image_path(rel_path, root, image)
        for image in val_images
        for rel_path, root in [_find_scan_for_image(image, dataset_scan_pairs)]
    ]

    log.step("train.txt / valid.txt 작성 중...")
    train_list_path.write_text("\n".join(train_lines) + ("\n" if train_lines else ""), encoding="utf-8")
    val_list_path.write_text("\n".join(val_lines) + ("\n" if val_lines else ""), encoding="utf-8")
    log.ok(f"train.txt 작성 완료 ({len(train_images)} lines)")
    log.ok(f"valid.txt 작성 완료 ({len(val_images)} lines)")

    for line in train_lines[:3]:
        log.info(f"  train sample: {line}")
    for line in val_lines[:3]:
        log.info(f"  valid sample: {line}")

    warnings: list[str] = []
    if not val_images:
        warnings.append("이미지가 1장뿐이라 valid 목록이 비어 있습니다.")
        log.warn("valid 목록이 비어 있습니다.")
    if model_folder_name != sanitized:
        warnings.append(f"동일 학습명 폴더가 있어 {model_folder_name} 폴더를 생성했습니다.")

    log.ok("split 생성 완료")

    return {
        "relativeDatasetPath": relative_dataset_path,
        "modelName": model_name,
        "modelFolderName": model_folder_name,
        "dataListsRoot": data_lists_root,
        "splitDirectory": split_paths["splitDirectory"],
        "trainPath": split_paths["trainPath"],
        "valPath": split_paths["valPath"],
        "trainListPath": str(train_list_path),
        "valListPath": str(val_list_path),
        "trainCount": len(train_images),
        "valCount": len(val_images),
        "totalCount": len(shuffled),
        "trainRatio": train_ratio,
        "seed": seed,
        "warnings": warnings,
        "logs": log.to_array(),
        "logText": log.text(),
        "status": "completed",
        "executionTarget": "remote-agent",
        "message": (
            f"9:1 split 생성 완료 · {split_paths['splitDirectory']} "
            f"(train {len(train_images)}, valid {len(val_images)})"
        ),
    }

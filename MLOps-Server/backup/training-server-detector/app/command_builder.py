from __future__ import annotations

from pathlib import Path


def resolve_workspace_path(workspace_root: str, relative_or_absolute: str) -> str:
    text = str(relative_or_absolute or "").strip().replace("\\", "/")
    if not text:
        raise ValueError("경로가 비어 있습니다.")
    if text.startswith("/"):
        return text
    if ".." in text.split("/"):
        raise ValueError("상대 경로에 .. 은 사용할 수 없습니다.")
    return str(Path(workspace_root) / text)


def resolve_dataset_argument(workspace_root: str, parameters: dict) -> str:
    dataset_paths = parameters.get("datasetPaths")
    if isinstance(dataset_paths, list) and dataset_paths:
        resolved = [
            resolve_workspace_path(workspace_root, item)
            for item in dataset_paths
            if str(item or "").strip()
        ]
        if resolved:
            return ",".join(resolved)

    raw = str(parameters.get("datasetPath") or "").strip()
    if not raw:
        raise ValueError("학습 데이터셋 경로가 필요합니다.")
    if "," in raw:
        return ",".join(
            resolve_workspace_path(workspace_root, item.strip())
            for item in raw.split(",")
            if item.strip()
        )
    return resolve_workspace_path(workspace_root, raw)


def build_training_args(parameters: dict, workspace_root: str) -> list[str]:
    name = parameters.get("name")
    dataset_path = resolve_dataset_argument(workspace_root, parameters)
    output_path = resolve_workspace_path(workspace_root, parameters.get("outputPath"))
    model_path = resolve_workspace_path(workspace_root, parameters.get("modelPath"))
    args = [
        "train_detector.py",
        "--name", str(name),
        "--dataset", dataset_path,
        "--output-dir", output_path,
        "--device", str(parameters.get("gpu", "0")),
        "--epochs", str(parameters.get("epochs", 1)),
        "--batch-size", str(parameters.get("batchSize", 8)),
        "--learning-rate", str(parameters.get("learningRate", 0.001)),
        "--model", model_path,
        "--img-size", str(parameters.get("imageSize", 640)),
        "--optimizer", str(parameters.get("optimizer", "AdamW")),
        "--workers", str(parameters.get("workers", 4)),
    ]
    if parameters.get("datasetConfigPath"):
        config_path = resolve_workspace_path(workspace_root, parameters["datasetConfigPath"])
        args.extend(["--data-config", config_path])
    if parameters.get("pretrained"):
        args.append("--pretrained")
    if parameters.get("resume"):
        args.append("--resume")
        if parameters.get("resumeCheckpoint"):
            args.extend([
                "--resume-checkpoint",
                resolve_workspace_path(workspace_root, parameters["resumeCheckpoint"]),
            ])
    return args

from __future__ import annotations

from pathlib import Path

from vlm_model_utils import resolve_base_model


def resolve_workspace_path(workspace_root: str, relative_or_absolute: str) -> str:
    text = str(relative_or_absolute or "").strip().replace("\\", "/")
    if not text:
        raise ValueError("경로가 비어 있습니다.")
    if text.startswith("/"):
        return text
    if ".." in text.split("/"):
        raise ValueError("상대 경로에 .. 은 사용할 수 없습니다.")
    return str(Path(workspace_root) / text)


def resolve_training_base_model(parameters: dict, workspace_root: str) -> str:
    raw = parameters.get("baseModelPath") or parameters.get("baseModel") or "Qwen/Qwen3-VL-4B-Instruct"
    return resolve_base_model(str(raw), workspace_root)


def build_vlm_training_args(parameters: dict, workspace_root: str) -> list[str]:
    name = parameters.get("name")
    dataset_path = resolve_workspace_path(workspace_root, parameters.get("datasetPath"))
    output_path = resolve_workspace_path(workspace_root, parameters.get("outputPath"))
    base_model = resolve_training_base_model(parameters, workspace_root)
    args = [
        "train_vlm.py",
        "--name", str(name),
        "--dataset", dataset_path,
        "--output-dir", output_path,
        "--device", str(parameters.get("gpu", "0")),
        "--epochs", str(parameters.get("epochs", 1)),
        "--batch-size", str(parameters.get("batchSize", 4)),
        "--learning-rate", str(parameters.get("learningRate", 0.0001)),
        "--base-model", base_model,
        "--gradient-accumulation-steps", str(parameters.get("gradientAccumulationSteps", 1)),
        "--max-sequence-length", str(parameters.get("maxSequenceLength", 2048)),
        "--optimizer", str(parameters.get("optimizer", "AdamW")),
        "--precision", str(parameters.get("precision", "bf16")),
    ]
    if parameters.get("useLora"):
        args.append("--use-lora")
        args.extend([
            "--lora-rank", str(parameters.get("loraRank", 8)),
            "--lora-alpha", str(parameters.get("loraAlpha", 16)),
            "--lora-dropout", str(parameters.get("loraDropout", 0.05)),
        ])
    else:
        args.append("--full-finetune")
    if parameters.get("resume"):
        args.append("--resume")
        if parameters.get("resumeCheckpoint"):
            args.extend([
                "--resume-checkpoint",
                resolve_workspace_path(workspace_root, parameters["resumeCheckpoint"]),
            ])
    return args

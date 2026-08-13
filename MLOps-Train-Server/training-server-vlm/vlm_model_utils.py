from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import torch

VLM_WEIGHTS_ROOT = Path(os.getenv("VLM_WEIGHTS_ROOT", "vlm/weights").strip().lstrip("/"))


def get_workspace_root(workspace_root: str | Path | None = None) -> Path:
    if workspace_root is not None:
        return Path(workspace_root).resolve()
    return Path(os.getenv("WORKSPACE_ROOT", "/workspace")).resolve()


def get_weights_root(workspace_root: str | Path | None = None) -> Path:
    return (get_workspace_root(workspace_root) / VLM_WEIGHTS_ROOT).resolve()


def is_local_model_dir(path: Path) -> bool:
    return path.is_dir() and (path / "config.json").is_file()


def read_model_config(model_path: str | Path) -> dict[str, Any]:
    config_path = Path(model_path) / "config.json"
    if not config_path.is_file():
        return {}
    return json.loads(config_path.read_text(encoding="utf-8"))


def resolve_base_model(base_model: str, workspace_root: str | Path | None = None) -> str:
    text = str(base_model or "").strip()
    if not text:
        raise ValueError("base model이 비어 있습니다.")

    workspace = get_workspace_root(workspace_root)
    normalized = text.replace("\\", "/")

    candidates: list[Path] = []
    raw_path = Path(normalized)
    if raw_path.is_absolute():
        candidates.append(raw_path)

    rel = normalized.lstrip("/")
    if rel:
        candidates.append((workspace / rel).resolve())

    weights_root = get_weights_root(workspace)
    short_name = rel.split("/")[-1] if rel else text
    candidates.extend([
        weights_root / text,
        weights_root / short_name,
    ])

    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        if is_local_model_dir(candidate):
            return str(candidate.resolve())

    return text


def list_local_base_models(workspace_root: str | Path | None = None) -> dict[str, Any]:
    weights_root = get_weights_root(workspace_root)
    models: list[dict[str, Any]] = []
    if weights_root.is_dir():
        for model_dir in sorted(weights_root.iterdir(), key=lambda item: item.name.lower()):
            if not is_local_model_dir(model_dir):
                continue
            config = read_model_config(model_dir)
            relative_path = str(model_dir.relative_to(get_workspace_root(workspace_root))).replace("\\", "/")
            models.append({
                "name": model_dir.name,
                "relativePath": relative_path,
                "path": str(model_dir),
                "modelType": config.get("model_type"),
                "architectures": config.get("architectures") or [],
            })

    return {
        "weightsRoot": str(VLM_WEIGHTS_ROOT).replace("\\", "/"),
        "weightsAbsolutePath": str(weights_root),
        "models": models,
    }


def pick_model_class(model_path: str):
    from transformers import AutoConfig

    config = AutoConfig.from_pretrained(model_path, trust_remote_code=True)
    architectures = list(getattr(config, "architectures", None) or [])
    model_type = str(getattr(config, "model_type", "") or "")
    arch_text = " ".join(architectures)

    if "Qwen3_5ForConditionalGeneration" in arch_text or model_type == "qwen3_5":
        from transformers import Qwen3_5ForConditionalGeneration

        return Qwen3_5ForConditionalGeneration
    if "Qwen2_5_VLForConditionalGeneration" in arch_text or "qwen2_5_vl" in model_type:
        from transformers import Qwen2_5_VLForConditionalGeneration

        return Qwen2_5_VLForConditionalGeneration
    if "Qwen2VL" in arch_text or "qwen2_vl" in model_type:
        from transformers import Qwen2VLForConditionalGeneration

        return Qwen2VLForConditionalGeneration

    from transformers import AutoModelForImageTextToText

    return AutoModelForImageTextToText


def load_vlm_model_and_processor(
    base_model: str,
    *,
    workspace_root: str | Path | None = None,
    use_lora: bool = True,
    lora_rank: int = 8,
    lora_alpha: int = 16,
    lora_dropout: float = 0.05,
):
    from transformers import AutoProcessor

    model_path = resolve_base_model(base_model, workspace_root)
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32

    processor = AutoProcessor.from_pretrained(model_path, trust_remote_code=True)
    model_cls = pick_model_class(model_path)
    model = model_cls.from_pretrained(
        model_path,
        torch_dtype=dtype,
        trust_remote_code=True,
    )

    if use_lora:
        from peft import LoraConfig, TaskType, get_peft_model

        target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
        lora_config = LoraConfig(
            r=lora_rank,
            lora_alpha=lora_alpha,
            lora_dropout=lora_dropout,
            bias="none",
            task_type=TaskType.CAUSAL_LM,
            target_modules=target_modules,
        )
        model = get_peft_model(model, lora_config)
        model.print_trainable_parameters()

    return model, processor, model_path

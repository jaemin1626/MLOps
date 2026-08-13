#!/usr/bin/env python3
"""Fine-tune Qwen VL models on MLOps VLM tagging conversations.json."""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from pathlib import Path
from typing import Any

import torch
from PIL import Image
from torch.utils.data import Dataset


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Qwen VL fine-tuning for MLOps Platform")
    parser.add_argument("--name", required=True, help="Run name")
    parser.add_argument("--dataset", required=True, help="conversations.json path or directory")
    parser.add_argument("--output-dir", required=True, help="Output root directory")
    parser.add_argument("--device", default="0", help="CUDA device id(s)")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--base-model", default="Qwen/Qwen3-VL-4B-Instruct")
    parser.add_argument("--use-lora", action="store_true")
    parser.add_argument("--full-finetune", action="store_true")
    parser.add_argument("--lora-rank", type=int, default=8)
    parser.add_argument("--lora-alpha", type=int, default=16)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=1)
    parser.add_argument("--max-sequence-length", type=int, default=2048)
    parser.add_argument("--optimizer", default="AdamW", choices=["AdamW", "Adam", "SGD"])
    parser.add_argument("--precision", default="bf16", choices=["bf16", "fp16", "fp32"])
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--resume-checkpoint", default="")
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def configure_device(device_arg: str) -> torch.device:
    os.environ["CUDA_VISIBLE_DEVICES"] = str(device_arg)
    if torch.cuda.is_available():
        return torch.device("cuda:0")
    return torch.device("cpu")


def find_child_dir(parent: Path, *names: str) -> Path | None:
    for name in names:
        exact = parent / name
        if exact.is_dir():
            return exact
        for child in parent.iterdir():
            if child.is_dir() and child.name.lower() == name.lower():
                return child
    return None


def find_label_json(label_dir: Path, topic_name: str = "") -> Path:
    preferred = [label_dir / "conversations.json"]
    if topic_name:
        preferred.append(label_dir / f"{topic_name}.json")
    for candidate in preferred:
        if candidate.is_file():
            return candidate
    json_files = sorted(label_dir.glob("*.json"))
    if len(json_files) == 1:
        return json_files[0]
    if topic_name:
        matched = [path for path in json_files if topic_name.lower() in path.name.lower()]
        if matched:
            return matched[0]
    return label_dir / "conversations.json"


def resolve_dataset_paths(dataset_arg: str) -> tuple[Path, Path, Path | None]:
    dataset_path = Path(dataset_arg).resolve()
    topic_name: str | None = None

    if dataset_path.is_file():
        json_path = dataset_path
        if dataset_path.parent.name.lower() == "label":
            topic_root = dataset_path.parent.parent
            topic_name = topic_root.name
            images_dir = find_child_dir(topic_root, "Images", "images")
        else:
            topic_root = dataset_path.parent.parent
            images_dir = find_child_dir(topic_root, "Images", "images") or dataset_path.parent.parent / "images"
    else:
        images_dir = find_child_dir(dataset_path, "Images", "images")
        label_dir = find_child_dir(dataset_path, "label", "json")
        if images_dir and label_dir:
            topic_name = dataset_path.name
            json_path = find_label_json(label_dir, topic_name)
        else:
            candidates = [
                dataset_path / "label" / "conversations.json",
                dataset_path / "json" / "conversations.json",
                dataset_path / "conversations.json",
            ]
            json_path = next((path for path in candidates if path.is_file()), None)
            if json_path is None and dataset_path.is_dir():
                label_root = find_child_dir(dataset_path, "label", "json")
                if label_root:
                    json_path = find_label_json(label_root, dataset_path.name)
            if json_path is None:
                raise FileNotFoundError(f"label JSON 파일을 찾지 못했습니다: {dataset_path}")
            if not images_dir:
                images_dir = find_child_dir(dataset_path, "Images", "images")
                if not images_dir and dataset_path.parent.name.lower() in {"label", "json"}:
                    topic_root = dataset_path.parent.parent
                    images_dir = find_child_dir(topic_root, "Images", "images")
                    topic_name = topic_root.name
                elif not images_dir:
                    images_dir = dataset_path.parent / "images"
                    if not images_dir.is_dir():
                        images_dir = dataset_path / "images"

    if not json_path.is_file():
        raise FileNotFoundError(f"데이터셋 JSON 파일이 없습니다: {json_path}")
    if not images_dir or not images_dir.is_dir():
        raise FileNotFoundError(f"Images 폴더를 찾지 못했습니다: {images_dir}")
    return json_path, images_dir, topic_name


def load_records(json_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("conversations.json 은 배열 형식이어야 합니다.")
    records = [item for item in payload if isinstance(item, dict) and item.get("conversations")]
    if not records:
        raise ValueError("학습 가능한 대화 레코드가 없습니다.")
    return records


def log_progress(epoch: int, total_epoch: int, step: int, total_step: int, loss: float) -> None:
    progress = min(100.0, round(((epoch - 1) + (step / max(total_step, 1))) / max(total_epoch, 1) * 100, 2))
    print(
        f"MLOPS_PROGRESS epoch={epoch}/{total_epoch} step={step}/{total_step} "
        f"loss={loss:.6f} progress={progress:.2f}",
        flush=True,
    )


def load_model_and_processor(base_model: str, use_lora: bool, lora_rank: int, lora_alpha: int, lora_dropout: float):
    from transformers import AutoProcessor

    processor = None
    model = None
    model_name = base_model.lower()

    try:
        if "qwen3" in model_name or "qwen2.5" in model_name or "qwen2_5" in model_name or "qwen2-vl" in model_name:
            from transformers import Qwen2_5_VLForConditionalGeneration

            processor = AutoProcessor.from_pretrained(base_model, trust_remote_code=True)
            model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                base_model,
                torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
                trust_remote_code=True,
            )
        else:
            from transformers import AutoModelForVision2Seq

            processor = AutoProcessor.from_pretrained(base_model, trust_remote_code=True)
            model = AutoModelForVision2Seq.from_pretrained(
                base_model,
                torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
                trust_remote_code=True,
            )
    except Exception as error:
        raise RuntimeError(f"모델 로드 실패 ({base_model}): {error}") from error

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
    return model, processor


class VlmConversationDataset(Dataset):
    def __init__(
        self,
        records: list[dict[str, Any]] | None = None,
        images_dir: Path | None = None,
        topic_name: str | None = None,
        samples: list[tuple[dict[str, Any], Path, str]] | None = None,
    ) -> None:
        if samples is not None:
            self.samples = samples
        else:
            self.samples = [
                (record, images_dir or Path("."), topic_name or "")
                for record in (records or [])
            ]

    def __len__(self) -> int:
        return len(self.samples)

    @staticmethod
    def _resolve_image_path(images_dir: Path, topic_name: str, image_name: str) -> Path:
        normalized = str(image_name or "").replace("\\", "/").lstrip("/")
        candidates = [images_dir / normalized]
        if topic_name and normalized.startswith(f"{topic_name}/"):
            candidates.append(images_dir / normalized[len(topic_name) + 1 :])
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        raise FileNotFoundError(f"이미지를 찾지 못했습니다: {candidates[0]}")

    def __getitem__(self, index: int) -> dict[str, Any]:
        record, images_dir, topic_name = self.samples[index]
        image_path = self._resolve_image_path(images_dir, topic_name, str(record.get("image") or ""))
        conversations = record.get("conversations") or []
        human = next((entry.get("value", "") for entry in conversations if entry.get("from") == "human"), "")
        assistant = next((entry.get("value", "") for entry in conversations if entry.get("from") == "gpt"), "")
        human_text = str(human).replace("<image>", "").strip()
        return {
            "image_path": str(image_path),
            "human": human_text,
            "assistant": str(assistant).strip(),
            "index": str(record.get("index") or index),
        }


def build_messages(sample: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": sample["image_path"]},
                {"type": "text", "text": sample["human"]},
            ],
        },
        {
            "role": "assistant",
            "content": [{"type": "text", "text": sample["assistant"]}],
        },
    ]


def collate_batch(batch: list[dict[str, Any]], processor, max_length: int) -> dict[str, torch.Tensor]:
    texts: list[str] = []
    images: list[Image.Image] = []
    for sample in batch:
        messages = build_messages(sample)
        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
        texts.append(text)
        images.append(Image.open(sample["image_path"]).convert("RGB"))

    encoded = processor(
        text=texts,
        images=images,
        padding=True,
        truncation=True,
        max_length=max_length,
        return_tensors="pt",
    )
    labels = encoded["input_ids"].clone()
    if processor.tokenizer.pad_token_id is not None:
        labels[labels == processor.tokenizer.pad_token_id] = -100
    encoded["labels"] = labels
    return encoded


def build_optimizer(model, optimizer_name: str, learning_rate: float):
    params = [param for param in model.parameters() if param.requires_grad]
    name = optimizer_name.lower()
    if name == "sgd":
        return torch.optim.SGD(params, lr=learning_rate, momentum=0.9)
    if name == "adam":
        return torch.optim.Adam(params, lr=learning_rate)
    return torch.optim.AdamW(params, lr=learning_rate)


def save_checkpoint(model, processor, output_dir: Path, tag: str) -> None:
    target = output_dir / tag
    target.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(target)
    processor.save_pretrained(target)


def load_training_samples(dataset_arg: str) -> tuple[list[tuple[dict[str, Any], Path, str]], list[Path], list[Path]]:
    parts = [part.strip() for part in str(dataset_arg).split(",") if part.strip()]
    if not parts:
        parts = [str(dataset_arg).strip()]
    samples: list[tuple[dict[str, Any], Path, str]] = []
    json_paths: list[Path] = []
    images_dirs: list[Path] = []
    for part in parts:
        json_path, images_dir, topic_name = resolve_dataset_paths(part)
        json_paths.append(json_path)
        images_dirs.append(images_dir)
        for record in load_records(json_path):
            samples.append((record, images_dir, topic_name or ""))
    return samples, json_paths, images_dirs


def main() -> int:
    args = parse_args()
    if args.use_lora and args.full_finetune:
        print("오류: --use-lora 와 --full-finetune 은 동시에 사용할 수 없습니다.", file=sys.stderr)
        return 2
    if not args.use_lora and not args.full_finetune:
        args.use_lora = True

    random.seed(args.seed)
    torch.manual_seed(args.seed)

    device = configure_device(args.device)
    samples, json_paths, images_dirs = load_training_samples(args.dataset)
    run_dir = Path(args.output_dir).resolve() / args.name
    run_dir.mkdir(parents=True, exist_ok=True)

    metadata = {
        "name": args.name,
        "dataset": ",".join(str(item) for item in json_paths),
        "imagesDir": ",".join(str(item) for item in images_dirs),
        "baseModel": args.base_model,
        "useLora": args.use_lora,
        "epochs": args.epochs,
        "batchSize": args.batch_size,
        "learningRate": args.learning_rate,
        "recordCount": len(samples),
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    (run_dir / "training-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Starting VLM training for {args.epochs} epochs on {len(samples)} samples", flush=True)
    print(f"dataset={metadata['dataset']}", flush=True)
    print(f"images={metadata['imagesDir']}", flush=True)
    print(f"output={run_dir}", flush=True)

    model, processor = load_model_and_processor(
        args.base_model,
        args.use_lora,
        args.lora_rank,
        args.lora_alpha,
        args.lora_dropout,
    )
    model.to(device)

    if args.resume and args.resume_checkpoint:
        checkpoint = Path(args.resume_checkpoint).resolve()
        if not checkpoint.exists():
            print(f"오류: resume checkpoint 가 없습니다: {checkpoint}", file=sys.stderr)
            return 2
        print(f"Resume checkpoint: {checkpoint}", flush=True)

    dataset = VlmConversationDataset(samples=samples)
    optimizer = build_optimizer(model, args.optimizer, args.learning_rate)
    use_amp = args.precision in {"bf16", "fp16"} and device.type == "cuda"
    amp_dtype = torch.bfloat16 if args.precision == "bf16" else torch.float16
    scaler = torch.cuda.amp.GradScaler(enabled=args.precision == "fp16" and device.type == "cuda")

    steps_per_epoch = max(1, math.ceil(len(dataset) / max(args.batch_size, 1)))
    global_step = 0
    model.train()

    for epoch in range(1, args.epochs + 1):
        indices = list(range(len(dataset)))
        random.shuffle(indices)
        epoch_loss = 0.0
        step_in_epoch = 0
        optimizer.zero_grad(set_to_none=True)

        for start in range(0, len(indices), args.batch_size):
            batch_indices = indices[start:start + args.batch_size]
            batch = [dataset[index] for index in batch_indices]
            encoded = collate_batch(batch, processor, args.max_sequence_length)
            encoded = {key: value.to(device) for key, value in encoded.items()}

            if use_amp and args.precision == "fp16":
                with torch.cuda.amp.autocast(dtype=amp_dtype):
                    outputs = model(**encoded)
                    loss = outputs.loss / max(args.gradient_accumulation_steps, 1)
                scaler.scale(loss).backward()
            else:
                if use_amp:
                    with torch.autocast(device_type=device.type, dtype=amp_dtype):
                        outputs = model(**encoded)
                        loss = outputs.loss / max(args.gradient_accumulation_steps, 1)
                else:
                    outputs = model(**encoded)
                    loss = outputs.loss / max(args.gradient_accumulation_steps, 1)
                loss.backward()

            step_in_epoch += 1
            global_step += 1
            loss_value = float(outputs.loss.detach().cpu())
            epoch_loss += loss_value

            if global_step % max(args.gradient_accumulation_steps, 1) == 0:
                if scaler.is_enabled():
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    optimizer.step()
                optimizer.zero_grad(set_to_none=True)

            log_progress(epoch, args.epochs, step_in_epoch, steps_per_epoch, loss_value)

        avg_loss = epoch_loss / max(step_in_epoch, 1)
        checkpoint_dir = run_dir / f"checkpoint-epoch-{epoch}"
        save_checkpoint(model, processor, checkpoint_dir, ".")
        print(f"[epoch {epoch}/{args.epochs}] avg_loss={avg_loss:.6f} saved={checkpoint_dir}", flush=True)

    final_dir = run_dir / ("final-lora" if args.use_lora else "final")
    save_checkpoint(model, processor, final_dir, ".")
    print(f"Training completed. model={final_dir}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

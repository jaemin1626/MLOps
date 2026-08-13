from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch
from ultralytics import YOLO


def normalize_device(device: str) -> str:
    text = str(device or "0").strip()
    if not text or text.lower() == "cpu":
        return "cpu"
    if not torch.cuda.is_available():
        print("[train_detector] warning: CUDA unavailable, falling back to cpu", flush=True)
        return "cpu"

    available = torch.cuda.device_count()
    if available <= 0:
        print("[train_detector] warning: no CUDA devices visible, falling back to cpu", flush=True)
        return "cpu"

    if "," not in text:
        index = int(text)
        if index >= available:
            print(
                f"[train_detector] warning: requested device={text} but only {available} GPU(s) visible; using 0",
                flush=True,
            )
            return "0"
        return text

    requested = [int(part.strip()) for part in text.split(",") if part.strip()]
    valid = [index for index in requested if 0 <= index < available]
    if not valid:
        print(
            f"[train_detector] warning: requested device={text} but only {available} GPU(s) visible; using 0",
            flush=True,
        )
        return "0"

    normalized = ",".join(str(index) for index in valid)
    if normalized != text:
        print(
            f"[train_detector] warning: requested device={text} but only {available} GPU(s) visible; using {normalized}",
            flush=True,
        )
    return normalized


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MLOps YOLO detector training wrapper")
    parser.add_argument("--name", required=True)
    parser.add_argument("--dataset", required=True, help="Dataset root directory")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--device", default="0")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--model", required=True, help="Pretrained .pt path")
    parser.add_argument("--data-config", required=True, help="Ultralytics data.yaml path")
    parser.add_argument("--img-size", type=int, default=640)
    parser.add_argument("--optimizer", default="AdamW")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--pretrained", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--resume-checkpoint")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    model_source = args.resume_checkpoint if args.resume and args.resume_checkpoint else args.model
    model = YOLO(model_source)

    print(f"[train_detector] name={args.name}")
    print(f"[train_detector] data={args.data_config}")
    print(f"[train_detector] model={model_source}")
    print(f"[train_detector] project={output_dir}")

    device = normalize_device(args.device)
    print(f"[train_detector] device={device} (requested={args.device}, visible={torch.cuda.device_count()})", flush=True)

    results = model.train(
        data=args.data_config,
        epochs=args.epochs,
        imgsz=args.img_size,
        batch=args.batch_size,
        device=device,
        project=str(output_dir),
        name=args.name,
        lr0=args.learning_rate,
        optimizer=args.optimizer,
        workers=args.workers,
        resume=args.resume,
        pretrained=args.pretrained,
        exist_ok=True,
    )

    save_dir = Path(results.save_dir) if hasattr(results, "save_dir") else output_dir / args.name
    best_pt = save_dir / "weights" / "best.pt"
    print(f"[train_detector] completed: {best_pt}")
    return 0 if best_pt.exists() or save_dir.exists() else 1


if __name__ == "__main__":
    sys.exit(main())

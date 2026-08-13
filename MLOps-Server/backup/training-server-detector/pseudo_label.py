from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ultralytics import YOLO

PSEUDO_LABEL_VERSION = "1"


def normalize_model_names(model_names) -> dict[int, str]:
    if isinstance(model_names, dict):
        return {int(key): str(value) for key, value in model_names.items()}
    if isinstance(model_names, (list, tuple)):
        return {index: str(name) for index, name in enumerate(model_names)}
    return {}


def map_class_id(
    model_class_id: int,
    model_names: dict[int, str],
    target_class_names: list[str] | None,
) -> int | None:
    if not target_class_names:
        return model_class_id
    if 0 <= model_class_id < len(target_class_names):
        return model_class_id

    model_name = model_names.get(model_class_id)
    if not model_name:
        return None

    lowered = {name.lower(): index for index, name in enumerate(target_class_names)}
    mapped = lowered.get(model_name.lower())
    if mapped is not None:
        return mapped

    for index, name in enumerate(target_class_names):
        if name == model_name:
            return index
    return None


def format_yolo_line(class_id: int, xywhn: list[float]) -> str:
    return (
        f"{class_id} "
        f"{xywhn[0]:.6f} {xywhn[1]:.6f} {xywhn[2]:.6f} {xywhn[3]:.6f}"
    )


def pseudo_label_images(
    weights_path: str | Path,
    image_paths: list[str | Path],
    *,
    conf: float = 0.25,
    iou: float = 0.45,
    overwrite: bool = False,
    target_class_names: list[str] | None = None,
    device: str | None = None,
) -> dict:
    weights = Path(weights_path).resolve()
    if not weights.is_file():
        raise FileNotFoundError(f"weights not found: {weights}")

    if not image_paths:
        raise ValueError("pseudo labeling 대상 이미지가 없습니다.")

    predict_kwargs = {
        "conf": conf,
        "iou": iou,
        "verbose": False,
    }
    if device:
        predict_kwargs["device"] = device

    model = YOLO(str(weights))
    model_names = normalize_model_names(model.names)

    processed = []
    skipped = 0
    total_boxes = 0
    unmapped_classes: set[str] = set()

    for raw_path in image_paths:
        image_path = Path(raw_path).resolve()
        if not image_path.is_file():
            processed.append({
                "imagePath": str(image_path),
                "skipped": True,
                "reason": "image not found",
                "boxCount": 0,
            })
            skipped += 1
            continue

        label_path = image_path.with_suffix(".txt")
        if not overwrite and label_path.exists() and label_path.stat().st_size > 0:
            processed.append({
                "imagePath": str(image_path),
                "labelPath": str(label_path),
                "skipped": True,
                "reason": "existing label",
                "boxCount": 0,
            })
            skipped += 1
            continue

        results = model.predict(source=str(image_path), **predict_kwargs)
        lines: list[str] = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                model_class_id = int(box.cls.item())
                mapped_class_id = map_class_id(model_class_id, model_names, target_class_names)
                if mapped_class_id is None:
                    model_name = model_names.get(model_class_id, str(model_class_id))
                    unmapped_classes.add(str(model_name))
                    continue
                xywhn = box.xywhn[0].tolist()
                lines.append(format_yolo_line(mapped_class_id, xywhn))

        label_path.write_text(
            ("\n".join(lines) + "\n") if lines else "",
            encoding="utf-8",
        )
        total_boxes += len(lines)
        processed.append({
            "imagePath": str(image_path),
            "labelPath": str(label_path),
            "skipped": False,
            "boxCount": len(lines),
        })

    return {
        "weightsPath": str(weights),
        "processedCount": len(processed) - skipped,
        "skippedCount": skipped,
        "totalBoxes": total_boxes,
        "images": processed,
        "modelNames": model_names,
        "unmappedClasses": sorted(unmapped_classes),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Intellivix pseudo labeling")
    parser.add_argument("--weights", required=True)
    parser.add_argument("--image", action="append", dest="images", default=[])
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--iou", type=float, default=0.45)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.images:
        print("[pseudo_label] error: --image 가 필요합니다.", file=sys.stderr)
        return 1
    try:
        result = pseudo_label_images(
            args.weights,
            args.images,
            conf=args.conf,
            iou=args.iou,
            overwrite=args.overwrite,
        )
    except Exception as error:
        print(f"[pseudo_label] error: {error}", file=sys.stderr)
        return 1
    print(
        "[pseudo_label] completed "
        f"processed={result['processedCount']} skipped={result['skippedCount']} "
        f"boxes={result['totalBoxes']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

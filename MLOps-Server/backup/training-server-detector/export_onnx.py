from __future__ import annotations

import argparse
import os
import struct
import sys
from pathlib import Path

import numpy as np
import onnx
import onnx.helper

# ----------------------------------------------------------------------
# onnx_graphsurgeon 호환 패치
# ----------------------------------------------------------------------
if not hasattr(onnx.helper, "float32_to_bfloat16"):
    def float32_to_bfloat16(fval):
        ival = struct.unpack("=I", struct.pack("=f", fval))[0]
        return ival >> 16

    onnx.helper.float32_to_bfloat16 = float32_to_bfloat16

import onnx_graphsurgeon as gs
from ultralytics import YOLO

EXPORT_ONNX_VERSION = "4"


def parse_img_size(value: str) -> tuple[int, int] | int:
    text = str(value).strip()
    if "," in text:
        parts = [int(part.strip()) for part in text.split(",") if part.strip()]
        if len(parts) != 2 or any(part <= 0 for part in parts):
            raise ValueError(f"invalid img-size: {value}")
        return parts[0], parts[1]
    size = int(text)
    if size <= 0:
        raise ValueError(f"invalid img-size: {value}")
    return size


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MLOps YOLO26 E-NMS ONNX export")
    parser.add_argument("--weights", required=True, help="Source .pt weights path")
    parser.add_argument("--output", required=True, help="Target .onnx output path")
    parser.add_argument("--img-size", default="512,896", help="Image size as N or H,W")
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--max-det", type=int, default=300)
    parser.add_argument("--conf-thres", type=float, default=0.25)
    parser.add_argument("--iou-thres", type=float, default=0.50)
    parser.add_argument("--end2end", action="store_true", help="EfficientNMS_TRT E-NMS export")
    parser.add_argument("--dynamic-batch", action="store_true", help="Accepted for CLI compatibility")
    parser.add_argument("--simplify", action="store_true", help="Accepted for CLI compatibility")
    return parser.parse_args()


def patch_detect_postprocess_to_identity(model):
    """
    detect head의 postprocess를 임시로 identity로 교체하여
    export 시 [B, N, 4+nc] 형태 raw tensor를 받기 위한 패치.
    """
    detect_head = model.model.model[-1]
    head_cls = detect_head.__class__

    if not hasattr(head_cls, "postprocess"):
        raise RuntimeError(
            f"detect head class({head_cls.__name__})에 postprocess가 없습니다. "
            "이 경우 현재 ultralytics 버전에 맞춰 추가 수정이 필요합니다."
        )

    original_postprocess = head_cls.postprocess

    def identity_postprocess(preds, *args, **kwargs):
        return preds

    head_cls.postprocess = staticmethod(identity_postprocess)
    return head_cls, original_postprocess


def restore_detect_postprocess(head_cls, original_postprocess):
    head_cls.postprocess = original_postprocess


def export_pre_nms_raw_onnx(pt_path, raw_onnx_path, imgsz=(512, 896), batch=1, opset=17):
    """
    PT -> pre-NMS raw ONNX export
    목표 출력: [B, N, 4+nc]
    """
    pt_path = str(Path(pt_path).resolve())
    raw_onnx_path = str(Path(raw_onnx_path).resolve())

    if not os.path.isfile(pt_path):
        raise FileNotFoundError(f"PT 파일을 찾을 수 없습니다: {pt_path}")

    print("=" * 100)
    print("[1] YOLO 모델 로드")
    print(f"PT_PATH      : {pt_path}")
    print(f"RAW_ONNX_PATH: {raw_onnx_path}")
    print("=" * 100)

    y = YOLO(pt_path)

    nc = len(y.names)
    print(f"[INFO] class 수(nc): {nc}")
    print(f"[INFO] class names : {y.names}")

    head_cls, original_postprocess = patch_detect_postprocess_to_identity(y)

    try:
        print("[2] pre-NMS raw ONNX export 시작")
        exported = y.export(
            format="onnx",
            imgsz=list(imgsz),
            batch=batch,
            opset=opset,
            simplify=False,
            dynamic=False,
            half=False,
            nms=False,
        )
        exported = str(exported)
        print(f"[완료] Ultralytics export 결과: {exported}")

        if os.path.abspath(exported) != os.path.abspath(raw_onnx_path):
            if os.path.exists(raw_onnx_path):
                os.remove(raw_onnx_path)
            os.replace(exported, raw_onnx_path)

        print(f"[완료] raw ONNX 저장: {raw_onnx_path}")

    finally:
        restore_detect_postprocess(head_cls, original_postprocess)

    return raw_onnx_path, nc


def build_enms_onnx_from_raw(
    raw_onnx_path,
    final_onnx_path,
    nc,
    imgsz=(512, 896),
    max_det=300,
    conf_thres=0.25,
    iou_thres=0.50,
):
    """
    raw ONNX([B,N,4+nc] 또는 [B,4+nc,N]) -> EfficientNMS_TRT 삽입
    최종 출력:
      images      : float32 [batch, 3, 512, 896]
      num_dets    : int32   [batch, 1]
      det_boxes   : float32 [batch, 300, 4]
      det_scores  : float32 [batch, 300]
      det_classes : int32   [batch, 300]
    """
    raw_onnx_path = str(Path(raw_onnx_path).resolve())
    final_onnx_path = str(Path(final_onnx_path).resolve())

    if not os.path.isfile(raw_onnx_path):
        raise FileNotFoundError(f"raw ONNX 파일이 없습니다: {raw_onnx_path}")

    print("=" * 100)
    print("[3] raw ONNX 로드 및 GraphSurgeon 처리")
    print(f"raw ONNX : {raw_onnx_path}")
    print("=" * 100)

    model = onnx.load(raw_onnx_path)
    graph = gs.import_onnx(model)

    if len(graph.inputs) != 1:
        raise RuntimeError(f"입력이 1개가 아닙니다. 현재 inputs={len(graph.inputs)}")

    if len(graph.outputs) != 1:
        raise RuntimeError(
            f"출력이 1개가 아닙니다. 현재 outputs={len(graph.outputs)} "
            f"names={[o.name for o in graph.outputs]}"
        )

    graph.inputs[0].name = "images"
    graph.inputs[0].dtype = np.float32
    graph.inputs[0].shape = ["batch", 3, imgsz[0], imgsz[1]]

    raw = graph.outputs[0]
    raw.name = "raw_output"

    raw_shape = raw.shape
    print(f"[INFO] raw output name  : {raw.name}")
    print(f"[INFO] raw output shape : {raw_shape}")

    if len(raw_shape) != 3:
        raise RuntimeError(f"예상과 다른 raw output shape입니다: {raw_shape}")

    d1, d2 = raw_shape[1], raw_shape[2]
    expected_c = 4 + nc
    need_transpose = False

    if isinstance(d2, int) and d2 == expected_c:
        need_transpose = False
    elif isinstance(d1, int) and d1 == expected_c:
        need_transpose = True
    else:
        if d1 == expected_c:
            need_transpose = True
        elif d2 == expected_c:
            need_transpose = False
        else:
            raise RuntimeError(
                f"raw output shape가 4+nc={expected_c} 구조로 보이지 않습니다.\n"
                f"현재 shape={raw_shape}\n"
                f"즉, export 단계에서 아직도 postprocess 결과(예: 300x6)가 나왔을 가능성이 큽니다."
            )

    work = raw

    if need_transpose:
        print("[INFO] raw output transpose 적용: [B,4+nc,N] -> [B,N,4+nc]")
        transposed = gs.Variable(
            name="raw_output_bnc",
            dtype=np.float32,
            shape=["batch", None, expected_c],
        )
        graph.nodes.append(
            gs.Node(
                op="Transpose",
                name="Transpose_raw_output",
                inputs=[work],
                outputs=[transposed],
                attrs={"perm": [0, 2, 1]},
            )
        )
        work = transposed
    else:
        print("[INFO] raw output transpose 생략: 이미 [B,N,4+nc]")

    boxes = gs.Variable(
        name="boxes_for_nms",
        dtype=np.float32,
        shape=["batch", None, 4],
    )
    scores = gs.Variable(
        name="scores_for_nms",
        dtype=np.float32,
        shape=["batch", None, nc],
    )

    starts_boxes = gs.Constant("starts_boxes", np.array([0], dtype=np.int64))
    ends_boxes = gs.Constant("ends_boxes", np.array([4], dtype=np.int64))
    axes_last = gs.Constant("axes_last", np.array([2], dtype=np.int64))
    steps_one = gs.Constant("steps_one", np.array([1], dtype=np.int64))

    starts_scores = gs.Constant("starts_scores", np.array([4], dtype=np.int64))
    ends_scores = gs.Constant("ends_scores", np.array([4 + nc], dtype=np.int64))

    graph.nodes.append(
        gs.Node(
            op="Slice",
            name="Slice_boxes",
            inputs=[work, starts_boxes, ends_boxes, axes_last, steps_one],
            outputs=[boxes],
        )
    )
    graph.nodes.append(
        gs.Node(
            op="Slice",
            name="Slice_scores",
            inputs=[work, starts_scores, ends_scores, axes_last, steps_one],
            outputs=[scores],
        )
    )

    num_dets = gs.Variable(
        name="num_dets",
        dtype=np.int32,
        shape=["batch", 1],
    )
    det_boxes = gs.Variable(
        name="det_boxes",
        dtype=np.float32,
        shape=["batch", max_det, 4],
    )
    det_scores = gs.Variable(
        name="det_scores",
        dtype=np.float32,
        shape=["batch", max_det],
    )
    det_classes = gs.Variable(
        name="det_classes",
        dtype=np.int32,
        shape=["batch", max_det],
    )

    nms_node = gs.Node(
        op="EfficientNMS_TRT",
        name="EfficientNMS_TRT",
        inputs=[boxes, scores],
        outputs=[num_dets, det_boxes, det_scores, det_classes],
        attrs={
            "plugin_version": "1",
            "background_class": -1,
            "max_output_boxes": max_det,
            "score_threshold": float(conf_thres),
            "iou_threshold": float(iou_thres),
            "score_activation": False,
            "box_coding": 0,
            "class_agnostic": False,
        },
    )
    graph.nodes.append(nms_node)

    graph.outputs = [num_dets, det_boxes, det_scores, det_classes]
    graph.cleanup().toposort()

    final_model = gs.export_onnx(graph)
    onnx.save(final_model, final_onnx_path)

    print("=" * 100)
    print("[4] 최종 e_nms ONNX 저장 완료")
    print(f"FINAL_ONNX_PATH : {final_onnx_path}")
    print("최종 출력:")
    print(" - num_dets    : int32   [batch, 1]")
    print(f" - det_boxes   : float32 [batch, {max_det}, 4]")
    print(f" - det_scores  : float32 [batch, {max_det}]")
    print(f" - det_classes : int32   [batch, {max_det}]")
    print("=" * 100)

    return final_onnx_path


def inspect_onnx_io(onnx_path):
    from onnx import TensorProto

    def dtype_name(t):
        return TensorProto.DataType.Name(t)

    model = onnx.load(onnx_path)
    print("=" * 100)
    print(f"[검사] {onnx_path}")
    print("Inputs:")
    for x in model.graph.input:
        tt = x.type.tensor_type
        shape = []
        for d in tt.shape.dim:
            shape.append(d.dim_param if d.dim_param else d.dim_value)
        print(f"  - {x.name}: {dtype_name(tt.elem_type)} {shape}")

    print("Outputs:")
    for x in model.graph.output:
        tt = x.type.tensor_type
        shape = []
        for d in tt.shape.dim:
            shape.append(d.dim_param if d.dim_param else d.dim_value)
        print(f"  - {x.name}: {dtype_name(tt.elem_type)} {shape}")
    print("=" * 100)


def normalize_imgsz(value: str | tuple[int, int] | int | list[int]) -> tuple[int, int]:
    if isinstance(value, tuple):
        return value
    if isinstance(value, list):
        if len(value) == 2:
            return int(value[0]), int(value[1])
        if len(value) == 1:
            size = int(value[0])
            return size, size
    if isinstance(value, int):
        return value, value
    parsed = parse_img_size(str(value))
    if isinstance(parsed, int):
        return parsed, parsed
    return parsed


def export_enms_onnx(
    pt_path: str,
    output_path: str,
    imgsz: tuple[int, int],
    batch: int,
    opset: int,
    max_det: int,
    conf_thres: float,
    iou_thres: float,
) -> str:
    output = Path(output_path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    raw_onnx_path = output.parent / f".{output.stem}_pre_nms_raw.onnx"

    raw_onnx, nc = export_pre_nms_raw_onnx(
        pt_path=pt_path,
        raw_onnx_path=str(raw_onnx_path),
        imgsz=imgsz,
        batch=batch,
        opset=opset,
    )
    inspect_onnx_io(raw_onnx)

    final_onnx = build_enms_onnx_from_raw(
        raw_onnx_path=raw_onnx,
        final_onnx_path=str(output),
        nc=nc,
        imgsz=imgsz,
        max_det=max_det,
        conf_thres=conf_thres,
        iou_thres=iou_thres,
    )
    inspect_onnx_io(final_onnx)

    if raw_onnx_path.exists():
        raw_onnx_path.unlink()

    return final_onnx


def main() -> int:
    args = parse_args()
    weights_path = Path(args.weights).resolve()
    output_path = Path(args.output).resolve()

    if not weights_path.is_file():
        print(f"[export_onnx] error: weights not found: {weights_path}", file=sys.stderr)
        return 1

    try:
        imgsz = normalize_imgsz(args.img_size)
    except ValueError as error:
        print(f"[export_onnx] error: {error}", file=sys.stderr)
        return 1

    print(
        "[export_onnx] "
        f"weights={weights_path} output={output_path} "
        f"imgsz={imgsz} batch={args.batch_size} opset={args.opset} "
        f"max_det={args.max_det} conf={args.conf_thres} iou={args.iou_thres} "
        f"end2end={args.end2end} dynamic_batch={args.dynamic_batch} simplify={args.simplify}"
    )

    try:
        if not args.end2end:
            print("[export_onnx] warning: --end2end 없음, E-NMS 파이프라인을 사용합니다.", file=sys.stderr)
        export_enms_onnx(
            pt_path=str(weights_path),
            output_path=str(output_path),
            imgsz=imgsz,
            batch=args.batch_size,
            opset=args.opset,
            max_det=args.max_det,
            conf_thres=args.conf_thres,
            iou_thres=args.iou_thres,
        )
    except Exception as error:
        print(f"[export_onnx] error: {error}", file=sys.stderr)
        return 1

    if not output_path.is_file():
        print(f"[export_onnx] error: export failed, output missing: {output_path}", file=sys.stderr)
        return 1

    print(f"[export_onnx] completed: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

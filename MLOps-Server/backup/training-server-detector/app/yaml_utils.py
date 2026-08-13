from __future__ import annotations

from pathlib import Path


def ensure_parent_dir(file_path: Path) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)


def write_dataset_yaml(yaml_content: str, target_path: Path) -> Path:
    ensure_parent_dir(target_path)
    target_path.write_text(yaml_content if yaml_content.endswith("\n") else f"{yaml_content}\n", encoding="utf-8")
    return target_path


def extract_arg_value(args: list[str], flag: str) -> str | None:
    if flag not in args:
        return None
    index = args.index(flag)
    if index + 1 >= len(args):
        return None
    return args[index + 1]

from __future__ import annotations

from .config import WORKSPACE_ROOT
from vlm_model_utils import list_local_base_models, resolve_base_model


def list_base_models() -> dict:
    return list_local_base_models(WORKSPACE_ROOT)


def resolve_training_base_model(base_model: str) -> str:
    return resolve_base_model(base_model, WORKSPACE_ROOT)

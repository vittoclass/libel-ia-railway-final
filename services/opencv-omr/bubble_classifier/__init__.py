"""
Clasificador por burbuja: CNN o modelo liviano para empty / filled / smudge.
Por ahora stub; preparado para sustituir por modelo entrenado.
"""
from __future__ import annotations

from typing import Literal

import numpy as np

BubbleClass = Literal["empty", "filled", "smudge"]


def classify_bubble(crop_gray: np.ndarray) -> BubbleClass:
    """
    Clasifica un recorte de burbuja en empty, filled o smudge.
    Stub: usa heurística simple (media e intensidad). Sustituir por CNN/modelo
    cuando exista modelo entrenado en dataset exportado por export_bubble_crops.
    """
    if crop_gray is None or crop_gray.size == 0:
        return "empty"
    mean = float(np.mean(crop_gray))
    dark_ratio = float(np.sum(crop_gray < 127)) / crop_gray.size
    if dark_ratio >= 0.25 and mean <= 120:
        return "filled"
    if dark_ratio <= 0.12 and mean >= 180:
        return "empty"
    return "smudge"

"""
Anclajes para recalibración geométrica de burbujas.
Si la plantilla tiene marcas guía o puntos estructurales, se detectan aquí
y se usan para ajustar offsets finos de la grilla. Si no hay anclajes, se usa grilla fija.
"""
from __future__ import annotations

from typing import Optional

import cv2
import numpy as np

from sheet_spec import LIBELIA_STANDARD, TemplateConfig, get_bubble_rects_px, get_warp_size_px


def detect_anchors(
    warped_gray: np.ndarray,
    config: Optional[TemplateConfig] = None,
) -> Optional[list[tuple[float, float]]]:
    """
    Detecta puntos ancla en la hoja warpeada (esquinas de área de contenido, marcadores, etc.).
    Si no hay plantilla con marcas detectables, devuelve None y el pipeline usa grilla fija.
    """
    # Stub: por ahora no detectamos anclajes; la grilla es fija.
    # Aquí se podría: detectar esquinas Harris/GoodFeatures, o buscar patrones
    # conocidos de la plantilla LibelIA (marcadores en las 4 esquinas).
    return None


def get_bubble_rects_px_adjusted(
    num_questions: int,
    num_options: int,
    warped_gray: np.ndarray,
    config: Optional[TemplateConfig] = None,
) -> list[tuple[int, int, int, int, int, int]]:
    """
    Devuelve rectángulos de burbujas en px. Si hay anclajes detectados, aplica
    ajuste fino (scale/offset); si no, devuelve la grilla fija.
    """
    rects = get_bubble_rects_px(num_questions, num_options, config)
    anchors = detect_anchors(warped_gray, config)
    if not anchors or len(anchors) < 4:
        return rects
    # TODO: calcular transformación desde anclajes y aplicar a rects
    return rects

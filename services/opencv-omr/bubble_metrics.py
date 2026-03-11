"""
Métricas por burbuja con máscaras centro/anillo para OMR robusto.
Centro erosionado evita borde impreso; anillo como referencia local para iluminación.
"""
from __future__ import annotations

from typing import Optional

import cv2
import numpy as np

from sheet_spec import LIBELIA_STANDARD, TemplateConfig

# Estados posibles de una burbuja
BUBBLE_EMPTY = "EMPTY"
BUBBLE_FILLED = "FILLED"
BUBBLE_SMUDGE = "SMUDGE"

# Umbrales para clasificación (calibrables)
FILL_RATIO_FILLED = 0.25
FILL_RATIO_EMPTY = 0.12
MEAN_BRIGHT_EMPTY = 180
MEAN_DARK_FILLED = 120
CONTRAST_MIN_FILLED = 0.12
FILL_RATIO_SMUDGE_HIGH = 0.22
FILL_RATIO_SMUDGE_LOW = 0.12


def _make_circle_mask(h: int, w: int, cx: float, cy: float, r: float) -> np.ndarray:
    """Máscara binaria circular (1 dentro, 0 fuera)."""
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.circle(mask, (int(cx), int(cy)), max(1, int(r)), 1, -1)
    return mask


def make_center_ring_masks(
    roi_h: int,
    roi_w: int,
    center_radius_ratio: float = 0.40,
    ring_inner_ratio: float = 0.45,
    ring_outer_ratio: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Máscaras para una burbuja de tamaño (roi_h, roi_w).
    - center: círculo erosionado (no incluye borde impreso).
    - ring: anillo entre ring_inner y ring_outer como referencia local.
    Devuelve (center_mask, ring_mask) uint8 0/1.
    """
    cx, cy = roi_w / 2.0, roi_h / 2.0
    r_full = min(roi_h, roi_w) / 2.0
    r_center = r_full * center_radius_ratio
    r_inner = r_full * ring_inner_ratio
    r_outer = r_full * ring_outer_ratio

    center_mask = _make_circle_mask(roi_h, roi_w, cx, cy, r_center)
    ring_outer_mask = _make_circle_mask(roi_h, roi_w, cx, cy, r_outer)
    ring_inner_mask = _make_circle_mask(roi_h, roi_w, cx, cy, r_inner)
    ring_mask = np.clip(ring_outer_mask.astype(np.int32) - ring_inner_mask.astype(np.int32), 0, 1).astype(np.uint8)

    return center_mask, ring_mask


def compute_bubble_metrics(
    gray: np.ndarray,
    x1: int, y1: int, x2: int, y2: int,
    config: Optional[TemplateConfig] = None,
) -> dict:
    """
    Métricas locales centro vs anillo para una burbuja en (x1,y1,x2,y2).
    Usa máscaras circulares; el borde impreso queda fuera del centro.
    """
    c = config or LIBELIA_STANDARD
    h_img, w_img = gray.shape
    x1 = max(0, min(x1, w_img - 1))
    x2 = max(x1 + 1, min(x2, w_img))
    y1 = max(0, min(y1, h_img - 1))
    y2 = max(y1 + 1, min(y2, h_img))
    roi = gray[y1:y2, x1:x2]
    roi_h, roi_w = roi.shape
    if roi.size == 0:
        return _empty_metrics()

    center_mask, ring_mask = make_center_ring_masks(roi_h, roi_w)
    n_center = int(np.sum(center_mask))
    n_ring = int(np.sum(ring_mask))
    if n_center == 0:
        n_center = 1
    if n_ring == 0:
        n_ring = 1

    dark_th = c.DARK_PIXEL_THRESHOLD
    dark_center = np.sum((roi < dark_th) & (center_mask > 0))
    dark_ring = np.sum((roi < dark_th) & (ring_mask > 0))
    dark_pixels_center = int(dark_center)
    dark_pixels_ring = int(dark_ring)

    fill_ratio_center = float(dark_center) / n_center
    fill_ratio_ring = float(dark_ring) / n_ring

    mean_intensity_center = float(np.sum(roi.astype(np.float64) * center_mask)) / n_center
    mean_intensity_ring = float(np.sum(roi.astype(np.float64) * ring_mask)) / n_ring

    contrast_center_vs_ring = (mean_intensity_ring - mean_intensity_center) / 255.0
    contrast_center_vs_ring = max(-1.0, min(1.0, contrast_center_vs_ring))

    normalized_darkness_center = 1.0 - (mean_intensity_center / 255.0)
    normalized_darkness_center = max(0.0, min(1.0, normalized_darkness_center))

    # Bins simples del centro: [0-63, 64-127, 128-191, 192-255]
    center_pixels = roi[center_mask > 0]
    bins = [0, 64, 128, 192, 256]
    hist, _ = np.histogram(center_pixels, bins=bins)
    hist_center = [int(x) for x in hist]

    # Score combinado: fill_center + contraste + oscuridad normalizada (ponderado)
    w1, w2, w3 = 0.45, 0.25, 0.30
    combined_score = (
        w1 * fill_ratio_center
        + w2 * max(0.0, contrast_center_vs_ring)
        + w3 * normalized_darkness_center
    )
    combined_score = round(min(1.0, max(0.0, combined_score)), 4)

    return {
        "dark_pixels_center": dark_pixels_center,
        "dark_pixels_ring": dark_pixels_ring,
        "fill_ratio_center": round(fill_ratio_center, 4),
        "fill_ratio_ring": round(fill_ratio_ring, 4),
        "mean_intensity_center": round(mean_intensity_center, 2),
        "mean_intensity_ring": round(mean_intensity_ring, 2),
        "contrast_center_vs_ring": round(contrast_center_vs_ring, 4),
        "normalized_darkness_center": round(normalized_darkness_center, 4),
        "hist_center_bins": hist_center,
        "combined_score": combined_score,
    }


def _empty_metrics() -> dict:
    return {
        "dark_pixels_center": 0,
        "dark_pixels_ring": 0,
        "fill_ratio_center": 0.0,
        "fill_ratio_ring": 0.0,
        "mean_intensity_center": 255.0,
        "mean_intensity_ring": 255.0,
        "contrast_center_vs_ring": 0.0,
        "normalized_darkness_center": 0.0,
        "hist_center_bins": [0, 0, 0, 0],
        "combined_score": 0.0,
    }


def classify_bubble_state(metrics: dict, config: Optional[TemplateConfig] = None) -> str:
    """
    Clasifica una burbuja en EMPTY, FILLED o SMUDGE usando centro, contraste y consistencia.
    """
    fill_c = metrics.get("fill_ratio_center", 0)
    mean_c = metrics.get("mean_intensity_center", 255)
    contrast = metrics.get("contrast_center_vs_ring", 0)

    if fill_c >= FILL_RATIO_FILLED and mean_c <= MEAN_DARK_FILLED and contrast >= CONTRAST_MIN_FILLED:
        return BUBBLE_FILLED
    if fill_c <= FILL_RATIO_EMPTY and mean_c >= MEAN_BRIGHT_EMPTY:
        return BUBBLE_EMPTY
    if FILL_RATIO_SMUDGE_LOW <= fill_c <= FILL_RATIO_SMUDGE_HIGH or (contrast < CONTRAST_MIN_FILLED and fill_c > FILL_RATIO_EMPTY):
        return BUBBLE_SMUDGE
    if fill_c > FILL_RATIO_EMPTY and fill_c < FILL_RATIO_FILLED:
        return BUBBLE_SMUDGE
    if mean_c < MEAN_BRIGHT_EMPTY and fill_c < FILL_RATIO_FILLED:
        return BUBBLE_SMUDGE
    return BUBBLE_EMPTY

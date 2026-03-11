"""
Motor OMR calibrado para plantilla estándar LibelIA.
Pipeline: base64 → grayscale → threshold → contorno hoja → warp → grilla exacta → lectura por ROI.
Toda la geometría y umbrales vienen de sheet_spec.TemplateConfig.
"""
from __future__ import annotations

import base64
import os
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from sheet_spec import (
    LIBELIA_STANDARD,
    TemplateConfig,
    get_bubble_inner_rects_px,
    get_bubble_rects_px,
    get_grid_lines_px,
    get_warp_size_px,
)
from bubble_metrics import (
    BUBBLE_EMPTY,
    BUBBLE_FILLED,
    BUBBLE_SMUDGE,
    classify_bubble_state,
    compute_bubble_metrics,
    make_center_ring_masks,
)
from anchors import detect_anchors, get_bubble_rects_px_adjusted

DEBUG = os.environ.get("OMR_DEBUG", "").lower() in ("true", "1")
DEBUG_DIR = Path("omr_debug")


def _log(msg: str, **kwargs: object) -> None:
    """Un solo argumento posicional es el mensaje; el resto por nombre (nunca usar nombre 'msg')."""
    if kwargs:
        print(f"[OPENCV_OMR] {msg}", kwargs)
    else:
        print(f"[OPENCV_OMR] {msg}")


def _ensure_debug_dir() -> Path:
    if not DEBUG:
        return DEBUG_DIR
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    return DEBUG_DIR


def _save_debug(img: np.ndarray, name: str) -> None:
    if not DEBUG or img is None:
        return
    d = _ensure_debug_dir()
    path = d / name
    cv2.imwrite(str(path), img)
    _log("debug saved", path=str(path))


def decode_image(image_base64: str) -> np.ndarray:
    raw = base64.b64decode(image_base64)
    buf = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("No se pudo decodificar la imagen desde base64.")
    return img


def preprocess(gray: np.ndarray) -> np.ndarray:
    denoised = cv2.fastNlMeansDenoising(gray, None, h=10, templateWindowSize=7, searchWindowSize=21)
    blur = cv2.GaussianBlur(denoised, (5, 5), 0)
    _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thresh


def find_page_contour(thresh: np.ndarray) -> np.ndarray | None:
    """
    Encuentra el contorno de la hoja: cuadrilátero más grande, o fallback a bounding rect del mayor.
    Logs: page contour candidates, selected contour area, page contour no encontrado.
    """
    h, w = thresh.shape
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        _log("page contour no encontrado", reason="no_contours")
        return None

    n_contours = len(contours)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    total_pixels = w * h
    min_area = total_pixels * 0.05  # relajado desde 0.1 para fotos con más fondo
    largest_area = cv2.contourArea(contours[0]) if contours else 0
    _log("page contour candidates", image_width=w, image_height=h, num_contours=n_contours, largest_area=round(largest_area, 0), min_area_required=round(min_area, 0))

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area:
            continue
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) == 4:
            _log("selected contour area", area=round(area, 0))
            return approx.reshape(4, 2)
        approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)
        if len(approx) == 4:
            _log("selected contour area", area=round(area, 0), relaxed_approx=True)
            return approx.reshape(4, 2)

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area:
            continue
        x, y, rw, rh = cv2.boundingRect(cnt)
        pts = np.array([
            [x, y],
            [x + rw, y],
            [x + rw, y + rh],
            [x, y + rh],
        ], dtype=np.float32)
        _log("selected contour area", area=round(area, 0), fallback="boundingRect")
        return pts

    _log("page contour no encontrado", reason="no_large_quad_or_contour")
    return None


def order_points(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def warp_perspective(img: np.ndarray, pts: np.ndarray, config: Optional[TemplateConfig] = None) -> np.ndarray:
    rect = order_points(pts)
    w, h = get_warp_size_px(config)
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(img, M, (w, h))


def _clip_roi(h: int, w: int, x1: int, y1: int, x2: int, y2: int) -> tuple[int, int, int, int]:
    x1 = max(0, min(x1, w - 1))
    x2 = max(0, min(x2, w))
    y1 = max(0, min(y1, h - 1))
    y2 = max(0, min(y2, h))
    if x2 <= x1 or y2 <= y1:
        return 0, 0, 0, 0
    return x1, y1, x2, y2


def read_bubble_roi(
    gray: np.ndarray,
    x1: int, y1: int, x2: int, y2: int,
    inner_x1: int, inner_y1: int, inner_x2: int, inner_y2: int,
    config: TemplateConfig,
) -> tuple[float, float, float]:
    """
    Lee una burbuja por ROI exacta. Usa inner ROI para la métrica principal.
    Returns (fill_ratio, dark_pixel_ratio, normalized_darkness).
    - fill_ratio: fracción de píxeles < DARK_PIXEL_THRESHOLD en inner ROI.
    - dark_pixel_ratio: igual en ROI completo (por si acaso).
    - normalized_darkness: 1 - (mean_intensity/255) en inner ROI, en [0,1].
    """
    h, w = gray.shape
    ix1, iy1, ix2, iy2 = _clip_roi(h, w, inner_x1, inner_y1, inner_x2, inner_y2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0, 0.0, 0.0
    roi = gray[iy1:iy2, ix1:ix2]
    total = roi.size
    if total == 0:
        return 0.0, 0.0, 0.0
    dark = np.sum(roi < config.DARK_PIXEL_THRESHOLD)
    fill_ratio = float(dark) / total
    mean_val = float(np.mean(roi))
    normalized_darkness = 1.0 - (mean_val / 255.0)

    ox1, oy1, ox2, oy2 = _clip_roi(h, w, x1, y1, x2, y2)
    dark_full = 0.0
    total_full = 1
    if ox2 > ox1 and oy2 > oy1:
        roi_full = gray[oy1:oy2, ox1:ox2]
        total_full = roi_full.size
        if total_full:
            dark_full = float(np.sum(roi_full < config.DARK_PIXEL_THRESHOLD)) / total_full
    return fill_ratio, dark_full, normalized_darkness


def _combined_score(fill_ratio: float, dark_full: float, normalized_darkness: float) -> float:
    """Combinación de métricas: peso a fill_ratio y normalized_darkness."""
    w1, w2, w3 = 0.5, 0.2, 0.3
    return w1 * fill_ratio + w2 * dark_full + w3 * normalized_darkness


def run_omr(
    image_base64: str,
    num_questions: int,
    option_labels: list[str],
    template_id: str,
    config: Optional[TemplateConfig] = None,
) -> tuple[list[dict], list[int], list[int], float]:
    """
    Returns (results, omissions, double_marks, processing_time_ms).
    Toda la geometría y umbrales vienen de config (LIBELIA_STANDARD por defecto).
    """
    c = config or LIBELIA_STANDARD
    t0 = time.perf_counter()
    _log("request recibida", num_questions=num_questions, template_id=template_id)

    raw = decode_image(image_base64)
    _log("image decoded", shape=raw.shape)
    if DEBUG:
        _save_debug(raw, "01_original.png")

    gray = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)
    _save_debug(gray, "02_grayscale.png")

    thresh = preprocess(gray)
    _log("threshold aplicado")
    _save_debug(thresh, "03_threshold.png")

    page_pts = find_page_contour(thresh)
    if page_pts is None:
        _log("page contour no encontrado")
        raise ValueError("OpenCV: no se pudo detectar el contorno principal de la hoja.")

    _log("page contour encontrado")
    if DEBUG:
        contour_vis = cv2.cvtColor(thresh, cv2.COLOR_GRAY2BGR)
        cv2.drawContours(contour_vis, [page_pts.astype(np.int32)], -1, (0, 255, 0), 2)
        _save_debug(contour_vis, "04_page_contour.png")

    warped_bgr = warp_perspective(raw, page_pts, c)
    warped_gray = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2GRAY)
    _log("perspective corregida")
    _save_debug(warped_gray, "05_warped.png")

    num_options = len(option_labels) if option_labels else len(c.DEFAULT_OPTION_LABELS)
    if not option_labels:
        option_labels = list(c.DEFAULT_OPTION_LABELS)
    labels = option_labels[:num_options]
    if len(labels) < num_options:
        labels = list(labels) + list(c.DEFAULT_OPTION_LABELS[len(labels):num_options])

    rects = get_bubble_rects_px_adjusted(num_questions, num_options, warped_gray, c)
    inner_rects = get_bubble_inner_rects_px(num_questions, num_options, c)
    if len(inner_rects) != len(rects):
        rects = get_bubble_rects_px(num_questions, num_options, c)
    anchors = detect_anchors(warped_gray, c)

    # —— Overlay grilla completa ——
    if DEBUG:
        overlay_grid = warped_bgr.copy()
        for (pt1, pt2) in get_grid_lines_px(num_questions, num_options, c):
            cv2.line(overlay_grid, pt1, pt2, (200, 200, 200), 1)
        _save_debug(overlay_grid, "06_overlay_grid.png")

    # —— Overlay burbujas con etiqueta Qn-X ——
    if DEBUG:
        overlay_bubbles = warped_bgr.copy()
        for (q, o, x1, y1, x2, y2) in rects:
            cv2.rectangle(overlay_bubbles, (x1, y1), (x2, y2), (0, 255, 0), 1)
            label = f"Q{q}-{labels[o]}"
            cv2.putText(overlay_bubbles, label, (x1, y1 - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 0), 1)
        _save_debug(overlay_bubbles, "07_overlay_bubbles.png")

    threshold = c.INNER_FILL_RATIO_THRESHOLD
    double_delta = c.DOUBLE_MARK_DELTA
    results: list[dict] = []
    omissions: list[int] = []
    double_marks: list[int] = []
    scores_per_question: list[dict] = []
    bubble_metrics_list: list[dict] = []
    flat_scores_detected = False

    for q in range(1, num_questions + 1):
        q_rects = [r for r in rects if r[0] == q]
        states: dict[str, str] = {}
        metrics_by_label: dict[str, dict] = {}
        for (_, o, x1, y1, x2, y2) in q_rects:
            lab = labels[o] if o < len(labels) else str(o)
            metrics = compute_bubble_metrics(warped_gray, x1, y1, x2, y2, c)
            state = classify_bubble_state(metrics, c)
            states[lab] = state
            metrics["state"] = state
            metrics_by_label[lab] = metrics
            bubble_metrics_list.append({"q": q, "o": o, "label": lab, "metrics": metrics, "rect": (x1, y1, x2, y2)})
            _log(
                f"Q{q}-{lab} metrics",
                dark_center=metrics["dark_pixels_center"],
                dark_ring=metrics["dark_pixels_ring"],
                fill_center=metrics["fill_ratio_center"],
                fill_ring=metrics["fill_ratio_ring"],
                mean_intensity_center=metrics["mean_intensity_center"],
                mean_intensity_ring=metrics["mean_intensity_ring"],
                contrast=metrics["contrast_center_vs_ring"],
                normalized_darkness=metrics["normalized_darkness_center"],
                combined_score=metrics.get("combined_score"),
                state=state,
            )

        filled = [lab for lab, s in states.items() if s == BUBBLE_FILLED]
        smudges = [lab for lab, s in states.items() if s == BUBBLE_SMUDGE]

        # Detección de flat scores (posible desalineación de grilla)
        fill_ratios = [metrics_by_label[lab]["fill_ratio_center"] for lab in labels[:num_options]]
        spread = max(fill_ratios) - min(fill_ratios) if fill_ratios else 0
        flat_scores_question = len(filled) == 0 and spread < 0.12 and spread >= 0

        if len(filled) == 0:
            chosen = "SIN_RESPUESTA"
            reason = "flat_scores_possible_misalignment" if flat_scores_question else "all_empty"
            if flat_scores_question:
                _log("possible grid misalignment detected")
                flat_scores_detected = True
            results.append({"pregunta": q, "respuesta": "SIN_RESPUESTA", "confianza": 0.5})
            omissions.append(q)
        elif len(filled) >= 2:
            chosen = filled[0]
            reason = "double_mark"
            results.append({"pregunta": q, "respuesta": chosen, "confianza": 0.5})
            double_marks.append(q)
        elif len(filled) == 1 and smudges:
            fill_ratio_best = metrics_by_label[filled[0]]["fill_ratio_center"]
            smudge_ratios = [metrics_by_label[s]["fill_ratio_center"] for s in smudges]
            if smudge_ratios and max(smudge_ratios) >= fill_ratio_best - double_delta:
                chosen = filled[0]
                reason = "revisar_ruido"
                results.append({"pregunta": q, "respuesta": chosen, "confianza": 0.6})
            else:
                chosen = filled[0]
                reason = "dominant_filled"
                conf = min(0.99, 0.6 + metrics_by_label[chosen]["normalized_darkness_center"] * 0.35)
                results.append({"pregunta": q, "respuesta": chosen, "confianza": round(conf, 2)})
        else:
            chosen = filled[0]
            reason = "dominant_filled"
            conf = min(0.99, 0.6 + metrics_by_label[chosen]["normalized_darkness_center"] * 0.35)
            results.append({"pregunta": q, "respuesta": chosen, "confianza": round(conf, 2)})

        scores_per_question.append({"q": q, "scores": {lab: metrics_by_label[lab]["fill_ratio_center"] for lab in states}, "states": states, "chosen": chosen, "reason": reason})
        _log(f"Q{q} decision", **{**states, "chosen": chosen, "reason": reason})

    # —— Overlay scores por burbuja (legacy) ——
    if DEBUG:
        overlay_scores = warped_bgr.copy()
        for (q, o, x1, y1, x2, y2) in rects:
            rec = next((s for s in scores_per_question if s["q"] == q), None)
            if rec:
                lab = labels[o] if o < len(labels) else str(o)
                sc = rec["scores"].get(lab, 0)
                cv2.rectangle(overlay_scores, (x1, y1), (x2, y2), (200, 200, 0), 1)
                cv2.putText(overlay_scores, f"{sc:.2f}", (x1, (y1 + y2) // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)
        _save_debug(overlay_scores, "08_overlay_scores.png")

    # —— Overlay elección final (verde=elegida, rojo=omisión, azul=doble) ——
    if DEBUG:
        overlay_final = warped_bgr.copy()
        for (q, o, x1, y1, x2, y2) in rects:
            rec = next((s for s in scores_per_question if s["q"] == q), None)
            if not rec:
                continue
            lab = labels[o] if o < len(labels) else str(o)
            chosen = rec["chosen"]
            state = rec["states"].get(lab, BUBBLE_EMPTY)
            if chosen == "SIN_RESPUESTA":
                color = (0, 0, 255)
            elif chosen == "DOBLE_MARCA" and lab == rec.get("chosen", ""):
                color = (255, 128, 0)
            elif chosen == lab:
                color = (0, 255, 0)
            else:
                color = (128, 128, 128)
            cv2.rectangle(overlay_final, (x1, y1), (x2, y2), color, 2)
            cv2.putText(overlay_final, f"Q{q}-{lab}", (x1, y1 - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1)
        _save_debug(overlay_final, "09_overlay_final_choices.png")

    # —— Overlay 10: máscaras centro (azul) y anillo (verde) ——
    if DEBUG:
        overlay_masks = warped_bgr.copy()
        for (q, o, x1, y1, x2, y2) in rects:
            roi = warped_gray[y1:y2, x1:x2]
            rh, rw = roi.shape
            if rh == 0 or rw == 0:
                continue
            center_mask, ring_mask = make_center_ring_masks(rh, rw)
            overlay_masks[y1:y2, x1:x2][center_mask > 0] = [255, 128, 0]
            overlay_masks[y1:y2, x1:x2][ring_mask > 0] = [0, 200, 100]
        _save_debug(overlay_masks, "10_overlay_center_ring_masks.png")

    # —— Overlay 11: estado por burbuja (verde=FILLED, rojo=EMPTY, azul=SMUDGE) ——
    if DEBUG:
        overlay_states = warped_bgr.copy()
        for (q, o, x1, y1, x2, y2) in rects:
            rec = next((s for s in scores_per_question if s["q"] == q), None)
            if not rec:
                continue
            lab = labels[o] if o < len(labels) else str(o)
            state = rec["states"].get(lab, BUBBLE_EMPTY)
            if state == BUBBLE_FILLED:
                color = (0, 255, 0)
            elif state == BUBBLE_EMPTY:
                color = (0, 0, 255)
            else:
                color = (255, 128, 0)
            cv2.rectangle(overlay_states, (x1, y1), (x2, y2), color, 2)
            cv2.putText(overlay_states, f"Q{q}-{lab} {state}", (x1, y1 - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1)
        _save_debug(overlay_states, "11_overlay_bubble_states.png")

    # —— Overlay 12: anclajes y ajuste (si hay anclajes) ——
    if DEBUG:
        overlay_anchor = warped_bgr.copy()
        if anchors and len(anchors) >= 4:
            for i, (ax, ay) in enumerate(anchors):
                cv2.circle(overlay_anchor, (int(ax), int(ay)), 8, (0, 255, 255), 2)
                cv2.putText(overlay_anchor, f"A{i}", (int(ax) - 5, int(ay) - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        else:
            cv2.putText(overlay_anchor, "no anchors (fixed grid)", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (128, 128, 128), 2)
        _save_debug(overlay_anchor, "12_overlay_anchor_adjustment.png")

    elapsed_ms = (time.perf_counter() - t0) * 1000
    answered = len(results) - len(omissions)
    _log("resultados generados", total=len(results), answered=answered, omissions=len(omissions), doubleMarks=len(double_marks), processingTimeMs=round(elapsed_ms, 0))

    return results, omissions, double_marks, elapsed_ms, {"flatScoresDetected": flat_scores_detected}

"""
Script de calibración para la plantilla estándar LibelIA.
Carga una imagen de hoja, detecta contorno, warpea y dibuja la grilla según la configuración.
Permite ajustar parámetros vía variables de entorno para que las ROI caigan exactamente sobre las burbujas.

Uso:
  cd services/opencv-omr
  set OMR_DEBUG=true
  python scripts/calibrate_template.py path/to/hoja_referencia.png
  python scripts/calibrate_template.py path/to/hoja.png --questions 5 --no-warp   # imagen ya recortada

Variables de entorno para ajustar geometría (valores en mm):
  OMR_START_Y_MM         Inicio Y de la primera fila de respuestas (default: 55)
  OMR_ROW_HEIGHT_MM      Altura de fila (default: 6)
  OMR_BUBBLE_SPACING_MM  Separación entre burbujas (default: 6)
  OMR_BUBBLE_WIDTH_MM    Ancho burbuja (default: 4)
  OMR_BUBBLE_HEIGHT_MM   Alto burbuja (default: 4)
  OMR_ROI_MARGIN_MM      Margen interior ROI (default: 0.5)
  OMR_QUESTION_NUMBER_WIDTH_MM  Ancho columna número de pregunta (default: 8)
"""
from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

# Permitir import desde raíz del servicio
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np

from sheet_spec import (
    LIBELIA_STANDARD,
    TemplateConfig,
    get_bubble_rects_px,
    get_grid_lines_px,
    get_warp_size_px,
)
from omr_engine import (
    DEBUG_DIR,
    find_page_contour,
    order_points,
    preprocess,
    warp_perspective,
)


def config_from_env() -> TemplateConfig:
    """Construye una TemplateConfig con overrides desde variables de entorno (solo los que se deseen)."""
    def f(name: str, default: float) -> float:
        v = os.environ.get(name)
        return float(v) if v is not None else default

    return TemplateConfig(
        PAGE_WIDTH_MM=f("OMR_PAGE_WIDTH_MM", LIBELIA_STANDARD.PAGE_WIDTH_MM),
        PAGE_HEIGHT_MM=f("OMR_PAGE_HEIGHT_MM", LIBELIA_STANDARD.PAGE_HEIGHT_MM),
        PX_PER_MM=f("OMR_PX_PER_MM", LIBELIA_STANDARD.PX_PER_MM),
        MARGIN_MM=f("OMR_MARGIN_MM", LIBELIA_STANDARD.MARGIN_MM),
        MARKER_SIZE_MM=f("OMR_MARKER_SIZE_MM", LIBELIA_STANDARD.MARKER_SIZE_MM),
        HEADER_HEIGHT_MM=f("OMR_HEADER_HEIGHT_MM", LIBELIA_STANDARD.HEADER_HEIGHT_MM),
        QUESTION_NUMBER_WIDTH_MM=f("OMR_QUESTION_NUMBER_WIDTH_MM", LIBELIA_STANDARD.QUESTION_NUMBER_WIDTH_MM),
        ROW_HEIGHT_MM=f("OMR_ROW_HEIGHT_MM", LIBELIA_STANDARD.ROW_HEIGHT_MM),
        BUBBLE_WIDTH_MM=f("OMR_BUBBLE_WIDTH_MM", LIBELIA_STANDARD.BUBBLE_WIDTH_MM),
        BUBBLE_HEIGHT_MM=f("OMR_BUBBLE_HEIGHT_MM", LIBELIA_STANDARD.BUBBLE_HEIGHT_MM),
        BUBBLE_SPACING_MM=f("OMR_BUBBLE_SPACING_MM", LIBELIA_STANDARD.BUBBLE_SPACING_MM),
        ROI_MARGIN_MM=f("OMR_ROI_MARGIN_MM", LIBELIA_STANDARD.ROI_MARGIN_MM),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibración visual de la plantilla LibelIA")
    parser.add_argument("image", type=Path, help="Ruta a la imagen de la hoja (o ya warpeada)")
    parser.add_argument("--questions", type=int, default=5, help="Número de preguntas")
    parser.add_argument("--options", type=int, default=4, help="Opciones por pregunta (A,B,C,D)")
    parser.add_argument("--no-warp", action="store_true", help="Imagen ya está recortada al tamaño estándar (no detectar contorno)")
    parser.add_argument("--out-dir", type=Path, default=DEBUG_DIR, help="Carpeta de salida para overlays")
    args = parser.parse_args()

    path = args.image
    if not path.exists():
        print(f"Archivo no encontrado: {path}")
        sys.exit(1)

    config = config_from_env()
    img = cv2.imread(str(path))
    if img is None:
        print("No se pudo cargar la imagen.")
        sys.exit(1)

    args.out_dir.mkdir(parents=True, exist_ok=True)

    if args.no_warp:
        warped = img
        gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
        print("Modo sin warp: usando imagen tal cual.")
    else:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        thresh = preprocess(gray)
        page_pts = find_page_contour(thresh)
        if page_pts is None:
            print("No se encontró contorno de hoja. Use --no-warp si la imagen ya está recortada.")
            sys.exit(1)
        warped = warp_perspective(img, page_pts, config)
        gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
        cv2.imwrite(str(args.out_dir / "calib_05_warped.png"), warped)
        print("Warp aplicado. Guardado calib_05_warped.png")

    num_questions = max(1, min(200, args.questions))
    num_options = args.options
    labels = ["A", "B", "C", "D"][:num_options]
    if num_options > 4:
        for i in range(4, num_options):
            labels.append(chr(65 + i))

    rects = get_bubble_rects_px(num_questions, num_options, config)
    lines = get_grid_lines_px(num_questions, num_options, config)

    # 06_overlay_grid
    overlay_grid = warped.copy()
    for (pt1, pt2) in lines:
        cv2.line(overlay_grid, pt1, pt2, (200, 200, 200), 1)
    cv2.imwrite(str(args.out_dir / "calib_06_overlay_grid.png"), overlay_grid)
    print("Guardado calib_06_overlay_grid.png")

    # 07_overlay_bubbles con etiquetas Qn-X
    overlay_bubbles = warped.copy()
    for (q, o, x1, y1, x2, y2) in rects:
        cv2.rectangle(overlay_bubbles, (x1, y1), (x2, y2), (0, 255, 0), 1)
        label = f"Q{q}-{labels[o]}"
        cv2.putText(overlay_bubbles, label, (x1, y1 - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 0), 1)
    cv2.imwrite(str(args.out_dir / "calib_07_overlay_bubbles.png"), overlay_bubbles)
    print("Guardado calib_07_overlay_bubbles.png")

    print("\nRevisa que las cajas verdes caigan sobre las burbujas impresas.")
    print("Si no coinciden, ajusta con variables de entorno y vuelve a ejecutar:")
    print("  OMR_START_Y_MM  OMR_ROW_HEIGHT_MM  OMR_BUBBLE_SPACING_MM")
    print("  OMR_BUBBLE_WIDTH_MM  OMR_BUBBLE_HEIGHT_MM  OMR_ROI_MARGIN_MM")
    print("  OMR_QUESTION_NUMBER_WIDTH_MM")


if __name__ == "__main__":
    main()

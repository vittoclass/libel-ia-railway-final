"""
Exporta recortes de burbujas desde una imagen de hoja para etiquetado y entrenamiento.
Uso:
  cd services/opencv-omr
  python scripts/export_bubble_crops.py path/to/hoja.png --questions 5 --out dataset/bubbles
  python scripts/export_bubble_crops.py path/to/hoja.png --questions 5 --with-labels

Genera:
  - dataset/bubbles/Q1_A.png, Q1_B.png, ... (recortes por burbuja)
  - dataset/bubbles/manifest.json (lista de archivos; label vacío o inferido empty/filled/smudge)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np

from sheet_spec import LIBELIA_STANDARD, get_bubble_rects_px
from omr_engine import find_page_contour, preprocess, warp_perspective
from bubble_metrics import classify_bubble_state, compute_bubble_metrics


def main() -> None:
    p = argparse.ArgumentParser(description="Exportar recortes de burbujas para dataset (CNN/entrenamiento)")
    p.add_argument("image", type=Path, help="Imagen de la hoja OMR")
    p.add_argument("--questions", type=int, default=5)
    p.add_argument("--options", type=int, default=4)
    p.add_argument("--out", type=Path, default=Path("dataset/bubbles"), help="Carpeta de salida")
    p.add_argument("--with-labels", action="store_true", help="Inferir label por estado del pipeline (empty/filled/smudge)")
    args = p.parse_args()

    if not args.image.exists():
        print("No existe:", args.image)
        sys.exit(1)

    raw = cv2.imread(str(args.image))
    if raw is None:
        with args.image.open("rb") as f:
            raw_b = f.read()
        raw = cv2.imdecode(np.frombuffer(raw_b, dtype=np.uint8), cv2.IMREAD_COLOR)
    if raw is None:
        print("No se pudo cargar la imagen")
        sys.exit(1)

    gray = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)
    thresh = preprocess(gray)
    page_pts = find_page_contour(thresh)
    if page_pts is None:
        print("No se detectó contorno de hoja. Usando imagen tal cual.")
        warped = gray
    else:
        warped_bgr = warp_perspective(raw, page_pts, LIBELIA_STANDARD)
        warped = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2GRAY)

    num_q = max(1, min(200, args.questions))
    num_opt = max(1, min(10, args.options))
    labels = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"][:num_opt]
    rects = get_bubble_rects_px(num_q, num_opt, LIBELIA_STANDARD)

    args.out.mkdir(parents=True, exist_ok=True)
    manifest = []

    for (q, o, x1, y1, x2, y2) in rects:
        h_img, w_img = warped.shape
        x1 = max(0, min(x1, w_img - 1))
        x2 = max(x1 + 1, min(x2, w_img))
        y1 = max(0, min(y1, h_img - 1))
        y2 = max(y1 + 1, min(y2, h_img))
        crop = warped[y1:y2, x1:x2]
        if crop.size == 0:
            continue
        lab = labels[o] if o < len(labels) else str(o)
        name = "Q%d_%s.png" % (q, lab)
        path = args.out / name
        cv2.imwrite(str(path), crop)
        entry = {"file": name, "question": q, "option": lab, "label": ""}
        if args.with_labels:
            metrics = compute_bubble_metrics(warped, x1, y1, x2, y2, LIBELIA_STANDARD)
            state = classify_bubble_state(metrics, LIBELIA_STANDARD)
            entry["label"] = state.lower()
        manifest.append(entry)

    manifest_path = args.out / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print("Exportados %d recortes en %s" % (len(manifest), args.out))
    print("Manifest:", manifest_path)


if __name__ == "__main__":
    main()

"""
Prueba de lectura OMR contra el microservicio OpenCV.
Uso:
  python scripts/test_read_omr.py path/to/hoja.png
  python scripts/test_read_omr.py path/to/hoja.png --url http://localhost:8000 --questions 5
"""
import argparse
import base64
import json
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Instala requests: pip install requests")
    sys.exit(1)


def main() -> None:
    p = argparse.ArgumentParser(description="Prueba POST /read-omr con una imagen")
    p.add_argument("image", type=Path, help="Ruta a la imagen (PNG/JPG) de la hoja OMR")
    p.add_argument("--url", default="http://localhost:8000", help="URL base del microservicio")
    p.add_argument("--questions", type=int, default=5, help="Número de preguntas")
    p.add_argument("--options", default="A,B,C,D", help="Opciones separadas por coma")
    args = p.parse_args()

    path = args.image
    if not path.exists():
        print(f"Archivo no encontrado: {path}")
        sys.exit(1)

    raw = path.read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    options = [x.strip() for x in args.options.split(",") if x.strip()]

    url = args.url.rstrip("/") + "/read-omr"
    payload = {
        "imageBase64": b64,
        "templateId": "test",
        "numQuestions": args.questions,
        "optionLabels": options or ["A", "B", "C", "D"],
    }

    print(f"POST {url} (questions={args.questions}, options={options})")
    try:
        r = requests.post(url, json=payload, timeout=30)
    except requests.RequestException as e:
        print(f"Error de conexión: {e}")
        sys.exit(1)

    print(f"Status: {r.status_code}")
    try:
        data = r.json()
    except Exception:
        print("Respuesta no JSON:", r.text[:500])
        sys.exit(1)

    print(json.dumps(data, indent=2, ensure_ascii=False))

    if data.get("success") and "results" in data:
        print("\n--- Resumen por pregunta ---")
        for item in data["results"]:
            print(f"  P{item['pregunta']}: {item['respuesta']} (confianza {item.get('confianza', 0)})")
        if data.get("omissions"):
            print("Omissions:", data["omissions"])
        if data.get("doubleMarks"):
            print("Double marks:", data["doubleMarks"])


if __name__ == "__main__":
    main()

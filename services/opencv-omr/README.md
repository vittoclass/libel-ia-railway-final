# OpenCV OMR — Microservicio de lectura real

Motor OMR real con OpenCV. Sin mock: lee la imagen, detecta la hoja, corrige perspectiva y lee burbujas según la plantilla estándar LibelIA.

## Requisitos

- Python 3.10+
- OpenCV, NumPy, FastAPI

## Instalación y ejecución

```bash
cd services/opencv-omr
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
# source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

El servicio queda en `http://localhost:8000`.

## Variables de entorno

| Variable     | Uso                                                                 |
|-------------|----------------------------------------------------------------------|
| `OMR_DEBUG` | `true` para guardar imágenes intermedias en `omr_debug/` (grayscale, threshold, warped, overlay). |

## Endpoints

- **GET /health** — Estado del servicio.
- **POST /read-omr** — Lectura OMR. Body:

```json
{
  "imageBase64": "<base64 de la imagen>",
  "templateId": "omr_123",
  "numQuestions": 40,
  "optionLabels": ["A", "B", "C", "D"]
}
```

Respuesta exitosa:

```json
{
  "success": true,
  "results": [
    { "pregunta": 1, "respuesta": "A", "confianza": 0.95 }
  ],
  "omissions": [],
  "doubleMarks": [],
  "metadata": { "engine": "opencv", "processingTimeMs": 120 }
}
```

## Integración con LibelIA

En el proyecto LibelIA (raíz):

1. **.env.local** (o .env):
   ```
   OMR_PROVIDER=opencv
   OPENCV_OMR_URL=http://localhost:8000
   ```
2. Levantar el microservicio OpenCV (arriba).
3. En la app: Corrección OMR por archivo → subir hoja. LibelIA llamará a `/api/omr/read-leadtools`, que reenviará a `OPENCV_OMR_URL/read-omr`.

## Prueba real (5 preguntas)

- **Plantilla:** 5 preguntas, opciones A,B,C,D.
- **Clave correcta:** A, B, C, D, A (preguntas 1–5).
- **Estudiante marca:** A, B, **B**, D, A (error en pregunta 3: marcó B en vez de C).

Resultado esperado del compare:
- 4 correctas (preguntas 1, 2, 4, 5).
- 1 incorrecta (pregunta 3).

Cómo probar:

1. Levantar OpenCV: `cd services/opencv-omr && uvicorn main:app --port 8000`.
2. En LibelIA: `OMR_PROVIDER=opencv`, `OPENCV_OMR_URL=http://localhost:8000` en `.env.local`.
3. Crear evaluación: 5 preguntas, clave manual A,B,C,D,A.
4. Subir imagen de hoja con respuestas A,B,B,D,A.
5. Revisar resultado: 4 correctas, 1 incorrecta (pregunta 3).
6. Logs en consola del microservicio: `[OPENCV_OMR] request recibida`, `image decoded`, `threshold aplicado`, `page contour encontrado`, `perspective corregida`, `leyendo pregunta X`, `resultados generados`.

Para comprobar si leyó bien la pregunta 3: en la tabla de resultados debe aparecer pregunta 3 con respuesta estudiante "B" y correcta "C" (incorrecta).

### Prueba desde línea de comandos (script)

Con una imagen de hoja guardada (ej. `hoja.png`):

```bash
cd services/opencv-omr
pip install requests   # solo para el script
python scripts/test_read_omr.py hoja.png --questions 5 --url http://localhost:8000
```

Se imprime el JSON de respuesta y un resumen por pregunta.

## Debug visual (OMR_DEBUG=true)

En `omr_debug/` se generan siempre:

1. `01_original.png` — Imagen recibida
2. `02_grayscale.png` — Escala de grises
3. `03_threshold.png` — Umbral Otsu
4. `04_page_contour.png` — Contorno detectado de la hoja
5. `05_warped.png` — Hoja corregida a tamaño fijo
6. `06_overlay_grid.png` — Grilla matemática completa
7. `07_overlay_bubbles.png` — Cada burbuja con etiqueta Qn-X
8. `08_overlay_scores.png` — Score por burbuja
9. `09_overlay_final_choices.png` — Verde=elegida, rojo=omisión, azul=doble marca
10. `10_overlay_center_ring_masks.png` — Máscaras centro (naranja) y anillo (verde)
11. `11_overlay_bubble_states.png` — Estado por burbuja: EMPTY (rojo), FILLED (verde), SMUDGE (azul)
12. `12_overlay_anchor_adjustment.png` — Anclajes detectados (si hay) o "no anchors (fixed grid)"

## Calibración: qué variable mover si la grilla cae corrida

| Síntoma | Variable a ajustar (env o en `sheet_spec.py`) |
|--------|-----------------------------------------------|
| Grilla baja/alta respecto a la hoja | `OMR_HEADER_HEIGHT_MM` o `OMR_ROW_HEIGHT_MM` |
| Burbujas desplazadas en X | `OMR_QUESTION_NUMBER_WIDTH_MM` o `OMR_BUBBLE_SPACING_MM` |
| Burbujas muy grandes/pequeñas en ROI | `OMR_BUBBLE_WIDTH_MM`, `OMR_BUBBLE_HEIGHT_MM` |
| Centro de burbuja no coincide con impresión | `OMR_ROI_MARGIN_MM` (margen interior) |

Ejecutar `scripts/calibrate_template.py` con la hoja de referencia y revisar `calib_07_overlay_bubbles.png`. Ajustar las variables y volver a ejecutar hasta que las cajas verdes coincidan con las burbujas impresas.

## Casos de prueba obligatorios (5 preguntas, clave A,B,C,D,A)

**Caso A — Una incorrecta**  
Estudiante: A, B, **B**, D, A → Esperado: 4 correctas, 1 incorrecta (pregunta 3).

**Caso B — Una sin responder**  
Estudiante: A, B, *vacía*, D, A → Esperado: 4 correctas, 1 sin responder (omisión en 3).

**Caso C — Doble marca**  
Estudiante: A, B, *doble B y C*, D, A → Esperado: doble marca en pregunta 3.

Cómo probar: LibelIA con `OMR_PROVIDER=opencv`, crear evaluación 5 preguntas clave A,B,C,D,A, subir imagen correspondiente a cada caso y revisar compare y tabla de resultados.

## Logs por pregunta

Por burbuja: `[OPENCV_OMR] Q3-B metrics { dark_center, dark_ring, fill_center, fill_ring, contrast, normalized_darkness, state: "FILLED" }`.  
Por pregunta: `[OPENCV_OMR] Q3 decision { A: "EMPTY", B: "FILLED", C: "SMUDGE", D: "EMPTY", chosen: "B", reason: "dominant_filled" }`.  
Si hay scores planos: `[OPENCV_OMR] possible grid misalignment detected`.  
Al final: `resultados generados { total, answered, omissions, doubleMarks, processingTimeMs }`.

## Exportar recortes para clasificador (CNN)

Para preparar dataset de burbujas (empty/filled/smudge):

```bash
cd services/opencv-omr
python scripts/export_bubble_crops.py path/to/hoja.png --questions 5 --out dataset/bubbles
python scripts/export_bubble_crops.py path/to/hoja.png --questions 5 --with-labels --out dataset/bubbles
```

Genera `dataset/bubbles/Q1_A.png`, etc., y `manifest.json`. La carpeta `bubble_classifier/` contiene el stub de clasificación (sustituir por modelo entrenado cuando exista).

## Limitaciones (primera versión)

- **Plantilla:** Solo plantilla estándar LibelIA (2 columnas, filas por pregunta, 4 opciones típicas). Otras plantillas no están soportadas.
- **Detección de hoja:** Se asume que la hoja es el contorno cuadrilátero más grande; fondos muy ruidosos o hojas muy inclinadas pueden fallar.
- **Burbujas:** Posiciones fijas en mm (sheet_spec). Si la impresión no coincide con la plantilla, la lectura puede ser errónea.
- **Resolución:** Mejor con imágenes de al menos ~800 px de ancho para que el warp y las burbujas queden bien definidos.

## Archivos

- `sheet_spec.py` — Configuración geométrica (TemplateConfig): PAGE_*_MM, PX_PER_MM, WARP_*_PX, START_Y_MM, ROW_HEIGHT_MM, COL1_X_MM, COL2_X_MM, QUESTION_NUMBER_WIDTH_MM, BUBBLE_*_MM, ROI_MARGIN_MM, INNER_FILL_RATIO_THRESHOLD, DOUBLE_MARK_DELTA, MIN_FILLED_AREA_RATIO, MAX_EMPTY_AREA_RATIO, DARK_PIXEL_THRESHOLD. `get_questions_per_column()`, `get_bubble_rects_px()`, etc.
- `bubble_metrics.py` — ROI circular centro/anillo, métricas (dark_pixels_center/ring, fill_ratio_center/ring, mean_intensity_center/ring, contrast_center_vs_ring, normalized_darkness_center, combined_score), clasificación EMPTY/FILLED/SMUDGE.
- `anchors.py` — Reanclaje geométrico (stub: grilla fija; preparado para detectar anclajes).
- `omr_engine.py` — Pipeline completo, overlays 01–12, logs por burbuja y por pregunta, detección flat_scores_possible_misalignment, retorno con metadata.flatScoresDetected.
- `main.py` — FastAPI, POST /read-omr, GET /health; metadata incluye flatScoresDetected cuando aplica.
- `scripts/calibrate_template.py` — Calibración visual; overrides por env.
- `scripts/export_bubble_crops.py` — Exportar recortes de burbujas para dataset/CNN.
- `scripts/test_read_omr.py` — Prueba POST /read-omr con una imagen.
- `bubble_classifier/` — Stub para clasificar burbuja en empty/filled/smudge (integrar modelo cuando exista).

## Qué quedó funcionando hoy

- **Lectura real:** OpenCV lee la imagen, detecta contorno, warpea y aplica grilla calibrada (plantilla estándar LibelIA).
- **ROI circular por burbuja:** Centro erosionado + anillo de referencia; exclusión del borde impreso.
- **Métricas por burbuja:** dark_pixels_center/ring, fill_ratio_center/ring, mean_intensity_center/ring, contrast_center_vs_ring, normalized_darkness_center, combined_score.
- **Estados EMPTY / FILLED / SMUDGE** por burbuja; decisión por pregunta: dominant_filled, all_empty, double_mark, revisar_ruido, flat_scores_possible_misalignment.
- **Overlays 01–12** con OMR_DEBUG=true (incluidas máscaras centro/anillo, estados y anclajes).
- **Logs** por burbuja (métricas completas) y por pregunta (decision + reason).
- **Reanclaje:** módulo `anchors.py` preparado; por ahora grilla fija.
- **Integración LibelIA:** provider=opencv, compare, scoring, persistencia; mensajes "OpenCV calibrado", "incidencias", "Revisar alineación" según metadata.flatScoresDetected e incidencias.
- **Scripts:** calibrate_template.py (grilla + burbujas + env overrides), export_bubble_crops.py (recortes para CNN), test_read_omr.py (prueba POST).

# Hoja OMR estándar LibelIA — Auditoría y diseño

**Proyecto:** LibelIA  
**Objetivo:** Definir e implementar una hoja OMR propia del sistema, generable e imprimible, alineada con la cámara y con el pipeline de lectura, sin tocar lo ya construido.

---

## FASE 1 — Auditoría y diseño del formato estándar

### 1. Mejor diseño de hoja OMR para LibelIA

- **Formato único:** Una sola hoja A4 con área de contenido delimitada por **4 marcadores de esquina** (cuadrados negros) para que la cámara pueda detectar el cuadrilátero y corregir perspectiva.
- **Área útil:** Entre los marcadores, un rectángulo fijo donde se dibujan título, datos del estudiante y el bloque de preguntas. Así la geometría es reproducible y el sistema puede asumir columnas y filas conocidas.
- **Dos variantes:** Hoja estudiante (burbujas vacías) y hoja clave (mismas posiciones, respuestas correctas marcadas). Misma geometría para ambas.

### 2. Distribución de preguntas y burbujas

- **Columnas:** 2 (mitad izquierda y mitad derecha), igual que el grid reader actual (`columnas: 2`).
- **Filas:** `ceil(totalPreguntas / 2)` filas; cada fila contiene 2 preguntas (una por columna).
- **Burbujas:** Círculos uniformes por pregunta; 4 opciones (A–D) o 5 (A–E) según configuración. Separación suficiente entre filas y entre opciones para impresión y lectura óptica.
- **Tamaño de burbuja:** Radio ~2 mm (diámetro 4 mm) para que sea fácil de marcar y estable ante pequeñas variaciones de impresión o cámara.

### 3. Marcadores de referencia

- **4 cuadrados negros** en las esquinas del área de contenido, fuera del bloque de preguntas.
- **Tamaño:** 12 mm × 12 mm para que sigan siendo detectables en foto de celular (suficiente contraste y área).
- **Posición:** Esquinas del rectángulo de contenido (márgenes de página 15 mm). El "interior" del documento es el rectángulo cuyas esquinas tocan el borde interior de cada marcador.

### 4. Tamaño de burbujas y separaciones

- **Burbuja:** radio 2 mm (diámetro 4 mm).
- **Separación entre centros de burbujas** de la misma pregunta: 6 mm (A, B, C, D o A–E).
- **Altura de fila por pregunta:** 6 mm (permite una fila de burbujas y un pequeño espacio).
- **Ancho por columna de preguntas:** ~70 mm por columna para acomodar número de pregunta + 4 o 5 burbujas.
- **Separación entre columnas:** ~15 mm.

### 5. Tamaño de página y márgenes

- **Papel:** A4 (210 mm × 297 mm).
- **Margen:** 15 mm en los cuatro lados.
- **Área de contenido (donde van los marcadores):** 180 mm × 267 mm. Los 4 marcadores de 12 mm están en las esquinas de este rectángulo.
- **Área interior (tras los marcadores):** desde (27, 27) hasta (183, 270) en mm → 156 mm × 243 mm. **Relación de aspecto = 156/243 ≈ 0,642.** Este valor es el que el sistema puede usar como `templateAspectRatio` cuando la hoja sea la estándar LibelIA.

### 6. Impresión, cámara y sistema

- **Impresión:** A4 estándar; márgenes 15 mm evitan recortes; burbujas y marcadores en negro sobre blanco.
- **Cámara:** Los 4 marcadores permiten detectar esquinas y aplicar corrección de perspectiva; el rectángulo interior tiene aspect ratio fijo para el pipeline actual.
- **Sistema:** Mismo número de columnas (2) y opciones (A–D o A–E) que usa `omr-grid-reader` y el flujo con plantilla superpuesta; la hoja queda alineada por diseño con ese pipeline.

---

## Diseño elegido (resumen)

| Elemento | Valor | Motivo |
|----------|--------|--------|
| Papel | A4 210×297 mm | Estándar impresión. |
| Márgenes | 15 mm | Buen borde para impresora y manejo. |
| Marcadores | 12×12 mm, esquinas del contenido | Detección robusta en cámara. |
| Área interior | 156×243 mm | Aspect ratio 0,642 para pipeline. |
| Columnas de preguntas | 2 | Coincide con grid reader. |
| Burbuja | radio 2 mm | Legible y estable. |
| Separación entre opciones | 6 mm centros | Evita solapamientos. |
| Altura por fila | 6 mm | Caben ~40 preguntas en el alto útil. |
| Cabecera | Título, nombre, curso, id. plantilla | Identificación y trazabilidad. |

---

## Archivos nuevos

| Archivo | Descripción |
|--------|-------------|
| `app/lib/omr-sheet-spec.ts` | Constantes del formato (mm), posiciones de marcadores y burbujas, relación de aspecto estándar. |
| `app/lib/omr-sheet-pdf.ts` | Generación del PDF (jspdf): marcadores, cabecera, burbujas; variante estudiante o clave. |
| `app/components/OMRSheetGeneratorModal.tsx` | UI: preguntas, alternativas, tipo hoja, clave (si aplica), previsualización, exportar PDF. |
| `AUDITORIA_HOJA_OMR_ESTANDAR_LIBELIA.md` | Este documento. |

---

## Archivos modificados

| Archivo | Cambio | Riesgo |
|--------|--------|--------|
| `app/EvaluatorClient.tsx` | Import de `OMRSheetGeneratorModal` y `FileDown`; estado `isOMRSheetGeneratorOpen`; modal y botón "Generar hoja OMR LibelIA" en la tarjeta de modos de captura. | Bajo: solo nueva herramienta y entrada; no se modifica lógica de evaluación ni OMR existente. |

---

## Checklist manual

- [ ] El sistema actual sigue intacto.
- [ ] Existe una herramienta nueva para generar hojas OMR.
- [ ] Se puede elegir cantidad de preguntas.
- [ ] Se puede elegir cantidad de alternativas (A–D o A–E).
- [ ] Se puede generar hoja estudiante vacía.
- [ ] Se puede generar hoja clave correcta.
- [ ] Se puede exportar a PDF.
- [ ] La hoja incluye marcadores de referencia en las 4 esquinas.
- [ ] La hoja está alineada con el sistema/cámara como formato preferido.
- [ ] No se rompe nada del sistema actual.

---

## Código y explicación breve

- **app/lib/omr-sheet-spec.ts:** Constantes en mm (página A4, márgenes, marcadores 12mm, área interior, relación de aspecto LIBELIA_OMR_ASPECT_RATIO). `getBubblePositions(numQuestions, numOptions)` devuelve el centro (cx, cy) de cada burbuja en mm para 2 columnas y N filas. `getMarkerCorners()` devuelve los centros de los 4 marcadores.

- **app/lib/omr-sheet-pdf.ts:** `generateOMRSheetPDF(opts)` importa jspdf dinámicamente, crea un documento A4 en mm, dibuja los 4 cuadrados negros en las esquinas, la cabecera (título, nombre, curso, y en variante clave el texto "CLAVE CORRECTA"), y las burbujas (círculos vacíos o rellenos si es clave y es la respuesta correcta). Números de pregunta a la izquierda de cada fila. `getOMRSheetFilename(variant, numQuestions)` devuelve `libelia_omr_estudiante_N.pdf` o `libelia_omr_clave_N.pdf`.

- **app/components/OMRSheetGeneratorModal.tsx:** Modal con: número de preguntas (5–60), alternativas (A–D / A–E), tipo (Estudiante / Clave). Si Clave: campo de texto para las respuestas correctas (N letras separadas por coma o espacio). Botón "Exportar PDF" que genera el blob, descarga con el nombre sugerido y muestra toast. No toca OMR ni evaluación.

- **app/EvaluatorClient.tsx:** Import de `OMRSheetGeneratorModal` y `FileDown`; estado `isOMRSheetGeneratorOpen`; render de `<OMRSheetGeneratorModal open={...} onClose={...} />`; botón "Generar hoja OMR LibelIA" en la tarjeta de selección de modo de captura que abre el modal.

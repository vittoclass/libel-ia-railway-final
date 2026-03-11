# OMR en tiempo real con plantilla superpuesta — Auditoría y diseño V1

**Proyecto:** LibelIA  
**Objetivo:** Flujo nuevo y separado de OMR desde cámara, con plantilla/clave de respuestas, detección, comparación y revisión mínima del profesor, sin tocar el sistema actual.

---

## 1. Auditoría del sistema actual

### 1.1 Flujo OMR existente (no tocar)

| Componente | Función | Ubicación |
|------------|---------|-----------|
| **Answer key** | Extrae respuestas correctas de una imagen de plantilla resuelta (Mistral Pixtral). Guarda en `omrTemplateCache`. | `POST /api/omr/answer-key` |
| **Closed answer** | Lee hoja del estudiante (imagen): nombre, curso, respuestas por pregunta. Devuelve `respuestas[]` con pregunta, respuesta, confianza. | `POST /api/omr/closed-answer` |
| **Compare** | Compara `answerKey` + `studentAnswers`. Devuelve resultados por pregunta, correctas/incorrectas/sin responder, `requierenRevision[]`, nota chilena. | `POST /api/omr/compare` |
| **ClosedAnswerOMRModal** | UI: imagen de plantilla, extrae con closed-answer, permite editar respuestas, confirma y devuelve resultado. | `components/ClosedAnswerOMRModal.tsx` |
| **Persistencia** | `persistEvaluation(result, opts)` espera `EvaluationResultForPersist`: `puntaje`, `nota`, `alternativas_corregidas: [{ pregunta, respuesta_estudiante, respuesta_correcta }]`. | `lib/persist-evaluation.ts` |
| **Retry-save** | Recibe `result` + opts y llama a `persistEvaluation`. Usado cuando la evaluación ya está calculada. | `POST /api/evaluations/retry-save` |

Ninguno de estos se modifica. El nuevo flujo solo los **utiliza** o construye el mismo contrato de datos.

### 1.2 Integración con LibelIA

- Las evaluaciones se guardan vía `persistEvaluation` (desde `/api/evaluate` o desde `retry-save`).
- El resultado debe tener `alternativas_corregidas` con `pregunta` (string, ej. "1"), `respuesta_estudiante`, `respuesta_correcta`.
- Con eso el análisis pedagógico, informe y archivar siguen igual.

---

## 2. Decisiones para la V1

### 2.1 Fuente de la plantilla correcta (FASE 2)

**Opción elegida para V1: D — Varias opciones, priorizando la más robusta.**

| Orden | Opción | Uso en V1 |
|-------|--------|-----------|
| 1 | **Clave estructurada manual** | El profesor ingresa total de preguntas, opciones (A–D) y la letra correcta por cada pregunta. Sin dependencia de visión. Más estable. |
| 2 | **Plantilla resuelta (imagen/PDF)** | Reutilizar `POST /api/omr/answer-key` sin modificarlo: se sube imagen de la pauta marcada y se obtiene la clave. Ya existe y es estable. |
| 3 | **Prueba base existente** | En una fase posterior: si la prueba base tiene ítems de alternativas con respuesta correcta, usar esa clave. No implementado en V1. |

**Por qué esta prioridad:** La clave manual es la más predecible y no depende de IA ni de calidad de foto. La plantilla resuelta ya está soportada por el sistema y se puede ofrecer como alternativa sin tocar nada.

### 2.2 Detección de la hoja del estudiante (FASE 3)

- **V1:** No se hace detección automática de contornos ni perspectiva.
- El profesor **alinea la hoja** con el encuadre de la cámara y pulsa **“Capturar”**.
- Mensaje claro: *“Alinea la hoja dentro del recuadro y captura cuando se vea nítida.”*
- Una fase futura puede añadir detección de esquinas y alineación automática.

### 2.3 Alineación plantilla / hoja (FASE 3)

- **V1:** No hay superposición geométrica plantilla-sobre-hoja en pantalla.
- Flujo: cargar **clave correcta** (manual o desde answer-key) → capturar **foto de la hoja del estudiante** → enviar a `closed-answer` → comparar con la clave.
- La “plantilla” es la clave de respuestas (datos), no una imagen superpuesta. La superposición visual puede ser V2.

### 2.4 Manejo de marcas (FASE 7)

- **V1:** Priorizar **burbujas** (círculos rellenados). El endpoint `closed-answer` actual está pensado para “X”; `answer-key` ya soporta burbuja o X según parámetro.
- **Cruces (X):** Se pueden soportar en V1 si `closed-answer` ya las maneja (el prompt actual habla de “X grande”). No se modifica el endpoint; solo se elige el tipo de hoja en la UI si se implementa selector.
- Criterio seguro: en V1 usar un solo tipo de marca (ej. burbujas) o el que ya use `closed-answer` por defecto.

### 2.5 Clasificación y visual (FASE 4)

- **Correcta:** respuesta estudiante = respuesta clave y confianza suficiente (p. ej. ≥ 0,85).
- **Incorrecta:** respuesta distinta a la clave.
- **Dudosa:** baja confianza o en `requierenRevision` (doble marca, sin respuesta, etc.).
- **Visual:** verde = correcta, rojo = incorrecta, amarillo = dudosa (o “requiere revisión”).

### 2.6 Revisión mínima del profesor (FASE 5)

- Solo las preguntas **dudosas** o en **requierenRevision** se muestran para edición.
- El profesor puede: confirmar, corregir la letra, o dejar en blanco.
- Las que ya están correctas/incorrectas sin duda no se modifican salvo que el profesor quiera (opcional: “Editar todas”).

### 2.7 Integración con el flujo LibelIA (FASE 6)

- Con las respuestas finales (tras revisión) se construye un objeto **EvaluationResultForPersist**:
  - `alternativas_corregidas`: una entrada por pregunta con `pregunta`, `respuesta_estudiante`, `respuesta_correcta`.
  - `puntaje`: ej. `"32/40"`.
  - `nota`: escala chilena (p. ej. la que devuelve `compare` o la misma fórmula).
- Se llama a **`POST /api/evaluations/retry-save`** con ese `result` y los opts (estudiante, curso, título, etc.).
- No se toca `/api/evaluate`, ni batch, ni `persist-evaluation.ts`: solo se usa la API existente de retry-save.

---

## 3. Componentes nuevos (V1)

| Componente | Responsabilidad |
|------------|-----------------|
| **RealtimeOMRModal** (o equivalente) | Flujo completo: (1) Cargar clave (manual o subir imagen → answer-key). (2) Abrir cámara, previsualización, botón Capturar. (3) Enviar foto a closed-answer. (4) Enviar clave + respuestas a compare. (5) Mostrar correctas/incorrectas/dudosas y lista de revisión. (6) Edición solo dudosas. (7) Construir result y llamar retry-save. |
| **Punto de entrada** | Botón o enlace “OMR en tiempo real” / “Corrección OMR con cámara” en la página de evaluar (o en Evaluaciones), que abre el modal. No reemplaza el botón/flujo actual de OMR. |

No se crean nuevos endpoints en V1: se reutilizan `answer-key`, `closed-answer`, `compare` y `retry-save`.

---

## 4. Riesgos y mitigación

| Riesgo | Mitigación |
|--------|------------|
| Confundir flujo viejo con el nuevo | Nombre distinto en UI (“OMR en tiempo real” / “Corrección con cámara”) y entrada separada. |
| Modificar por error APIs existentes | No editar archivos de `/api/evaluate`, `/api/omr/closed-answer`, `/api/omr/compare`, `/api/omr/answer-key`; solo consumirlos. |
| Persistencia distinta | Usar exactamente el contrato de `EvaluationResultForPersist` y `retry-save`. |
| Cámara en móvil | Usar `getUserMedia` con restricciones para vídeo; pedir permisos y mostrar mensaje si se deniegan. |

---

## 5. Mensajes claros (FASE 8)

- *“Alinea la hoja dentro del recuadro y captura cuando se vea nítida.”*
- *“Plantilla correcta cargada.”* (al tener clave lista).
- *“Se detectaron X respuestas correctas, Y incorrectas y Z dudosas.”*
- *“Hay N preguntas que requieren revisión manual.”*
- *“Corrección lista para guardar.”*
- *“Alinea mejor la hoja”* (si la imagen sale muy mala o el servicio devuelve error; opcional en V1).

---

## 6. Checklist de no rotura

- El OMR actual (ClosedAnswerOMRModal, subida de imagen, etc.) sigue funcionando igual.
- Existe un flujo nuevo claramente nombrado (OMR en tiempo real / corrección con cámara).
- Se puede cargar o elegir plantilla correcta (manual o imagen).
- Se puede abrir la cámara en el celular.
- Se puede alinear la hoja en el encuadre y capturar.
- Se detectan respuestas del estudiante (vía closed-answer).
- Se comparan con la plantilla (vía compare).
- Se muestran correctas / incorrectas / dudosas.
- El profesor puede corregir solo lo dudoso.
- El resultado final se puede guardar (retry-save).
- El resultado entra al flujo de evaluación (persistencia e informe existentes).
- No se rompe nada del sistema actual (evaluar, evaluaciones, informe, archivar).

---

## 7. Resumen

- **V1:** Flujo nuevo en un modal (o vista) separado: clave (manual o por imagen vía answer-key) → cámara → captura → closed-answer → compare → revisión de dudosas → retry-save. Sin tocar ningún endpoint ni la lógica de persistencia actual.
- **Plantilla:** Clave estructurada manual como opción principal; plantilla resuelta por imagen como segunda opción reutilizando answer-key.
- **Alineación:** Manual en cámara; sin overlay geométrico en V1.
- **Integración:** Mismo contrato que el resto de LibelIA vía `retry-save` y `EvaluationResultForPersist`.

---

## 8. Archivos nuevos (implementación V1)

| Archivo | Descripción |
|---------|-------------|
| `app/components/RealtimeOMRModal.tsx` | Modal del flujo OMR en tiempo real: cargar clave (manual o subir imagen → answer-key), cámara, captura, closed-answer, compare, revisión de dudosas, construcción de result y llamada a retry-save. No modifica APIs existentes. |

---

## 9. Archivos modificados (implementación V1)

| Archivo | Cambio | Riesgo |
|---------|--------|--------|
| `app/EvaluatorClient.tsx` | Import de `RealtimeOMRModal`, estado `isRealtimeOMROpen`, botón "OMR en tiempo real (clave + cámara)" en el modal de selección de modo de captura, y render de `<RealtimeOMRModal />`. | Bajo. Solo se añade una opción y un modal; no se modifica el flujo ni el OMR actual. |

---

## 10. Riesgo por archivo

- **RealtimeOMRModal.tsx:** Solo consume APIs existentes (answer-key, closed-answer, compare, retry-save). No toca persist-evaluation ni evaluate.
- **EvaluatorClient.tsx:** Añadidos import, estado y botón; el flujo actual de captura y OMR cerradas sigue igual.

---

## 11. Checklist manual (post-implementación)

- [ ] El OMR actual (plantilla respuestas cerradas, captura, etc.) sigue funcionando igual.
- [ ] Existe el flujo nuevo "OMR en tiempo real" (botón en selección de modo de captura).
- [ ] Se puede cargar plantilla correcta (manual o subir imagen).
- [ ] Se puede abrir la cámara en el celular.
- [ ] Se puede alinear la hoja y capturar.
- [ ] Se detectan respuestas del estudiante (closed-answer).
- [ ] Se comparan con la plantilla (compare).
- [ ] Se muestran correctas / incorrectas / dudosas.
- [ ] El profesor puede corregir solo lo dudoso.
- [ ] El resultado se puede guardar (retry-save).
- [ ] El resultado entra al flujo de evaluación (listado, informe, análisis).
- [ ] No se rompe nada del sistema actual.

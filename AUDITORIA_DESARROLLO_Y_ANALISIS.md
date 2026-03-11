# Auditoría: Desarrollo del estudiante y análisis pedagógico

**Proyecto:** LibelIA  
**Objetivo:** Respuestas de desarrollo (imagen/PDF) corregidas y entrando al análisis pedagógico sin romper nada.

---

## 1. Resumen ejecutivo

- **Persistencia:** Los ítems de desarrollo ya se guardan en `evaluation_items` con `score_obtained`, `score_max` y `student_answer`. Se corrigió el **mapeo de `question_number`**: ahora se extrae del identificador de la clave (ej. `P39` → 39) para que coincida con `item_number` de la prueba base y entren al análisis pedagógico.
- **Análisis pedagógico:** Ya está implementado y cruza por `question_number` / `item_number`. No se modificó; con el fix de persistencia las preguntas abiertas entran en by_question, by_axis, by_skill, by_cognitive_level, alumno y curso.
- **Extracción/corrección (imagen/PDF):** Sigue en `/api/evaluate`; por regla no se tocó. La persistencia queda alineada para cuando ese flujo entregue `detalle_desarrollo` con claves tipo P39, P40.

---

## 2. Qué sí está funcionando

| Área | Estado | Detalle |
|------|--------|---------|
| Prueba base con desarrollo | ✅ | Se detectan preguntas de desarrollo con rúbrica y se asocian a la evaluación. |
| Persistencia de alternativas | ✅ | `question_number` secuencial 1, 2, 3…; scoring ya funcional. |
| Persistencia de desarrollo | ✅ (corregido) | Se guarda en `evaluation_items` con `question_number` extraído de la clave (P39→39). |
| Análisis por pregunta | ✅ | `analyzeLearningResults` cruza `evaluation_items.question_number` con `source_exam_items.item_number`. |
| Análisis por eje/habilidad/nivel | ✅ | Mismo cruce; si los ítems tienen `question_number` correcto, entran. |
| Resumen alumno y curso | ✅ | Usan el mismo análisis. |
| API de análisis pedagógico | ✅ | Lee `evaluation_items` y `source_exam_items`; no se modificó. |

---

## 3. Qué no / qué está parcial

| Área | Estado | Notas |
|------|--------|--------|
| Corrección desde imagen/PDF | Parcial / externo | Depende de `/api/evaluate` (no modificado). Si ese endpoint ya devuelve `respuestas_desarrollo` con claves P39, P40 y puntaje "X/Y", la persistencia los guarda bien. |
| Múltiples páginas / varias imágenes | Parcial | Mismo flujo; si el evaluate agrupa por pregunta y devuelve detalle_desarrollo, la persistencia los integra. |
| Predicción / triangulación / evidencia | No implementado | Fase 4: solo se deja base (datos en `evaluation_items` y análisis listos para cruces). |

---

## 4. Cambio realizado (único cambio de código)

**Archivo:** `app/lib/persist-evaluation.ts`

- **Antes:** Los ítems de `detalle_desarrollo` se guardaban con `question_number` secuencial (`questionNumber++`), por lo que un solo ítem "P40" podía guardarse como 39 y no coincidir con `item_number` 40 en la prueba base.
- **Después:** Se extrae el número de la clave con `parseDevelopmentQuestionNumber(key)` (ej. "P39" → 39). Ese valor se usa como `question_number`. Si la clave no tiene número válido (1–999), se usa el contador secuencial `questionNumber++` (una sola vez).
- **Riesgo:** Bajo; solo afecta a ítems de desarrollo; alternativas y resto del flujo intactos.

---

## 5. Archivos tocados

| Archivo | Acción | Riesgo |
|---------|--------|--------|
| `app/lib/persist-evaluation.ts` | Modificado (question_number por clave en desarrollo) | Bajo |

**Solo revisados (sin cambios):**  
`app/lib/analyze-learning-results.ts`, `app/api/evaluations/[id]/pedagogical-analysis/route.ts`, `app/api/courses/[courseId]/pedagogical-summary/route.ts`, `app/api/evaluate/route.ts`, `app/lib/parse-development-blocks.ts`.

---

## 6. Integración con análisis pedagógico

- Los endpoints de análisis leen `evaluation_items` y `source_exam_items` y llaman a `analyzeLearningResults`.
- El análisis cruza por `evaluation_items.question_number === source_exam_items.item_number`.
- Con el fix, los ítems de desarrollo (ej. P39, P40) quedan con `question_number` 39 y 40, por lo que entran en:
  - by_question  
  - by_axis  
  - by_skill  
  - by_cognitive_level  
  - student_summary  
  - course_summary  

Ejemplo: si la pregunta 39 (desarrollo) vale 2 y el estudiante obtiene 1, ese 50% se refleja en pregunta, eje, habilidad, nivel, alumno y curso.

---

## 7. Base para análisis profundo (Fase 4)

Sin implementar aún lógica de IA generativa:

- **Predicción:** Los datos ya están en `evaluation_items` (por pregunta, score, alumno, evaluación). Se puede usar para detectar patrones repetidos y riesgos futuros.
- **Triangulación:** `analyzeLearningResults` ya cruza cerradas, ejes, habilidades y niveles. Las preguntas abiertas quedan en el mismo modelo; se puede cruzar con historial del estudiante y resultados del curso.
- **Evidencia:** by_question, by_axis, by_skill y resúmenes ofrecen porcentajes y datos concretos para explicar debilidades y fortalezas.

No se añadió aún un sistema de predicción ni indicadores automáticos; la base de datos y el análisis actual son la base para ello.

---

## 8. Checklist manual

Comprobar en entorno real:

- [ ] Una prueba con preguntas abiertas puede subirse en imagen o PDF (según lo que permita `/api/evaluate`).
- [ ] El desarrollo se reconoce por número de pregunta (clave P39, P40, etc.).
- [ ] Se corrige con rúbrica (en el flujo de evaluate).
- [ ] Se guarda `score_obtained` y `score_max` por pregunta abierta en `evaluation_items`.
- [ ] Las preguntas abiertas aparecen en `evaluation_items` con `question_number` correcto (39, 40).
- [ ] Las preguntas abiertas entran al análisis por pregunta.
- [ ] Las preguntas abiertas entran al análisis por eje.
- [ ] Las preguntas abiertas entran al análisis por habilidad.
- [ ] Las preguntas abiertas entran al análisis del alumno.
- [ ] Las preguntas abiertas entran al resumen del curso.
- [ ] No se rompe la corrección de alternativas ni el resto del sistema.

---

## 9. Mensajes claros (Fase 5)

- **¿LibelIA ya corrige desarrollo desde imagen?** Depende de `/api/evaluate`. Si ese endpoint procesa imagen y devuelve `respuestas_desarrollo` con claves P39, P40 y puntajes, la persistencia los guarda y el análisis los usa.
- **¿Desde PDF?** Igual: si evaluate entrega `detalle_desarrollo`, el flujo de persistencia y análisis está listo.
- **¿Cómo se guardan?** En `evaluation_items` con `question_number` = número extraído de la clave (P39→39), `score_obtained`, `score_max`, `student_answer`.
- **¿Alimentan el análisis pedagógico?** Sí, porque el análisis cruza por `question_number` y los ítems de desarrollo ya llevan el número correcto.

Resultado: LibelIA no solo reconoce desarrollo en la prueba base; cuando el flujo de corrección (evaluate) entrega desarrollo del estudiante, se persiste con el número de pregunta correcto y se integra al análisis pedagógico real.

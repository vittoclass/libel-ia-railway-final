# Reorganización UX flujo pedagógico — LibelIA

## 1. Auditoría breve de UX

**Antes:**
- En **Evaluaciones** (tabla): botones Ver, Análisis pedagógico, Archivar. No se veía estado de prueba base ni acceso directo al curso.
- En **detalle** de evaluación: solo "Asociar a prueba base", sin indicar si ya estaba asociada; no había "Análisis pedagógico" ni "Ver resumen del curso" en el detalle.
- Para ver el resumen del curso había que ir a la pestaña Cursos y abrir "Ver resumen pedagógico" desde ahí.

**Datos ya disponibles por evaluación:**
- `course_id` / `course_label` (en lista y en detalle).
- `source_exam_id` no se exponía en el GET de detalle; solo se usaba en backend.

---

## 2. Propuesta de reorganización (implementada)

- **Evaluaciones como hub:** Desde la fila y desde el detalle se puede: ver estado de prueba base, asociar/cambiar prueba base, abrir análisis pedagógico y abrir resumen del curso.
- **Estado explícito:** En el detalle se muestra "Prueba base: asociada" o "Prueba base: pendiente".
- **Etiquetas:** "Asociar a prueba base" / "Cambiar prueba base", "Análisis pedagógico", "Ver resumen del curso".
- **Acceso directo al curso:** Botón "Ver resumen del curso" en la fila (tabla) y en el detalle, que abre el modal de resumen pedagógico con el `course_id` de esa evaluación.
- **Cursos y Estudiantes:** Sin cambios; siguen siendo vistas agregada e individual.

---

## 3. Archivos modificados

| Archivo | Cambios |
|---------|--------|
| `app/api/evaluations/[id]/route.ts` | Se incluye `source_exam_id` en el `select` de `evaluations` y en el objeto `evaluation` de la respuesta. Aditivo; no se cambia el resto del contrato. |
| `app/EvaluatorClient.tsx` | (1) Detalle: línea "Prueba base: asociada / pendiente"; botón "Asociar a prueba base" o "Cambiar prueba base" según estado; botones "Análisis pedagógico" y "Ver resumen del curso" que abren los modales correspondientes. (2) Tabla Evaluaciones: botón "Ver resumen del curso" por fila que abre el modal de resumen con el `course_id` de la evaluación. |

---

## 4. Riesgo por archivo

- **`app/api/evaluations/[id]/route.ts`:** Bajo. Solo se añade un campo de lectura (`source_exam_id`) a la respuesta.
- **`app/EvaluatorClient.tsx`:** Bajo. Solo se añaden estado visual y botones; no se modifica evaluate, scoring, informe ni archivar.

---

## 5. Código relevante

- **API:** El GET de evaluación devuelve `evaluation.source_exam_id` (string o undefined).
- **Detalle:** Se muestra `Prueba base: asociada` si `evaluacionesDetail.evaluation.source_exam_id` existe; si no, `pendiente`. Los tres botones (Asociar/Cambiar, Análisis pedagógico, Ver resumen del curso) están en un `flex` con `gap-2`.
- **Fila:** Junto a "Análisis pedagógico" se añade un botón "Ver resumen del curso" que hace `setCoursePedagogicalSummaryId(ev.course_id ?? "Sin curso")`, `setCoursePedagogicalSummaryLabel(...)` y `setCoursePedagogicalSummaryOpen(true)`.

---

## 6. Explicación breve

El flujo principal queda: **Evaluar → (Asociar prueba base) → Análisis pedagógico → Ver resumen del curso**, todo accesible desde la pestaña Evaluaciones (fila y detalle). No se tocan APIs de evaluate, scoring, informe ni archivar; solo se reordena la UX y se expone `source_exam_id` en el detalle para mostrar el estado de la prueba base.

---

## 7. Checklist manual

- [ ] La evaluación normal (ver, nota, informe) sigue funcionando.
- [ ] La asociación a prueba base sigue funcionando y tras asociar se ve "Prueba base: asociada" en el detalle.
- [ ] Desde el detalle se puede abrir "Análisis pedagógico" y "Ver resumen del curso".
- [ ] Desde la fila de Evaluaciones se puede abrir "Ver resumen del curso" sin abrir el detalle.
- [ ] La pestaña Cursos sigue funcionando (Ver resumen pedagógico).
- [ ] La pestaña Estudiantes sigue funcionando (Análisis pedagógico, Ver perfil).
- [ ] El flujo se percibe más directo: estado claro y acciones visibles en Evaluaciones.
- [ ] No se rompe evaluate, scoring, Ver informe, Archivar ni importación de prueba base.

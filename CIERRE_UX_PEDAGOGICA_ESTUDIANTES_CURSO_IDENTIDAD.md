# Cierre final UX pedagógica — Estudiantes, Curso, Identidad

## 1. Auditoría breve

- **Estudiantes:** El botón "Análisis pedagógico" ya abría el modal con la evaluación más reciente o mostraba un toast; el mensaje con 0 evaluaciones era genérico ("evaluaciones analizables") y los logs en dev no dejaban claro el motivo cuando no se abría el análisis.
- **Curso:** El modal ya mostraba SummaryBlock y NoSummaryMessage; el mensaje de error de red era genérico y no había fallback cuando `!data` tras cargar.
- **Evaluaciones:** La columna Estudiante mostraba "—" cuando no había nombre; el label pasado al modal de análisis priorizaba el título sobre el nombre del estudiante, por lo que el título del modal no dejaba claro de quién era la evaluación.

## 2. Causas

| Área | Causa |
|------|--------|
| Estudiantes | Mensaje con 0 evaluaciones poco alineado con el texto solicitado; falta de logs claros al elegir evaluación o al no poder abrir. |
| Curso | Error de fetch mostrado como texto plano; sin mensaje explícito cuando falla la carga; sin fallback cuando no hay `data`. |
| Evaluaciones | Fallback "—" en lugar de "Sin nombre de estudiante"; `evaluationLabel` con prioridad título en lugar de nombre del estudiante. |

## 3. Archivos modificados

| Archivo | Cambios |
|---------|--------|
| `app/EvaluatorClient.tsx` | Estudiantes: toast exacto "Este estudiante aún no tiene evaluaciones." cuando no hay evaluaciones; logs en dev (sin evaluación usable / abriendo modal / error). Evaluaciones: columna Estudiante con fallback "Sin nombre de estudiante"; label del modal con prioridad nombre del estudiante ("Nombre — Título" o "Nombre"); mismo criterio en el botón del detalle; log en dev al abrir análisis desde fila. |
| `app/components/CoursePedagogicalSummaryModal.tsx` | Error mostrado en bloque con borde; fallback cuando `!loading && !error && !data` con mensaje "No se pudo cargar el resumen pedagógico." |

## 4. Riesgo por archivo

- **EvaluatorClient.tsx:** Bajo; solo mensajes, labels y logs; no se toca evaluate, scoring, informe ni archivar.
- **CoursePedagogicalSummaryModal.tsx:** Muy bajo; solo presentación del error y fallback.

## 5. Código relevante

- **Estudiantes (0 evaluaciones):** `toast({ title: "Este estudiante aún no tiene evaluaciones.", variant: "default" })`. Log en dev: `reason: "no_evaluations"`.
- **Estudiantes (abriendo modal):** Log en dev con `studentId`, `studentName`, `evaluationsCount`, `chosenEvalId`, `chosenLabel`.
- **Curso:** `{error && <p className="...">{error}</p>}`; `{!loading && !error && !data && <p>No se pudo cargar el resumen pedagógico.</p>}`.
- **Evaluaciones (fila):** `ev.first_student_name && String(ev.first_student_name).trim() ? ev.first_student_name : "Sin nombre de estudiante"`; label modal: `first_student_name ? (title ? \`${first_student_name} — ${title}\` : first_student_name) : (title || null)`.

## 6. Explicación breve

Se unifican mensajes y comportamiento en las tres vistas: en Estudiantes se usa el texto exacto pedido cuando no hay evaluaciones y se registra en dev qué evaluación se elige o por qué no se abre el análisis; en Curso se muestra siempre un mensaje claro en caso de error o de ausencia de datos; en Evaluaciones se muestra "Sin nombre de estudiante" cuando falta nombre y el modal de análisis lleva en el título el nombre del estudiante (con título de evaluación si existe). No se modifica lógica de evaluación, scoring, informe ni archivar.

## 7. Checklist manual

- [ ] En Estudiantes, el botón de análisis hace siempre algo visible (toast o modal).
- [ ] Con 0 evaluaciones se muestra "Este estudiante aún no tiene evaluaciones.".
- [ ] Con evaluaciones se abre el modal de la más reciente y el título incluye el nombre del estudiante.
- [ ] En Curso, con error o sin datos se muestra un mensaje explícito.
- [ ] En Curso, con datos se muestra el encabezado con conteos.
- [ ] En Evaluaciones, la columna Estudiante muestra nombre o "Sin nombre de estudiante".
- [ ] El modal de análisis muestra "Análisis pedagógico de evaluación — [Nombre]" (o "— Nombre — Título").
- [ ] No se rompe evaluación normal, informe, archivar ni importación.

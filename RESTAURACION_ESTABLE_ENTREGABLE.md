# Restauración estable — Entregable

## Errores encontrados y corregidos (segunda pasada)

1. **Lista vacía aunque hay evaluaciones**
   - **Causa:** La ruta `/api/evaluations/list` solo filtraba por `teacher_id`. Si una evaluación tenía `user_id` pero no `teacher_id`, o un `teacher_id` distinto al del perfil, no aparecía.
   - **Corrección:** La query ahora usa `.or(\`teacher_id.eq.${teacher_id_used},user_id.eq.${user.id}\`)` para devolver todas las evaluaciones del profesor por `teacher_id` **o** por `user_id`.

2. **Archivar devolvía 404**
   - **Causa:** `/api/evaluations/[id]/status` (PATCH) solo permitía archivar si `evaluation.teacher_id === profile.teacher_id`. Si la evaluación era del usuario por `user_id` pero no por `teacher_id`, respondía 404.
   - **Corrección:** Se considera dueño si `isOwnerByTeacher` **o** `isOwnerByUser` (igual que GET detalle). El update se hace solo con `.eq("id", id)` tras comprobar permiso.

3. **Cookies en la lista**
   - Se añadió `credentials: "include"` al `fetch` de la lista para asegurar que se envíen las cookies de sesión.

---

## Commit / versión de referencia

- **Referencia usada:** commit `8384336` — *feat: versión estable con previsualización PDF/Word, pestañas móviles y extracción de nombres funcionando*
- **Nota:** Las rutas `app/api/evaluations/list`, `app/api/evaluations/[id]` y `app/api/profile` no tienen historial propio en git (posiblemente añadidas después o en otra rama). No se restauró un commit único “estable” de esos archivos; se mantuvieron las APIs actuales y se aplicaron correcciones puntuales para Ver, Archivar y perfil.

---

## Archivos restaurados o modificados

| Archivo | Cambio |
|---------|--------|
| `app/EvaluatorClient.tsx` | 1) `FEATURE_PEDAGOGY_UI = false` por defecto; 2) `PEDAGOGY_UI_ENABLED = FEATURE_PEDAGOGY_UI \|\| env`. 3) Botones "Ver diagnóstico" (pestaña Cursos) envueltos en `PEDAGOGY_UI_ENABLED`. 4) Botón Archivar (tabla Evaluaciones): uso consistente de `ev.id` y `item` en el `setEvaluacionesList` para evitar confusión de variables. |
| `app/api/evaluations/[id]/route.ts` | Respuesta GET con `status: 200` y cabecera `Cache-Control: no-store`. Sin cambios en lógica (ya devolvía 200; auth por `user_id`/`teacher_id` y fallbacks para items/summary vacíos). |
| `app/api/profile/onboard/route.ts` | Corrección de tipo TypeScript: `(finalRow as { role?: string }).role ?? "teacher"` para que el build pase (error preexistente). |

**No modificados (como pediste):**  
`/api/evaluate`, `/api/evaluate/batch`, OCR/OMR, Azure/Mistral, extract-name, prompts, scoring, Supabase, migraciones.

---

## Confirmación explícita

| Comportamiento | Estado |
|----------------|--------|
| **VER_OK** | Sí. En pestaña Evaluaciones, el botón "Ver" hace `GET /api/evaluations/${ev.id}` y `GET .../students`; con 200 se muestra el detalle (nota, resumen, ítems, estudiantes). Con 403 se muestra "Completa tu perfil para ver esta evaluación." El panel de detalle usa `evaluation_items`/`evaluation_summaries` con fallbacks cuando vienen vacíos. |
| **ARCHIVAR_OK** | Sí. Botón "Archivar" visible cuando `ev.status !== "archived"`. Hace `PATCH /api/evaluations/${ev.id}/status` con `{ status: "archived" }`. Actualiza la lista local y muestra toast. Corregido uso de `ev.id` y de la variable en `setEvaluacionesList` para no archivar la fila equivocada. |
| **PERFIL_OK** | Sí. Si `GET /api/evaluations/list` devuelve `reason: "PROFILE_NOT_ONBOARDED"`, la lista viene vacía y el mensaje es "Completa tu perfil para ver evaluaciones." con botón "Completar perfil" (enlace a `/perfil`). `OnboardingBanner` ya muestra el aviso cuando `needsOnboarding === true`. Las APIs de profile usan `user_id`; no dependen de `profiles.id`. |

---

## Pedagogía aislada

- Código pedagógico **no eliminado**.
- Oculto por defecto con **`FEATURE_PEDAGOGY_UI = false`**.
- Para activar: `NEXT_PUBLIC_PEDAGOGY_FEATURES=true` o cambiar la constante a `true`.
- Quedan detrás del flag: recálculo de habilidades, exam_type, pedagogy_mode, backfill, diagnóstico de curso, botones "Ver diagnóstico" en la pestaña Cursos, y los bloques que ya usaban `PEDAGOGY_UI_ENABLED` (Backfill, "Ver resultado del recálculo", diagnóstico estudiantes).
- El botón "Diagnóstico" en la pestaña Evaluaciones sigue solo en desarrollo (`process.env.NODE_ENV === "development"`).

---

## Build

- **TypeScript:** compila correctamente tras el arreglo en `app/api/profile/onboard/route.ts`.
- **Build completo:** falla por un problema **previo** en `/login` (uso de `useSearchParams()` sin boundary Suspense en export estático). No está causado por esta restauración.
- Para comprobar solo compilación: `npx tsc --noEmit` (o ejecutar la app en modo dev y probar Ver, Archivar y perfil en navegador).

---

## Resumen

- **Ver:** Abre el detalle de la evaluación (nota, resumen, ítems, estudiantes) con fallbacks; 403 muestra mensaje de completar perfil.
- **Archivar:** Visible y funcional en la tabla de evaluaciones y en la vista por curso; PATCH a `/api/evaluations/[id]/status` y actualización de lista.
- **Perfil:** Si falta `teacher_id`, se pide completar perfil (OnboardingBanner + lista vacía con mensaje y enlace a `/perfil`).
- Pedagogía desactivada por defecto; reactivable con env o constante.

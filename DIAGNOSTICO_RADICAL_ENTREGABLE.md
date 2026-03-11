# Diagnóstico radical — Instrumentación (sin cambiar comportamiento)

## Archivos tocados

| Archivo | Cambios |
|---------|--------|
| `app/EvaluatorClient.tsx` | Estado `verDebug`, `archiveDebug`, `debugPanelOpen`. Logs en click Ver, antes/después fetch, payload/error. Log render Archivar por fila. Log click y respuesta Archivar. useEffect que rellena `archiveDebug` en pestaña Evaluaciones. Panel "Debug UI" colapsable (solo dev). |
| `app/api/evaluations/[id]/route.ts` | Logs ordenados `[API][EVAL_DETAIL]`: start, user, profile, teacher_id, evaluation found, ownership, items count, summary found, response 200. En errores, respuesta JSON con `step`, `message`, `debug` en development. |
| `app/api/profile/route.ts` | Logs `[API][PROFILE]`: user.id, no user / supabase null, profile found, teacher_id, school_id, after insert, returning fallback. |
| `app/lib/profile.ts` | Logs `[profile][lib]`: getAuthUser result, supabase null, select error, profile found, no row inserting, insert error, select after insert failed, after insert, toProfileRow null. |

---

## Logs agregados

### EvaluatorClient.tsx (solo development)

- **Ver**
  - `[UI][VER] clicked` + evaluationId
  - `[UI][VER] fetching` + url
  - `[UI][VER] response status` + res.status
  - Si `r.ok`: `[UI][VER] payload keys`, `has evaluation`, `items length`, `has summary`
  - Si falla: se guarda en estado `verDebug` (evaluationId, status, error, payload)
- **Archivar**
  - Por cada fila al renderizar: `[UI][ARCHIVE] render` + { evaluationId, status, activeTab, canShowArchive }
  - Al hacer click: `[UI][ARCHIVE] clicked` + ev.id
  - Tras PATCH: `[UI][ARCHIVE] response` + status y json; se actualiza `archiveDebug.lastClick` y `archiveDebug.lastResponse`

### app/api/evaluations/[id]/route.ts (solo development)

- `[API][EVAL_DETAIL] start` + id
- `[API][EVAL_DETAIL] user` + user?.id
- `[API][EVAL_DETAIL] profile read` + !!profile
- `[API][EVAL_DETAIL] teacher_id` + teacherId
- `[API][EVAL_DETAIL] evaluation found` + !!evaluation
- `[API][EVAL_DETAIL] ownership validated` + { isOwnerByTeacher, isOwnerByUser }
- En 403: `[API][EVAL_DETAIL] 403 forbidden`
- `[API][EVAL_DETAIL] items count`, `summary found`, `response 200`
- En errores 4xx/5xx: respuesta con `{ step, message, debug }` en development

### app/api/profile/route.ts (solo development)

- `[API][PROFILE] user.id`, no user, supabase null, profile found, teacher_id, school_id, after insert, returning fallback.

### app/lib/profile.ts (solo development)

- `[profile][lib]` getAuthUser, supabase null, select error, profile found, no row inserting, insert error, select after insert failed, after insert, toProfileRow null.

---

## Bloque debug visible en la app (solo development)

- **Panel "Debug UI"** (colapsable, arriba del contenido):
  - **A) Ver informe:** último evaluationId abierto, último status, último error, payload (o "Sin último intento de Ver").
  - **B) Archivar:** total evaluaciones, status por evaluación (id corto, status, archivar=true/false), último click, última respuesta (status + json). Si no se ha cargado la pestaña Evaluaciones: "Ir a pestaña Evaluaciones para ver datos".
  - **C) Perfil:** hasSession, profileLoaded, teacher_id, school_id, shouldShowOnboardingModal, shouldShowProfileBanner.

- El bloque `[DEV] Perfil` existente se mantiene (userId, teacher_id, school_id).

---

## Hipótesis que esta instrumentación permite comprobar

1. **Ver no muestra informe**
   - ¿Llega el click? → `[UI][VER] clicked`
   - ¿Se hace el fetch? → `[UI][VER] fetching`
   - ¿Qué status devuelve la API? → `[UI][VER] response status` y en servidor `[API][EVAL_DETAIL]`
   - ¿Falla auth? → `[API][EVAL_DETAIL] user` null o 401
   - ¿Falla ownership? → `[API][EVAL_DETAIL] ownership validated` false y 403 con `debug`
   - ¿Falta evaluation/items/summary en la respuesta? → `[UI][VER] has evaluation`, `items length`, `has summary` y panel A) Ver informe
   - En fallo: panel A) muestra evaluationId, status, error y payload.

2. **Archivar no aparece o no funciona**
   - ¿Se pinta el botón por fila? → `[UI][ARCHIVE] render` con `canShowArchive` (false si status === "archived").
   - ¿Hay filas? → panel B) total y lista de status/canShowArchive.
   - Si canShowArchive es false en todas → todas están "archived" o status raro; panel B) lo muestra.
   - Si el botón existe pero falla al archivar → `[UI][ARCHIVE] response` y panel B) última respuesta.

3. **Perfil / onboarding no se pide o no se detecta**
   - ¿Llega user en API? → `[API][PROFILE] user.id` y `[profile][lib] getAuthUser result`
   - ¿Se encuentra perfil en BD? → `[API][PROFILE] profile found`, `[profile][lib] profile found`
   - ¿teacher_id/school_id? → logs en API y lib
   - ¿Se devuelve fallback? → `[API][PROFILE] returning fallback profile`
   - En cliente: panel C) hasSession, profileLoaded, teacher_id, school_id, shouldShowOnboardingModal, shouldShowProfileBanner.

---

## Comportamiento

- No se modificó lógica funcional: solo logs, estado de diagnóstico y panel colapsable.
- Todo lo añadido está condicionado a `process.env.NODE_ENV === "development"` (o `!== "production"` en la API) para no afectar producción.

# Dónde revisar el diagnóstico — Paso a paso

## Requisito

- Ejecutar la app en **modo desarrollo**: `npm run dev`
- Abrir la app en el navegador (ej: http://localhost:3000)

---

## PASO 1 — Abrir la consola del navegador

1. En Chrome/Edge: **F12** o **Ctrl+Shift+J** (Windows) / **Cmd+Option+J** (Mac).
2. Ve a la pestaña **Console**.
3. Deja la consola abierta mientras usas la app.

Ahí verás todos los logs que empiezan por `[UI][VER]` y `[UI][ARCHIVE]`.

---

## PASO 2 — Ver el panel "Debug UI" en la pantalla

1. Con la app en desarrollo, **arriba del contenido** (debajo del banner de perfil si aparece) verás un bloque con el título **"Debug UI"** y una flecha (▶ / ▼).
2. **Haz click en "Debug UI"** para expandirlo.
3. Verás tres secciones:
   - **A) Ver informe** — último intento de abrir un informe (o "Sin último intento").
   - **B) Archivar** — total de evaluaciones, status de cada una, último click en Archivar y última respuesta del servidor.
   - **C) Perfil** — hasSession, teacher_id, school_id, si debe mostrarse el modal de completar perfil.

Si no ves "Debug UI", comprueba que estás en desarrollo (`npm run dev`) y que no estás en `NODE_ENV=production`.

---

## PASO 3 — Revisar el flujo "Ver informe"

1. Ve a la pestaña **Evaluaciones** (en la barra de pestañas de la app).
2. Espera a que cargue la lista (o comprueba si sale "Completa tu perfil" / lista vacía).
3. Haz click en el botón **"Ver"** de una evaluación.
4. **En la consola del navegador** deberías ver en este orden:
   - `[UI][VER] clicked` + id de la evaluación
   - `[UI][VER] fetching` + la URL
   - `[UI][VER] response status` + número (200, 403, 404, etc.)
   - Si la respuesta es 200: `[UI][VER] payload keys`, `has evaluation`, `items length`, `has summary`
5. **En el panel Debug UI**, sección **A) Ver informe**:
   - Si algo falló, verás el último `evaluationId`, `status`, `error` y el `payload` que devolvió la API.

Si "Ver" no hace nada o no ves el informe, con esos logs sabes si el fallo es: click que no se dispara, fetch que no se hace, status distinto de 200, o payload sin `evaluation`/`items`/`summary`.

---

## PASO 4 — Revisar el flujo "Archivar"

1. Sigue en la pestaña **Evaluaciones** con la lista cargada.
2. **En la consola** verás, por cada fila de la tabla, algo como:
   - `[UI][ARCHIVE] render` + `evaluationId`, `status`, `activeTab`, `canShowArchive` (true/false).
   - Si `canShowArchive` es **false** en todas las filas, el botón Archivar no se muestra (porque todas están archivadas o el status no es el esperado).
3. Si hay al menos una fila con **Archivar** visible (icono de carpeta), haz click en él.
4. En la consola deberías ver:
   - `[UI][ARCHIVE] clicked` + id
   - `[UI][ARCHIVE] response` + status y el JSON de respuesta.
5. **En el panel Debug UI**, sección **B) Archivar**:
   - `total evaluaciones`
   - `status por evaluación` (id corto, status, archivar=true/false)
   - `último click` y `última respuesta` (status + json) después de archivar.

Si el botón no aparece, mira en B) el `status` de cada evaluación y si `archivar` es false para todas.

---

## PASO 5 — Revisar el flujo "Perfil / onboarding"

1. **En el panel Debug UI**, sección **C) Perfil**:
   - `hasSession`: true/false (¿hay usuario logueado?).
   - `profileLoaded`: true/false (¿se cargó el perfil desde la API?).
   - `teacher_id` y `school_id`: valores o "null".
   - `shouldShowOnboardingModal`: true si la app debería mostrar el modal "Completa tu perfil".
   - `shouldShowProfileBanner`: true si debería mostrarse el banner de completar perfil.

2. **En la consola del navegador** no verás muchos logs de perfil desde el cliente (el perfil se pide al cargar la página). Los logs detallados de perfil están en el **servidor** (terminal donde corre `npm run dev`).

---

## PASO 6 — Revisar los logs del servidor (API)

1. Mira la **terminal** donde ejecutaste `npm run dev` (no el navegador).
2. Cada vez que la app llame a:
   - **GET /api/evaluations/[id]** (al hacer "Ver"), en la terminal verás:
     - `[API][EVAL_DETAIL] start` + id
     - `[API][EVAL_DETAIL] user` + user id o null
     - `[API][EVAL_DETAIL] profile read`, `teacher_id`, `evaluation found`, `ownership validated`, `items count`, `summary found`, `response 200` (o el paso donde falle).
   - **GET /api/profile** (al cargar la app o refrescar perfil), verás:
     - `[API][PROFILE] user.id`, `profile found`, `teacher_id`, `school_id`, etc.

Si "Ver" falla con 403 o 404, en esa misma terminal verás el último `[API][EVAL_DETAIL]` y si el fallo fue por user, ownership, o evaluación no encontrada.

---

## Resumen rápido

| Qué quieres revisar | Dónde mirar |
|--------------------|-------------|
| Si el click "Ver" se dispara y qué responde la API | Consola del navegador: `[UI][VER]` |
| Último error de "Ver" (status, error, payload) | Panel Debug UI → **A) Ver informe** |
| Si el botón Archivar se pinta y por qué | Consola: `[UI][ARCHIVE] render`; Panel **B) Archivar** |
| Última respuesta al archivar | Consola: `[UI][ARCHIVE] response`; Panel **B) Archivar** |
| Sesión, perfil, teacher_id, si debe pedir perfil | Panel **C) Perfil** |
| Por qué la API de detalle devuelve 403/404/500 | Terminal del servidor: `[API][EVAL_DETAIL]` |
| Por qué el perfil viene vacío o fallback | Terminal del servidor: `[API][PROFILE]` y `[profile][lib]` |

---

## Orden recomendado para diagnosticar

1. Abrir consola (F12) y panel Debug UI (expandir "Debug UI").
2. Ir a pestaña **Evaluaciones** y mirar en **B)** y en consola si hay filas y si `canShowArchive` es true en alguna.
3. Pulsar **Ver** en una fila y mirar en consola `[UI][VER]` y en **A)** el resultado.
4. Si "Ver" falla, mirar en la **terminal** del servidor los `[API][EVAL_DETAIL]` para ver en qué paso falla (user, ownership, evaluation not found, etc.).
5. Revisar **C) Perfil** para ver si el problema es sesión o perfil sin teacher_id.

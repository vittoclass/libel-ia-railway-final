# LibelIA — Configuración Supabase (Fase 1: memoria persistente)

Pasos para tener persistencia real en Supabase sin romper el flujo actual de evaluación.

---

## Parte 1 — Supabase: proyecto y SQL

### 1. Crear proyecto en Supabase

1. Entra en [supabase.com](https://supabase.com) e inicia sesión.
2. **New project**: elige organización, nombre del proyecto, contraseña de base de datos (guárdala).
3. Región: la más cercana a tus usuarios.
4. Espera a que el proyecto esté listo (unos minutos).

### 2. Ejecutar el schema SQL

1. En el dashboard del proyecto: **SQL Editor**.
2. **New query**.
3. Copia y pega todo el contenido de `supabase/schema.sql`.
4. **Run**. Debe crear las tablas: `schools`, `teachers`, `courses`, `evaluations`, `evaluation_items`, `evaluation_summaries`.

### 3. Variables de entorno

1. En el proyecto Supabase: **Settings** → **API**.
2. Anota:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** (secret) → `SUPABASE_SERVICE_ROLE_KEY` (solo servidor; no exponer en cliente).

Copia `.env.example` a `.env.local` y rellena:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

Opcional: si no quieres exponer la URL en el cliente, en servidor puedes usar además `SUPABASE_URL` (mismo valor) y el helper usará esa variable si existe.

### 4. Bucket de storage (opcional en Fase 1)

Para Fase 1 no es obligatorio. Si más adelante quieres guardar archivos (PDFs, imágenes):

1. **Storage** → **New bucket** (ej. `evaluations`).
2. Políticas: según necesites (por ahora se puede dejar restringido).

---

## Parte 2 — Probar en local

1. Instala dependencias (ya incluyen `@supabase/supabase-js`):
   ```bash
   npm install
   ```

2. Crea `.env.local` con las variables de la sección anterior.

3. Arranca el servidor:
   ```bash
   npm run dev
   ```

4. En la app:
   - Si no hay sesión (localStorage sin `libelia_teacher_id`), aparece el aviso “Para guardar el historial…”.
   - Ingresa tu nombre y pulsa **Guardar sesión**. Se crean escuela y profesor en Supabase y se guardan `teacher_id` y `school_id` en localStorage.
   - Evalúa una prueba como siempre. Si hay `teacher_id` en localStorage, la evaluación se guarda en Supabase (sin cambiar la respuesta ni el flujo).

5. Comprobar persistencia:
   - `GET /api/evaluations/by-teacher/:teacherId` (usa el `teacher_id` de localStorage).
   - Debe devolver `{ success: true, evaluations: [...] }` con las evaluaciones recientes.

---

## Parte 3 — Desplegar en Railway

1. En tu proyecto de Railway, añade las variables de entorno:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

2. No hace falta cambiar código; con estas variables el mismo build ya usa Supabase en producción.

3. (Opcional) Si prefieres no exponer la URL en el cliente, en Railway solo configura `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`; el servidor usará `SUPABASE_URL` si está definida.

---

## RLS (fase futura)

En Fase 1 las tablas no tienen Row Level Security (RLS). Para activarlo más adelante con Supabase Auth:

1. Activar RLS en cada tabla:
   ```sql
   ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
   ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
   -- ... y el resto de tablas
   ```

2. Crear políticas que restrinjan por `auth.uid()` o por `teacher_id` asociado al usuario autenticado.

Mientras RLS esté desactivado, el acceso se controla solo por el uso de la **service role** en el servidor (nunca en el cliente).

---

## Archivos tocados en Fase 1

| Archivo | Cambio |
|--------|--------|
| `supabase/schema.sql` | Nuevo: schema de tablas e índices. |
| `.env.example` | Nuevo: variables Supabase. |
| `app/lib/supabase-server.ts` | Nuevo: cliente servidor con service role. |
| `app/lib/persist-evaluation.ts` | Nuevo: inserción de evaluación + ítems + resumen. |
| `app/api/evaluate/route.ts` | Lectura de `teacher_id`, `school_id`, etc. del body; llamada a `persistEvaluation` tras construir la respuesta (sin alterar el JSON). |
| `app/api/evaluations/by-teacher/[teacherId]/route.ts` | Nuevo: GET por profesor. |
| `app/api/evaluations/by-course/[courseId]/route.ts` | Nuevo: GET por curso. |
| `app/api/session/ensure-teacher/route.ts` | Nuevo: POST para crear escuela + profesor y devolver ids. |
| `app/EvaluatorClient.tsx` | Envío de `teacher_id`/`school_id` desde localStorage en el payload de evaluación; banner de sesión y efecto para leer `libelia_teacher_id`. |

La lógica de evaluación y el JSON de respuesta del POST de evaluación no se modifican; solo se añade la persistencia opcional cuando hay `teacher_id`.

# Auth profesional LibelIA — Configuración y pruebas

## Configuración de Supabase (Google OAuth)

### 1. Activar Google en Supabase

1. En **Supabase Dashboard** → **Authentication** → **Providers**.
2. Entra en **Google** y actívalo (**Enable**).
3. Rellena **Client ID** y **Client Secret** (desde Google Cloud Console).

**IMPORTANTE:** El hostname de `NEXT_PUBLIC_SUPABASE_URL` en tu `.env.local` debe ser el **mismo proyecto** de Supabase donde habilitas Google. Si la app apunta a otro proyecto, verás "Unsupported provider: provider is not enabled".

### 2. Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/) → tu proyecto → **APIs & Services** → **Credentials**.
2. Crea o edita un **OAuth 2.0 Client ID** (tipo “Web application”).
3. **Authorized JavaScript origins** (sin path):
   - `http://localhost:3000`
   - `https://<tu-dominio-railway>.up.railway.app` (o tu URL de producción)
4. **Authorized redirect URIs** (ruta exacta del callback):
   - `http://localhost:3000/auth/callback`
   - `https://<tu-dominio-railway>.up.railway.app/auth/callback`

### 3. Redirect URLs en Supabase

En **Supabase** → **Authentication** → **URL Configuration**:

- **Site URL**: `http://localhost:3000` (dev) o `https://<railway-url>` (prod).
- **Redirect URLs** (añade): `http://localhost:3000/auth/callback` y `https://<railway-url>/auth/callback` (y opcionalmente `http://localhost:3000/**`, `https://<railway-url>/**`).

### 4. Desarrollo local (email/password)

Para no depender del correo de confirmación en desarrollo:

- **Authentication** → **Providers** → **Email** → desactiva **Confirm email** en desarrollo si lo necesitas.

### 5. Si ves "Unsupported provider" o "provider is not enabled"

- En desarrollo: en la pantalla de login aparece un mensaje y el enlace **Ver diagnóstico** (abre `GET /api/debug/auth/providers`). Comprueba que `supabaseHost` coincide con el proyecto donde habilitaste Google.
- En Supabase: **Authentication** → **Providers** → **Google** → **Enable** + Client ID/Secret.
- En `.env.local`: que `NEXT_PUBLIC_SUPABASE_URL` sea la URL de ese mismo proyecto (mismo hostname).

### 6. Consola en desarrollo (perfil)

En desarrollo, al cargar perfil verás en la consola del servidor:

- `[profile] user <id> teacher_id <id|null>` — confirma que `teacher_id` no vuelve a `null` tras completar onboarding.

---

## Checklist de pruebas manuales

1. **Redirección sin sesión**
   - Abrir `/evaluar` sin estar logueado.
   - Debe redirigir a `/login?next=/evaluar` (y opcionalmente un mensaje).

2. **Crear cuenta con email**
   - En `/login`, “Crear cuenta”, completar email y contraseña.
   - Tras registro/login correcto, debe ir a `/evaluar` (o a la URL en `next` si existe).

3. **Onboarding obligatorio**
   - Con sesión recién creada (sin perfil completado), entrar a `/evaluar`.
   - Debe aparecer el modal “Completa tu perfil” (no cerrable con Escape o clic fuera).
   - Completar: Nombre profesor, Colegio, Departamento (opcional) → “Guardar perfil”.
   - Al guardar con éxito, el modal se cierra.
   - **Refrescar F5:** el modal NO debe reaparecer.
   - **Abrir nueva pestaña `/evaluar`:** el modal NO debe reaparecer.

4. **Guardado de evaluación**
   - Con sesión y perfil completado, evaluar una prueba.
   - Debe guardarse y aparecer en la pestaña “Evaluaciones” (o listado de evaluaciones).

5. **Cerrar sesión**
   - En el header, menú del usuario → “Cerrar sesión”.
   - Debe ir a `/login` y las cookies de sesión deben limpiarse.

6. **Login con Google**
   - En `/login`, “Continuar con Google”.
   - Completar flujo en Google y volver a la app.
   - Debe terminar en `/evaluar` (o en la URL en `next`).
   - Si el perfil no tiene `teacher_id`, debe mostrarse el modal “Completa tu perfil”.
   - Tras completar onboarding, **refrescar y nueva pestaña:** comportamiento estable, sin volver a pedir perfil.

---

## Archivos tocados (resumen)

| Archivo | Cambio |
|--------|--------|
| `middleware.ts` | Redirección a `/login?next=/evaluar` cuando no hay sesión en `/evaluar`. |
| `app/login/page.tsx` | Redirect a `next` tras login; Google con `next` en callback; `?signup=1` para modo “Crear cuenta”. |
| `app/components/AuthHeader.tsx` | Dos botones “Iniciar sesión” y “Crear cuenta”; logout llama a `POST /api/auth/logout` y redirige a `/login`. |
| `app/api/auth/logout/route.ts` | **Nuevo**: cierra sesión en servidor (Supabase). |
| `app/EvaluatorClient.tsx` | Perfil en mount; modal obligatorio “Completa tu perfil”; banner “No se guardará hasta completar perfil”; eliminado uso de `localStorage` para `teacher_id`/`school_id`. |

No se ha modificado la lógica de evaluación (`/api/evaluate`, OMR, Azure, Mistral ni scoring).

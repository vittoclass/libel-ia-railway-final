-- Nota de arquitectura (idempotente):
-- La validación desde el celular NO usa el cliente Supabase anónimo: usa GET /api/docente/batch-session/public
-- en Next.js con SUPABASE_SERVICE_ROLE_KEY, que en Supabase ignora RLS.
-- No añadir política SELECT para rol `anon`: expondría lotes activos a quien tenga la anon key en el navegador.
-- El POST /api/docente/batch-session hace upsert con service role tras validar sesión y perfil del docente.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.batch_scan_sessions TO service_role;

COMMENT ON TABLE public.batch_scan_sessions IS
  'Lotes QR móvil: escritura vía API (docente autenticado; upsert con service role). Validación móvil vía API pública con service role (sin lectura anon directa).';

COMMIT;

-- =============================================================================
-- REVERSIBLE: políticas SELECT en public.evaluations para rol authenticated.
-- ROLLBACK: copiar el bloque del final de este archivo al SQL Editor y ejecutar.
--
-- Contexto LibelIA:
-- - Las API routes de Next.js usan SUPABASE_SERVICE_ROLE_KEY → bypass RLS.
-- - Este cambio solo afecta lecturas directas con el cliente Supabase usando
--   el JWT del usuario (p. ej. futuros usos en cliente o Edge).
-- - No toca OMR ni tablas de escaneo.
--
-- Riesgo: si activáis RLS y algún flujo depende del rol authenticated sin estas
-- políticas, fallará hasta añadir políticas adecuadas. La app actual no depende
-- de ello para /api/evaluations/*.
-- =============================================================================

ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evaluations_select_owner_user ON public.evaluations;
CREATE POLICY evaluations_select_owner_user ON public.evaluations
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS evaluations_select_owner_teacher ON public.evaluations;
CREATE POLICY evaluations_select_owner_teacher ON public.evaluations
  FOR SELECT
  TO authenticated
  USING (
    teacher_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.teacher_id IS NOT NULL
        AND p.teacher_id = evaluations.teacher_id
    )
  );

DROP POLICY IF EXISTS evaluations_select_same_school ON public.evaluations;
CREATE POLICY evaluations_select_same_school ON public.evaluations
  FOR SELECT
  TO authenticated
  USING (
    evaluations.school_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.school_id IS NOT NULL
        AND p.school_id = evaluations.school_id
    )
  );

-- -----------------------------------------------------------------------------
-- ROLLBACK (ejecutar manualmente si hay que revertir):
--
-- DROP POLICY IF EXISTS evaluations_select_same_school ON public.evaluations;
-- DROP POLICY IF EXISTS evaluations_select_owner_teacher ON public.evaluations;
-- DROP POLICY IF EXISTS evaluations_select_owner_user ON public.evaluations;
-- ALTER TABLE public.evaluations DISABLE ROW LEVEL SECURITY;
-- -----------------------------------------------------------------------------

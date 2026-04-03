-- Seed de prueba: asignación docente para verificar carga en /docente/estacion.
-- Curso: 8° Básico A · Asignatura: Lenguaje · Usuario: vittoclass@gmail.com
--
-- Requisitos (si no inserta ninguna fila, revisa esto en Supabase):
-- 1) El usuario debe existir en auth.users con ese correo.
-- 2) public.profiles debe tener teacher_id y school_id NOT NULL (completar perfil / onboarding en la app).
--
-- Ejecuta migraciones con: supabase db push  (o pega este SQL en el SQL Editor de Supabase).

INSERT INTO public.teacher_assignments (
  school_id,
  teacher_id,
  academic_year,
  semester,
  subject,
  course_label,
  is_active
)
SELECT
  p.school_id,
  p.teacher_id,
  EXTRACT(YEAR FROM NOW())::integer,
  'H1',
  'Lenguaje',
  '8° Básico A',
  true
FROM public.profiles p
INNER JOIN auth.users u ON u.id = p.user_id
WHERE lower(trim(u.email)) = lower(trim('vittoclass@gmail.com'))
  AND p.teacher_id IS NOT NULL
  AND p.school_id IS NOT NULL
ON CONFLICT ON CONSTRAINT teacher_assignments_unique_scope
DO UPDATE SET
  is_active = EXCLUDED.is_active,
  updated_at = now();

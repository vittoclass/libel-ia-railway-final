-- ESTANDARIZACION UUID 2026
-- Objetivo: garantizar UUID en columnas clave del flujo de evaluaciones
-- (evaluations.id, evaluation_* .evaluation_id, evaluations.source_exam_id, evaluations.batch_id)
-- y evitar errores de tipo integer/uuid en persistencia.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  col_type text;
BEGIN
  -- 1) evaluations.id -> uuid (si hoy no lo es)
  SELECT c.data_type
  INTO col_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'evaluations' AND c.column_name = 'id';

  IF col_type IS NOT NULL AND col_type <> 'uuid' THEN
    -- columna temporal UUID para id principal
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='evaluations' AND column_name='id_uuid_tmp'
    ) THEN
      ALTER TABLE public.evaluations ADD COLUMN id_uuid_tmp uuid;
    END IF;
    UPDATE public.evaluations SET id_uuid_tmp = COALESCE(id_uuid_tmp, gen_random_uuid());

    -- mapeo de FK evaluation_id en tablas hijas (solo si no son uuid)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='evaluation_items' AND column_name='evaluation_id' AND data_type <> 'uuid'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='evaluation_items' AND column_name='evaluation_id_uuid_tmp'
      ) THEN
        ALTER TABLE public.evaluation_items ADD COLUMN evaluation_id_uuid_tmp uuid;
      END IF;
      UPDATE public.evaluation_items ei
      SET evaluation_id_uuid_tmp = e.id_uuid_tmp
      FROM public.evaluations e
      WHERE ei.evaluation_id::text = e.id::text;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='evaluation_summaries' AND column_name='evaluation_id' AND data_type <> 'uuid'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='evaluation_summaries' AND column_name='evaluation_id_uuid_tmp'
      ) THEN
        ALTER TABLE public.evaluation_summaries ADD COLUMN evaluation_id_uuid_tmp uuid;
      END IF;
      UPDATE public.evaluation_summaries es
      SET evaluation_id_uuid_tmp = e.id_uuid_tmp
      FROM public.evaluations e
      WHERE es.evaluation_id::text = e.id::text;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='evaluation_skill_results' AND column_name='evaluation_id' AND data_type <> 'uuid'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='evaluation_skill_results' AND column_name='evaluation_id_uuid_tmp'
      ) THEN
        ALTER TABLE public.evaluation_skill_results ADD COLUMN evaluation_id_uuid_tmp uuid;
      END IF;
      UPDATE public.evaluation_skill_results esr
      SET evaluation_id_uuid_tmp = e.id_uuid_tmp
      FROM public.evaluations e
      WHERE esr.evaluation_id::text = e.id::text;
    END IF;

    -- eliminar FKs hacia evaluations.id antes del swap
    ALTER TABLE public.evaluation_items DROP CONSTRAINT IF EXISTS evaluation_items_evaluation_id_fkey;
    ALTER TABLE public.evaluation_summaries DROP CONSTRAINT IF EXISTS evaluation_summaries_evaluation_id_fkey;
    ALTER TABLE public.evaluation_skill_results DROP CONSTRAINT IF EXISTS evaluation_skill_results_evaluation_id_fkey;
    ALTER TABLE public.evaluation_students DROP CONSTRAINT IF EXISTS evaluation_students_evaluation_id_fkey;
    ALTER TABLE public.evaluation_source_exams DROP CONSTRAINT IF EXISTS evaluation_source_exams_evaluation_id_fkey;

    -- swap PK en evaluations
    ALTER TABLE public.evaluations DROP CONSTRAINT IF EXISTS evaluations_pkey;
    ALTER TABLE public.evaluations DROP COLUMN id;
    ALTER TABLE public.evaluations RENAME COLUMN id_uuid_tmp TO id;
    ALTER TABLE public.evaluations ALTER COLUMN id SET NOT NULL;
    ALTER TABLE public.evaluations ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE public.evaluations ADD CONSTRAINT evaluations_pkey PRIMARY KEY (id);

    -- swap FK columns hijas (si hicieron tmp)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='evaluation_items' AND column_name='evaluation_id_uuid_tmp'
    ) THEN
      ALTER TABLE public.evaluation_items DROP COLUMN evaluation_id;
      ALTER TABLE public.evaluation_items RENAME COLUMN evaluation_id_uuid_tmp TO evaluation_id;
      ALTER TABLE public.evaluation_items ALTER COLUMN evaluation_id SET NOT NULL;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='evaluation_summaries' AND column_name='evaluation_id_uuid_tmp'
    ) THEN
      ALTER TABLE public.evaluation_summaries DROP COLUMN evaluation_id;
      ALTER TABLE public.evaluation_summaries RENAME COLUMN evaluation_id_uuid_tmp TO evaluation_id;
      ALTER TABLE public.evaluation_summaries ALTER COLUMN evaluation_id SET NOT NULL;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='evaluation_skill_results' AND column_name='evaluation_id_uuid_tmp'
    ) THEN
      ALTER TABLE public.evaluation_skill_results DROP COLUMN evaluation_id;
      ALTER TABLE public.evaluation_skill_results RENAME COLUMN evaluation_id_uuid_tmp TO evaluation_id;
      ALTER TABLE public.evaluation_skill_results ALTER COLUMN evaluation_id SET NOT NULL;
    END IF;

    -- recrear FKs críticas
    ALTER TABLE public.evaluation_items
      ADD CONSTRAINT evaluation_items_evaluation_id_fkey
      FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON DELETE CASCADE;
    ALTER TABLE public.evaluation_summaries
      ADD CONSTRAINT evaluation_summaries_evaluation_id_fkey
      FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON DELETE CASCADE;
    ALTER TABLE public.evaluation_skill_results
      ADD CONSTRAINT evaluation_skill_results_evaluation_id_fkey
      FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON DELETE CASCADE;
    ALTER TABLE public.evaluation_students
      ADD CONSTRAINT evaluation_students_evaluation_id_fkey
      FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON DELETE CASCADE;
    ALTER TABLE public.evaluation_source_exams
      ADD CONSTRAINT evaluation_source_exams_evaluation_id_fkey
      FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2) En tablas involucradas, normalizar columnas id a uuid cuando no lo sean.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema='public'
      AND t.table_type='BASE TABLE'
      AND c.column_name='id'
      AND c.data_type <> 'uuid'
      AND c.table_name IN ('evaluation_items','evaluation_summaries','evaluation_skill_results')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS id_uuid_tmp uuid;', r.table_name);
    EXECUTE format('UPDATE public.%I SET id_uuid_tmp = COALESCE(id_uuid_tmp, gen_random_uuid());', r.table_name);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I_pkey;', r.table_name, r.table_name);
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN id;', r.table_name);
    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN id_uuid_tmp TO id;', r.table_name);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET NOT NULL;', r.table_name);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid();', r.table_name);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I_pkey PRIMARY KEY (id);', r.table_name, r.table_name);
  END LOOP;
END $$;

-- 3) evaluations.source_exam_id y evaluations.batch_id -> uuid si aún no lo son.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='evaluations' AND column_name='source_exam_id' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE public.evaluations ADD COLUMN IF NOT EXISTS source_exam_id_uuid_tmp uuid;
    UPDATE public.evaluations
    SET source_exam_id_uuid_tmp = CASE
      WHEN source_exam_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN source_exam_id::text::uuid
      ELSE NULL
    END;
    ALTER TABLE public.evaluations DROP COLUMN source_exam_id;
    ALTER TABLE public.evaluations RENAME COLUMN source_exam_id_uuid_tmp TO source_exam_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='evaluations' AND column_name='batch_id' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE public.evaluations ADD COLUMN IF NOT EXISTS batch_id_uuid_tmp uuid;
    UPDATE public.evaluations
    SET batch_id_uuid_tmp = CASE
      WHEN batch_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN batch_id::text::uuid
      ELSE NULL
    END;
    ALTER TABLE public.evaluations DROP COLUMN batch_id;
    ALTER TABLE public.evaluations RENAME COLUMN batch_id_uuid_tmp TO batch_id;
  END IF;
END $$;

-- 4) Reafirmar FK de source_exam_id por si quedó sin constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='evaluations' AND constraint_name='evaluations_source_exam_id_fkey'
  ) THEN
    ALTER TABLE public.evaluations
      ADD CONSTRAINT evaluations_source_exam_id_fkey
      FOREIGN KEY (source_exam_id) REFERENCES public.source_exams(id) ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

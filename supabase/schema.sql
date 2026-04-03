-- LibelIA Fase 1: Memoria persistente en Supabase
-- Ejecutar en SQL Editor del proyecto Supabase

-- Escuelas
CREATE TABLE IF NOT EXISTS schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  created_at timestamptz DEFAULT now()
);

-- Profesores (por escuela)
CREATE TABLE IF NOT EXISTS teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teachers_school_id ON teachers(school_id);

-- Cursos (opcional para Fase 1)
CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE,
  level text,
  letter text,
  year integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courses_school_id ON courses(school_id);
CREATE INDEX IF NOT EXISTS idx_courses_teacher_id ON courses(teacher_id);

-- Evaluaciones (una por estudiante/prueba evaluada)
CREATE TABLE IF NOT EXISTS evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id uuid REFERENCES teachers(id) ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
  title text,
  subject text,
  evaluated_at timestamptz,
  assessment_category text,
  batch_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluations_school_id ON evaluations(school_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_teacher_id ON evaluations(teacher_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_course_id ON evaluations(course_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_evaluated_at ON evaluations(evaluated_at);

-- Ítems por evaluación (cada pregunta/alternativa/desarrollo)
CREATE TABLE IF NOT EXISTS evaluation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid REFERENCES evaluations(id) ON DELETE CASCADE,
  question_number integer NOT NULL,
  student_answer text,
  correct_answer text,
  is_correct boolean,
  score_obtained numeric DEFAULT 0,
  score_max numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_items_evaluation_id ON evaluation_items(evaluation_id);

-- Resumen por evaluación (nota, fortalezas, mejoras, raw)
CREATE TABLE IF NOT EXISTS evaluation_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid REFERENCES evaluations(id) ON DELETE CASCADE,
  grade_chile numeric,
  student_name_raw text,
  strengths text,
  improvements text,
  raw jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_summaries_evaluation_id ON evaluation_summaries(evaluation_id);

-- RLS: desactivado en Fase 1. Para activar en fase futura con Supabase Auth:
-- ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE evaluation_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE evaluation_summaries ENABLE ROW LEVEL SECURITY;
-- (luego crear políticas por auth.uid() / teacher_id, etc.)

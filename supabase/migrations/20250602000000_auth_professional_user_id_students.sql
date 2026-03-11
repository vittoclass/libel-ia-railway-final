-- Auth profesional + guardado consistente: user_id, índices, evaluation_students
-- Idempotente. No elimina columnas ni datos.

-- evaluations: user_id para escalabilidad (nullable para filas antiguas)
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft';
COMMENT ON COLUMN evaluations.status IS 'draft | final | archived';

-- Índices para listado y filtros
CREATE INDEX IF NOT EXISTS evaluations_user_status_idx ON evaluations(user_id, status, evaluated_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS evaluations_teacher_status_idx ON evaluations(teacher_id, status, evaluated_at DESC NULLS LAST);

-- evaluation_students: por estudiante por evaluación (para SIMCE/PAES y export)
CREATE TABLE IF NOT EXISTS evaluation_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  student_name text,
  student_identifier text,
  course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
  raw_name_source text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evaluation_students_evaluation_id ON evaluation_students(evaluation_id);

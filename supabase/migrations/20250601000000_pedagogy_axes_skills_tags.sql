-- Pedagogía: Ejes/Habilidades (SIMCE/PAES) + etiquetado de preguntas
-- No modifica tablas existentes. Solo crea nuevas.

-- Ejes por asignatura (ej: Comprensión lectora en Lenguaje)
CREATE TABLE IF NOT EXISTS pedagogy_axes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(subject, name)
);

CREATE INDEX IF NOT EXISTS idx_pedagogy_axes_subject ON pedagogy_axes(subject);

-- Habilidades por eje (ej: Localizar información, Inferir información)
CREATE TABLE IF NOT EXISTS pedagogy_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  axis_id uuid NOT NULL REFERENCES pedagogy_axes(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(axis_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pedagogy_skills_axis_id ON pedagogy_skills(axis_id);

-- Etiquetas por pregunta de una evaluación (opcional: axis_id y skill_id pueden ser null)
CREATE TABLE IF NOT EXISTS evaluation_question_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  question_number int NOT NULL,
  axis_id uuid REFERENCES pedagogy_axes(id) ON DELETE SET NULL,
  skill_id uuid REFERENCES pedagogy_skills(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(evaluation_id, question_number)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_question_tags_evaluation_id ON evaluation_question_tags(evaluation_id);

-- Trigger updated_at para evaluation_question_tags
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS evaluation_question_tags_updated_at ON evaluation_question_tags;
CREATE TRIGGER evaluation_question_tags_updated_at
  BEFORE UPDATE ON evaluation_question_tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed mínimo DEV: Lenguaje - Comprensión lectora + 2 habilidades
-- Idempotente: solo inserta si no existen (por subject+name / axis+name).
INSERT INTO pedagogy_axes (id, subject, name)
SELECT gen_random_uuid(), 'Lenguaje', 'Comprensión lectora'
WHERE NOT EXISTS (SELECT 1 FROM pedagogy_axes WHERE subject = 'Lenguaje' AND name = 'Comprensión lectora');

INSERT INTO pedagogy_skills (axis_id, name)
SELECT a.id, 'Localizar información'
FROM pedagogy_axes a
WHERE a.subject = 'Lenguaje' AND a.name = 'Comprensión lectora'
  AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Localizar información');

INSERT INTO pedagogy_skills (axis_id, name)
SELECT a.id, 'Inferir información'
FROM pedagogy_axes a
WHERE a.subject = 'Lenguaje' AND a.name = 'Comprensión lectora'
  AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Inferir información');

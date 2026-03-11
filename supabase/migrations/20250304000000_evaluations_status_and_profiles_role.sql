-- Sistema de borrador + publicación de evaluaciones
-- Valores status: draft | final | archived

ALTER TABLE evaluations
ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft';

-- Rol en perfil para control de eliminación (solo admin puede eliminar)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS role text DEFAULT 'teacher';

COMMENT ON COLUMN evaluations.status IS 'draft=borrador, final=publicada, archived=archivada';
COMMENT ON COLUMN profiles.role IS 'teacher=profesor, admin=administrador (puede eliminar evaluaciones)';

-- Proteção adicional para aplicar a um projeto GestorMobile já existente.
-- Cada utilizador autenticado só pode ler o próprio perfil.
-- Administradores podem consultar e gerir todos os perfis.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles são visíveis para utilizadores autenticados"
ON public.profiles;

CREATE POLICY "Profiles são visíveis para utilizadores autenticados"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = (SELECT auth.uid())
  OR (SELECT private.is_admin())
);

REVOKE ALL ON FUNCTION public.handle_new_user()
FROM PUBLIC, anon, authenticated;

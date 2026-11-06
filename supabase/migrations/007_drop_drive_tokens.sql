-- 007_drop_drive_tokens.sql
-- L'archiviazione dei documenti passa a Supabase Storage: l'integrazione Google Drive
-- (e i relativi token OAuth) non è più necessaria.

drop table if exists public.drive_tokens;

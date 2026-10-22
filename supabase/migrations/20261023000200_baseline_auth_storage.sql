-- REVIEW DRAFT ONLY. Not executed or approved for deployment.
-- Target: an initialized, isolated Supabase PostgreSQL 17 environment.
-- Read docs/database-baseline-review.md before any future application.
-- Supabase CLI owns the per-file transaction and migration-history recording.
-- Do not add outer BEGIN/COMMIT or run this file with autocommit.
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Prerequisites: baseline_public; Supabase-managed auth/storage tables and helpers.
-- Only application customizations are added; managed schemas/tables are not recreated.
-- Supabase's Creating Buckets guide explicitly supports SQL bucket provisioning.
-- Keep this limited to the reviewed bucket configuration; do not edit object rows.
-- This is bucket configuration only, not uploaded object metadata.
-- User verified in Supabase SQL Editor: exactly 5242880 bytes (5 MiB).
-- Bucket is private and accepts JPEG/PNG only. No files are embedded.
-- Existing conflicting settings abort instead of being silently overwritten.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-photos', 'profile-photos', false, 5242880,
        ARRAY['image/jpeg', 'image/png']::text[])
ON CONFLICT (id) DO NOTHING;

DO $bms_bucket_check$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets AS bucket
        WHERE bucket.id = 'profile-photos'
          AND bucket.name = 'profile-photos'
          AND bucket.public IS FALSE
          AND bucket.file_size_limit = 5242880
          AND bucket.allowed_mime_types IS NOT NULL
          AND bucket.allowed_mime_types @> ARRAY['image/jpeg', 'image/png']::text[]
          AND bucket.allowed_mime_types <@ ARRAY['image/jpeg', 'image/png']::text[]
    ) THEN
        RAISE EXCEPTION 'Existing profile-photos bucket differs from the reviewed configuration';
    END IF;
END;
$bms_bucket_check$;

-- Qualified function name and explicit terminator are migration adaptations.
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- A newly created trigger has ordinary enabled state; do not ALTER a managed table
-- just to repeat that default. Check the result without changing managed ownership.
DO $bms_auth_trigger_check$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger AS trigger_entry
        WHERE trigger_entry.tgrelid = pg_catalog.to_regclass('auth.users')
          AND trigger_entry.tgname = 'on_auth_user_created'
          AND trigger_entry.tgfoid = pg_catalog.to_regprocedure('public.handle_new_user()')
          AND trigger_entry.tgenabled = 'O'
          AND trigger_entry.tgisinternal IS FALSE
    ) THEN
        RAISE EXCEPTION 'BMS auth trigger is missing or not ordinarily enabled';
    END IF;
END;
$bms_auth_trigger_check$;

-- Exact three exported policy definitions follow. No DELETE access is added.
CREATE POLICY "Users can update own profile photo" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))) WITH CHECK (((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))));

CREATE POLICY "Users can upload own profile photo" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))));

CREATE POLICY "Users can view own profile photo" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))));

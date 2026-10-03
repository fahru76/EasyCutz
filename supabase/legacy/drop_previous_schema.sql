-- Removes the previous (empty) schema found in the Supabase project on 2026-10-03.
-- Backup of everything removed here: supabase/legacy/previous_schema_2026-10-03.sql
-- Non-cascading on purpose: it fails instead of silently removing anything unexpected.
drop function if exists public.cancel_appointment(uuid, text);
drop function if exists public.create_appointment(uuid, uuid, timestamptz, text, text, text, uuid);
drop function if exists public.list_available_slots(uuid, uuid, timestamptz, timestamptz);
drop function if exists public.list_services();
drop function if exists public.list_staff();
drop table if exists public.appointments;
drop table if exists public.queue;
drop table if exists public.seats;
drop table if exists public.services;
drop table if exists public.shop_settings;
drop table if exists public.staff;
drop type if exists public.appointment_status;
drop type if exists public.queue_status;

-- =============================================================================
-- EasyCutz — EZ-009 owner admin: services, add-ons, fees & rules
--
-- * Only staff with role = 'owner' may change the catalog or shop settings.
-- * Every change is written to catalog_changes (who / when / before / after).
-- * Services and add-ons are never hard-deleted (bookings reference them);
--   deactivating hides them from the menu and from price_cart().
-- * Bookings snapshot price + duration at booking time, so edits never change
--   existing bookings.
-- =============================================================================

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.assert_owner()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception using message = 'forbidden', errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.catalog_changes (
  id          uuid primary key default gen_random_uuid(),
  changed_by  uuid references auth.users(id) on delete set null,
  changed_at  timestamptz not null default now(),
  table_name  text not null check (table_name in ('services', 'addons', 'shop_settings')),
  row_id      text not null,
  action      text not null check (action in ('create', 'update', 'activate', 'deactivate', 'reorder')),
  before      jsonb,
  after       jsonb
);
create index catalog_changes_changed_at_idx on public.catalog_changes (changed_at desc);

alter table public.catalog_changes enable row level security;
create policy "owner reads catalog changes" on public.catalog_changes
  for select to authenticated using (public.is_owner());
revoke insert, update, delete, truncate on public.catalog_changes from anon, authenticated;
grant select on public.catalog_changes to authenticated;
revoke select on public.catalog_changes from anon;

create or replace function public.log_catalog_change(
  p_table text, p_row_id text, p_action text, p_before jsonb, p_after jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.catalog_changes (changed_by, table_name, row_id, action, before, after)
  values (auth.uid(), p_table, p_row_id, p_action, p_before, p_after);
$$;

-- "Skin Fade (Long)" -> "skin-fade-long"
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_service(
  p_id           uuid,
  p_name         text,
  p_description  text,
  p_category     public.service_category,
  p_duration_min integer,
  p_price_cents  integer,
  p_is_popular   boolean,
  p_is_active    boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.services;
  v_after  public.services;
  v_slug   text;
begin
  perform public.assert_owner();
  if coalesce(btrim(p_name), '') = '' or length(p_name) > 80 then
    raise exception using message = 'invalid_value', errcode = 'P0001', detail = 'name';
  end if;

  begin
    if p_id is null then
      v_slug := public.slugify(p_name);
      if v_slug = '' then
        raise exception using message = 'invalid_value', errcode = 'P0001', detail = 'name';
      end if;
      if exists (select 1 from public.services where slug = v_slug) then
        v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
      end if;
      insert into public.services (slug, name, description, category, duration_min, price_cents, is_popular, is_active, sort_order)
      values (v_slug, btrim(p_name), coalesce(btrim(p_description), ''), p_category, p_duration_min, p_price_cents,
              coalesce(p_is_popular, false), coalesce(p_is_active, true),
              coalesce((select max(sort_order) from public.services where category = p_category), 0) + 10)
      returning * into v_after;
      perform public.log_catalog_change('services', v_after.id::text, 'create', null, to_jsonb(v_after));
    else
      select * into v_before from public.services where id = p_id for update;
      if v_before.id is null then
        raise exception using message = 'not_found', errcode = 'P0001';
      end if;
      update public.services
         set name = btrim(p_name), description = coalesce(btrim(p_description), ''), category = p_category,
             duration_min = p_duration_min, price_cents = p_price_cents,
             is_popular = coalesce(p_is_popular, is_popular), is_active = coalesce(p_is_active, is_active)
       where id = p_id
      returning * into v_after;
      perform public.log_catalog_change(
        'services', p_id::text,
        case when v_before.is_active and not v_after.is_active then 'deactivate'
             when not v_before.is_active and v_after.is_active then 'activate'
             else 'update' end,
        to_jsonb(v_before), to_jsonb(v_after));
    end if;
  exception
    when check_violation or not_null_violation then
      raise exception using message = 'invalid_value', errcode = 'P0001';
  end;

  return v_after.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Add-ons
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_addon(
  p_id           uuid,
  p_name         text,
  p_description  text,
  p_duration_min integer,
  p_price_cents  integer,
  p_is_active    boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.addons;
  v_after  public.addons;
  v_slug   text;
begin
  perform public.assert_owner();
  if coalesce(btrim(p_name), '') = '' or length(p_name) > 80 then
    raise exception using message = 'invalid_value', errcode = 'P0001', detail = 'name';
  end if;

  begin
    if p_id is null then
      v_slug := public.slugify(p_name);
      if v_slug = '' then
        raise exception using message = 'invalid_value', errcode = 'P0001', detail = 'name';
      end if;
      if exists (select 1 from public.addons where slug = v_slug) then
        v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
      end if;
      insert into public.addons (slug, name, description, duration_min, price_cents, is_active, sort_order)
      values (v_slug, btrim(p_name), coalesce(btrim(p_description), ''), p_duration_min, p_price_cents,
              coalesce(p_is_active, true), coalesce((select max(sort_order) from public.addons), 0) + 10)
      returning * into v_after;
      perform public.log_catalog_change('addons', v_after.id::text, 'create', null, to_jsonb(v_after));
    else
      select * into v_before from public.addons where id = p_id for update;
      if v_before.id is null then
        raise exception using message = 'not_found', errcode = 'P0001';
      end if;
      update public.addons
         set name = btrim(p_name), description = coalesce(btrim(p_description), ''),
             duration_min = p_duration_min, price_cents = p_price_cents, is_active = coalesce(p_is_active, is_active)
       where id = p_id
      returning * into v_after;
      perform public.log_catalog_change(
        'addons', p_id::text,
        case when v_before.is_active and not v_after.is_active then 'deactivate'
             when not v_before.is_active and v_after.is_active then 'activate'
             else 'update' end,
        to_jsonb(v_before), to_jsonb(v_after));
    end if;
  exception
    when check_violation or not_null_violation then
      raise exception using message = 'invalid_value', errcode = 'P0001';
  end;

  return v_after.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reorder (services within the order given, or add-ons)
-- ---------------------------------------------------------------------------
create or replace function public.admin_reorder(p_table text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_i integer;
begin
  perform public.assert_owner();
  if p_table not in ('services', 'addons') then
    raise exception using message = 'invalid_action', errcode = 'P0001';
  end if;
  for v_i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    if p_table = 'services' then
      update public.services set sort_order = v_i * 10 where id = p_ids[v_i];
    else
      update public.addons set sort_order = v_i * 10 where id = p_ids[v_i];
    end if;
  end loop;
  perform public.log_catalog_change(p_table, 'many', 'reorder', null, to_jsonb(p_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- Fees & rules (shop_settings). Only the listed keys are editable.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_settings(p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before  public.shop_settings;
  v_after   public.shop_settings;
  v_allowed text[] := array[
    'shop_name', 'shop_phone', 'shop_address',
    'deposit_percent', 'min_deposit_cents', 'hold_minutes',
    'booking_horizon_days', 'min_lead_min', 'slot_interval_min',
    'notify_lead_min', 'delay_notify_min', 'early_offer_min'
  ];
  v_key text;
begin
  perform public.assert_owner();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using message = 'invalid_value', errcode = 'P0001';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not v_key = any(v_allowed) then
      raise exception using message = 'invalid_value', errcode = 'P0001', detail = v_key;
    end if;
  end loop;

  select * into v_before from public.shop_settings where id = 1 for update;

  begin
    update public.shop_settings s set
      shop_name            = coalesce(nullif(btrim(p_patch->>'shop_name'), ''), s.shop_name),
      shop_phone           = case when p_patch ? 'shop_phone' then nullif(btrim(p_patch->>'shop_phone'), '') else s.shop_phone end,
      shop_address         = case when p_patch ? 'shop_address' then nullif(btrim(p_patch->>'shop_address'), '') else s.shop_address end,
      deposit_percent      = coalesce((p_patch->>'deposit_percent')::integer, s.deposit_percent),
      min_deposit_cents    = coalesce((p_patch->>'min_deposit_cents')::integer, s.min_deposit_cents),
      hold_minutes         = coalesce((p_patch->>'hold_minutes')::integer, s.hold_minutes),
      booking_horizon_days = coalesce((p_patch->>'booking_horizon_days')::integer, s.booking_horizon_days),
      min_lead_min         = coalesce((p_patch->>'min_lead_min')::integer, s.min_lead_min),
      slot_interval_min    = coalesce((p_patch->>'slot_interval_min')::integer, s.slot_interval_min),
      notify_lead_min      = coalesce((p_patch->>'notify_lead_min')::integer, s.notify_lead_min),
      delay_notify_min     = coalesce((p_patch->>'delay_notify_min')::integer, s.delay_notify_min),
      early_offer_min      = coalesce((p_patch->>'early_offer_min')::integer, s.early_offer_min)
     where id = 1
    returning * into v_after;
  exception
    when check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception using message = 'invalid_value', errcode = 'P0001';
  end;

  if v_after.slot_interval_min not in (5, 10, 15, 20, 30, 60) then
    raise exception using message = 'invalid_value', errcode = 'P0001', detail = 'slot_interval_min';
  end if;

  perform public.log_catalog_change('shop_settings', '1', 'update', to_jsonb(v_before), to_jsonb(v_after));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges + realtime (menu changes reach open booking pages live)
-- ---------------------------------------------------------------------------
revoke execute on function public.is_owner() from public;
revoke execute on function public.assert_owner() from public, anon;
revoke execute on function public.log_catalog_change(text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_save_service(uuid, text, text, public.service_category, integer, integer, boolean, boolean) from public, anon;
revoke execute on function public.admin_save_addon(uuid, text, text, integer, integer, boolean) from public, anon;
revoke execute on function public.admin_reorder(text, uuid[]) from public, anon;
revoke execute on function public.admin_update_settings(jsonb) from public, anon;

grant execute on function public.is_owner() to anon, authenticated, service_role;
grant execute on function public.assert_owner() to authenticated, service_role;
grant execute on function public.slugify(text) to authenticated, service_role;
grant execute on function public.admin_save_service(uuid, text, text, public.service_category, integer, integer, boolean, boolean) to authenticated;
grant execute on function public.admin_save_addon(uuid, text, text, integer, integer, boolean) to authenticated;
grant execute on function public.admin_reorder(text, uuid[]) to authenticated;
grant execute on function public.admin_update_settings(jsonb) to authenticated;

alter publication supabase_realtime add table public.services;
alter publication supabase_realtime add table public.addons;
alter publication supabase_realtime add table public.shop_settings;

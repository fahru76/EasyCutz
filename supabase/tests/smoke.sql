-- =============================================================================
-- EasyCutz — database smoke tests (run via supabase/tests/run-local.sh)
-- Every block raises on failure; the script stops at the first error.
-- =============================================================================
\set ON_ERROR_STOP on

-- Helper: expect an exception with a given message.
create or replace function pg_temp.expect_error(p_sql text, p_message text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error "%" but statement succeeded: %', p_message, p_sql;
exception when others then
  if sqlerrm <> p_message then
    raise exception 'expected error "%" but got "%" for: %', p_message, sqlerrm, p_sql;
  end if;
end;
$$;

-- Next Tuesday 14:00 shop-local (always open in the seed roster).
create or replace function pg_temp.next_tuesday_at(p_hhmm text)
returns timestamptz language sql as $$
  select ((public.shop_today()
           + coalesce(nullif((9 - extract(dow from public.shop_today())::int) % 7, 0), 7))::text
          || ' ' || p_hhmm)::timestamp at time zone public.shop_tz();
$$;

\echo '--- pricing'
do $$
declare r record; v_ids uuid[];
begin
  select array_agg(id order by slug) into v_ids from services where slug in ('signature-cut', 'beard-sculpt');
  select * into r from price_cart(v_ids, array(select id from addons where slug = 'hot-towel'));
  assert r.o_duration_min = 70, format('duration %s', r.o_duration_min);
  assert r.o_price_cents = 7800, format('price %s', r.o_price_cents);
  assert amount_due_now(7800, 'deposit') = 1560, 'deposit 20%';
  assert amount_due_now(4000, 'deposit') = 1000, 'min deposit floor';
  assert amount_due_now(7800, 'full') = 7800, 'full';
  assert amount_due_now(7800, 'cash_on_site') = 0, 'cash';
  assert make_display_name('  ahmad   rizal bin ali ') = 'ahmad A.', make_display_name('  ahmad   rizal bin ali ');
end $$;
select pg_temp.expect_error($$select price_cart('{}'::uuid[], '{}'::uuid[])$$, 'empty_cart');
select pg_temp.expect_error($$select price_cart(array[gen_random_uuid()], '{}'::uuid[])$$, 'unknown_service');

\echo '--- walk-in tickets'
do $$
declare v jsonb; v2 jsonb; v_cut uuid; v_bryan uuid;
begin
  select id into v_cut from services where slug = 'signature-cut';
  select id into v_bryan from barbers where slug = 'bryan';
  v := issue_queue_ticket(null, array[v_cut], '{}', 'Ali Hassan', '+60111111111', null, 'cash_on_site');
  assert v->>'code' = 'W-1', v::text;
  v2 := issue_queue_ticket(v_bryan, array[v_cut], '{}', 'Ben Tan', '+60122222222', 'ben@example.com', 'full');
  assert v2->>'code' = 'B-2', v2::text;
  assert (v2->>'amount_due_now_cents')::int = 4500, v2::text;
  assert (select display_name from queue_tickets where id = (v->>'id')::uuid) = 'Ali H.';
end $$;
select pg_temp.expect_error(
  $$select issue_queue_ticket(null, array[(select id from services where slug='buzz-cut')], '{}', 'Ali', '+60111111111', null, 'cash_on_site')$$,
  'already_in_queue');
select pg_temp.expect_error(
  $$select issue_queue_ticket((select id from barbers where slug='danial'), array[(select id from services where slug='buzz-cut')], '{}', 'Zed', '+60199999999', null, 'cash_on_site')$$,
  'barber_unavailable');

\echo '--- appointments'
do $$
declare v jsonb; v2 jsonb; v3 jsonb; v_cut uuid; v_aiman uuid; v_start timestamptz;
begin
  select id into v_cut from services where slug = 'skin-fade';
  select id into v_aiman from barbers where slug = 'aiman';
  v_start := pg_temp.next_tuesday_at('14:00');
  v := book_appointment(v_aiman, v_start, array[v_cut], '{}', 'Chris Lee', '+60133333333', null, 'cash_on_site');
  assert v->>'status' = 'confirmed', v::text;
  assert (v->>'ends_at')::timestamptz = v_start + interval '45 minutes', v::text;
  -- "first available" at the same instant must land on another chair
  v2 := book_appointment(null, v_start, array[v_cut], '{}', 'Dan Wong', '+60144444444', null, 'deposit');
  assert (v2->>'barber_id')::uuid <> v_aiman, v2::text;
  assert v2->>'status' = 'pending_payment', v2::text;
  -- back-to-back is fine ('[)' ranges)
  v3 := book_appointment(v_aiman, v_start + interval '45 minutes', array[v_cut], '{}', 'Eve Lim', '+60155555555', null, 'cash_on_site');
  assert v3->>'status' = 'confirmed';
end $$;
select pg_temp.expect_error(
  $$select book_appointment((select id from barbers where slug='aiman'), pg_temp.next_tuesday_at('14:15'),
     array[(select id from services where slug='buzz-cut')], '{}', 'Fay', '+60166666666', null, 'cash_on_site')$$,
  'slot_unavailable');
select pg_temp.expect_error(
  $$select book_appointment((select id from barbers where slug='aiman'), pg_temp.next_tuesday_at('14:10'),
     array[(select id from services where slug='buzz-cut')], '{}', 'Fay', '+60166666666', null, 'cash_on_site')$$,
  'misaligned_slot');
select pg_temp.expect_error(
  $$select book_appointment((select id from barbers where slug='aiman'), pg_temp.next_tuesday_at('18:45'),
     array[(select id from services where slug='skin-fade')], '{}', 'Fay', '+60166666666', null, 'cash_on_site')$$,
  'slot_unavailable'); -- runs past Aiman's 19:00 shift end
select pg_temp.expect_error(
  $$select book_appointment(null, now() - interval '1 hour', array[(select id from services where slug='buzz-cut')], '{}', 'Fay', '+60166666666', null, 'cash_on_site')$$,
  'slot_in_past');

\echo '--- payments'
do $$
declare v_appt uuid; v_res jsonb;
begin
  select id into v_appt from appointments where status = 'pending_payment' limit 1;
  insert into payments (kind, appointment_id, stripe_checkout_session_id, amount_cents, currency)
  values ('appointment', v_appt, 'cs_test_smoke_1', 1000, 'myr');
  v_res := apply_checkout_result('cs_test_smoke_1', true, 'pi_test_1');
  assert v_res->>'outcome' = 'ok', v_res::text;
  assert (select status from appointments where id = v_appt) = 'confirmed';
  assert (select payment_status from appointments where id = v_appt) = 'paid';
  v_res := apply_checkout_result('cs_test_smoke_1', true, 'pi_test_1');
  assert v_res->>'outcome' = 'already_paid', 'idempotent';
end $$;

\echo '--- holds expire'
do $$
declare v jsonb;
begin
  v := book_appointment(null, pg_temp.next_tuesday_at('16:00'), array[(select id from services where slug='buzz-cut')], '{}',
                        'Gus', '+60177777777', null, 'full');
  update appointments set hold_expires_at = now() - interval '1 minute' where id = (v->>'id')::uuid;
  assert expire_stale_holds() = 1;
  assert (select status from appointments where id = (v->>'id')::uuid) = 'expired';
end $$;

\echo '--- privileges: anon'
set role anon;
do $$
begin
  perform 1 from queue_tickets;      -- allowed
  perform 1 from appointments;       -- allowed
  begin
    perform 1 from booking_private;
    raise exception 'anon could read booking_private';
  exception when insufficient_privilege then null;
  end;
  begin
    perform issue_queue_ticket(null, '{}', '{}', 'x', '+60100000000', null, 'cash_on_site');
    raise exception 'anon could issue tickets directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update queue_tickets set status = 'completed';
    raise exception 'anon could update tickets';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo '--- desk flow'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'host@example.com') on conflict do nothing;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000bb', 'rando@example.com') on conflict do nothing;
insert into staff (user_id, role, display_name) values ('00000000-0000-0000-0000-0000000000aa', 'host', 'Front Desk') on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', false);
select pg_temp.expect_error($$select desk_call_next((select id from barbers where slug='aiman'))$$, 'forbidden');
do $$
begin
  perform 1 from booking_private;
  assert (select count(*) from booking_private) = 0, 'non-staff sees no contacts';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
do $$
declare v jsonb; v_aiman uuid; v_bryan uuid;
begin
  assert is_staff(), 'host is staff';
  assert (select count(*) from booking_private) > 0, 'staff sees contacts';
  select id into v_aiman from barbers where slug = 'aiman';
  select id into v_bryan from barbers where slug = 'bryan';

  -- Aiman: W-1 is "first available" -> called for Aiman
  v := desk_call_next(v_aiman);
  assert v->>'label' = 'W-1', v::text;
  perform desk_transition('ticket', (v->>'id')::uuid, 'seat');
  assert (select status from queue_tickets where id = (v->>'id')::uuid) = 'in_chair';

  -- Bryan: next eligible is B-2
  v := desk_call_next(v_bryan);
  assert v->>'label' = 'B-2', v::text;

  -- Aiman's chair is busy, seating B-2 there must fail
  begin
    perform desk_transition('ticket', (v->>'id')::uuid, 'seat', v_aiman);
    raise exception 'expected chair_busy';
  exception when others then
    assert sqlerrm = 'chair_busy', sqlerrm;
  end;

  perform desk_transition('ticket', (v->>'id')::uuid, 'no_show');
  assert (select status from queue_tickets where id = (v->>'id')::uuid) = 'no_show';

  perform desk_transition('ticket', (select id from queue_tickets where code = 'W-1' and shop_day = shop_today()), 'complete');
  assert (select status from queue_tickets where code = 'W-1' and shop_day = shop_today()) = 'completed';

  -- Nothing left to call
  assert desk_call_next(v_bryan) is null, 'queue empty';

  perform desk_set_duty((select id from barbers where slug = 'danial'), true);
  assert (select is_on_duty from barbers where slug = 'danial');
end $$;

-- Check-in via pass token
do $$
declare v jsonb; v_token uuid;
begin
  select bp.access_token into v_token
    from booking_private bp join appointments a on a.id = bp.appointment_id
   where a.status = 'confirmed' limit 1;
  v := desk_check_in(v_token);
  assert v->>'kind' = 'appointment', v::text;
  assert (select status from appointments a join booking_private bp on bp.appointment_id = a.id where bp.access_token = v_token) = 'checked_in';
end $$;
reset role;

\echo '--- customer cancel'
do $$
declare v jsonb; v_token uuid;
begin
  v := issue_queue_ticket(null, array[(select id from services where slug = 'buzz-cut')], '{}', 'Hana', '+60188888888', null, 'cash_on_site');
  v_token := (v->>'access_token')::uuid;
  perform cancel_booking(v_token);
  assert (select status from queue_tickets where id = (v->>'id')::uuid) = 'cancelled';
end $$;
select pg_temp.expect_error(
  $$select cancel_booking((select access_token from booking_private bp join queue_tickets t on t.id = bp.ticket_id where t.status = 'completed' limit 1))$$,
  'invalid_transition');

\echo 'ALL SMOKE TESTS PASSED'

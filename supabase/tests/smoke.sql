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

-- A Tuesday 4-10 days ahead, at a shop-local time (Tuesday is always open in the
-- seed roster). Never within 3 days, so it cannot overlap EZ-001's closure window
-- (tomorrow .. today + 3); EZ-001's far booking uses today + 11 for the same reason.
-- Regression: with 1-7 days, a Monday run booked "next Tuesday" = tomorrow and
-- collided with EZ-001's own bookings.
create or replace function pg_temp.next_tuesday_at(p_hhmm text)
returns timestamptz language sql as $$
  select ((public.shop_today()
           + (select case when d < 4 then d + 7 else d end
                from (select (9 - extract(dow from public.shop_today())::int) % 7 as d) x))::text
          || ' ' || p_hhmm)::timestamp at time zone public.shop_tz();
$$;

-- Earlier sections were written before EZ-003; they book fixed times that the
-- seeded lunches would block. Breaks get their own section at the end.
do $$ begin assert (select count(*) from barber_breaks) > 0, 'seed adds breaks'; end $$;
create temp table t_seed_breaks as select * from barber_breaks;
delete from barber_breaks;

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

\echo '--- EZ-011 service timing'
-- Chandra: next booked appointment in ~25 min; a 45-min and a 20-min walk-in wait for her.
insert into appointments (barber_id, starts_at, ends_at, duration_min, price_cents, service_ids, service_summary, display_name, status)
select b.id, now() + interval '25 minutes', now() + interval '70 minutes', 45, 5000,
       array[(select id from services where slug = 'skin-fade')], 'Skin Fade', 'Gap T.', 'confirmed'
  from barbers b where b.slug = 'chandra';
select issue_queue_ticket((select id from barbers where slug='chandra'), array[(select id from services where slug='signature-cut')], '{}', 'Long Cut', '+60111000001', null, 'cash_on_site');
select issue_queue_ticket((select id from barbers where slug='chandra'), array[(select id from services where slug='buzz-cut')], '{}', 'Short Cut', '+60111000002', null, 'cash_on_site');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
do $$
declare v jsonb; v_chandra uuid; v_id uuid; v_end timestamptz; v_end2 timestamptz;
begin
  select id into v_chandra from barbers where slug = 'chandra';

  -- gap-aware: the 20-min buzz cut fits before the appointment, the older 45-min cut does not
  v := desk_call_next(v_chandra);
  assert v->>'kind' = 'ticket', v::text;
  v_id := (v->>'id')::uuid;
  assert (select duration_min from queue_tickets where id = v_id) = 20, 'called the cut that fits';

  -- seating sets expected_end_at = seated_at + duration
  perform desk_transition('ticket', v_id, 'seat');
  select expected_end_at into v_end from queue_tickets where id = v_id;
  assert v_end between now() + interval '19 minutes' and now() + interval '21 minutes', format('expected end %s', v_end);

  -- running over: +10 pushes the expected end
  v_end2 := desk_set_expected_end('ticket', v_id, 'extend', 10);
  assert v_end2 = v_end + interval '10 minutes', format('extended %s -> %s', v_end, v_end2);

  -- finishing early: done in ~5
  v_end2 := desk_set_expected_end('ticket', v_id, 'finish_in', 5);
  assert v_end2 between now() + interval '4 minutes' and now() + interval '6 minutes', 'finish_in';

  -- chair frees at expected end
  assert chair_free_at(v_chandra) = v_end2, 'chair_free_at follows expected end';

  perform desk_transition('ticket', v_id, 'complete');

  -- only the 45-min cut waits; 25-min gap -> no_fit (never overruns into the booking)
  v := desk_call_next(v_chandra);
  assert v->>'reason' = 'no_fit', v::text;
  assert (v->>'needed_min')::int = 45, v::text;
  assert (v->>'gap_min')::int between 23 and 25, v::text;
  assert v->>'next_label' = 'Gap T.', v::text;
  assert (select status from queue_tickets where code like 'C-%' and duration_min = 45 and shop_day = shop_today()) = 'waiting';

  -- invalid adjustments are rejected
  begin
    perform desk_set_expected_end('ticket', v_id, 'extend', 10);  -- not in chair any more
    raise exception 'expected invalid_transition';
  exception when others then assert sqlerrm = 'invalid_transition', sqlerrm; end;
  begin
    perform desk_set_expected_end('ticket', v_id, 'teleport', 10);
    raise exception 'expected invalid_action';
  exception when others then assert sqlerrm = 'invalid_action', sqlerrm; end;

  perform desk_mark_delay_notified((select id from appointments where display_name = 'Gap T.'), 15);
  assert (select delay_notified_min from appointments where display_name = 'Gap T.') = 15;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', false);
select pg_temp.expect_error($$select desk_set_expected_end('ticket', gen_random_uuid(), 'extend', 5)$$, 'forbidden');
reset role;

\echo '--- EZ-009 owner admin'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000cc', 'owner@example.com') on conflict do nothing;
insert into staff (user_id, role, display_name) values ('00000000-0000-0000-0000-0000000000cc', 'owner', 'Owner') on conflict do nothing;
set role authenticated;

-- host (staff but not owner) is refused
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select pg_temp.expect_error($$select admin_save_service(null, 'Hack Cut', '', 'haircut', 30, 100, false, true)$$, 'forbidden');
select pg_temp.expect_error($$select admin_update_settings('{"deposit_percent": 1}'::jsonb)$$, 'forbidden');
do $$ begin assert (select count(*) from catalog_changes) = 0, 'host cannot read audit log'; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', false);
do $$
declare v_id uuid; v_old_price integer; v_cut uuid;
begin
  assert is_owner();
  -- create
  v_id := admin_save_service(null, 'Hair Dye (Short)', 'Single colour', 'haircut', 90, 12000, false, true);
  assert (select slug from services where id = v_id) = 'hair-dye-short';
  -- price change does not touch existing bookings
  select id into v_cut from services where slug = 'skin-fade';
  select price_cents into v_old_price from appointments where 'Skin Fade' = service_summary limit 1;
  perform admin_save_service(v_cut, 'Skin Fade', 'Bald-to-blend fade', 'haircut', 45, 5500, true, true);
  assert (select price_cents from services where id = v_cut) = 5500;
  assert (select price_cents from appointments where 'Skin Fade' = service_summary limit 1) = v_old_price, 'snapshot kept';
  -- deactivate hides it from price_cart
  perform admin_save_service(v_id, 'Hair Dye (Short)', 'Single colour', 'haircut', 90, 12000, false, false);
  -- add-on + reorder
  perform admin_save_addon(null, 'Nose Wax', '', 5, 1000, true);
  perform admin_reorder('addons', array(select id from addons order by name));
  -- settings
  perform admin_update_settings('{"deposit_percent": 30, "min_deposit_cents": 1500, "shop_phone": "+60199998888"}'::jsonb);
  assert (select deposit_percent from shop_settings) = 30;
  assert (select shop_phone from shop_settings) = '+60199998888';
  assert (select count(*) from catalog_changes) >= 6, format('audit rows %s', (select count(*) from catalog_changes));
  assert exists (select 1 from catalog_changes where row_id = v_id::text and action = 'deactivate'), 'deactivation logged';
  assert exists (select 1 from catalog_changes where row_id = v_cut::text and (before->>'price_cents')::int = 5000 and (after->>'price_cents')::int = 5500), 'price change logged with before/after';
end $$;
select pg_temp.expect_error($$select admin_save_service(null, 'Bad', '', 'haircut', 0, 100, false, true)$$, 'invalid_value');
select pg_temp.expect_error($$select admin_save_service(null, 'Bad', '', 'haircut', 30, -1, false, true)$$, 'invalid_value');
select pg_temp.expect_error($$select admin_save_service(null, '   ', '', 'haircut', 30, 100, false, true)$$, 'invalid_value');
select pg_temp.expect_error($$select admin_update_settings('{"deposit_percent": 150}'::jsonb)$$, 'invalid_value');
select pg_temp.expect_error($$select admin_update_settings('{"timezone": "UTC"}'::jsonb)$$, 'invalid_value');
select pg_temp.expect_error($$select admin_update_settings('{"slot_interval_min": 7}'::jsonb)$$, 'invalid_value');
select pg_temp.expect_error($$select admin_update_settings('{"hold_minutes": "abc"}'::jsonb)$$, 'invalid_value');
reset role;
select pg_temp.expect_error($$select price_cart(array[(select id from services where slug='hair-dye-short')], '{}'::uuid[])$$, 'unknown_service');
-- restore defaults for later sections
update shop_settings set deposit_percent = 20, min_deposit_cents = 1000;

\echo '--- EZ-002 reschedule'
create temp table t_ids (k text primary key, val uuid);
grant all on t_ids to authenticated;
do $$
declare v jsonb; v_cut uuid; v_aiman uuid;
begin
  select id into v_cut from services where slug = 'buzz-cut';            -- 20 min
  select id into v_aiman from barbers where slug = 'aiman';
  v := book_appointment(v_aiman, pg_temp.next_tuesday_at('11:00'), array[v_cut], '{}', 'Res One', '+60177000001', null, 'cash_on_site');
  insert into t_ids values ('far_appt', (v->>'id')::uuid), ('far_token', (v->>'access_token')::uuid);

  -- customer self-reschedule (far from cutoff): free choice, same barber
  v := reschedule_by_token((select val from t_ids where k='far_token'), pg_temp.next_tuesday_at('12:00'), null, null);
  assert (v->>'starts_at')::timestamptz = pg_temp.next_tuesday_at('12:00'), v::text;
  assert (select status from appointments where id = (select val from t_ids where k='far_appt')) = 'confirmed';
  assert (select count(*) from booking_events where appointment_id = (select val from t_ids where k='far_appt') and kind = 'rescheduled') = 1;

  -- a booking starting soon (inside the 120-min cutoff)
  insert into appointments (barber_id, starts_at, ends_at, duration_min, price_cents, service_ids, service_summary, display_name, status, payment_option, payment_status, amount_due_now_cents)
  values (v_aiman, now() + interval '60 minutes', now() + interval '80 minutes', 20, 2500, array[v_cut], 'Buzz Cut', 'Soon S.', 'confirmed', 'deposit', 'paid', 1000)
  returning id into v_cut;
  insert into booking_private (kind, appointment_id, customer_name, phone) values ('appointment', v_cut, 'Soon Soon', '+60177000002');
  insert into t_ids values ('soon_appt', v_cut), ('soon_token', (select access_token from booking_private where appointment_id = v_cut));
end $$;
select pg_temp.expect_error(
  $$select reschedule_by_token((select val from t_ids where k='soon_token'), pg_temp.next_tuesday_at('15:00'), null, null)$$,
  'reschedule_cutoff');
select pg_temp.expect_error(
  $$select reschedule_by_token((select val from t_ids where k='far_token'), pg_temp.next_tuesday_at('12:10'), null, null)$$,
  'misaligned_slot');

-- desk proposes two soft-held times (Aiman 13:00, Bryan 13:00)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
do $$
declare v jsonb;
begin
  v := create_reschedule_offers((select val from t_ids where k='soon_appt'), 'delay', jsonb_build_array(
    jsonb_build_object('starts_at', pg_temp.next_tuesday_at('13:00'), 'barber_id', (select id from barbers where slug='aiman')),
    jsonb_build_object('starts_at', pg_temp.next_tuesday_at('13:00'), 'barber_id', (select id from barbers where slug='bryan')),
    jsonb_build_object('starts_at', pg_temp.next_tuesday_at('12:00'), 'barber_id', (select id from barbers where slug='aiman'))  -- taken: skipped
  ));
  assert jsonb_array_length(v) = 2, v::text;
  assert (select reschedule_requested_at from appointments where id = (select val from t_ids where k='soon_appt')) is not null;
  insert into t_ids values ('offer_a', (v->0->>'id')::uuid), ('offer_b', (v->1->>'id')::uuid);
end $$;
reset role;

-- soft hold: nobody else can book Aiman or Bryan at 13:00, 'any' lands on another chair
select pg_temp.expect_error(
  $$select book_appointment((select id from barbers where slug='aiman'), pg_temp.next_tuesday_at('13:00'), array[(select id from services where slug='buzz-cut')], '{}', 'Intruder', '+60177000003', null, 'cash_on_site')$$,
  'slot_unavailable');
do $$
declare v jsonb;
begin
  v := book_appointment(null, pg_temp.next_tuesday_at('13:00'), array[(select id from services where slug='buzz-cut')], '{}', 'Any One', '+60177000004', null, 'cash_on_site');
  assert (v->>'barber_id')::uuid not in (select id from barbers where slug in ('aiman', 'bryan')), v::text;
  -- another customer can't move onto a held window either
  begin
    perform reschedule_by_token((select val from t_ids where k='far_token'), pg_temp.next_tuesday_at('13:00'), (select id from barbers where slug='bryan'), null);
    raise exception 'expected slot_unavailable';
  exception when others then assert sqlerrm = 'slot_unavailable', sqlerrm; end;

  -- requested reschedule bypasses the cutoff; customer accepts offer B (Bryan)
  v := reschedule_by_token((select val from t_ids where k='soon_token'), null, null, (select val from t_ids where k='offer_b'));
  assert (v->>'barber_id')::uuid = (select id from barbers where slug='bryan'), v::text;
  assert (select status from reschedule_offers where id = (select val from t_ids where k='offer_b')) = 'accepted';
  assert (select status from reschedule_offers where id = (select val from t_ids where k='offer_a')) = 'released';
  assert (select payment_status from appointments where id = (select val from t_ids where k='soon_appt')) = 'paid', 'deposit kept';
  assert (select reschedule_requested_at from appointments where id = (select val from t_ids where k='soon_appt')) is null;
end $$;
select pg_temp.expect_error(
  $$select reschedule_by_token((select val from t_ids where k='soon_token'), null, null, (select val from t_ids where k='offer_a'))$$,
  'offer_expired');

-- expiry + release on cancel
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select create_reschedule_offers((select val from t_ids where k='far_appt'), 'manual',
  jsonb_build_array(jsonb_build_object('starts_at', pg_temp.next_tuesday_at('16:30'), 'barber_id', (select id from barbers where slug='aiman'))));
-- desk moves directly
select desk_reschedule((select val from t_ids where k='far_appt'), pg_temp.next_tuesday_at('17:00'), null, null);
reset role;
do $$
begin
  assert (select starts_at from appointments where id = (select val from t_ids where k='far_appt')) = pg_temp.next_tuesday_at('17:00');
  assert (select count(*) from reschedule_offers where appointment_id = (select val from t_ids where k='far_appt') and status = 'open') = 0, 'released on move';
  assert (select actor from booking_events where appointment_id = (select val from t_ids where k='far_appt') and kind='rescheduled' order by created_at desc limit 1) = 'staff';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select create_reschedule_offers((select val from t_ids where k='far_appt'), 'manual',
  jsonb_build_array(jsonb_build_object('starts_at', pg_temp.next_tuesday_at('18:00'), 'barber_id', (select id from barbers where slug='aiman'))));
reset role;
do $$
begin
  update reschedule_offers set expires_at = now() - interval '1 second' where appointment_id = (select val from t_ids where k='far_appt') and status = 'open';
  perform expire_stale_holds();
  assert (select count(*) from reschedule_offers where appointment_id = (select val from t_ids where k='far_appt') and status = 'expired') = 1;
  perform cancel_booking((select val from t_ids where k='far_token'));
end $$;

-- privileges
set role anon;
select pg_temp.expect_error($$select reschedule_by_token(gen_random_uuid(), now(), null, null)$$, 'permission denied for function reschedule_by_token');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', false);
select pg_temp.expect_error($$select desk_reschedule(gen_random_uuid(), now(), null, null)$$, 'forbidden');
select pg_temp.expect_error($$select create_reschedule_offers(gen_random_uuid(), 'delay', '[]'::jsonb)$$, 'forbidden');
do $$ begin assert (select count(*) from reschedule_offers) = 0, 'non-staff cannot read offers'; end $$;
reset role;

\echo '--- EZ-001 emergency closure'
do $$
declare v jsonb; v_cut uuid; v_barber uuid; v_appt uuid; v_hold uuid; v_far uuid;
begin
  update barbers set is_on_duty = true where slug in ('aiman', 'bryan');
  select id into v_cut from services where slug = 'buzz-cut';
  select id into v_barber from barbers where slug = 'aiman';

  -- two live walk-ins today, one prepaid
  v := issue_queue_ticket(null, array[v_cut], '{}', 'Closure Walk', '+60188000001', null, 'cash_on_site');
  insert into t_ids values ('cl_t1', (v->>'id')::uuid);
  v := issue_queue_ticket(null, array[v_cut], '{}', 'Closure Paid', '+60188000002', null, 'full');
  insert into t_ids values ('cl_t2', (v->>'id')::uuid);
  update queue_tickets set payment_status = 'paid' where id = (v->>'id')::uuid;
  insert into payments (kind, ticket_id, stripe_checkout_session_id, amount_cents, currency, status)
  values ('ticket', (v->>'id')::uuid, 'cs_test_closure_t2', 2500, 'myr', 'paid');
  -- a ticket whose checkout is still open
  v := issue_queue_ticket(null, array[v_cut], '{}', 'Closure Late Pay', '+60188000003', null, 'full');
  insert into t_ids values ('cl_t3', (v->>'id')::uuid);
  insert into payments (kind, ticket_id, stripe_checkout_session_id, amount_cents, currency, status)
  values ('ticket', (v->>'id')::uuid, 'cs_test_closure_t3', 2500, 'myr', 'pending');

  -- a paid appointment tomorrow 15:00 (inside the closure), a payment hold at 16:00
  insert into appointments (barber_id, starts_at, ends_at, duration_min, price_cents, service_ids, service_summary, display_name, status, payment_option, payment_status, amount_due_now_cents)
  values (v_barber, ((shop_today() + 1)::text || ' 15:00')::timestamp at time zone shop_tz(),
          ((shop_today() + 1)::text || ' 15:20')::timestamp at time zone shop_tz(),
          20, 2500, array[v_cut], 'Buzz Cut', 'Affected A.', 'confirmed', 'deposit', 'paid', 1000)
  returning id into v_appt;
  insert into booking_private (kind, appointment_id, customer_name, phone) values ('appointment', v_appt, 'Affected Appt', '+60188000004');
  insert into payments (kind, appointment_id, stripe_checkout_session_id, amount_cents, currency, status)
  values ('appointment', v_appt, 'cs_test_closure_a1', 1000, 'myr', 'paid');
  insert into t_ids values ('cl_appt', v_appt), ('cl_appt_token', (select access_token from booking_private where appointment_id = v_appt));

  insert into appointments (barber_id, starts_at, ends_at, duration_min, price_cents, service_ids, service_summary, display_name, status, payment_option, payment_status, amount_due_now_cents, hold_expires_at)
  values (v_barber, ((shop_today() + 1)::text || ' 16:00')::timestamp at time zone shop_tz(),
          ((shop_today() + 1)::text || ' 16:20')::timestamp at time zone shop_tz(),
          20, 2500, array[v_cut], 'Buzz Cut', 'Hold H.', 'pending_payment', 'full', 'pending', 2500, now() + interval '30 minutes')
  returning id into v_hold;
  insert into payments (kind, appointment_id, stripe_checkout_session_id, amount_cents, currency, status)
  values ('appointment', v_hold, 'cs_test_closure_h1', 2500, 'myr', 'pending');
  insert into t_ids values ('cl_hold', v_hold);

  -- an appointment well after the closure, holding an offer inside it
  insert into appointments (barber_id, starts_at, ends_at, duration_min, price_cents, service_ids, service_summary, display_name, status)
  values (v_barber, ((shop_today() + 11)::text || ' 11:00')::timestamp at time zone shop_tz(),
          ((shop_today() + 11)::text || ' 11:20')::timestamp at time zone shop_tz(),
          20, 2500, array[v_cut], 'Buzz Cut', 'Far F.', 'confirmed')
  returning id into v_far;
  insert into reschedule_offers (appointment_id, barber_id, starts_at, ends_at, reason, expires_at)
  values (v_far, (select id from barbers where slug = 'bryan'),
          ((shop_today() + 1)::text || ' 17:00')::timestamp at time zone shop_tz(),
          ((shop_today() + 1)::text || ' 17:20')::timestamp at time zone shop_tz(), 'manual', now() + interval '1 day');
  insert into t_ids values ('cl_far', v_far);
end $$;

-- only staff may close; bad input rejected
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', false);
select pg_temp.expect_error($$select desk_close_shop(now() + interval '1 day', 'power', 'x')$$, 'forbidden');
select pg_temp.expect_error($$select desk_reopen_shop()$$, 'forbidden');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select pg_temp.expect_error($$select desk_close_shop(now() + interval '1 minute', 'power', 'Closed')$$, 'invalid_value');
select pg_temp.expect_error($$select desk_close_shop(now() + interval '60 days', 'power', 'Closed')$$, 'invalid_value');
select pg_temp.expect_error($$select desk_close_shop(now() + interval '1 day', 'aliens', 'Closed')$$, 'invalid_value');
select pg_temp.expect_error($$select desk_close_shop(now() + interval '1 day', 'power', '   ')$$, 'invalid_value');
select pg_temp.expect_error($$select desk_reopen_shop()$$, 'invalid_transition');
do $$
declare v jsonb;
begin
  v := desk_close_shop(((shop_today() + 3)::text || ' 09:00')::timestamp at time zone shop_tz(), 'power', 'Power cut in the area. Sorry!');
  assert (v->>'tickets_cancelled')::int >= 3, v::text;
  assert (v->>'holds_released')::int >= 1, v::text;
  assert (v->>'offers_released')::int >= 1, v::text;
  assert (v->'appointment_ids') ? (select val::text from t_ids where k='cl_appt'), v::text;
  insert into t_ids values ('closure', (v->>'closure_id')::uuid);
  -- running it again (new message) keeps the same closure and doesn't duplicate impacts
  v := desk_close_shop(((shop_today() + 3)::text || ' 09:00')::timestamp at time zone shop_tz(), 'power', 'Power cut — back on Thursday.');
  assert (v->>'closure_id')::uuid = (select val from t_ids where k='closure'), v::text;
  assert (v->>'tickets_cancelled')::int = 0, v::text;
end $$;
reset role;

do $$
begin
  assert shop_closed_now(), 'closed now';
  assert (select closure_message from shop_settings) = 'Power cut — back on Thursday.';
  assert (select closed_until from shop_settings) = ((shop_today() + 3)::text || ' 09:00')::timestamp at time zone shop_tz();
  assert (select count(*) from queue_tickets where id in (select val from t_ids where k in ('cl_t1','cl_t2','cl_t3'))
            and status = 'cancelled' and cancel_reason = 'shop_closed') = 3, 'walk-ins cancelled';
  assert (select needs_refund from payments where stripe_checkout_session_id = 'cs_test_closure_t2'), 'paid ticket flagged';
  assert (select had_payment from closure_impacts where ticket_id = (select val from t_ids where k='cl_t2')), 'impact records payment';
  assert (select count(*) from closure_impacts where ticket_id = (select val from t_ids where k='cl_t1')) = 1, 'no duplicate impacts';
  assert (select status from appointments where id = (select val from t_ids where k='cl_appt')) = 'confirmed', 'appointment not cancelled';
  assert (select reschedule_requested_at from appointments where id = (select val from t_ids where k='cl_appt')) is not null;
  assert (select status from appointments where id = (select val from t_ids where k='cl_hold')) = 'expired', 'hold released';
  assert (select status from reschedule_offers where appointment_id = (select val from t_ids where k='cl_far')) = 'released', 'offer in window released';
  assert slot_conflict((select id from barbers where slug='bryan'),
                       ((shop_today() + 1)::text || ' 17:00')::timestamp at time zone shop_tz(),
                       ((shop_today() + 1)::text || ' 17:20')::timestamp at time zone shop_tz(), null) = 'shop_closed';
end $$;

-- closed: no tickets, no bookings or moves into the window
select pg_temp.expect_error(
  $$select issue_queue_ticket(null, array[(select id from services where slug='buzz-cut')], '{}', 'Too Late', '+60188000009', null, 'cash_on_site')$$,
  'shop_closed');
select pg_temp.expect_error(
  $$select book_appointment(null, ((shop_today() + 1)::text || ' 14:00')::timestamp at time zone shop_tz(), array[(select id from services where slug='buzz-cut')], '{}', 'In Window', '+60188000010', null, 'cash_on_site')$$,
  'closed_window');
select pg_temp.expect_error(
  $$select reschedule_by_token((select val from t_ids where k='cl_appt_token'), ((shop_today() + 2)::text || ' 14:00')::timestamp at time zone shop_tz(), null, null)$$,
  'slot_unavailable');

-- late payments: a cancelled ticket or a released hold is flagged for refund, not revived
do $$
declare v jsonb;
begin
  v := apply_checkout_result('cs_test_closure_t3', true, 'pi_t3');
  assert v->>'outcome' = 'needs_refund', v::text;
  assert (select status from queue_tickets where id = (select val from t_ids where k='cl_t3')) = 'cancelled';
  v := apply_checkout_result('cs_test_closure_h1', true, 'pi_h1');
  assert v->>'outcome' = 'needs_refund', v::text;
  assert (select status from appointments where id = (select val from t_ids where k='cl_hold')) = 'expired', 'hold not revived';
end $$;

-- desk: notified + cancel-with-refund for the affected appointment
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select desk_mark_closure_notified((select id from closure_impacts where appointment_id = (select val from t_ids where k='cl_appt')));
do $$
declare v jsonb;
begin
  assert (select notified_at from closure_impacts where appointment_id = (select val from t_ids where k='cl_appt')) is not null;
  v := desk_cancel_affected((select id from closure_impacts where appointment_id = (select val from t_ids where k='cl_appt')));
  assert (v->>'refund_flagged')::boolean, v::text;
end $$;
select pg_temp.expect_error(
  $$select desk_cancel_affected((select id from closure_impacts where ticket_id = (select val from t_ids where k='cl_t1')))$$,
  'not_found');
reset role;
do $$
begin
  assert (select status from appointments where id = (select val from t_ids where k='cl_appt')) = 'cancelled';
  assert (select needs_refund from payments where stripe_checkout_session_id = 'cs_test_closure_a1'), 'deposit flagged for refund';
end $$;

-- visibility: anon can see the public closure message but not the closure tables
set role anon;
select pg_temp.expect_error($$select count(*) from shop_closures$$, 'permission denied for table shop_closures');
select pg_temp.expect_error($$select count(*) from closure_impacts$$, 'permission denied for table closure_impacts');
do $$ begin assert (select closed_until from shop_settings) is not null; end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', false);
do $$ begin assert (select count(*) from closure_impacts) = 0, 'non-staff cannot read impacts'; end $$;

-- reopen: queue works again, closure kept as history, cancelled tickets stay cancelled
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select desk_reopen_shop();
select pg_temp.expect_error($$select desk_reopen_shop()$$, 'invalid_transition');
reset role;
do $$
declare v jsonb;
begin
  assert not shop_closed_now(), 'reopened';
  assert (select closed_until from shop_settings) is null;
  assert (select reopened_at from shop_closures where id = (select val from t_ids where k='closure')) is not null, 'history kept';
  assert (select ends_at < planned_ends_at from shop_closures where id = (select val from t_ids where k='closure')), 'window shortened';
  assert (select status from queue_tickets where id = (select val from t_ids where k='cl_t1')) = 'cancelled';
  v := issue_queue_ticket(null, array[(select id from services where slug='buzz-cut')], '{}', 'After Reopen', '+60188000011', null, 'cash_on_site');
  assert v ? 'code', v::text;
  assert slot_conflict((select id from barbers where slug='bryan'),
                       ((shop_today() + 1)::text || ' 17:00')::timestamp at time zone shop_tz(),
                       ((shop_today() + 1)::text || ' 17:20')::timestamp at time zone shop_tz(), null) is distinct from 'shop_closed';
end $$;

\echo '--- EZ-003 barber breaks'
-- restore the seeded breaks and check their shape
insert into barber_breaks select * from t_seed_breaks;
do $$
begin
  assert (select count(*) from barber_breaks where weekday = 5 and label = 'Friday prayers') = 4, 'friday prayers for every barber';
  assert (select count(*) from barber_breaks where weekday = 1) = 0, 'no breaks on the closed Monday';
end $$;

do $$
declare v_aiman uuid; v_cut uuid; v jsonb;
begin
  select id into v_aiman from barbers where slug = 'aiman';
  select id into v_cut from services where slug = 'buzz-cut';   -- 20 min
  -- seeded lunch: Aiman Tue 13:00-13:45
  assert slot_conflict(v_aiman, pg_temp.next_tuesday_at('12:45'), pg_temp.next_tuesday_at('13:05'), null) = 'break', 'runs into lunch';
  assert slot_conflict(v_aiman, pg_temp.next_tuesday_at('13:30'), pg_temp.next_tuesday_at('13:50'), null) = 'break', 'starts in lunch';
  assert slot_conflict(v_aiman, pg_temp.next_tuesday_at('12:40'), pg_temp.next_tuesday_at('13:00'), null) is null, 'ends at lunch start';
  assert slot_conflict(v_aiman, pg_temp.next_tuesday_at('13:45'), pg_temp.next_tuesday_at('13:55'), null) is null, 'starts at lunch end';
  -- 'any' barber at 13:00 lands on someone who isn't at lunch
  v := book_appointment(null, pg_temp.next_tuesday_at('13:15'), array[v_cut], '{}', 'Lunch Any', '+60199000001', null, 'cash_on_site');
  assert (v->>'barber_id')::uuid <> v_aiman, v::text;
end $$;
-- a crafted request inside Aiman's lunch is refused
select pg_temp.expect_error(
  $$select book_appointment((select id from barbers where slug='aiman'), pg_temp.next_tuesday_at('13:15'), array[(select id from services where slug='buzz-cut')], '{}', 'Lunch Crash', '+60199000002', null, 'cash_on_site')$$,
  'slot_unavailable');

-- buffer after each service
do $$
declare v_bryan uuid; v_cut uuid; v jsonb;
begin
  select id into v_bryan from barbers where slug = 'bryan';
  select id into v_cut from services where slug = 'buzz-cut';
  update shop_settings set buffer_after_service_min = 10;
  v := book_appointment(v_bryan, pg_temp.next_tuesday_at('17:00'), array[v_cut], '{}', 'Buffer One', '+60199000003', null, 'cash_on_site');
  -- 17:00-17:20 + 10 min buffer -> 17:20 and 17:25 refused, 17:30 ok; 16:40 (ends 17:00 + buffer) refused
  assert slot_conflict(v_bryan, pg_temp.next_tuesday_at('17:20'), pg_temp.next_tuesday_at('17:40'), null) = 'slot_unavailable';
  assert slot_conflict(v_bryan, pg_temp.next_tuesday_at('17:30'), pg_temp.next_tuesday_at('17:50'), null) is null;
  assert slot_conflict(v_bryan, pg_temp.next_tuesday_at('16:40'), pg_temp.next_tuesday_at('17:00'), null) = 'slot_unavailable';
  assert slot_conflict(v_bryan, pg_temp.next_tuesday_at('16:30'), pg_temp.next_tuesday_at('16:50'), null) is null;
  update shop_settings set buffer_after_service_min = 0;
end $$;

-- desk: take a break, call-next refused, back now
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', false);
select pg_temp.expect_error($$select desk_take_break((select id from barbers where slug='chandra'), 15)$$, 'forbidden');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select pg_temp.expect_error($$select desk_take_break((select id from barbers where slug='chandra'), 2)$$, 'invalid_value');
select pg_temp.expect_error($$select desk_end_break((select id from barbers where slug='chandra'))$$, 'invalid_transition');
do $$
declare v_chandra uuid; v_back timestamptz;
begin
  select id into v_chandra from barbers where slug = 'chandra';
  perform desk_set_duty(v_chandra, true);
  v_back := desk_take_break(v_chandra, 15);
  assert v_back between now() + interval '14 minutes' and now() + interval '16 minutes', v_back::text;
  assert barber_back_at(v_chandra) = v_back;
  begin
    perform desk_take_break(v_chandra, 10);
    raise exception 'expected already_on_break';
  exception when others then assert sqlerrm = 'already_on_break', sqlerrm; end;
  begin
    perform desk_call_next(v_chandra);
    raise exception 'expected on_break';
  exception when others then assert sqlerrm = 'on_break', sqlerrm; end;
end $$;
-- separate statements: now() is fixed inside one transaction
select desk_end_break((select id from barbers where slug='chandra'));
do $$
begin
  assert barber_back_at((select id from barbers where slug='chandra')) is null, 'back now';
  assert (select kind from barber_time_off where barber_id = (select id from barbers where slug='chandra') order by starts_at desc limit 1) = 'break';
end $$;
reset role;

-- recurring break happening right now also blocks Call Next; walk-ins must fit before the next break
do $$
declare v_danial uuid; v_now_local time := (now() at time zone shop_tz())::time;
begin
  select id into v_danial from barbers where slug = 'danial';
  delete from barber_breaks where barber_id = v_danial;
  if v_now_local < time '23:00' and v_now_local > time '00:05' then
    insert into barber_breaks (barber_id, weekday, start_time, end_time, label)
    values (v_danial, extract(dow from shop_today())::smallint, v_now_local - interval '5 minutes', v_now_local + interval '20 minutes', 'Test break');
    assert barber_back_at(v_danial) is not null, 'recurring break counts as on break';
    delete from barber_breaks where barber_id = v_danial;
    insert into barber_breaks (barber_id, weekday, start_time, end_time, label)
    values (v_danial, extract(dow from shop_today())::smallint, v_now_local + interval '25 minutes', v_now_local + interval '50 minutes', 'Soon break');
    assert next_break_start(v_danial, now()) is not null, 'next break found';
    update queue_tickets set status = 'cancelled' where status = 'waiting' and shop_day = shop_today(); -- isolate this check
    perform issue_queue_ticket(v_danial, array[(select id from services where slug='signature-cut')], '{}', 'Break Fit', '+60199000004', null, 'cash_on_site');
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
do $$
declare v jsonb; v_danial uuid; v_now_local time := (now() at time zone shop_tz())::time;
begin
  select id into v_danial from barbers where slug = 'danial';
  if v_now_local < time '23:00' and v_now_local > time '00:05' then
    -- the 45-min walk-in for Danial can't fit before the break in ~25 min
    v := desk_call_next(v_danial);
    assert v->>'reason' = 'no_fit', coalesce(v::text, 'null');
    assert v->>'next_label' = 'a break', v::text;
  end if;
end $$;
reset role;

-- owner edits breaks (audited); host cannot
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select pg_temp.expect_error($$select admin_save_break(null, (select id from barbers where slug='aiman'), 2, '16:00', '16:15', 'Tea')$$, 'forbidden');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', false);
select pg_temp.expect_error($$select admin_save_break(null, (select id from barbers where slug='aiman'), 2, '16:15', '16:00', 'Tea')$$, 'invalid_value');
select pg_temp.expect_error($$select admin_save_break(null, (select id from barbers where slug='aiman'), 7, '16:00', '16:15', 'Tea')$$, 'invalid_value');
do $$
declare v_id uuid;
begin
  v_id := admin_save_break(null, (select id from barbers where slug='aiman'), 2, '16:00', '16:15', 'Tea');
  perform admin_save_break(v_id, (select id from barbers where slug='aiman'), 2, '16:00', '16:20', 'Tea');
  assert (select end_time from barber_breaks where id = v_id) = '16:20';
  perform admin_delete_break(v_id);
  assert not exists (select 1 from barber_breaks where id = v_id);
  assert (select count(*) from catalog_changes where table_name = 'barber_breaks' and row_id = v_id::text) = 3, 'audited';
  perform admin_update_settings('{"buffer_after_service_min": 5, "reschedule_cutoff_min": 60}'::jsonb);
  assert (select buffer_after_service_min from shop_settings) = 5;
  assert (select reschedule_cutoff_min from shop_settings) = 60;
  perform admin_update_settings('{"buffer_after_service_min": 0, "reschedule_cutoff_min": 120}'::jsonb);
end $$;
select pg_temp.expect_error($$select admin_update_settings('{"buffer_after_service_min": 45}'::jsonb)$$, 'invalid_value');
reset role;

-- anon can read breaks (roster + estimator) but not write them
set role anon;
do $$ begin assert (select count(*) from barber_breaks) > 0, 'anon reads breaks'; end $$;
select pg_temp.expect_error($$insert into barber_breaks (barber_id, weekday, start_time, end_time) values ((select id from barbers limit 1), 2, '10:00', '10:15')$$, 'permission denied for table barber_breaks');
reset role;

\echo '--- desk_call_next consistency (found by evals/)'
-- isolate: Danial on duty, no waiting walk-ins, no breaks, no bookings today
do $$
declare v_danial uuid := (select id from barbers where slug = 'danial');
begin
  update barbers set is_on_duty = true where id = v_danial;
  update queue_tickets set status = 'cancelled' where status in ('waiting', 'called') and shop_day = shop_today();
  delete from barber_breaks where barber_id = v_danial;
  update appointments set status = 'cancelled' where barber_id = v_danial and status in ('confirmed', 'checked_in', 'called', 'pending_payment');
  update barber_time_off set ends_at = least(ends_at, starts_at + interval '1 second') where barber_id = v_danial;
end $$;

-- (2) walk-in + rest buffer must fit before the next booking
do $$
declare v_danial uuid := (select id from barbers where slug = 'danial'); v_now_local time := (now() at time zone shop_tz())::time;
begin
  if v_now_local between time '00:05' and time '22:30' then
    insert into appointments (barber_id, starts_at, ends_at, duration_min, price_cents, service_ids, service_summary, display_name, status)
    values (v_danial, now() + interval '28 minutes', now() + interval '48 minutes', 20, 2500,
            array[(select id from services where slug='buzz-cut')], 'Buzz Cut', 'Gap Fit', 'confirmed');
    perform issue_queue_ticket(v_danial, array[(select id from services where slug='buzz-cut')], '{}', 'Buffer Fit', '+60199100001', null, 'cash_on_site');
    update shop_settings set buffer_after_service_min = 10;
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
do $$
declare v jsonb; v_now_local time := (now() at time zone shop_tz())::time;
begin
  if v_now_local between time '00:05' and time '22:30' then
    v := desk_call_next((select id from barbers where slug = 'danial'));
    assert v->>'reason' = 'no_fit', coalesce(v::text, 'null');       -- 20 + 10 rest > 27 free
    assert (v->>'needed_min')::int = 30, v::text;
  end if;
end $$;
reset role;
update shop_settings set buffer_after_service_min = 0;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
do $$
declare v jsonb; v_now_local time := (now() at time zone shop_tz())::time;
begin
  if v_now_local between time '00:05' and time '22:30' then
    v := desk_call_next((select id from barbers where slug = 'danial'));
    assert v->>'kind' = 'ticket', coalesce(v::text, 'null');       -- 20 fits in 27 without the buffer
    perform desk_transition('ticket', (v->>'id')::uuid, 'no_show', null);
  end if;
end $$;
reset role;

-- (1) a booking is not called early into the barber's break
do $$
declare v_danial uuid := (select id from barbers where slug = 'danial'); v_now_local time := (now() at time zone shop_tz())::time;
begin
  update appointments set status = 'cancelled' where barber_id = v_danial and status = 'confirmed';
  if v_now_local between time '00:05' and time '22:30' then
    insert into appointments (barber_id, starts_at, ends_at, duration_min, price_cents, service_ids, service_summary, display_name, status)
    values (v_danial, now() + interval '8 minutes', now() + interval '28 minutes', 20, 2500,
            array[(select id from services where slug='buzz-cut')], 'Buzz Cut', 'Into Break', 'confirmed');
    insert into barber_breaks (barber_id, weekday, start_time, end_time, label)
    values (v_danial, extract(dow from shop_today())::smallint, v_now_local + interval '3 minutes', v_now_local + interval '33 minutes', 'Soon');
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
do $$
declare v jsonb; v_now_local time := (now() at time zone shop_tz())::time;
begin
  if v_now_local between time '00:05' and time '22:30' then
    v := desk_call_next((select id from barbers where slug = 'danial'));
    assert v is null, 'booking at +8 must not be called early into the break at +3: ' || v::text;
  end if;
end $$;
reset role;
do $$
begin
  delete from barber_breaks where barber_id = (select id from barbers where slug = 'danial') and label = 'Soon';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
do $$
declare v jsonb; v_now_local time := (now() at time zone shop_tz())::time;
begin
  if v_now_local between time '00:05' and time '22:30' then
    v := desk_call_next((select id from barbers where slug = 'danial'));
    assert v->>'kind' = 'appointment', coalesce(v::text, 'null');  -- no break: called up to 10 min early as before
  end if;
end $$;
reset role;

\echo 'ALL SMOKE TESTS PASSED'

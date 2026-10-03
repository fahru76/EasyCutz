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

\echo 'ALL SMOKE TESTS PASSED'

-- =============================================================================
-- EasyCutz — starter catalog, roster and opening hours.
-- Safe to re-run: every insert is keyed on a unique slug / id.
-- Prices are stored in sen (MYR cents): 4500 = RM 45.00
-- =============================================================================

insert into public.shop_settings (id, shop_name, timezone, currency, slot_interval_min, booking_horizon_days,
                                  min_lead_min, hold_minutes, deposit_percent, min_deposit_cents, notify_lead_min,
                                  shop_phone, shop_address)
values (1, 'EasyCutz', 'Asia/Kuala_Lumpur', 'myr', 15, 14, 30, 30, 20, 1000, 10,
        '+60123456789', 'Kuala Lumpur, Malaysia')
on conflict (id) do nothing;

insert into public.services (slug, name, description, category, duration_min, price_cents, is_popular, sort_order) values
  ('signature-cut',      'Signature Cut',        'Consultation, precision scissor & clipper cut, wash-free style finish.', 'haircut',     45, 4500, true,  10),
  ('skin-fade',          'Skin Fade',            'Bald-to-blend fade with foil-shaver detailing and sharp line-up.',      'haircut',     45, 5000, true,  20),
  ('buzz-cut',           'Buzz Cut',             'Single-guard all-over clipper cut with neckline clean-up.',             'haircut',     20, 2500, false, 30),
  ('kids-cut',           'Kids Cut (under 12)',  'Patient, quick cut for the little ones.',                               'haircut',     30, 3000, false, 40),
  ('long-hair-restyle',  'Long Hair Restyle',    'Texturising and reshaping for shoulder-length hair.',                   'haircut',     60, 7000, false, 50),
  ('beard-trim',         'Beard Trim',           'Shape-up and length trim with clean edges.',                            'beard_shave', 15, 1800, false, 10),
  ('beard-sculpt',       'Beard Sculpt',         'Full sculpt, cheek & neck line, hot towel and beard oil.',              'beard_shave', 20, 2500, true,  20),
  ('hot-towel-shave',    'Hot Towel Shave',      'Traditional straight-razor shave with pre-shave oil and hot towels.',   'beard_shave', 30, 4000, false, 30),
  ('cut-and-beard',      'Cut + Beard',          'Signature Cut paired with a Beard Sculpt.',                             'combo',       60, 6500, true,  10),
  ('the-full-works',     'The Full Works',       'Cut, hot towel shave, charcoal mask and scalp massage.',                'combo',       90, 11000, false, 20),
  ('scalp-detox',        'Scalp Detox',          'Exfoliating scrub, steam and massage to reset the scalp.',              'scalp',       30, 5500, false, 10),
  ('anti-dandruff',      'Anti-Dandruff Therapy','Medicated cleanse, treatment serum and massage.',                       'scalp',       40, 6500, false, 20)
on conflict (slug) do nothing;

insert into public.addons (slug, name, description, duration_min, price_cents, sort_order) values
  ('hot-towel',      'Hot Towel',       'Steamed towel wrap to open pores.',     5, 800,  10),
  ('charcoal-mask',  'Charcoal Mask',   'Deep-cleansing peel-off mask.',         10, 1500, 20),
  ('hair-wash',      'Hair Wash',       'Shampoo, condition and towel dry.',     10, 1000, 30),
  ('eyebrow-tidy',   'Eyebrow Tidy',    'Razor clean-up of stray brow hairs.',   5, 800,  40),
  ('style-finish',   'Styling Finish',  'Blow-dry and premium product finish.',  5, 1000, 50)
on conflict (slug) do nothing;

insert into public.barbers (slug, display_name, specialty, bio, rating, review_count, ticket_prefix, is_on_duty, sort_order) values
  ('aiman',  'Aiman',  'Skin fades & tapers',     'Ten years behind the chair. Fade perfectionist.',   4.9, 412, 'A', true,  10),
  ('bryan',  'Bryan',  'Scissor cuts & textures', 'Classic scissor work and modern textured crops.',  4.8, 287, 'B', true,  20),
  ('chandra','Chandra','Beards & hot towel shaves','Straight-razor specialist and beard architect.',  4.9, 351, 'C', true,  30),
  ('danial', 'Danial', 'Kids & quick cuts',        'Fast, friendly and great with first haircuts.',   4.7, 164, 'D', false, 40)
on conflict (slug) do nothing;

-- Shifts (shop-local time). Shop closed Mondays (weekday 1).
insert into public.barber_shifts (barber_id, weekday, start_time, end_time)
select b.id, d.weekday, s.start_time, s.end_time
  from public.barbers b
  cross join lateral (values
    ('aiman',   time '10:00', time '19:00'),
    ('bryan',   time '11:00', time '21:00'),
    ('chandra', time '10:00', time '20:00'),
    ('danial',  time '12:00', time '21:00')
  ) as s(slug, start_time, end_time)
  cross join lateral (values (0), (2), (3), (4), (5), (6)) as d(weekday)
 where b.slug = s.slug
   and not exists (
     select 1 from public.barber_shifts x where x.barber_id = b.id and x.weekday = d.weekday
   );

-- Recurring breaks (EZ-003). Lunches are staggered so the shop never empties;
-- Friday (weekday 5) has a shared prayer break instead of lunch. Edit in /desk/admin.
insert into public.barber_breaks (barber_id, weekday, start_time, end_time, label)
select b.id, d.weekday, s.start_time, s.end_time, 'Lunch'
  from public.barbers b
  cross join lateral (values
    ('aiman',   time '13:00', time '13:45'),
    ('bryan',   time '14:00', time '14:45'),
    ('chandra', time '13:45', time '14:30'),
    ('danial',  time '15:00', time '15:45')
  ) as s(slug, start_time, end_time)
  cross join lateral (values (0), (2), (3), (4), (6)) as d(weekday)
 where b.slug = s.slug
   and not exists (select 1 from public.barber_breaks x where x.barber_id = b.id and x.weekday = d.weekday);

insert into public.barber_breaks (barber_id, weekday, start_time, end_time, label)
select b.id, 5, time '12:45', time '14:30', 'Friday prayers'
  from public.barbers b
 where not exists (select 1 from public.barber_breaks x where x.barber_id = b.id and x.weekday = 5);

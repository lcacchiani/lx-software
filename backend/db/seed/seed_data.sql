-- Seed data for Hong Kong activities

INSERT INTO organizations (id, name, description)
SELECT '11111111-1111-1111-1111-111111111111', 'Harbor Arts Studio',
       'Art classes focused on painting and crafts.'
WHERE NOT EXISTS (
  SELECT 1 FROM organizations WHERE id = '11111111-1111-1111-1111-111111111111'
);

INSERT INTO organizations (id, name, description)
SELECT '22222222-2222-2222-2222-222222222222', 'Kowloon Kids Dance',
       'Dance and movement programs for children.'
WHERE NOT EXISTS (
  SELECT 1 FROM organizations WHERE id = '22222222-2222-2222-2222-222222222222'
);

INSERT INTO locations (id, org_id, district, address, lat, lng)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
       'Central and Western', '1 Queens Road Central', 22.282, 114.158
WHERE NOT EXISTS (
  SELECT 1 FROM locations WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
);

INSERT INTO locations (id, org_id, district, address, lat, lng)
SELECT 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111',
       'Wan Chai', '88 Hennessy Road', 22.276, 114.172
WHERE NOT EXISTS (
  SELECT 1 FROM locations WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

INSERT INTO locations (id, org_id, district, address, lat, lng)
SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222',
       'Yau Tsim Mong', '18 Nathan Road', 22.298, 114.172
WHERE NOT EXISTS (
  SELECT 1 FROM locations WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
);

INSERT INTO activities (id, org_id, name, description, age_range)
SELECT 'dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111',
       'Creative Painting', 'Painting classes for young artists.',
       int4range(4, 9, '[]')
WHERE NOT EXISTS (
  SELECT 1 FROM activities WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
);

INSERT INTO activities (id, org_id, name, description, age_range)
SELECT 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222',
       'Beginner Dance', 'Introductory dance sessions.',
       int4range(3, 7, '[]')
WHERE NOT EXISTS (
  SELECT 1 FROM activities WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
);

INSERT INTO activity_locations (activity_id, location_id)
SELECT 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
WHERE NOT EXISTS (
  SELECT 1 FROM activity_locations
  WHERE activity_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    AND location_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
);

INSERT INTO activity_locations (activity_id, location_id)
SELECT 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
WHERE NOT EXISTS (
  SELECT 1 FROM activity_locations
  WHERE activity_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    AND location_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

INSERT INTO activity_locations (activity_id, location_id)
SELECT 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'cccccccc-cccc-cccc-cccc-cccccccccccc'
WHERE NOT EXISTS (
  SELECT 1 FROM activity_locations
  WHERE activity_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    AND location_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
);

INSERT INTO activity_pricing (id, activity_id, location_id, pricing_type, amount, currency, sessions_count)
SELECT 'f1111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'per_class', 280.00, 'HKD', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM activity_pricing WHERE id = 'f1111111-1111-1111-1111-111111111111'
);

INSERT INTO activity_pricing (id, activity_id, location_id, pricing_type, amount, currency, sessions_count)
SELECT 'f2222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'per_sessions', 1200.00, 'HKD', 6
WHERE NOT EXISTS (
  SELECT 1 FROM activity_pricing WHERE id = 'f2222222-2222-2222-2222-222222222222'
);

INSERT INTO activity_pricing (id, activity_id, location_id, pricing_type, amount, currency, sessions_count)
SELECT 'f3333333-3333-3333-3333-333333333333', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
       'cccccccc-cccc-cccc-cccc-cccccccccccc', 'per_month', 900.00, 'HKD', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM activity_pricing WHERE id = 'f3333333-3333-3333-3333-333333333333'
);

INSERT INTO activity_schedule (
  id, activity_id, location_id, schedule_type, day_of_week_utc,
  start_minutes_utc, end_minutes_utc, languages
)
SELECT '51111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'weekly', 6, 120, 240, ARRAY['en','zh']
WHERE NOT EXISTS (
  SELECT 1 FROM activity_schedule WHERE id = '51111111-1111-1111-1111-111111111111'
);

INSERT INTO activity_schedule (
  id, activity_id, location_id, schedule_type, day_of_month,
  start_minutes_utc, end_minutes_utc, languages
)
SELECT '52222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'monthly', 15, 300, 420, ARRAY['zh']
WHERE NOT EXISTS (
  SELECT 1 FROM activity_schedule WHERE id = '52222222-2222-2222-2222-222222222222'
);

INSERT INTO activity_schedule (
  id, activity_id, location_id, schedule_type, start_at_utc, end_at_utc, languages
)
SELECT '53333333-3333-3333-3333-333333333333', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
       'cccccccc-cccc-cccc-cccc-cccccccccccc', 'date_specific',
       '2026-02-01T02:00:00+00', '2026-02-01T03:30:00+00', ARRAY['en']
WHERE NOT EXISTS (
  SELECT 1 FROM activity_schedule WHERE id = '53333333-3333-3333-3333-333333333333'
);

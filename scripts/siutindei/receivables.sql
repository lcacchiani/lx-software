-- Apply in the siutindei Aurora database (its own migration).
-- Executive Board T4: listing receivables (§5.4) and read-only views (§5.7).
-- AdminApiFn reaches these only through the RDS Data API (parameterised
-- ExecuteStatement). Writes are limited to invoices, payments, and
-- listing_subscriptions.status.

BEGIN;

CREATE TABLE IF NOT EXISTS listing_plans (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    price_hkd       numeric(12, 2) NOT NULL CHECK (price_hkd >= 0),
    billing_period  text NOT NULL CHECK (billing_period IN ('monthly', 'annual')),
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listing_subscriptions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    store_id        uuid,
    plan_id         uuid REFERENCES listing_plans (id),
    starts_on       date NOT NULL,
    renews_on       date,
    status          text NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'cancelled')),
    payer_contact   text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id uuid REFERENCES listing_subscriptions (id),
    number          text NOT NULL UNIQUE,
    issued_on       date,
    due_on          date,
    amount_hkd      numeric(12, 2) NOT NULL CHECK (amount_hkd >= 0),
    status          text NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')),
    fps_reference   text UNIQUE,
    pdf_key         text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      uuid REFERENCES invoices (id),
    received_on     date NOT NULL,
    amount_hkd      numeric(12, 2) NOT NULL,
    payer_name      text,
    bank_reference  text,
    source          text NOT NULL CHECK (source IN ('alert_email', 'statement', 'manual')),
    matched_by      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_status_due_idx ON invoices (status, due_on);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments (invoice_id);

-- §5.7 views, aligned to the live siutindei Alembic schema
-- (organizations, activities, activity_locations, locations,
-- geographic_areas, activity_categories, activity_pricing,
-- activity_schedule, organizations.media_urls). The product has no
-- stores table and no funnel events yet: locations stand in for venues,
-- and listing_events_daily is created here for the product to fill later.

CREATE TABLE IF NOT EXISTS listing_events_daily (
    day                 date NOT NULL,
    location_id         uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    searches            integer NOT NULL DEFAULT 0,
    listing_views       integer NOT NULL DEFAULT 0,
    cta_taps            integer NOT NULL DEFAULT 0,
    leads_relayed       integer NOT NULL DEFAULT 0,
    bookings_confirmed  integer NOT NULL DEFAULT 0,
    PRIMARY KEY (day, location_id)
);

CREATE OR REPLACE VIEW v_catalog_health AS
SELECT
    COALESCE(ga.name, 'unknown') AS district,
    COALESCE(c.name, 'unknown') AS category,
    COUNT(DISTINCT a.id)::int AS activities,
    COUNT(DISTINCT a.org_id)::int AS providers,
    COUNT(DISTINCT l.id)::int AS stores,
    AVG(
        (CASE WHEN COALESCE(cardinality(o.media_urls), 0) > 0 THEN 1 ELSE 0 END)
        + (CASE WHEN EXISTS (
            SELECT 1 FROM activity_pricing p WHERE p.activity_id = a.id
        ) THEN 1 ELSE 0 END)
        + (CASE WHEN EXISTS (
            SELECT 1 FROM activity_schedule s WHERE s.activity_id = a.id
        ) THEN 1 ELSE 0 END)
        + (CASE WHEN l.lat IS NOT NULL AND l.lng IS NOT NULL THEN 1 ELSE 0 END)
    ) / 4.0 AS completeness
FROM activities a
JOIN organizations o ON o.id = a.org_id
LEFT JOIN activity_categories c ON c.id = a.category_id
LEFT JOIN activity_locations al ON al.activity_id = a.id
LEFT JOIN locations l ON l.id = al.location_id
LEFT JOIN geographic_areas ga ON ga.id = l.area_id
GROUP BY 1, 2;

CREATE OR REPLACE VIEW v_funnel_daily AS
SELECT
    d.day,
    COALESCE(ga.name, 'all') AS district,
    SUM(d.searches)::int AS searches,
    SUM(d.listing_views)::int AS listing_views,
    SUM(d.cta_taps)::int AS cta_taps,
    SUM(d.leads_relayed)::int AS leads_relayed,
    SUM(d.bookings_confirmed)::int AS bookings_confirmed
FROM listing_events_daily d
LEFT JOIN locations l ON l.id = d.location_id
LEFT JOIN geographic_areas ga ON ga.id = l.area_id
GROUP BY 1, 2;

CREATE OR REPLACE VIEW v_provider_pipeline AS
SELECT
    o.id AS organization_id,
    o.name AS organization_name,
    o.created_at::date AS signed_up_on,
    CASE
        WHEN EXISTS (SELECT 1 FROM activities a WHERE a.org_id = o.id) THEN 'listed'
        WHEN COALESCE(cardinality(o.media_urls), 0) > 0 THEN 'profile'
        ELSE 'signed_up'
    END AS onboarding_step,
    (CURRENT_DATE - o.updated_at::date) AS days_since_last_edit,
    ls.status AS subscription_status
FROM organizations o
LEFT JOIN listing_subscriptions ls
    ON ls.organization_id = o.id
    AND ls.status IN ('trial', 'active', 'past_due');

COMMIT;

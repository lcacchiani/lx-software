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

-- §5.7 views. Catalog / funnel / pipeline tables live in the product schema;
-- adjust the FROM clauses if those names differ. The board only SELECTs these
-- views, with date-range and district/category parameters.

CREATE OR REPLACE VIEW v_catalog_health AS
SELECT
    COALESCE(s.district, 'unknown') AS district,
    COALESCE(a.category, 'unknown') AS category,
    COUNT(*)::int AS activities,
    COUNT(DISTINCT a.organization_id)::int AS providers,
    COUNT(DISTINCT a.store_id)::int AS stores,
    AVG(
        (CASE WHEN a.photo_count > 0 THEN 1 ELSE 0 END)
        + (CASE WHEN a.price_hkd IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN a.has_schedule THEN 1 ELSE 0 END)
        + (CASE WHEN s.geocoded THEN 1 ELSE 0 END)
    ) / 4.0 AS completeness
FROM activities a
LEFT JOIN stores s ON s.id = a.store_id
GROUP BY 1, 2;

CREATE OR REPLACE VIEW v_funnel_daily AS
SELECT
    d.day,
    COALESCE(s.district, 'all') AS district,
    SUM(d.searches)::int AS searches,
    SUM(d.listing_views)::int AS listing_views,
    SUM(d.cta_taps)::int AS cta_taps,
    SUM(d.leads_relayed)::int AS leads_relayed,
    SUM(d.bookings_confirmed)::int AS bookings_confirmed
FROM listing_events_daily d
LEFT JOIN stores s ON s.id = d.store_id
GROUP BY 1, 2;

CREATE OR REPLACE VIEW v_provider_pipeline AS
SELECT
    o.id AS organization_id,
    o.name AS organization_name,
    o.signed_up_on,
    o.onboarding_step,
    (CURRENT_DATE - o.last_edited_on) AS days_since_last_edit,
    ls.status AS subscription_status
FROM organizations o
LEFT JOIN listing_subscriptions ls
    ON ls.organization_id = o.id
    AND ls.status IN ('trial', 'active', 'past_due');

COMMIT;

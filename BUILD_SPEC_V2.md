# Menu App — Build Specification v2 (Recommended Stack)

Same product as [BUILD_SPEC.md](BUILD_SPEC.md) — a local-food discovery and ordering platform — re-specified on the stack I would choose to build it for real. The goal shifts from "edge-hosted MVP demo" to "production-ready marketplace that a small team can ship and scale."

---

## 1. Stack Choice & Rationale

| Layer | v1 (as built) | v2 (chosen) | Why change |
|---|---|---|---|
| Framework | Hono on Cloudflare Workers, hand-rolled SPA in one 57 kB vanilla JS file | **Next.js 15 (App Router) + React 19 + TypeScript** | The vanilla-JS SPA is the biggest liability — every view is string-built HTML with manual re-renders. React components + server components give type-safe UI, code-splitting, and SSR/SEO for vendor pages free. |
| Database | Cloudflare D1 (SQLite) | **PostgreSQL (Neon or Supabase) + PostGIS** | Real geo queries (`ORDER BY location <-> point` with an index) replace the fetch-200-rows-then-filter-in-JS approach. Concurrent writes, proper migrations, row-level constraints. |
| ORM / migrations | Raw SQL strings + `CREATE TABLE IF NOT EXISTS` middleware on every request | **Drizzle ORM + drizzle-kit migrations** | Typed queries end-to-end, schema as code, no runtime DDL. |
| Auth | Passwordless demo JWT, client picks its own role | **Better Auth** (email OTP + OAuth), sessions in Postgres | Real identity. Role/vendor membership stored server-side, never client-asserted. |
| Payments | Stub endpoint returning a fake client secret | **Stripe** — Payment Intents + **Stripe Connect** (Express) for vendor payouts | A marketplace needs split payments, refunds, and payouts; Connect is the standard answer and maps to the unused `payout_account_id` field in v1. |
| Validation | Manual clamps | **Zod** on every API boundary (shared schemas client/server) | |
| UI | Tailwind via CDN script, Font Awesome | **Tailwind CSS 4 (built) + shadcn/ui + lucide-react** | CDN Tailwind is dev-only by design; shadcn gives accessible modals/forms (the options-picker modal, checkout) without a component-library lock-in. |
| Client data | Hand-rolled `fetch` + global `state` object | **TanStack Query** + Server Actions | Caching, optimistic cart updates, and order-status polling for free. |
| Realtime order tracking | Client polling | **Server-Sent Events** from a `/api/orders/[id]/stream` route (upgrade path: Supabase Realtime / Pusher) | Cheap to run, no websocket infra for v1 of tracking. |
| Background jobs | none | **Inngest** (or Vercel Cron) — order auto-expiry, review aggregation, daily A/B rollups | Removes "do side-effects inline in the request" patterns. |
| Observability | Hand-rolled Sentry `fetch` | **Sentry SDK** + Vercel Analytics; A/B experiments via **PostHog** (replaces KV counters + cookie logic) | PostHog gives assignment, tracking, and significance testing; delete ~80 lines of custom hero-variant code. |
| Hosting | Cloudflare Pages | **Vercel** (Neon for DB) | First-class Next.js. (If staying on Cloudflare is a hard requirement, keep Workers and swap Next.js for this same spec on Hono + React Router — everything below still applies.) |
| Testing | none | **Vitest** (unit: pricing engine), **Playwright** (checkout + group-order E2E) | The pricing engine is pure functions — cheap to test, most expensive to get wrong. |

**What deliberately stays the same:** product scope, user roles, order lifecycle, pricing rules, and the overall "browse → customize → checkout → track" flow. This is a re-platform, not a redesign.

---

## 2. Project Layout

```
menu/
├── app/                          # Next.js App Router
│   ├── (marketing)/page.tsx      # Landing (RSC, static)
│   ├── (app)/
│   │   ├── browse/page.tsx       # Vendor discovery (RSC + client filters)
│   │   ├── vendors/[slug]/page.tsx  # Vendor profile + menu (RSC, ISR)
│   │   ├── checkout/page.tsx
│   │   ├── orders/[id]/page.tsx  # Live tracking (SSE client)
│   │   └── group/[code]/page.tsx
│   ├── vendor/                   # Vendor dashboard (role-gated layout)
│   │   ├── menu/page.tsx         # Menu editor (sections/items/options CRUD)
│   │   ├── orders/page.tsx       # Live order queue (accept → ready flow)
│   │   └── settings/page.tsx     # Hours, service modes, Stripe onboarding
│   └── api/                      # Route handlers (webhooks, SSE, public API)
│       ├── webhooks/stripe/route.ts
│       └── orders/[id]/stream/route.ts
├── lib/
│   ├── db/schema.ts              # Drizzle schema (single source of truth)
│   ├── db/queries/               # Typed query modules per domain
│   ├── pricing.ts                # Pure pricing engine (unit-tested)
│   ├── auth.ts                   # Better Auth config
│   └── validators/               # Zod schemas shared client/server
├── components/                   # shadcn/ui + domain components
├── drizzle/                      # Generated migrations
├── tests/
│   ├── pricing.test.ts
│   └── e2e/checkout.spec.ts
└── inngest/                      # Job functions
```

Server Actions handle authenticated mutations (cart, orders, menu CRUD); route handlers exist only for webhooks, SSE, and anything a third party calls.

---

## 3. Data Model (PostgreSQL + Drizzle)

Money is **integer cents** everywhere (unchanged). Key deltas from v1 noted inline.

### Identity
- **users** — `id uuid PK`, `email citext unique`, `phone`, `name`, `created_at` *(role moves off users — see memberships)*
- **sessions / accounts / verifications** — managed by Better Auth
- **vendor_members** — `user_id`, `vendor_id`, `role ('owner'|'staff')`, PK (user_id, vendor_id) — *replaces client-asserted `vendor_id` in the JWT; a user can belong to multiple vendors*

### Vendors & Catalog
- **vendors** — `id`, `slug unique`, `org_name`, `type` enum (`restaurant|truck|home_chef|street|baker|caterer`), `tier` enum, `verified bool`, `rating_avg numeric`, `rating_count int`, `stripe_account_id`, `service_modes jsonb`, `timezone text NOT NULL` *(new — fixes UTC-only hours)*, `created_at`
- **locations** — as v1, plus `geo geography(Point,4326)` column + GiST index *(replaces haversine-in-JS)*; `hours jsonb` interpreted in the vendor's timezone
- **menus / menu_sections / menu_items / option_groups / options** — same shape as v1, with FKs `ON DELETE CASCADE`, `position int` ordering, and `menu_items.dietary_tags text[]` *(new — replaces LIKE-based diet search)*
- **inventory** — `item_id PK`, `available_qty`, `out_of_stock_until` — now enforced: decremented in the order transaction, item hidden when depleted

### Orders & Payments
- **orders** — as v1 plus `public_code` (short human ref), `status` as Postgres enum, `promo_id FK`, `placed_at`; monetary breakdown unchanged (`subtotal, taxes, fees, tip, discount, total` — *discount now stored explicitly instead of mutating subtotal*)
- **order_items** — as v1, plus denormalized `item_name` and `unit_price` *(snapshot at purchase time so menu edits don't rewrite history)*
- **order_events** — `order_id`, `status`, `actor`, `created_at` *(new — audit trail powering the tracking timeline)*
- **payments** — `order_id`, `stripe_payment_intent_id`, `status`, `amount`, `application_fee`, `currency`; written by the Stripe webhook, not the client
- **promos** — `code unique`, `kind ('percent'|'fixed')`, `value`, `max_discount`, `vendor_id nullable` (platform-wide or per-vendor), `starts_at/ends_at`, `max_redemptions` *(replaces hardcoded SAVE10)*

### Engagement
- **reviews** — as v1 plus `order_id FK unique` *(new — only completed orders can be reviewed; one review per order)*; `rating_avg/count` recomputed by an Inngest job, not inline
- **loyalty_accounts** — (`user_id`, `vendor_id`) PK, `points` — plus **loyalty_ledger** (`account`, `delta`, `reason`, `order_id`) *(new — auditable accrual/redemption instead of blind UPDATEs)*
- **group_orders / group_order_items** — as v1; code generation identical (6 chars, no 0/O/1/I); `expires_at` *(new — auto-close via job)*
- **reservations** — as v1, status enum `requested|confirmed|declined|canceled` with vendor dashboard actions

---

## 4. API / Server Interface

Most mutations are **Server Actions** validated with Zod and gated by Better Auth session + `vendor_members` checks. Public/external surface:

| Kind | Surface | Notes |
|---|---|---|
| RSC data | Browse, vendor page, menu | Direct Drizzle queries in server components; vendor pages ISR-cached, revalidated on menu edit (`revalidateTag('vendor:{id}')`) |
| Server Actions | `addToCart`-less (cart is client state) → `placeOrder`, `submitGroupOrder`, `postReview`, `requestReservation`, vendor menu CRUD, `updateOrderStatus` | Each returns typed result or field errors |
| Route handlers | `POST /api/webhooks/stripe` (payment_intent.succeeded → mark paid, decrement inventory, emit order_event, award loyalty), `GET /api/orders/[id]/stream` (SSE), `GET /api/v1/vendors...` (optional public JSON API, mirrors v1 catalog endpoints) | |

**Discovery query (replaces v1's fetch-200-filter-in-JS):** one SQL query with `WHERE` on type/tags/service modes, `ST_DWithin` for max radius, `ORDER BY geo <-> :point | rating | last_updated`, keyset pagination. Open-now computed in SQL against the vendor's timezone (`now() AT TIME ZONE vendors.timezone`).

**Checkout flow (replaces stub payments):**
1. Client builds cart → `placeOrder` action re-prices server-side via `lib/pricing.ts`, creates `orders` row (status `PendingPayment`) **and** a Stripe PaymentIntent with `application_fee_amount` (platform commission) + `transfer_data.destination` = vendor's Connect account, inside one DB transaction.
2. Client confirms with Stripe Elements.
3. Webhook flips order to `Submitted`, notifies vendor dashboard (SSE), starts the status lifecycle: `Submitted → Accepted → InPrep → Ready → OutForDelivery → Completed | Canceled | Refunded` — transitions validated by a state machine; every change appends to `order_events`.
4. Refunds go through Stripe and reverse loyalty via the ledger.

---

## 5. Business Rules (unchanged, now isolated & tested)

`lib/pricing.ts` is a pure function `price(cart, context) → breakdown`:

1. Unit price = DB `base_price` + Σ selected option `price_delta` (server re-read; option selections validated against group min/max/required — *v1 only enforced this in the UI*).
2. Taxes = `round(subtotal × taxRate)` — rate from vendor region config (default 8%).
3. Fees: pickup 99¢; delivery 399¢ + quote `199 + 80×km` (km from PostGIS distance, not client-supplied), ETA `30 + 4×km` min.
4. Promo: looked up in `promos` (validity window, redemption cap, vendor scope), `percent` capped by `max_discount`.
5. Loyalty: 1 pt = 1¢; redemption ≤ min(requested, balance, subtotal − promo); accrual `floor(total/100)` pts — both as ledger entries.
6. Tip ≥ 0; Total = `max(0, subtotal + taxes + fees + tip − discount)`.

Vitest covers: option pricing, promo caps/expiry, loyalty caps, delivery quotes, rounding, and the state-machine transitions.

---

## 6. Frontend Specification

- **Landing** (`/`) — same content as v1 (hero, categories, how-it-works, vendor CTA). Hero A/B via PostHog feature flag (`hero-variant: bg|card`) with exposure events; delete the cookie/KV/`hero.js` machinery.
- **Browse** (`/browse`) — server-rendered first page; filters (text, type, open-now, pickup/delivery, dietary tags, distance slider with geolocation) update via URL search params → RSC refetch; TanStack Query for infinite scroll.
- **Vendor page** (`/vendors/[slug]`) — menu with sections, item cards; **options modal** (shadcn Dialog + RadioGroup/Checkbox honoring min/max/required with live price); reviews tab; reservation form; loyalty balance; "Start group order" button.
- **Cart** — client-side (Zustand store, persisted to localStorage), single-vendor rule as v1.
- **Checkout** — type toggle, address → delivery quote, tip presets, promo field, loyalty slider, Stripe Payment Element.
- **Order tracking** (`/orders/[id]`) — timeline from `order_events` over SSE; map placeholder for future truck tracking.
- **Group order** (`/group/[code]`) — join with a display name (guest ok), live participant list + subtotal via SSE, owner-only submit panel.
- **Vendor dashboard** (`/vendor`) — order queue with one-tap status advance (drives customer SSE), menu editor (sections/items/options, drag-reorder, availability + inventory toggles), hours/timezone/service-mode settings, Stripe Connect onboarding link, reservations inbox.

Accessibility and dark mode come from shadcn/Tailwind defaults; all forms are Zod-validated with inline field errors.

---

## 7. Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Auth |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Payments |
| `NEXT_PUBLIC_POSTHOG_KEY` | Experiments/analytics |
| `SENTRY_DSN` | Errors |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Jobs |

---

## 8. Build, Run, Deploy

```bash
pnpm install
pnpm drizzle-kit migrate        # apply migrations
pnpm db:seed                    # demo vendors/menus (same dataset as v1)
pnpm dev                        # next dev + stripe listen --forward-to /api/webhooks/stripe

pnpm test                       # vitest (pricing, state machine)
pnpm test:e2e                   # playwright (checkout, group order)

# Deploy: push to main → Vercel preview/production; migrations run in CI before promote
```

---

## 9. Migration Path from v1 (if reusing the existing app)

1. Export D1 → import into Postgres (schema maps 1:1; add `slug`, `timezone`, split `discount` out of `subtotal`).
2. Ship the Next.js app behind the same domain; keep v1 `/api/*` JSON shapes as a compatibility layer during cutover if anything external consumes them.
3. Backfill `vendor_members` from the vendors' contact emails; force re-auth (v1 tokens are unverifiable demo JWTs — invalidate all).
4. Onboard vendors to Stripe Connect before enabling real checkout; until then run in "test mode" with the v1-style fake intent.

## 10. Explicitly Deferred (same as v1, now with a home)

- Live food-truck GPS tracking → later via vendor mobile app pings + the existing SSE channel.
- Courier dispatch/marketplace logistics → integrate DoorDash Drive / Uber Direct behind the delivery-quote interface.
- Native mobile apps → the "Get App" CTA remains aspirational; PWA manifest ships in v2.

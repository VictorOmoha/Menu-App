# Menu App — Build Specification

A local-food discovery and ordering platform ("Menu") connecting customers with restaurants, food trucks, home chefs, street vendors, and bakeries. This document specifies the full system as built, sufficient to rebuild it from scratch.

---

## 1. Product Overview

**Concept:** Customers discover nearby food vendors, browse menus, customize items, and place pickup or delivery orders. Vendors onboard, publish menus, and manage service modes. The platform supports group ordering, loyalty points, reservations, and reviews.

**User roles:**
| Role | Capabilities |
|---|---|
| Guest / Customer | Browse vendors, search/filter, order, review, reserve, join group orders, earn/redeem loyalty points |
| Vendor | Manage own profile, service modes, menu skeleton (JWT-protected endpoints) |
| Admin | Same as vendor plus implicit elevated role in JWT |

**Core user journeys:**
1. **Discover** — search and filter vendors (by text, type, open-now, pickup/delivery, diet keywords, distance).
2. **Order** — build a cart with item options, choose pickup/delivery, apply tip/promo/loyalty, check out, then track order status.
3. **Group order** — start a shareable code-based group cart; multiple people add items; owner submits one combined order.
4. **Engage** — leave reviews (recalculates vendor rating), request reservations, accrue loyalty points per vendor.
5. **Vendor onboarding** — login with vendor role, set service modes, generate a starter menu.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Pages + Workers (edge, `nodejs_compat` flag) |
| Backend framework | Hono ^4.9.4 (TypeScript, JSX SSR via `hono/jsx-renderer`) |
| Database | Cloudflare D1 (SQLite), binding `DB` |
| KV store | Cloudflare KV, binding `KV` (A/B impression counters) |
| Auth | JWT via `hono/jwt` (HS256), `JWT_SECRET` env (falls back to `dev-secret`) |
| Frontend | Server-rendered shell + vanilla JS SPA (`public/static/app.js`), Tailwind CSS (CDN), Font Awesome 6.4 (CDN) |
| Build | Vite ^6.3.5 + `@hono/vite-cloudflare-pages` → single `dist/_worker.js` (~96 kB) |
| Dev/deploy CLI | Wrangler ^4.4.0 |
| Observability | Minimal hand-rolled Sentry client (`SENTRY_DSN` env, optional) |

**Project layout:**
```
├── src/
│   ├── index.tsx        # All backend routes + SSR pages (single file, ~1300 lines)
│   └── renderer.tsx     # HTML document shell (Tailwind + FA + app.js)
├── public/static/
│   ├── app.js           # SPA frontend (~57 kB vanilla JS)
│   ├── hero.js          # Hero A/B auto-rotation script
│   ├── style.css, tokens.css
├── migrations/webapp-production/0001_initial_schema.sql
├── seed.sql             # Demo data
├── wrangler.jsonc       # D1 + KV bindings, pages_build_output_dir: ./dist
├── vite.config.ts
└── ecosystem.config.cjs # PM2 config (sandbox dev)
```

---

## 3. Data Model (D1 / SQLite)

All prices stored as **integer cents**.

### Users & Auth
- **users** — `id`, `email` (unique), `phone`, `role` (`customer` | `vendor` | `admin`, default `customer`), `created_at`
- **sessions** — `id` (token PK), `user_id` FK, `created_at` *(defined in migration; runtime auth actually uses stateless JWT)*

### Vendors & Catalog
- **vendors** — `id`, `org_name`, `type` (`restaurant` | `truck` | `home_chef` | `street` | `baker` | `caterer`), `tier` (default `basic`; `premium` exists), `verified` (0/1), `rating_avg`, `rating_count`, `payout_account_id`, `service_modes_json` (e.g. `{"pickup":true,"delivery":true,"dinein":true}`), `created_at`
- **locations** — `id`, `vendor_id` FK, address fields (`address`, `city`, `region`, `postal_code`, `country`), `lat`, `lng`, `hours_json` (weekly map, e.g. `{"mon":["10:00-20:00"]}`), `is_live_tracking` (0/1), `created_at`
- **menus** — `id`, `vendor_id` FK, `title`, `is_active`, `last_updated`
- **menu_sections** — `id`, `menu_id` FK, `name`, `sort_order`
- **menu_items** — `id`, `section_id` FK, `name`, `description`, `photo`, `base_price` (cents), `is_available`
- **option_groups** — `id`, `item_id` FK, `name`, `min`, `max`, `required`
- **options** — `id`, `group_id` FK, `name`, `price_delta` (cents, +/−)
- **inventory** — `item_id` PK/FK, `available_qty`, `out_of_stock_until` *(schema only; not used by API yet)*

### Orders & Payments
- **orders** — `id`, `user_id`, `vendor_id`, `location_id`, `type` (`pickup` | `delivery`), `subtotal`, `taxes`, `fees`, `tip`, `total`, `status`, `eta`, `created_at`
  - Status lifecycle: `Draft → Submitted → Accepted → In-Prep → Ready → Out-for-Delivery → Completed` (plus `Canceled`, `Refunded`)
- **order_items** — `id`, `order_id`, `item_id`, `qty`, `selected_options_json` (array of option ids), `line_total`
- **payments** — `id`, `order_id`, `provider` (default `test`), `intent_id`, `status` (`created`/`authorized`/`captured`/`refunded`/`failed`), `amount`, `currency` *(schema only; payment intent endpoint is a stub)*

### Engagement
- **reviews** — `id`, `user_id`, `vendor_id`, `rating` (1–5), `text`, `status` (`published`/`flagged`/`removed`), `created_at`
- **loyalty** — composite PK (`user_id`, `vendor_id`), `points` (1 point = 1 cent redemption value)
- **group_orders** — `id`, `vendor_id`, `code` (unique 6-char, alphabet excludes 0/O/1/I), `owner_user_id`, `status` (`open` → `submitted`)
- **group_order_items** — `id`, `group_id`, `user_id`, `user_name`, `item_id`, `qty`, `selected_options_json`, `line_total`
- **reservations** — `id`, `user_id`, `vendor_id`, `party_size` (1–20), `datetime_iso`, `notes`, `status` (default `requested`)

**Schema bootstrap:** an `ensureSchemaAndSeed(db)` middleware runs on every `/api/*` request — creates all tables idempotently (`CREATE TABLE IF NOT EXISTS`), applies column evolutions (e.g. backfills `vendors.service_modes_json`), and seeds demo data on first run (3 vendors: Sunset Tacos / Home Chef Nia / Green Bowl, with locations, menus, items, and option groups).

---

## 4. API Specification

Base path `/api`, JSON in/out, CORS enabled. Errors return `{ "error": "<code>" }` with appropriate HTTP status. Global `onError` returns `{error:"internal_error"}` (500) and reports to Sentry when configured.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Demo passwordless login. Body: `{email, role?, vendor_id?}`. Upserts user by email, returns `{token, user}` — JWT payload `{sub, email, role, vendor_id?}`. Roles limited to `customer`/`vendor`/`admin`. |

Protected vendor endpoints require `Authorization: Bearer <jwt>`; `requireVendor` additionally requires role `vendor` (with `vendor_id` in token) or `admin`.

### Vendor onboarding (protected)
| Method | Path | Description |
|---|---|---|
| GET | `/api/vendor/self` | Own vendor record + latest menu |
| POST | `/api/vendor/service-modes` | Body `{service_modes: {...}}` → updates `service_modes_json` |
| POST | `/api/vendor/menu-skeleton` | Creates "Main Menu" + "Featured" section if the vendor has no menu; returns `{menu_id, created}` |

### Catalog (public)
| Method | Path | Description |
|---|---|---|
| GET | `/api/vendors` | Search/filter/sort. Query params: `q` (name LIKE), `type`, `open_now=1`, `pickup=1`, `delivery=1`, `diet` (CSV keyword match against item name/description), `near=lat,lng`, `max_km`, `sort=rating\|distance\|updated\|trending`. Returns enriched list: `open_now` (computed from `hours_json` vs current UTC time), `distance_km` (haversine to nearest location). SQL-filtered on q/type (LIMIT 200), remaining filters applied in-memory. |
| GET | `/api/vendors/:id` | Vendor + parsed `service_modes` + locations + `open_now` |
| POST | `/api/vendors` | Create vendor `{org_name, type, tier?}` (unauthenticated — demo) |
| GET | `/api/vendors/:id/menus` | Latest active menu with sections → items (nested) |
| GET | `/api/items/:id/options` | Option groups with nested options for an item |

### Orders
| Method | Path | Description |
|---|---|---|
| POST | `/api/orders` | Create order. Body: `{vendor_id, type: 'pickup'\|'delivery', items: [{item_id, qty, selected_options?: number[]}], user_id?, tip_cents?, promo_code?, distance_km?, loyalty_points?}`. Server re-prices every line from DB. Returns `{order}`. |
| GET | `/api/orders/:id` | Order + items (joined with item names) |
| POST | `/api/orders/:id/status` | Update status (validated against the allowed set) + optional `eta` |

### Group orders
| Method | Path | Description |
|---|---|---|
| POST | `/api/group/start` | `{vendor_id}` → creates open group, returns `{group_id, code}` |
| GET | `/api/group/:code` | Group + items + running subtotal |
| POST | `/api/group/:code/add` | `{item_id, qty, selected_options?, user_name?}` — server-priced line added |
| POST | `/api/group/:code/submit` | Owner checkout: same pricing rules as `/api/orders`; flattens group items into a real order, closes group (`submitted`) |

### Engagement
| Method | Path | Description |
|---|---|---|
| GET | `/api/vendors/:id/reviews` | Latest 20 published reviews |
| POST | `/api/vendors/:id/reviews` | `{rating (1–5 clamped), text?}` → inserts and recalculates `vendors.rating_avg/rating_count` |
| GET | `/api/vendors/:id/loyalty` | Current user's points at vendor |
| GET | `/api/vendors/:id/reservations` | User's last 20 reservations at vendor |
| POST | `/api/vendors/:id/reservations` | `{party_size, datetime_iso, notes?}` → status `requested` |

### Logistics & payments (stubs)
| Method | Path | Description |
|---|---|---|
| POST | `/api/delivery/quote` | `{distance_km}` → `{fee: 199 + km*80 cents, eta_minutes: 30 + km*4}` |
| POST | `/api/payments/intent` | `{amount, currency?}` → fake `{provider:'test', client_secret}` (production: Stripe/Adyen PaymentIntent) |

### Utility / metrics
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | `{ok:true}` |
| POST | `/api/dev/ensure` | Force schema+seed bootstrap |
| POST | `/api/metrics/ab-hero?variant=bg\|card` | Increment KV impression counter `impressions:hero:{variant}:{YYYY-MM-DD}` |

---

## 5. Business Rules (Pricing Engine)

Applied identically in `/api/orders` and `/api/group/:code/submit` — all server-side, in cents:

1. **Unit price** = `menu_items.base_price` + Σ `options.price_delta` for selected options (re-read from DB, never trusted from client).
2. **Line total** = unit × qty (qty clamped ≥ 1). **Subtotal** = Σ lines.
3. **Taxes** = `round(subtotal × 8%)`.
4. **Fees** = flat 399 (delivery) or 99 (pickup); if delivery with a `distance_km`, add distance quote `round(199 + km×80)` and set ETA `30 + round(km×4)` minutes.
5. **Promo** — single hardcoded code `SAVE10`: 10% off subtotal, capped at 500 (i.e. $5).
6. **Loyalty redemption** — 1 point = 1 cent; capped at min(requested, available balance, subtotal − promo discount). Deducted after order creation (floor at 0).
7. **Tip** = client-provided `tip_cents` (clamped ≥ 0).
8. **Total** = `max(0, subtotal + taxes + fees + tip − discount)`. Stored `subtotal` is the discounted subtotal.
9. **Loyalty accrual** — `floor(total / 100)` points (1 point per $1) upserted per (user, vendor).

**Open-now computation:** parse `hours_json` per location, compare current **UTC** `HH:MM` against day ranges (documented MVP simplification — no timezone handling).

**Distance:** haversine (km, R=6371) from `near` query point to nearest vendor location, 2-decimal rounding.

---

## 6. Frontend Specification

### Pages (server-rendered by Hono JSX)
- **`/` Landing** — top nav (How it Works / For Business / Support, Sign In, Get App), hero, categories card (Restaurants, Food Trucks, Home Chefs, Bakeries & More), "How It Works" 3-step section (Discover → Order → Enjoy), vendor CTA section. CTA "Get Started" → `/app`.
- **`/app` SPA shell** — header + empty `#app` div; `public/static/app.js` renders everything client-side.
- **`/ab/reset`** — clears hero A/B cookie, redirects home.

### Hero A/B test
- Two variants: `bg` (full-bleed background image + overlay) and `card` (white background, image in card). Both are rendered; visibility toggled.
- Selection: `?hero=bg|card` query override, else weighted random (default 80% bg / 20% card, tunable via `?hero_bias=`).
- `hero.js` auto-rotates variants every 10–15 s; impressions counted in KV per variant per day (server-side on render + `/api/metrics/ab-hero` beacon).

### SPA (`app.js`) — vanilla JS, global `state` object, re-render functions
- **Home view** (`renderHome`) — vendor list with filter bar: text search, type select, pickup/delivery/open-now toggles, sort (rating/distance/updated/trending), geolocation "near me" + max-km.
- **Vendor view** (`renderVendor`) — vendor profile, menu sections/items, add-to-cart with an **options modal** (respects group min/max/required, price deltas), reviews (list + submit), reservations (list + request form), loyalty points display, group-order start/join.
- **Cart & checkout** — per-vendor cart; type pickup/delivery, delivery distance → live quote, tip, promo code, loyalty toggle; places order via `/api/orders`.
- **Order summary/tracking** (`renderOrderSummary`) — order details with status; polls for status updates (`state.orderPoll`).
- **Group order view** (`renderGroup(code)`) — shared cart by code: participants add named items via options modal; owner submits with the same checkout options.
- Prices formatted from cents via `money()`.

### Styling
Tailwind via CDN (no build step for CSS), black-and-white minimal aesthetic, Font Awesome icons, custom `style.css`/`tokens.css` for section dividers and design tokens.

---

## 7. Configuration & Environments

**Bindings (wrangler.jsonc):**
- `DB` → D1 database `webapp-production` (id `a1b81f43-...`)
- `KV` → KV namespace (id `db4b8b7d...`)
- `compatibility_date: 2025-01-01`, `nodejs_compat`

**Environment variables / secrets:**
| Name | Purpose | Default |
|---|---|---|
| `JWT_SECRET` | JWT signing secret | `dev-secret` (dev only — must be set in production) |
| `SENTRY_DSN` | Error reporting (optional) | unset → console.error |

## 8. Build, Run, Deploy

```bash
npm install
npm run build            # vite build → dist/_worker.js

# Local D1 setup (migrations live in migrations/webapp-production/)
npx wrangler d1 migrations apply webapp-production --local
npx wrangler d1 execute webapp-production --local --file=./seed.sql

# Local preview (serves built worker + static, with local D1/KV)
npm run dev:sandbox      # wrangler pages dev dist --port 3000
# or plain vite dev (no CF bindings): npm run dev

# Deploy
npm run deploy           # build + wrangler pages deploy dist
npm run deploy:prod      # ... --project-name webapp
```

Other scripts: `db:reset` (wipe local D1 state + re-migrate + seed), `cf-typegen` (generate `CloudflareBindings` types), `test` (curl smoke check). `ecosystem.config.cjs` provides a PM2 entry for sandbox hosting.

---

## 9. Known Limitations / Deliberate MVP Stubs

- **Auth is demo-grade:** email-only login with client-chosen role and vendor_id — no password/OTP. Production needs real identity + vendor-account linkage.
- **Payments stubbed:** `/api/payments/intent` returns a fake secret; `payments` table unused. Integrate Stripe/Adyen.
- **Hardcoded demo user:** most customer endpoints (`user_id ?? 1`) default to user 1 instead of reading the JWT.
- **Open-now uses UTC** — no vendor timezone support.
- **Promo codes hardcoded** (`SAVE10` only); no promo table.
- **Inventory & sessions tables unused** by the API.
- **In-memory filtering** on `/api/vendors` after a LIMIT 200 SQL fetch — fine for MVP, won't scale.
- **`ensureSchemaAndSeed` on every API request** — dev convenience; remove in production in favor of migrations only.
- **No tests, no rate limiting, no input schema validation library** (manual clamps/checks only).
- **Live truck tracking** (`is_live_tracking`) is modeled but has no tracking endpoint yet.

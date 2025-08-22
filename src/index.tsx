import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { renderer } from './renderer'
import { serveStatic } from 'hono/cloudflare-workers'

// Types for Cloudflare Bindings
export type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS for API routes (adjust origins in production)
app.use('/api/*', cors())
// Ensure schema + seed on first API hit (local dev convenience)
app.use('/api/*', async (c, next) => {
  await ensureSchemaAndSeed(c.env.DB)
  await next()
})

// Serve static assets from public/ at /static/*
app.use('/static/*', serveStatic({ root: './public' }))

// Renderer for SSR shell
app.use(renderer)

// Home route renders landing page (clean marketing page)
app.get('/', (c) => {

  const heroImage = 'https://page.gensparksite.com/v1/base64_upload/5d08717649f52e98bdb4154062ac3323'
  return c.render(
    <div>
      {/* Top Nav */}
      <header class="bg-white border-b">
        <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div class="text-xl font-semibold">Menu</div>
          <nav class="hidden md:flex items-center gap-6 text-sm text-gray-700">
            <a href="#how" class="hover:text-gray-900">How it Works</a>
            <a href="#vendors" class="hover:text-gray-900">For Business</a>
            <a href="#support" class="hover:text-gray-900">Support</a>
          </nav>
          <div class="flex items-center gap-2">
            <a href="#signin" class="px-3 py-1.5 text-sm border rounded">Sign In</a>
            <a href="#getapp" class="px-3 py-1.5 text-sm bg-black text-white rounded">Get App</a>
          </div>
        </div>
      </header>

      {/* Hero: two-column layout, image not used as background */}
      <section class="bg-white">
        <div class="max-w-7xl mx-auto px-6 py-16 md:py-24 grid md:grid-cols-2 gap-8 md:gap-12 items-center">
          {/* Copy */}
          <div>
            <h1 class="text-5xl md:text-6xl font-bold text-gray-900">Discover Local Flavors</h1>
            <p class="mt-4 md:mt-6 text-lg md:text-xl text-gray-600">From street vendors to fine dining. Find amazing food from restaurants, food trucks, home chefs, and local vendors in your area.</p>
            <div class="mt-8 flex items-center gap-3">
              <a id="cta-get-started" href="/app" class="px-5 py-3 bg-black text-white rounded font-semibold">Get Started</a>
              <a id="cta-download" href="#getapp" class="px-5 py-3 border border-gray-300 text-gray-900 rounded">Download App</a>
            </div>

            {/* Categories Card */}
            <div class="mt-10 md:mt-12 bg-white text-gray-900 rounded-2xl shadow p-6 md:p-8 max-w-4xl">
              <div class="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
                <div class="flex items-start gap-4">
                  <div class="text-black"><i class="fa-solid fa-utensils"></i></div>
                  <div>
                    <div class="font-semibold">Restaurants</div>
                    <div class="text-xs text-gray-500">Browse menus from local restaurants</div>
                  </div>
                </div>
                <div class="flex items-start gap-4">
                  <div class="text-black"><i class="fa-solid fa-truck"></i></div>
                  <div>
                    <div class="font-semibold">Food Trucks</div>
                    <div class="text-xs text-gray-500">Track live locations and menus</div>
                  </div>
                </div>
                <div class="flex items-start gap-4">
                  <div class="text-black"><i class="fa-solid fa-kitchen-set"></i></div>
                  <div>
                    <div class="font-semibold">Home Chefs</div>
                    <div class="text-xs text-gray-500">Authentic homemade meals</div>
                  </div>
                </div>
                <div class="flex items-start gap-4">
                  <div class="text-black"><i class="fa-solid fa-bread-slice"></i></div>
                  <div>
                    <div class="font-semibold">Bakeries & More</div>
                    <div class="text-xs text-gray-500">Fresh baked goods and specialty</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Visual: use the provided image inside a card, not as background */}
          <div class="relative">
            <figure class="rounded-2xl shadow-xl ring-1 ring-black/5 overflow-hidden bg-white">
              <img src={heroImage} alt="Design preview" class="w-full h-auto object-cover" />
            </figure>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how" class="bg-white">
        <div class="max-w-7xl mx-auto px-6 py-16 md:py-20">
          <h2 class="text-3xl md:text-4xl font-bold">How It Works</h2>
          <div class="mt-8 grid md:grid-cols-3 gap-10 text-sm">
            <div>
              <div class="text-lg font-semibold">1. Discover</div>
              <p class="text-gray-600">Find local food vendors near you</p>
            </div>
            <div>
              <div class="text-lg font-semibold">2. Order</div>
              <p class="text-gray-600">Choose pickup, delivery, or dine in</p>
            </div>
            <div>
              <div class="text-lg font-semibold">3. Enjoy</div>
              <p class="text-gray-600">Track and enjoy your order</p>
            </div>
          </div>
        </div>
      </section>

      {/* Vendors CTA */}
      <section id="vendors" class="bg-gray-50">
        <div class="max-w-7xl mx-auto px-6 py-16 md:py-20 grid md:grid-cols-3 gap-8 items-stretch">
          <div class="md:col-span-2">
            <h3 class="text-xl font-semibold">Grow your business with Menu</h3>
            <p class="mt-2 text-gray-600">Join our platform to reach new customers and manage orders, menus, loyalty, group orders and more.</p>
          </div>
          <div class="bg-white rounded-2xl shadow-lg p-8">
            <div class="text-lg font-semibold">For Vendors</div>
            <p class="mt-2 text-sm text-gray-600">Grow your business with Menu</p>
            <a href="#join" class="mt-4 inline-block px-4 py-2 bg-black text-white rounded">Join as Vendor</a>
          </div>
        </div>
      </section>


    </div>
  )
})

// SPA shell route for the app experience
app.get('/app', (c) => {
  return c.render(
    <div>
      <header class="bg-white border-b">
        <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div class="text-xl font-semibold"><a href="/">Menu</a></div>
          <nav class="hidden md:flex items-center gap-6 text-sm text-gray-700">
            <a href="/" class="hover:text-gray-900">Home</a>
          </nav>
        </div>
      </header>
      <main class="max-w-7xl mx-auto px-6 py-8">
        <div id="app" class="space-y-4 md:space-y-6"></div>
      </main>
    </div>
  )
})


// ---------- Helpers ----------
async function queryAll<T>(db: D1Database, sql: string, bind: unknown[] = []) {
  return (await db.prepare(sql).bind(...bind).all<T>()).results || []
}
async function queryOne<T>(db: D1Database, sql: string, bind: unknown[] = []) {
  const res = await db.prepare(sql).bind(...bind).first<T>()
  return res || null
}

async function tableExists(db: D1Database, name: string) {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind(name)
    .first<{ name: string }>()
  return !!row
}

async function columnExists(db: D1Database, table: string, column: string) {
  // Use PRAGMA table_info to check column existence
  const row = await db
    .prepare(`SELECT 1 AS ok FROM pragma_table_info('${table}') WHERE name = ? LIMIT 1`)
    .bind(column)
    .first<{ ok: number }>()
  return !!row
}

function isOpenNow(hoursJson?: string | null): boolean {
  if (!hoursJson) return false
  try {
    const map = JSON.parse(hoursJson) as Record<string, string[]>
    const now = new Date()
    // Cloudflare Workers use UTC; this is a simplification for MVP
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const day = days[now.getUTCDay()]
    const ranges = map[day]
    if (!Array.isArray(ranges)) return false
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
    const hhmm = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`
    return ranges.some((r) => {
      const [start, end] = r.split('-')
      return start <= hhmm && hhmm <= end
    })
  } catch {
    return false
  }
}

function haversineKm(lat1?: number | null, lon1?: number | null, lat2?: number | null, lon2?: number | null) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Number.POSITIVE_INFINITY
  const toRad = (x: number) => (x * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

async function ensureSchemaAndSeed(db: D1Database) {
  // Create minimal tables if they don't exist
  if (!(await tableExists(db, 'vendors'))) {
    // Users
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, phone TEXT, role TEXT NOT NULL DEFAULT 'customer', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
      )
      .run()
    // Vendors & Catalog
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS vendors (id INTEGER PRIMARY KEY AUTOINCREMENT, org_name TEXT NOT NULL, type TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'basic', verified INTEGER NOT NULL DEFAULT 0, rating_avg REAL DEFAULT 0, rating_count INTEGER DEFAULT 0, payout_account_id TEXT, service_modes_json TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
      )
      .run()
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL, address TEXT, city TEXT, region TEXT, postal_code TEXT, country TEXT, lat REAL, lng REAL, hours_json TEXT, is_live_tracking INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (vendor_id) REFERENCES vendors(id))`
      )
      .run()
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_locations_vendor_id ON locations(vendor_id)`).run()
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS menus (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL, title TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (vendor_id) REFERENCES vendors(id))`
      )
      .run()
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_menus_vendor_id ON menus(vendor_id)`).run()
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS menu_sections (id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (menu_id) REFERENCES menus(id))`
      )
      .run()
    await db
      .prepare(`CREATE INDEX IF NOT EXISTS idx_menu_sections_menu_id ON menu_sections(menu_id)`).run()
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, section_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, photo TEXT, base_price INTEGER NOT NULL, is_available INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (section_id) REFERENCES menu_sections(id))`
      )
      .run()
    await db
      .prepare(`CREATE INDEX IF NOT EXISTS idx_menu_items_section_id ON menu_items(section_id)`).run()
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS option_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, name TEXT NOT NULL, min INTEGER NOT NULL DEFAULT 0, max INTEGER NOT NULL DEFAULT 1, required INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (item_id) REFERENCES menu_items(id))`
      )
      .run()
    await db
      .prepare(`CREATE INDEX IF NOT EXISTS idx_option_groups_item_id ON option_groups(item_id)`).run()
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS options (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, name TEXT NOT NULL, price_delta INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (group_id) REFERENCES option_groups(id))`
      )
      .run()
    // Orders (for checkout)
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, vendor_id INTEGER NOT NULL, location_id INTEGER, type TEXT NOT NULL, subtotal INTEGER NOT NULL, taxes INTEGER NOT NULL, fees INTEGER NOT NULL, tip INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Submitted', eta TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
      )
      .run()
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`).run()
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_vendor_id ON orders(vendor_id)`).run()
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, item_id INTEGER NOT NULL, qty INTEGER NOT NULL, selected_options_json TEXT, line_total INTEGER NOT NULL)`
      )
      .run()
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`).run()

    // Seed minimal data
    await db
      .prepare(`INSERT INTO users (email, phone, role) VALUES ('alice@example.com','+15550000001','customer')`)
      .run()
    await db
      .prepare(
        `INSERT INTO vendors (org_name, type, tier, verified, rating_avg, rating_count, service_modes_json) VALUES ('Sunset Tacos','truck','basic',1,4.6,213,'{"pickup":true,"delivery":true}'), ('Home Chef Nia','home_chef','basic',1,4.9,87,'{"pickup":true}'), ('Green Bowl','restaurant','premium',1,4.4,512,'{"pickup":true,"delivery":true,"dinein":true}')`
      )
      .run()
    await db
      .prepare(
        `INSERT INTO locations (vendor_id, address, city, region, postal_code, country, lat, lng, hours_json, is_live_tracking) VALUES (1,'123 5th Ave','Metropolis','CA','94000','US',37.7749,-122.4194,'{"mon":["10:00-20:00"]}',1), (2,'12 Baker St','Metropolis','CA','94000','US',37.78,-122.41,'{"mon":["09:00-18:00"]}',0), (3,'500 Market St','Metropolis','CA','94000','US',37.79,-122.42,'{"mon":["11:00-22:00"]}',0)`
      )
      .run()
    await db
      .prepare(
        `INSERT INTO menus (vendor_id, title, is_active) VALUES (1,'Everyday Menu',1), (2,'Weekly Specials',1), (3,'Healthy Bowls',1)`
      )
      .run()
    await db
      .prepare(
        `INSERT INTO menu_sections (menu_id, name, sort_order) VALUES (1,'Tacos',1),(1,'Sides',2),(2,'Home Meals',1),(3,'Bowls',1)`
      )
      .run()
    await db
      .prepare(
        `INSERT INTO menu_items (section_id, name, description, photo, base_price, is_available) VALUES (1,'Al Pastor Taco','Marinated pork with pineapple',NULL,450,1),(1,'Chicken Taco','Grilled chicken taco',NULL,400,1),(2,'Chips & Salsa','Corn chips with salsa',NULL,250,1),(3,'Jollof Bowl','West African rice bowl',NULL,1200,1),(4,'Green Goddess','Kale, quinoa, avocado',NULL,1300,1)`
      )
      .run()
    await db
      .prepare(
        `INSERT INTO option_groups (item_id, name, min, max, required) VALUES (1,'Salsa',0,2,0),(2,'Salsa',0,2,0),(5,'Protein',1,1,1)`
      )
      .run()
    await db
      .prepare(
        `INSERT INTO options (group_id, name, price_delta) VALUES (1,'Mild',0),(1,'Hot',0),(2,'Mild',0),(2,'Hot',0),(3,'Tofu',0),(3,'Chicken',200),(3,'Salmon',400)`
      )
      .run()
  }

  // Idempotent evolutions and safety nets for local dev
  if (await tableExists(db, 'vendors')) {
    const hasModes = await columnExists(db, 'vendors', 'service_modes_json')
    if (!hasModes) {
      await db.prepare(`ALTER TABLE vendors ADD COLUMN service_modes_json TEXT`).run()
    }
    // Backfill sensible defaults for local dev databases missing values
    await db
      .prepare(
        `UPDATE vendors
         SET service_modes_json = CASE
           WHEN type = 'home_chef' THEN '{"pickup":true}'
           ELSE '{"pickup":true,"delivery":true}'
         END
         WHERE service_modes_json IS NULL OR service_modes_json = ''`
      )
      .run()
  }

  // Ensure core tables always exist (in case a partial DB already existed)
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL, address TEXT, city TEXT, region TEXT, postal_code TEXT, country TEXT, lat REAL, lng REAL, hours_json TEXT, is_live_tracking INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (vendor_id) REFERENCES vendors(id))`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_locations_vendor_id ON locations(vendor_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS menus (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL, title TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (vendor_id) REFERENCES vendors(id))`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_menus_vendor_id ON menus(vendor_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS menu_sections (id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (menu_id) REFERENCES menus(id))`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_menu_sections_menu_id ON menu_sections(menu_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, section_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, photo TEXT, base_price INTEGER NOT NULL, is_available INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (section_id) REFERENCES menu_sections(id))`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_menu_items_section_id ON menu_items(section_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS option_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, name TEXT NOT NULL, min INTEGER NOT NULL DEFAULT 0, max INTEGER NOT NULL DEFAULT 1, required INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (item_id) REFERENCES menu_items(id))`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_option_groups_item_id ON option_groups(item_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS options (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, name TEXT NOT NULL, price_delta INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (group_id) REFERENCES option_groups(id))`
    )
    .run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, vendor_id INTEGER NOT NULL, location_id INTEGER, type TEXT NOT NULL, subtotal INTEGER NOT NULL, taxes INTEGER NOT NULL, fees INTEGER NOT NULL, tip INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Submitted', eta TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_vendor_id ON orders(vendor_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, item_id INTEGER NOT NULL, qty INTEGER NOT NULL, selected_options_json TEXT, line_total INTEGER NOT NULL)`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`).run()

  // Ensure Reviews table exists (idempotent)
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, vendor_id INTEGER NOT NULL, rating INTEGER NOT NULL, text TEXT, status TEXT NOT NULL DEFAULT 'published', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_reviews_vendor_id ON reviews(vendor_id)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id)`).run()

  // Group Orders
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS group_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        code TEXT UNIQUE NOT NULL,
        owner_user_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_group_orders_vendor_id ON group_orders(vendor_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS group_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER,
        user_name TEXT,
        item_id INTEGER NOT NULL,
        qty INTEGER NOT NULL,
        selected_options_json TEXT,
        line_total INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES group_orders(id)
      )`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_group_order_items_group_id ON group_order_items(group_id)`).run()

  // Loyalty table (per user/vendor)
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS loyalty (
        user_id INTEGER NOT NULL,
        vendor_id INTEGER NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, vendor_id)
      )`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_loyalty_vendor_id ON loyalty(vendor_id)`).run()

  // Reservations
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        vendor_id INTEGER NOT NULL,
        party_size INTEGER NOT NULL,
        datetime_iso TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'requested',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_reservations_vendor_id ON reservations(vendor_id)`).run()
}

// ---------- Utility ----------
app.get('/api/health', (c) => c.json({ ok: true }))
app.post('/api/dev/ensure', async (c) => {
  await ensureSchemaAndSeed(c.env.DB)
  return c.json({ ensured: true })
})

// ---------- Catalog Endpoints ----------
app.get('/api/vendors', async (c) => {
  const db = c.env.DB
  const q = c.req.query('q')?.trim()
  const type = c.req.query('type')?.trim()
  const openNowParam = c.req.query('open_now')
  const openNow = openNowParam === '1' || openNowParam === 'true'
  const deliveryParam = c.req.query('delivery')
  const delivery = deliveryParam === '1' || deliveryParam === 'true'
  const pickupParam = c.req.query('pickup')
  const pickup = pickupParam === '1' || pickupParam === 'true'
  const dietCsv = c.req.query('diet')?.trim() // e.g. "vegan,vegetarian"
  const sort = (c.req.query('sort') || 'rating').toLowerCase() as 'rating'|'distance'|'updated'|'trending'
  const near = c.req.query('near') // "lat,lng"
  const maxKm = Number(c.req.query('max_km') || '')
  let nearLat: number | undefined
  let nearLng: number | undefined
  if (near && near.includes(',')) {
    const [la, lo] = near.split(',').map((x) => Number(x))
    if (!Number.isNaN(la) && !Number.isNaN(lo)) {
      nearLat = la
      nearLng = lo
    }
  }

  // Base vendor query (SQL filters for q/type only)
  const clauses: string[] = []
  const bind: unknown[] = []
  if (q) {
    clauses.push('org_name LIKE ?')
    bind.push(`%${q}%`)
  }
  if (type) {
    clauses.push('type = ?')
    bind.push(type)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const baseVendors = await queryAll<any>(
    db,
    `SELECT id, org_name, type, tier, verified, rating_avg, rating_count, service_modes_json, created_at FROM vendors ${where} ORDER BY id DESC LIMIT 200`,
    bind
  )

  if (baseVendors.length === 0) return c.json({ vendors: [] })

  // Fetch locations for these vendors
  const ids = baseVendors.map((v) => v.id)
  const placeholders = ids.map(() => '?').join(',')
  const locs = await queryAll<any>(db, `SELECT * FROM locations WHERE vendor_id IN (${placeholders})`, ids as unknown[])
  const locsByVendor: Record<number, any[]> = {}
  for (const L of locs) {
    ;(locsByVendor[L.vendor_id] ||= []).push(L)
  }

  // Latest menu update per vendor
  const menuAgg = await queryAll<{ vendor_id: number; last_updated: string }>(
    db,
    `SELECT vendor_id, MAX(last_updated) AS last_updated FROM menus WHERE vendor_id IN (${placeholders}) GROUP BY vendor_id`,
    ids as unknown[]
  )
  const lastUpdatedMap = new Map(menuAgg.map((m) => [m.vendor_id, m.last_updated]))

  // Optional simple diet-based filter using menu_items text search
  let dietVendorAllow: Set<number> | null = null
  if (dietCsv) {
    const terms = dietCsv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (terms.length) {
      const dietVendorsRows = await queryAll<{ vendor_id: number }>(
        db,
        `SELECT DISTINCT m.vendor_id AS vendor_id
         FROM menus m
         JOIN menu_sections s ON s.menu_id = m.id
         JOIN menu_items i ON i.section_id = s.id
         WHERE m.vendor_id IN (${placeholders})
           AND (${terms.map(() => '(LOWER(i.name) LIKE ? OR LOWER(i.description) LIKE ?)').join(' OR ')})`,
        [
          ...ids,
          ...terms.flatMap((t) => [`%${t}%`, `%${t}%`])
        ] as unknown[]
      )
      dietVendorAllow = new Set(dietVendorsRows.map((r) => r.vendor_id))
    }
  }

  // Build enriched vendor list
  let enriched = baseVendors.map((v) => {
    const locations = locsByVendor[v.id] || []
    const open_now = locations.some((L) => isOpenNow(L.hours_json))
    let distance_km: number | undefined
    if (nearLat != null && nearLng != null && locations.length) {
      let min = Number.POSITIVE_INFINITY
      for (const L of locations) {
        const d = haversineKm(nearLat, nearLng, L.lat, L.lng)
        if (d < min) min = d
      }
      distance_km = isFinite(min) ? Number(min.toFixed(2)) : undefined
    }
    return {
      ...v,
      open_now,
      distance_km,
      last_updated: lastUpdatedMap.get(v.id) || null,
    }
  })

  // Filter by service modes
  if (delivery || pickup) {
    enriched = enriched.filter((v) => {
      let modes: any = null
      try { modes = v.service_modes_json ? JSON.parse(v.service_modes_json) : null } catch {}
      const hasDelivery = modes?.delivery === true
      const hasPickup = modes?.pickup !== false
      if (delivery && pickup) return hasDelivery && hasPickup
      if (delivery) return hasDelivery
      if (pickup) return hasPickup
      return true
    })
  }

  if (openNow) {
    enriched = enriched.filter((v) => v.open_now)
  }

  if (dietVendorAllow) {
    enriched = enriched.filter((v) => dietVendorAllow!.has(v.id))
  }

  if (nearLat != null && nearLng != null && !Number.isNaN(maxKm) && maxKm > 0) {
    enriched = enriched.filter((v) => v.distance_km != null && (v.distance_km as number) <= maxKm)
  }

  if (sort === 'distance' && nearLat != null && nearLng != null) {
    enriched.sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9))
  } else if (sort === 'updated') {
    enriched.sort((a, b) => new Date(b.last_updated || 0).getTime() - new Date(a.last_updated || 0).getTime())
  } else if (sort === 'trending') {
    enriched.sort((a, b) => (b.rating_count || 0) - (a.rating_count || 0) || (b.rating_avg || 0) - (a.rating_avg || 0))
  } else {
    enriched.sort((a, b) => (b.rating_avg || 0) - (a.rating_avg || 0) || (b.rating_count || 0) - (a.rating_count || 0))
  }

  const vendors = enriched.map((v) => ({
    id: v.id,
    org_name: v.org_name,
    type: v.type,
    tier: v.tier,
    verified: v.verified,
    rating_avg: v.rating_avg,
    rating_count: v.rating_count,
    open_now: v.open_now,
    distance_km: v.distance_km,
  }))
  return c.json({ vendors })
})

app.get('/api/vendors/:id', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const vendor = await queryOne(db, 'SELECT * FROM vendors WHERE id = ?', [id])
  if (!vendor) return c.notFound()
  const locations = await queryAll(db, 'SELECT * FROM locations WHERE vendor_id = ?', [id])
  const open_now = locations.some((L: any) => isOpenNow(L.hours_json))
  let service_modes: any = null
  try { service_modes = (vendor as any).service_modes_json ? JSON.parse((vendor as any).service_modes_json) : null } catch {}
  return c.json({ vendor: { ...vendor, open_now, service_modes }, locations })
})

app.post('/api/vendors', async (c) => {
  const db = c.env.DB
  const body = await c.req.json<{ org_name: string; type: string; tier?: string }>()
  if (!body.org_name || !body.type) return c.json({ error: 'org_name and type required' }, 400)
  const tier = body.tier || 'basic'
  const res = await db
    .prepare(`INSERT INTO vendors (org_name, type, tier, verified, rating_avg, rating_count) VALUES (?, ?, ?, 0, 0, 0)`) 
    .bind(body.org_name, body.type, tier)
    .run()
  const id = Number(res.meta.last_row_id)
  return c.json({ id })
})

app.get('/api/vendors/:id/menus', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const menu = await queryOne(db, 'SELECT * FROM menus WHERE vendor_id = ? AND is_active = 1 ORDER BY last_updated DESC LIMIT 1', [id])
  if (!menu) return c.json({ menu: null, sections: [] })
  const sections = await queryAll<any>(db, 'SELECT * FROM menu_sections WHERE menu_id = ? ORDER BY sort_order, id', [menu.id])
  const items = await queryAll<any>(db, 'SELECT * FROM menu_items WHERE section_id IN (SELECT id FROM menu_sections WHERE menu_id = ?)', [menu.id])
  const itemsBySection: Record<number, any[]> = {}
  for (const it of items) {
    ;(itemsBySection[it.section_id] ||= []).push(it)
  }
  const sectionsWithItems = sections.map((s) => ({ ...s, items: (itemsBySection[s.id] || []).map((i) => ({ ...i })) }))
  return c.json({ menu, sections: sectionsWithItems })
})

// ---------- Reviews ----------
app.get('/api/vendors/:id/reviews', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const reviews = await queryAll<any>(db, 'SELECT * FROM reviews WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 20', [id])
  return c.json({ reviews })
})

app.post('/api/vendors/:id/reviews', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ user_id?: number; rating: number; text?: string }>()
  const userId = body.user_id ?? 1 // demo user
  const rating = Math.max(1, Math.min(5, Number(body.rating)))
  await db
    .prepare(`INSERT INTO reviews (user_id, vendor_id, rating, text, status) VALUES (?, ?, ?, ?, 'published')`)
    .bind(userId, id, rating, body.text || null)
    .run()
  // Update aggregate rating (simple recalculation)
  const agg = await queryOne<{ avg: number; count: number }>(
    db,
    'SELECT AVG(rating) as avg, COUNT(1) as count FROM reviews WHERE vendor_id = ?',
    [id]
  )
  if (agg) {
    await db
      .prepare('UPDATE vendors SET rating_avg = ?, rating_count = ? WHERE id = ?')
      .bind(Number(agg.avg || 0), Number(agg.count || 0), id)
      .run()
  }
  return c.json({ ok: true })
})

// ---------- Loyalty & Reservations ----------
app.get('/api/vendors/:id/loyalty', async (c) => {
  const db = c.env.DB
  const vendorId = Number(c.req.param('id'))
  const userId = 1
  const row = await queryOne<{ points: number }>(db, 'SELECT points FROM loyalty WHERE user_id = ? AND vendor_id = ?', [userId, vendorId])
  return c.json({ points: row?.points || 0 })
})

app.get('/api/vendors/:id/reservations', async (c) => {
  const db = c.env.DB
  const vendorId = Number(c.req.param('id'))
  const userId = 1
  const list = await queryAll<any>(db, 'SELECT * FROM reservations WHERE vendor_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20', [vendorId, userId])
  return c.json({ reservations: list })
})

app.post('/api/vendors/:id/reservations', async (c) => {
  const db = c.env.DB
  const vendorId = Number(c.req.param('id'))
  const body = await c.req.json<{ party_size: number; datetime_iso: string; notes?: string }>()
  const userId = 1
  const party = Math.max(1, Math.min(20, Number(body.party_size || 1)))
  const dt = String(body.datetime_iso || '').trim()
  if (!dt) return c.json({ error: 'datetime_iso required' }, 400)
  const res = await db
    .prepare('INSERT INTO reservations (user_id, vendor_id, party_size, datetime_iso, notes, status) VALUES (?, ?, ?, ?, ?, "requested")')
    .bind(userId, vendorId, party, dt, body.notes || null)
    .run()
  const id = Number(res.meta.last_row_id)
  const rec = await queryOne<any>(db, 'SELECT * FROM reservations WHERE id = ?', [id])
  return c.json({ reservation: rec })
})

// ---------- Payments (stub for MVP) ----------
app.post('/api/payments/intent', async (c) => {
  const body = await c.req.json<{ amount: number; currency?: string }>().catch(() => ({ amount: 0 }))
  const amount = Number(body.amount || 0)
  const currency = (body.currency || 'USD').toUpperCase()
  if (amount <= 0) return c.json({ error: 'amount required' }, 400)
  // In production, call Stripe/Adyen to create PaymentIntent and return client_secret
  return c.json({ provider: 'test', client_secret: `test_secret_${amount}_${currency}` })
})

// ---------- Group Orders ----------
function randomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)]
  return s
}

app.post('/api/group/start', async (c) => {
  const db = c.env.DB
  const body = await c.req.json<{ vendor_id: number; user_id?: number }>().catch(()=>({vendor_id:0}))
  const vendorId = Number(body.vendor_id||0)
  if (!vendorId) return c.json({ error: 'vendor_id required' }, 400)
  const userId = body.user_id ?? 1
  // generate unique code
  let code = ''
  for (let i=0;i<5;i++) {
    code = randomCode(6)
    const exists = await queryOne<{id:number}>(db, 'SELECT id FROM group_orders WHERE code = ?', [code])
    if (!exists) break
  }
  if (!code) return c.json({ error: 'unable_to_allocate_code' }, 500)
  const res = await db.prepare('INSERT INTO group_orders (vendor_id, code, owner_user_id, status) VALUES (?, ?, ?, "open")')
    .bind(vendorId, code, userId).run()
  return c.json({ group_id: Number(res.meta.last_row_id), code, vendor_id: vendorId, status: 'open' })
})

app.get('/api/group/:code', async (c) => {
  const db = c.env.DB
  const code = c.req.param('code')
  const group = await queryOne<any>(db, 'SELECT * FROM group_orders WHERE code = ?', [code])
  if (!group) return c.notFound()
  const items = await queryAll<any>(db, 'SELECT * FROM group_order_items WHERE group_id = ? ORDER BY id', [group.id])
  const subtotal = items.reduce((s, it) => s + (it.line_total||0), 0)
  return c.json({ group, items, subtotal })
})

app.post('/api/group/:code/add', async (c) => {
  const db = c.env.DB
  const code = c.req.param('code')
  const group = await queryOne<any>(db, 'SELECT * FROM group_orders WHERE code = ? AND status = "open"', [code])
  if (!group) return c.json({ error: 'group_not_found_or_closed' }, 404)
  const body = await c.req.json<{ user_id?: number; user_name?: string; item_id: number; qty: number; selected_options?: number[] }>()
  const userId = body.user_id ?? 1
  const userName = (body.user_name || '').trim() || 'Guest'
  const row = await queryOne<any>(db, 'SELECT id, base_price FROM menu_items WHERE id = ?', [body.item_id])
  if (!row) return c.json({ error: 'item_not_found' }, 400)
  let unit = Number(row.base_price||0)
  const opts = Array.isArray(body.selected_options) ? body.selected_options : []
  if (opts.length) {
    const deltas = await queryAll<{ price_delta: number }>(db, `SELECT price_delta FROM options WHERE id IN (${opts.map(()=>'?').join(',')})`, opts as unknown[])
    unit += deltas.reduce((s,d)=> s + (d.price_delta||0), 0)
  }
  const qty = Math.max(1, Number(body.qty||1))
  const line = unit * qty
  await db.prepare('INSERT INTO group_order_items (group_id, user_id, user_name, item_id, qty, selected_options_json, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(group.id, userId, userName, body.item_id, qty, JSON.stringify(opts), line).run()
  const items = await queryAll<any>(db, 'SELECT * FROM group_order_items WHERE group_id = ? ORDER BY id', [group.id])
  const subtotal = items.reduce((s, it) => s + (it.line_total||0), 0)
  return c.json({ ok: true, subtotal, count: items.length })
})

app.post('/api/group/:code/submit', async (c) => {
  const db = c.env.DB
  const code = c.req.param('code')
  const group = await queryOne<any>(db, 'SELECT * FROM group_orders WHERE code = ? AND status = "open"', [code])
  if (!group) return c.json({ error: 'group_not_found_or_closed' }, 404)
  const body = await c.req.json<{ type: string; tip_cents?: number; promo_code?: string; distance_km?: number; loyalty_points?: number }>()
  const userId = group.owner_user_id || 1
  const vendorId = group.vendor_id
  const gItems = await queryAll<any>(db, 'SELECT * FROM group_order_items WHERE group_id = ? ORDER BY id', [group.id])
  if (gItems.length === 0) return c.json({ error: 'empty_group' }, 400)

  // Totals based on stored line totals
  const subtotal = gItems.reduce((s,it)=> s + (it.line_total||0), 0)
  const taxes = Math.round(subtotal * 0.08)
  const type = body.type === 'delivery' ? 'delivery' : 'pickup'
  let fees = type === 'delivery' ? 399 : 99
  let etaStr: string | null = null
  if (type === 'delivery' && typeof body.distance_km === 'number' && !Number.isNaN(body.distance_km) && body.distance_km > 0) {
    const km = Math.max(0, Number(body.distance_km))
    const quoteFee = Math.round(199 + km * 80)
    fees += quoteFee
    const eta_minutes = 30 + Math.round(km * 4)
    etaStr = `${eta_minutes}m`
  }
  let discount = 0
  if (body.promo_code && body.promo_code.toUpperCase() === 'SAVE10') {
    discount = Math.min(Math.round(subtotal * 0.1), 500)
  }
  // Loyalty redemption
  let loyaltyRedeem = 0
  if (typeof body.loyalty_points === 'number' && body.loyalty_points > 0) {
    const availRow = await queryOne<{ points: number }>(db, 'SELECT points FROM loyalty WHERE user_id = ? AND vendor_id = ?', [userId, vendorId])
    const available = Number(availRow?.points || 0)
    const requested = Math.floor(Number(body.loyalty_points))
    const maxBySubtotal = Math.max(0, subtotal - discount)
    loyaltyRedeem = Math.max(0, Math.min(requested, available, maxBySubtotal))
    discount += loyaltyRedeem
  }
  const tip = Math.max(0, Number(body.tip_cents || 0))
  const total = Math.max(0, subtotal + taxes + fees + tip - discount)

  // Create order
  const orderRes = await db.prepare(
    `INSERT INTO orders (user_id, vendor_id, type, subtotal, taxes, fees, tip, total, status, eta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?)`
  ).bind(userId, vendorId, type, subtotal - (discount), taxes, fees, tip, total, etaStr).run()
  const orderId = Number(orderRes.meta.last_row_id)

  // Persist order_items (flatten group items)
  for (const it of gItems) {
    await db.prepare(`INSERT INTO order_items (order_id, item_id, qty, selected_options_json, line_total) VALUES (?, ?, ?, ?, ?)`) 
      .bind(orderId, it.item_id, it.qty, it.selected_options_json, it.line_total).run()
  }

  // Deduct loyalty used
  if (loyaltyRedeem > 0) {
    await db.prepare('INSERT OR IGNORE INTO loyalty (user_id, vendor_id, points) VALUES (?, ?, 0)').bind(userId, vendorId).run()
    await db.prepare('UPDATE loyalty SET points = CASE WHEN points >= ? THEN points - ? ELSE 0 END WHERE user_id = ? AND vendor_id = ?')
      .bind(loyaltyRedeem, loyaltyRedeem, userId, vendorId).run()
  }
  // Award points
  try {
    const points = Math.floor(total / 100)
    await db.prepare(`INSERT INTO loyalty (user_id, vendor_id, points) VALUES (?, ?, ?) ON CONFLICT(user_id, vendor_id) DO UPDATE SET points = points + excluded.points`)
      .bind(userId, vendorId, points).run()
  } catch {}

  // Close group
  await db.prepare('UPDATE group_orders SET status = "submitted" WHERE id = ?').bind(group.id).run()

  const order = await queryOne<any>(db, 'SELECT * FROM orders WHERE id = ?', [orderId])
  return c.json({ order })
})

// ---------- Logistics (stub for MVP) ----------
app.post('/api/delivery/quote', async (c) => {
  const body = await c.req.json<{ vendor_id: number; address?: string; distance_km?: number }>().catch(() => ({ vendor_id: 0 }))
  const km = Math.max(0, Number(body.distance_km ?? 5))
  const fee = Math.round(199 + km * 80) // base + per-km
  const eta_minutes = 30 + Math.round(km * 4)
  return c.json({ fee, eta_minutes })
})

// ---------- Orders ----------
app.post('/api/orders', async (c) => {
  const db = c.env.DB
  type ItemReq = { item_id: number; qty: number; selected_options?: number[] }
  const body = await c
    .req
    .json<{ vendor_id: number; type: string; items: ItemReq[]; user_id?: number; tip_cents?: number; promo_code?: string; distance_km?: number; loyalty_points?: number }>({ vendor_id: 0, type: 'pickup', items: [] } as any)
  const userId = body.user_id ?? 1 // demo user
  const vendorId = body.vendor_id
  const type = body.type === 'delivery' ? 'delivery' : 'pickup'
  // pricing
  let subtotal = 0
  const pricedItems: Array<{ item_id: number; qty: number; unit_price: number; line_total: number; selected_options: number[]; name: string }> = []
  for (const it of body.items) {
    const row = await queryOne<any>(db, 'SELECT id, name, base_price FROM menu_items WHERE id = ?', [it.item_id])
    if (!row) return c.json({ error: `Item ${it.item_id} not found` }, 400)
    let unit = row.base_price as number
    const opts = Array.isArray(it.selected_options) ? it.selected_options : []
    if (opts.length) {
      const deltas = await queryAll<{ price_delta: number }>(
        db,
        `SELECT price_delta FROM options WHERE id IN (${opts.map(() => '?').join(',')})`,
        opts as unknown[]
      )
      unit += deltas.reduce((s, d) => s + (d.price_delta || 0), 0)
    }
    const qty = Math.max(1, Number((it as any).qty || 1))
    const line = unit * qty
    subtotal += line
    pricedItems.push({ item_id: row.id, qty, unit_price: unit, line_total: line, selected_options: opts, name: row.name })
  }
  const taxes = Math.round(subtotal * 0.08)
  let fees = type === 'delivery' ? 399 : 99
  let etaStr: string | null = null
  if (type === 'delivery' && typeof body.distance_km === 'number' && !Number.isNaN(body.distance_km) && body.distance_km > 0) {
    const km = Math.max(0, Number(body.distance_km))
    const quoteFee = Math.round(199 + km * 80)
    fees += quoteFee
    const eta_minutes = 30 + Math.round(km * 4)
    etaStr = `${eta_minutes}m`
  }
  // promo: simple demo - SAVE10 gives 10% off up to $5
  let discount = 0
  if (body.promo_code && body.promo_code.toUpperCase() === 'SAVE10') {
    discount = Math.min(Math.round(subtotal * 0.1), 500)
  }
  // loyalty redemption: 1 point = 1 cent. Cap by available points and subtotal after promo
  let loyaltyRedeem = 0
  if (typeof body.loyalty_points === 'number' && body.loyalty_points > 0) {
    const availRow = await queryOne<{ points: number }>(db, 'SELECT points FROM loyalty WHERE user_id = ? AND vendor_id = ?', [userId, vendorId])
    const available = Number(availRow?.points || 0)
    const requested = Math.floor(Number(body.loyalty_points))
    const maxBySubtotal = Math.max(0, subtotal - discount)
    loyaltyRedeem = Math.max(0, Math.min(requested, available, maxBySubtotal))
    discount += loyaltyRedeem
  }
  const tip = Math.max(0, Number(body.tip_cents || 0))
  const total = Math.max(0, subtotal + taxes + fees + tip - discount)

  // create order
  const orderRes = await db
    .prepare(
      `INSERT INTO orders (user_id, vendor_id, type, subtotal, taxes, fees, tip, total, status, eta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?)`
    )
    .bind(userId, vendorId, type, subtotal - discount, taxes, fees, tip, total, etaStr)
    .run()
  const orderId = Number(orderRes.meta.last_row_id)

  for (const it of pricedItems) {
    await db
      .prepare(
        `INSERT INTO order_items (order_id, item_id, qty, selected_options_json, line_total) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(orderId, it.item_id, it.qty, JSON.stringify(it.selected_options), it.line_total)
      .run()
  }

  // Deduct redeemed loyalty points if any
  if (loyaltyRedeem > 0) {
    await db
      .prepare('INSERT OR IGNORE INTO loyalty (user_id, vendor_id, points) VALUES (?, ?, 0)')
      .bind(userId, vendorId)
      .run()
    await db
      .prepare('UPDATE loyalty SET points = CASE WHEN points >= ? THEN points - ? ELSE 0 END WHERE user_id = ? AND vendor_id = ?')
      .bind(loyaltyRedeem, loyaltyRedeem, userId, vendorId)
      .run()
  }

  const order = await queryOne<any>(db, 'SELECT * FROM orders WHERE id = ?', [orderId])

  // Award loyalty points (simple rule): 1 point per $1 total
  try {
    const points = Math.floor(Number(order.total || 0) / 100)
    await db
      .prepare(
        `INSERT INTO loyalty (user_id, vendor_id, points)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, vendor_id) DO UPDATE SET points = points + excluded.points`
      )
      .bind(userId, vendorId, points)
      .run()
  } catch {}

  return c.json({ order })
})

app.get('/api/orders/:id', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const order = await queryOne<any>(db, 'SELECT * FROM orders WHERE id = ?', [id])
  if (!order) return c.notFound()
  const items = await queryAll<any>(db, 'SELECT oi.*, mi.name AS item_name FROM order_items oi JOIN menu_items mi ON mi.id = oi.item_id WHERE oi.order_id = ?', [id])
  return c.json({ order, items })
})

app.post('/api/orders/:id/status', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ status: string; eta?: string }>()
  const allowed = new Set([
    'Draft',
    'Submitted',
    'Accepted',
    'In-Prep',
    'Ready',
    'Out-for-Delivery',
    'Completed',
    'Canceled',
    'Refunded',
  ])
  if (!allowed.has(body.status)) return c.json({ error: 'invalid status' }, 400)
  await db
    .prepare('UPDATE orders SET status = ?, eta = COALESCE(?, eta) WHERE id = ?')
    .bind(body.status, body.eta || null, id)
    .run()
  const order = await queryOne<any>(db, 'SELECT * FROM orders WHERE id = ?', [id])
  return c.json({ order })
})

// Item options
app.get('/api/items/:id/options', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const groups = await queryAll<any>(db, 'SELECT id, name, min, max, required FROM option_groups WHERE item_id = ? ORDER BY id', [id])
  const result = [] as any[]
  for (const g of groups) {
    const opts = await queryAll<any>(db, 'SELECT id, name, price_delta FROM options WHERE group_id = ? ORDER BY id', [g.id])
    result.push({ ...g, options: opts })
  }
  return c.json({ groups: result })
})

export default app

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { renderer } from './renderer'
import { serveStatic } from 'hono/cloudflare-workers'
import { setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'

// Types for Cloudflare Bindings
export type Bindings = {
  DB: D1Database
  JWT_SECRET?: string
  KV?: KVNamespace
  SENTRY_DSN?: string
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

// ---------- Observability (Sentry minimal) ----------
async function captureError(c: any, err: unknown, context?: Record<string, unknown>) {
  try {
    const dsn = c.env?.SENTRY_DSN
    if (!dsn) {
      console.error('[error]', err)
      return
    }
    // Parse DSN: https://{key}@{host}/{project}
    const u = new URL(dsn)
    const key = u.username
    const project = u.pathname.replace(/^\//, '')
    const host = u.host
    const endpoint = `https://${host}/api/${project}/store/`
    const headers = {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=webapp/1.0`
    }
    const payload: any = {
      platform: 'javascript',
      level: 'error',
      message: (err as any)?.message || String(err),
      exception: { values: [{ type: (err as any)?.name || 'Error', value: (err as any)?.stack || String(err) }] },
      tags: { service: 'webapp' },
      extra: { context: context || {}, url: c.req?.url },
      timestamp: Math.floor(Date.now() / 1000)
    }
    await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) })
  } catch (e) {
    console.error('[sentry-fail]', e)
  }
}

app.onError(async (err, c) => {
  await captureError(c, err)
  return c.json({ error: 'internal_error' }, 500)
})

// ---------- KV Counters Helper ----------
async function incKV(c: any, key: string, n = 1) {
  try {
    const kv = c.env?.KV
    if (!kv) return
    const cur = Number((await kv.get(key)) || '0')
    await kv.put(key, String(cur + n))
  } catch (e) {
    console.warn('[kv-inc-fail]', e)
  }
}

// ---------- Auth Helpers ----------
function getJwtSecret(c: any) {
  return c.env?.JWT_SECRET || 'dev-secret'
}

async function requireAuth(c: any, next: any) {
  const h = c.req.header('Authorization') || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  if (!m) return c.json({ error: 'unauthorized' }, 401)
  try {
    const payload = await verify(m[1], getJwtSecret(c))
    c.set('user', payload)
  } catch {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
}

async function requireVendor(c: any, next: any) {
  const user: any = c.get('user')
  if (!user || (user.role !== 'vendor' && user.role !== 'admin')) {
    return c.json({ error: 'forbidden' }, 403)
  }
  if (!user.vendor_id && user.role === 'vendor') {
    return c.json({ error: 'vendor_context_required' }, 400)
  }
  await next()
}

// ---------- Auth Endpoints ----------
app.post('/api/auth/login', async (c) => {
  try {
    const body = await c.req.json<{ email: string; role?: string; vendor_id?: number }>()
    const email = (body.email || '').toLowerCase().trim()
    if (!email) return c.json({ error: 'email_required' }, 400)
    const role = (body.role === 'vendor' || body.role === 'admin') ? body.role : 'customer'
    const vendorId = body.vendor_id && Number(body.vendor_id) > 0 ? Number(body.vendor_id) : undefined
    // Ensure user row exists (demo behavior)
    const db = c.env.DB
    let user = await queryOne<any>(db, 'SELECT * FROM users WHERE email = ?', [email])
    if (!user) {
      await db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').bind(email, role).run()
      user = await queryOne<any>(db, 'SELECT * FROM users WHERE email = ?', [email])
    }
    // Issue token
    const payload: any = { sub: String(user.id), email, role }
    if (role === 'vendor' && vendorId) payload.vendor_id = vendorId
    const token = await sign(payload, getJwtSecret(c))
    return c.json({ token, user: payload })
  } catch (e) {
    await captureError(c, e, { route: 'login' })
    return c.json({ error: 'login_failed' }, 400)
  }
})

// Home route renders landing page (clean marketing page)
app.get('/', async (c) => {
  return c.render(
    <div>
      {/* Top Nav */}
      <header class="bg-white/95 backdrop-blur sticky top-0 z-40 border-b border-gray-100">
        <div class="max-w-7xl mx-auto px-6 h-[72px] flex items-center justify-between">
          <a href="/" class="text-2xl font-extrabold tracking-tight">Menu<span style="color:#EB1700">.</span></a>
          <nav class="hidden md:flex items-center gap-8 text-sm font-medium text-gray-700">
            <a href="#how" class="hover:text-black">How it works</a>
            <a href="#vendors" class="hover:text-black">For businesses</a>
          </nav>
          <div class="flex items-center gap-2">
            <a href="/app" class="px-4 py-2 text-sm font-semibold rounded-full bg-gray-100 hover:bg-gray-200">Sign in</a>
            <a href="/app" class="px-4 py-2 text-sm font-semibold rounded-full bg-black text-white hover:bg-gray-800">Get started</a>
          </div>
        </div>
      </header>

      {/* Hero — DoorDash-style brand red with address entry */}
      <section class="relative overflow-hidden" style="background:#EB1700">
        <img src={IMG('1565299585323-38d6b0865b47', 900)} alt="" class="hidden md:block absolute -left-16 -top-16 w-72 h-72 object-cover rounded-full opacity-95 rotate-[-8deg] shadow-2xl" />
        <img src={IMG('1568901346375-23c9450c58cd', 900)} alt="" class="hidden md:block absolute -right-20 top-8 w-80 h-80 object-cover rounded-full opacity-95 rotate-[7deg] shadow-2xl" />
        <img src={IMG('1555507036-ab1f4038808a', 700)} alt="" class="hidden lg:block absolute right-40 -bottom-24 w-56 h-56 object-cover rounded-full opacity-90 shadow-2xl" />
        <div class="relative max-w-3xl mx-auto px-6 py-20 md:py-28 text-center">
          <h1 class="text-4xl md:text-6xl font-extrabold tracking-tight text-white">Discover local flavors, delivered.</h1>
          <p class="mt-4 text-lg md:text-xl text-white/90">Restaurants, food trucks, home chefs and bakeries — from your neighborhood to your door.</p>
          <form action="/app" method="get" class="mt-8 max-w-xl mx-auto flex items-center gap-2 bg-white rounded-full p-2 pl-5 shadow-2xl">
            <i class="fa-solid fa-location-dot text-gray-500"></i>
            <input name="addr" placeholder="Enter delivery address" class="flex-1 min-w-0 outline-none text-[15px] text-gray-900 placeholder-gray-500 bg-transparent" />
            <button type="submit" class="shrink-0 px-5 py-3 rounded-full bg-black text-white text-sm font-bold hover:bg-gray-800">Find food</button>
          </form>
          <div class="mt-4">
            <a href="/app" class="inline-flex items-center gap-2 bg-white/95 hover:bg-white rounded-full px-4 py-2 text-sm font-semibold text-gray-900">
              <i class="fa-regular fa-user"></i> Sign in for saved addresses
            </a>
          </div>
        </div>
      </section>

      {/* Explore by craving */}
      <section class="max-w-7xl mx-auto px-6 pt-16 pb-6">
        <h2 class="text-2xl md:text-3xl font-extrabold tracking-tight">Explore by craving</h2>
        <div class="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <a href="/app#/?cat=Pizza" class="relative overflow-hidden rounded-2xl border border-gray-200 h-36 p-5 hover:shadow-lg transition-shadow bg-white">
            <div class="font-bold text-lg">Pizza</div>
            <img src={IMG('1513104890138-7c749659a591', 400)} alt="Pizza" class="absolute -bottom-7 -right-7 w-28 h-28 rounded-full object-cover" />
          </a>
          <a href="/app#/?cat=Mexican" class="relative overflow-hidden rounded-2xl border border-gray-200 h-36 p-5 hover:shadow-lg transition-shadow bg-white">
            <div class="font-bold text-lg">Tacos</div>
            <img src={IMG('1565299585323-38d6b0865b47', 400)} alt="Tacos" class="absolute -bottom-7 -right-7 w-28 h-28 rounded-full object-cover" />
          </a>
          <a href="/app#/?cat=Sushi" class="relative overflow-hidden rounded-2xl border border-gray-200 h-36 p-5 hover:shadow-lg transition-shadow bg-white">
            <div class="font-bold text-lg">Sushi</div>
            <img src={IMG('1579871494447-9811cf80d66c', 400)} alt="Sushi" class="absolute -bottom-7 -right-7 w-28 h-28 rounded-full object-cover" />
          </a>
          <a href="/app#/?cat=Bakery" class="relative overflow-hidden rounded-2xl border border-gray-200 h-36 p-5 hover:shadow-lg transition-shadow bg-white">
            <div class="font-bold text-lg">Bakery</div>
            <img src={IMG('1555507036-ab1f4038808a', 400)} alt="Bakery" class="absolute -bottom-7 -right-7 w-28 h-28 rounded-full object-cover" />
          </a>
        </div>
      </section>

      {/* How It Works */}
      <section id="how" class="max-w-7xl mx-auto px-6 py-16">
        <h2 class="text-2xl md:text-3xl font-extrabold tracking-tight">How it works</h2>
        <div class="mt-8 grid md:grid-cols-3 gap-6">
          <div class="rounded-2xl border border-gray-200 p-6">
            <div class="w-12 h-12 rounded-full flex items-center justify-center text-xl" style="background:#FCE9E7;color:#EB1700"><i class="fa-solid fa-magnifying-glass"></i></div>
            <div class="mt-4 text-lg font-bold">1. Discover</div>
            <p class="mt-1 text-gray-600 text-sm">Browse local restaurants, food trucks, home chefs and bakeries near you.</p>
          </div>
          <div class="rounded-2xl border border-gray-200 p-6">
            <div class="w-12 h-12 rounded-full flex items-center justify-center text-xl" style="background:#FCE9E7;color:#EB1700"><i class="fa-solid fa-bag-shopping"></i></div>
            <div class="mt-4 text-lg font-bold">2. Order</div>
            <p class="mt-1 text-gray-600 text-sm">Customize your items, choose delivery or pickup, and check out in seconds.</p>
          </div>
          <div class="rounded-2xl border border-gray-200 p-6">
            <div class="w-12 h-12 rounded-full flex items-center justify-center text-xl" style="background:#FCE9E7;color:#EB1700"><i class="fa-solid fa-map-location-dot"></i></div>
            <div class="mt-4 text-lg font-bold">3. Track &amp; enjoy</div>
            <p class="mt-1 text-gray-600 text-sm">Follow your order live from the kitchen to your doorstep.</p>
          </div>
        </div>
      </section>

      {/* Vendors CTA */}
      <section id="vendors" class="max-w-7xl mx-auto px-6 pb-20">
        <div class="rounded-3xl overflow-hidden grid md:grid-cols-2" style="background:#191919">
          <div class="p-10 md:p-14 text-white">
            <h3 class="text-2xl md:text-3xl font-extrabold tracking-tight">Grow your business with Menu</h3>
            <p class="mt-3 text-white/80">Reach new customers and manage orders, menus, loyalty, reservations and group orders — all in one place.</p>
            <a href="/app#/vendor/join" class="mt-6 inline-block px-6 py-3 rounded-full text-white text-sm font-bold" style="background:#EB1700">Join as a vendor</a>
          </div>
          <img src={IMG('1556910103-1c02745aae4d', 900)} alt="Chef preparing food" class="w-full h-64 md:h-full object-cover" />
        </div>
      </section>

      {/* Footer */}
      <footer class="border-t border-gray-200">
        <div class="max-w-7xl mx-auto px-6 py-12 grid md:grid-cols-4 gap-8 text-sm">
          <div>
            <div class="text-xl font-extrabold">Menu<span style="color:#EB1700">.</span></div>
            <p class="mt-2 text-gray-500">Local food, delivered with love.</p>
          </div>
          <div>
            <div class="font-bold mb-3">Get to know us</div>
            <div class="space-y-2 text-gray-600"><div>About us</div><div>Careers</div><div>Blog</div></div>
          </div>
          <div>
            <div class="font-bold mb-3">Let us help you</div>
            <div class="space-y-2 text-gray-600"><div>Support</div><div>FAQs</div><div>Contact</div></div>
          </div>
          <div>
            <div class="font-bold mb-3">Doing business</div>
            <div class="space-y-2 text-gray-600"><div>Become a vendor</div><div>Become a courier</div><div>API for partners</div></div>
          </div>
        </div>
        <div class="border-t border-gray-100">
          <div class="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between text-xs text-gray-500">
            <div>© 2026 Menu Technologies</div>
            <div class="flex gap-4"><span>Privacy</span><span>Terms</span><span>Pricing</span></div>
          </div>
        </div>
      </footer>
    </div>
  )
})

// A/B reset route: clears cookie and redirects to home
app.get('/ab/reset', (c) => {
  setCookie(c, 'hero', '', { path: '/', maxAge: 0, sameSite: 'Lax' })
  return c.redirect('/')
})

// SPA shell route for the app experience (app.js renders everything into #app)
app.get('/app', (c) => {
  return c.render(<div id="app"></div>)
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

// ---------- Rich demo catalog (DoorDash/UberEats-style data) ----------
const IMG = (id: string, w = 800) => `https://images.unsplash.com/photo-${id}?w=${w}&q=60&auto=format&fit=crop`

type SeedItem = { name: string; desc?: string; price: number; photo?: string; popular?: boolean; options?: Array<{ name: string; min: number; max: number; required: boolean; choices: Array<[string, number]> }> }
type SeedVendor = {
  org_name: string; type: string; cuisine: string; tier?: string; price_range: number
  rating: number; ratings: number; image: string; promo?: string | null
  fee: number; eta_min: number; eta_max: number; modes: any; live?: boolean
  lat: number; lng: number; address: string
  sections: Array<{ name: string; items: SeedItem[] }>
  reviews: Array<[string, number, string]>
}

const SALSA_OPTS = { name: 'Salsa', min: 0, max: 2, required: false, choices: [['Mild', 0], ['Hot', 0], ['Extra Hot', 0]] as Array<[string, number]> }
const TACO_ADDONS = { name: 'Add-ons', min: 0, max: 3, required: false, choices: [['Guacamole', 150], ['Extra Meat', 200], ['Queso', 100]] as Array<[string, number]> }

const RICH_VENDORS: SeedVendor[] = [
  {
    org_name: 'Sunset Tacos', type: 'truck', cuisine: 'Mexican', price_range: 1, rating: 4.6, ratings: 2130,
    image: IMG('1565299585323-38d6b0865b47', 1200), promo: '20% off, up to $5', fee: 0, eta_min: 15, eta_max: 25,
    modes: { pickup: true, delivery: true }, live: true, lat: 37.7749, lng: -122.4194, address: '123 5th Ave',
    sections: [
      { name: 'Tacos', items: [
        { name: 'Al Pastor Taco', desc: 'Marinated pork, charred pineapple, cilantro & onion', price: 450, photo: IMG('1599974579688-8dbdd335c77f'), popular: true, options: [SALSA_OPTS, TACO_ADDONS] },
        { name: 'Carne Asada Taco', desc: 'Grilled steak, salsa verde, lime', price: 500, photo: IMG('1551504734-5ee1c4a1479b'), popular: true, options: [SALSA_OPTS, TACO_ADDONS] },
        { name: 'Baja Fish Taco', desc: 'Crispy cod, chipotle crema, cabbage slaw', price: 550, photo: IMG('1512838243191-e81e8f66f1fd'), options: [SALSA_OPTS] },
        { name: 'Chicken Tinga Taco', desc: 'Slow-braised chipotle chicken', price: 450, options: [SALSA_OPTS, TACO_ADDONS] },
      ]},
      { name: 'Burritos', items: [
        { name: 'California Burrito', desc: 'Carne asada, fries, cheese, guac & pico', price: 1150, photo: IMG('1626700051175-6818013e1d4f'), popular: true },
        { name: 'Carnitas Burrito', desc: 'Slow-cooked pork, rice, beans, salsa roja', price: 1090 },
      ]},
      { name: 'Sides & Drinks', items: [
        { name: 'Chips & Guacamole', desc: 'Fresh tortilla chips, hand-smashed guac', price: 650, photo: IMG('1548839140-29a749e1cf4d') },
        { name: 'Elote', desc: 'Street corn, cotija, chile-lime mayo', price: 500 },
        { name: 'Horchata', desc: 'House-made, cinnamon rice milk', price: 400 },
      ]},
    ],
    reviews: [ ['Maya R.', 5, 'Best al pastor in the city. The truck is fast even at lunch rush.'], ['Devon K.', 5, 'California burrito is enormous and perfect.'], ['Ana P.', 4, 'Great tacos, salsa bar is amazing. Parking can be tricky.'] ],
  },
  {
    org_name: 'Burger & Shake Society', type: 'restaurant', cuisine: 'Burgers', price_range: 2, rating: 4.4, ratings: 3240,
    image: IMG('1568901346375-23c9450c58cd', 1200), promo: '$0 delivery fee', fee: 0, eta_min: 15, eta_max: 25,
    modes: { pickup: true, delivery: true, dinein: true }, lat: 37.781, lng: -122.414, address: '88 Grove St',
    sections: [
      { name: 'Burgers', items: [
        { name: 'Classic Smash', desc: 'Two smashed patties, American cheese, house sauce', price: 990, photo: IMG('1568901346375-23c9450c58cd'), popular: true, options: [
          { name: 'Toppings', min: 0, max: 4, required: false, choices: [['Bacon', 200], ['Avocado', 150], ['Fried Egg', 150], ['Grilled Onions', 0]] },
          { name: 'Temperature', min: 1, max: 1, required: true, choices: [['Medium', 0], ['Medium Well', 0], ['Well Done', 0]] },
        ]},
        { name: 'Double Trouble', desc: 'Four patties, double cheese, pickles', price: 1350, photo: IMG('1550317138-10000687a72b'), popular: true },
        { name: 'Truffle Burger', desc: 'Truffle aioli, swiss, crispy shallots', price: 1490, photo: IMG('1551782450-a2132b4ba21d') },
        { name: 'Impossible Burger', desc: 'Plant-based patty, vegan cheddar (vegetarian)', price: 1250 },
      ]},
      { name: 'Fries & Sides', items: [
        { name: 'Classic Fries', desc: 'Crispy, sea salt', price: 450, photo: IMG('1573080496219-bb080dd4f877'), popular: true },
        { name: 'Garlic Parm Fries', desc: 'Garlic butter, shredded parmesan', price: 590 },
        { name: 'Loaded Fries', desc: 'Cheese sauce, bacon, scallions', price: 750 },
      ]},
      { name: 'Shakes', items: [
        { name: 'Oreo Shake', desc: 'Hand-spun, real cookies', price: 650, photo: IMG('1563805042-7684c019e1cb') },
        { name: 'Vanilla Bean Shake', desc: 'Madagascar vanilla', price: 650 },
      ]},
    ],
    reviews: [ ['Jordan T.', 4, 'Smash burgers done right. Fries stayed crispy through delivery.'], ['Sam W.', 5, 'Oreo shake is dangerously good.'], ['Priya N.', 4, 'Solid, fast, consistent.'] ],
  },
  {
    org_name: 'Brick Oven Pizza Co.', type: 'restaurant', cuisine: 'Pizza', price_range: 2, rating: 4.5, ratings: 1420,
    image: IMG('1513104890138-7c749659a591', 1200), promo: 'Free delivery over $20', fee: 99, eta_min: 25, eta_max: 40,
    modes: { pickup: true, delivery: true, dinein: true }, lat: 37.788, lng: -122.407, address: '210 Columbus Ave',
    sections: [
      { name: 'Pizzas', items: [
        { name: 'Margherita', desc: 'San Marzano tomato, fresh mozzarella, basil', price: 1400, photo: IMG('1574071318508-1cdbab80d002'), popular: true, options: [
          { name: 'Size', min: 1, max: 1, required: true, choices: [['12" Regular', 0], ['16" Large', 600]] },
          { name: 'Extras', min: 0, max: 3, required: false, choices: [['Extra Mozzarella', 250], ['Prosciutto', 400], ['Chili Honey', 150]] },
        ]},
        { name: 'Pepperoni', desc: 'Cup-and-char pepperoni, aged mozzarella', price: 1600, photo: IMG('1628840042765-356cda07504e'), popular: true, options: [
          { name: 'Size', min: 1, max: 1, required: true, choices: [['12" Regular', 0], ['16" Large', 600]] },
        ]},
        { name: 'Truffle Mushroom', desc: 'Wild mushrooms, taleggio, truffle oil', price: 1850 },
        { name: 'BBQ Chicken', desc: 'Smoked chicken, red onion, cilantro', price: 1700 },
      ]},
      { name: 'Wings & Sides', items: [
        { name: 'Buffalo Wings', desc: '8 pc, blue cheese dip', price: 1100, photo: IMG('1608039755401-742074f0548d') },
        { name: 'Garlic Knots', desc: '6 pc, parmesan, marinara', price: 650 },
      ]},
      { name: 'Desserts', items: [
        { name: 'Tiramisu', desc: 'Espresso-soaked, house mascarpone', price: 800, photo: IMG('1571877227200-a0d98ea607e9') },
      ]},
    ],
    reviews: [ ['Gina L.', 5, 'Real-deal neapolitan crust. Margherita is perfect.'], ['Marco D.', 4, 'Great pizza, arrived hot. Knots are a must.'], ['Chris B.', 4, 'Truffle mushroom pie is worth every penny.'] ],
  },
  {
    org_name: 'Tokyo Sushi Bar', type: 'restaurant', cuisine: 'Sushi', price_range: 3, rating: 4.8, ratings: 720,
    image: IMG('1579871494447-9811cf80d66c', 1200), promo: null, fee: 399, eta_min: 30, eta_max: 45,
    modes: { pickup: true, delivery: true, dinein: true }, lat: 37.785, lng: -122.431, address: '1580 Post St',
    sections: [
      { name: 'Signature Rolls', items: [
        { name: 'Dragon Roll', desc: 'Eel, cucumber, avocado, tobiko', price: 1500, photo: IMG('1579871494447-9811cf80d66c'), popular: true },
        { name: 'Rainbow Roll', desc: 'California roll topped with chef’s selection', price: 1600, photo: IMG('1553621042-f6e147245754'), popular: true },
        { name: 'Spicy Tuna Roll', desc: 'Ahi tuna, spicy mayo, scallion', price: 1100 },
        { name: 'California Roll', desc: 'Snow crab, avocado, cucumber', price: 900 },
      ]},
      { name: 'Nigiri & Sashimi', items: [
        { name: 'Salmon Nigiri (2pc)', desc: 'Scottish salmon', price: 700, photo: IMG('1534482421-64566f976cfa') },
        { name: 'Bluefin Tuna Nigiri (2pc)', desc: 'Line-caught', price: 800 },
        { name: 'Sashimi Platter', desc: '12 pc chef’s selection', price: 2400 },
      ]},
      { name: 'Appetizers', items: [
        { name: 'Edamame', desc: 'Sea salt or spicy garlic', price: 550, options: [ { name: 'Style', min: 1, max: 1, required: true, choices: [['Sea Salt', 0], ['Spicy Garlic', 50]] } ] },
        { name: 'Pork Gyoza (5pc)', desc: 'Pan-fried, ponzu', price: 750, photo: IMG('1496116218417-1a781b1c416c') },
        { name: 'Miso Soup', desc: 'Tofu, wakame, scallion', price: 400 },
      ]},
    ],
    reviews: [ ['Kenji M.', 5, 'Fish quality rivals places twice the price.'], ['Lauren S.', 5, 'Dragon roll presentation is stunning, even delivered.'], ['Tom H.', 4, 'Pricey but worth it for a treat.'] ],
  },
  {
    org_name: 'Green Bowl Kitchen', type: 'restaurant', cuisine: 'Healthy', price_range: 2, rating: 4.7, ratings: 860,
    image: IMG('1512621776951-a57141f2eefd', 1200), promo: 'Buy 1, Get 1 Free', fee: 199, eta_min: 20, eta_max: 30,
    modes: { pickup: true, delivery: true }, lat: 37.79, lng: -122.42, address: '500 Market St',
    sections: [
      { name: 'Bowls', items: [
        { name: 'Green Goddess', desc: 'Kale, quinoa, avocado, green tahini', price: 1300, photo: IMG('1512621776951-a57141f2eefd'), popular: true, options: [
          { name: 'Protein', min: 1, max: 1, required: true, choices: [['Tofu', 0], ['Chicken', 200], ['Salmon', 400]] },
        ]},
        { name: 'Harvest Bowl', desc: 'Roasted sweet potato, wild rice, goat cheese', price: 1250, photo: IMG('1546069901-ba9599a7e63c'), popular: true, options: [
          { name: 'Protein', min: 1, max: 1, required: true, choices: [['Tofu', 0], ['Chicken', 200], ['Steak', 350]] },
        ]},
        { name: 'Spicy Tofu Bowl', desc: 'Gochujang tofu, brown rice, pickled veg (vegan)', price: 1190 },
      ]},
      { name: 'Salads', items: [
        { name: 'Kale Caesar', desc: 'Lacinato kale, sourdough crumb, white anchovy', price: 1050, photo: IMG('1550304943-4f24f54ddde9') },
        { name: 'Mediterranean Crunch', desc: 'Chickpeas, feta, cucumber, sumac vinaigrette', price: 1100 },
      ]},
      { name: 'Smoothies & Juice', items: [
        { name: 'Berry Blast Smoothie', desc: 'Triple berry, banana, oat milk', price: 750, photo: IMG('1505252585461-04db1eb84625') },
        { name: 'Green Machine Juice', desc: 'Celery, apple, ginger, lemon', price: 800 },
      ]},
    ],
    reviews: [ ['Elena V.', 5, 'The only salad place where delivery still tastes fresh.'], ['Marcus J.', 4, 'Harvest bowl with steak is my weekly order.'], ['Kim O.', 5, 'Vegan options that actually have flavor.'] ],
  },
  {
    org_name: "Nia's Kitchen", type: 'home_chef', cuisine: 'West African', price_range: 2, rating: 4.9, ratings: 312,
    image: IMG('1512058564366-18510be2db19', 1200), promo: null, fee: 299, eta_min: 35, eta_max: 50,
    modes: { pickup: true, delivery: true }, lat: 37.78, lng: -122.41, address: '12 Baker St',
    sections: [
      { name: 'Home Meals', items: [
        { name: 'Jollof Rice & Chicken', desc: 'Smoky party jollof, grilled chicken thigh, plantains', price: 1400, photo: IMG('1512058564366-18510be2db19'), popular: true, options: [
          { name: 'Heat Level', min: 1, max: 1, required: true, choices: [['Mild', 0], ['Medium', 0], ['Naija Hot', 0]] },
        ]},
        { name: 'Egusi & Pounded Yam', desc: 'Melon seed stew, spinach, assorted meat', price: 1600, popular: true },
        { name: 'Suya Skewers (3pc)', desc: 'Peanut-spiced grilled beef, red onion', price: 1200, photo: IMG('1529006557810-274b9b2fc783') },
        { name: 'Sweet Fried Plantains', desc: 'Caramelized dodo', price: 600 },
      ]},
      { name: 'Weekend Specials', items: [
        { name: 'Waakye Bowl', desc: 'Rice & beans, gari, boiled egg, shito (Sat/Sun)', price: 1350 },
        { name: 'Chin Chin (Snack Bag)', desc: 'Crunchy-sweet, house recipe', price: 450 },
      ]},
    ],
    reviews: [ ['Adaeze O.', 5, 'Tastes like my grandmother’s cooking. The real thing.'], ['Femi A.', 5, 'Jollof has actual smoke flavor. Order the suya too.'], ['Rachel G.', 5, 'Chef Nia puts love in every container.'] ],
  },
  {
    org_name: 'Seoul Street BBQ', type: 'truck', cuisine: 'Korean', price_range: 2, rating: 4.7, ratings: 1180,
    image: IMG('1529193591184-b1d58069ecdd', 1200), promo: '15% off orders $30+', fee: 149, eta_min: 20, eta_max: 30,
    modes: { pickup: true, delivery: true }, live: true, lat: 37.776, lng: -122.424, address: 'Civic Center Plaza',
    sections: [
      { name: 'Plates', items: [
        { name: 'Bulgogi Plate', desc: 'Soy-marinated ribeye, rice, banchan', price: 1450, photo: IMG('1529193591184-b1d58069ecdd'), popular: true },
        { name: 'Spicy Pork Plate', desc: 'Gochujang pork belly, kimchi, rice', price: 1390, popular: true },
        { name: 'Tofu Bibimbap', desc: 'Crispy tofu, seasonal veg, fried egg, gochujang (vegetarian)', price: 1250, photo: IMG('1553163147-622ab57be1c7') },
      ]},
      { name: 'Street Food', items: [
        { name: 'Korean Corn Dog', desc: 'Mozzarella, panko, sugar dust', price: 750, popular: true },
        { name: 'Tteokbokki', desc: 'Chewy rice cakes, sweet-spicy sauce', price: 890 },
        { name: 'Kimchi Fries', desc: 'Bulgogi, kimchi, gochujang aioli, scallion', price: 950 },
      ]},
    ],
    reviews: [ ['Hana C.', 5, 'Corn dog stretch is unreal. Track the truck, it moves!'], ['Diego F.', 4, 'Bulgogi plate portions are generous.'], ['Wes P.', 5, 'Kimchi fries = elite drunk food.'] ],
  },
  {
    org_name: 'Golden Dragon Noodles', type: 'restaurant', cuisine: 'Chinese', price_range: 1, rating: 4.3, ratings: 940,
    image: IMG('1585032226651-759b368d7246', 1200), promo: null, fee: 249, eta_min: 20, eta_max: 35,
    modes: { pickup: true, delivery: true, dinein: true }, lat: 37.794, lng: -122.406, address: '733 Washington St',
    sections: [
      { name: 'Noodles', items: [
        { name: 'Dan Dan Noodles', desc: 'Sichuan chili oil, minced pork, peanut', price: 1250, photo: IMG('1585032226651-759b368d7246'), popular: true },
        { name: 'Beef Chow Fun', desc: 'Wok-charred wide rice noodles', price: 1390, popular: true },
        { name: 'Veggie Lo Mein', desc: 'Seasonal vegetables, scallion oil (vegan)', price: 1090 },
      ]},
      { name: 'Dumplings', items: [
        { name: 'Pork Soup Dumplings (6pc)', desc: 'Hand-pleated XLB', price: 890, photo: IMG('1496116218417-1a781b1c416c'), popular: true },
        { name: 'Veggie Dumplings (6pc)', desc: 'Cabbage, shiitake, glass noodle (vegan)', price: 850 },
      ]},
      { name: 'Rice', items: [
        { name: 'Yangzhou Fried Rice', desc: 'Shrimp, BBQ pork, egg', price: 990 },
      ]},
    ],
    reviews: [ ['Vivian Z.', 4, 'XLB survive delivery surprisingly well.'], ['Nate R.', 4, 'Dan dan noodles have proper málà kick.'], ['Iris W.', 5, 'Fast, cheap, delicious.'] ],
  },
  {
    org_name: 'La Pâtisserie Dorée', type: 'baker', cuisine: 'Bakery', price_range: 2, rating: 4.9, ratings: 452,
    image: IMG('1555507036-ab1f4038808a', 1200), promo: '20% off pastries', fee: 199, eta_min: 20, eta_max: 30,
    modes: { pickup: true, delivery: true }, lat: 37.771, lng: -122.437, address: '2101 Hayes St',
    sections: [
      { name: 'Viennoiserie', items: [
        { name: 'Butter Croissant', desc: '72-hour laminated, French butter', price: 425, photo: IMG('1555507036-ab1f4038808a'), popular: true },
        { name: 'Pain au Chocolat', desc: 'Valrhona batons', price: 475, popular: true },
        { name: 'Almond Croissant', desc: 'Twice-baked, frangipane', price: 525 },
      ]},
      { name: 'Cakes & Tarts', items: [
        { name: 'Chocolate Fondant Slice', desc: '70% dark chocolate', price: 650, photo: IMG('1578985545062-69928b1d9587') },
        { name: 'Basque Cheesecake Slice', desc: 'Burnt top, custardy center', price: 700 },
        { name: 'Lemon Tart', desc: 'Torched meringue', price: 675 },
      ]},
      { name: 'Coffee', items: [
        { name: 'Latte', desc: 'Double shot, house blend', price: 500, photo: IMG('1509042239860-f550ce710b93'), options: [ { name: 'Milk', min: 1, max: 1, required: true, choices: [['Whole', 0], ['Oat', 75], ['Almond', 75]] } ] },
        { name: 'Cappuccino', desc: 'Classic dry foam', price: 475 },
      ]},
    ],
    reviews: [ ['Sophie B.', 5, 'Croissants as good as Paris. Not exaggerating.'], ['Liam N.', 5, 'Basque cheesecake is a religious experience.'], ['Grace T.', 4, 'Arrives beautifully boxed.'] ],
  },
  {
    org_name: 'Bombay Spice House', type: 'restaurant', cuisine: 'Indian', price_range: 2, rating: 4.6, ratings: 890,
    image: IMG('1585937421612-70a008356fbe', 1200), promo: null, fee: 299, eta_min: 30, eta_max: 45,
    modes: { pickup: true, delivery: true, dinein: true }, lat: 37.765, lng: -122.42, address: '3111 24th St',
    sections: [
      { name: 'Curries', items: [
        { name: 'Butter Chicken', desc: 'Tandoor chicken, tomato-fenugreek cream', price: 1590, photo: IMG('1585937421612-70a008356fbe'), popular: true, options: [
          { name: 'Spice Level', min: 1, max: 1, required: true, choices: [['Mild', 0], ['Medium', 0], ['Hot', 0], ['Indian Hot', 0]] },
        ]},
        { name: 'Chana Masala', desc: 'Chickpeas, ginger, garam masala (vegan)', price: 1290, options: [
          { name: 'Spice Level', min: 1, max: 1, required: true, choices: [['Mild', 0], ['Medium', 0], ['Hot', 0]] },
        ]},
        { name: 'Lamb Rogan Josh', desc: 'Kashmiri chili, slow-braised', price: 1750 },
      ]},
      { name: 'Tandoor & Breads', items: [
        { name: 'Garlic Naan', desc: 'Charred, buttered', price: 450, popular: true },
        { name: 'Chicken Biryani', desc: 'Saffron basmati, crispy onions, raita', price: 1490, photo: IMG('1563379091339-03b21ab4a4f8') },
        { name: 'Tandoori Half Chicken', desc: 'Yogurt-marinated, mint chutney', price: 1390 },
      ]},
    ],
    reviews: [ ['Anish P.', 5, 'Butter chicken is silky perfection. Get extra naan.'], ['Meera D.', 4, 'Biryani portion feeds two.'], ['Jake L.', 4, '"Indian Hot" is not a joke. Delicious.'] ],
  },
  {
    org_name: 'The Breakfast Club', type: 'restaurant', cuisine: 'Breakfast', price_range: 2, rating: 4.5, ratings: 2410,
    image: IMG('1567620905732-2d1ec7ab7445', 1200), promo: '15% off orders $25+', fee: 199, eta_min: 15, eta_max: 25,
    modes: { pickup: true, delivery: true, dinein: true }, lat: 37.798, lng: -122.435, address: '2301 Chestnut St',
    sections: [
      { name: 'All-Day Breakfast', items: [
        { name: 'Buttermilk Pancakes', desc: 'Stack of three, whipped butter, maple', price: 1090, photo: IMG('1567620905732-2d1ec7ab7445'), popular: true },
        { name: 'Avocado Toast', desc: 'Sourdough, heirloom tomato, chili flake', price: 1150, photo: IMG('1541519227354-08fa5d50c44d'), popular: true },
        { name: 'Breakfast Burrito', desc: 'Scrambled eggs, bacon, crispy potato, salsa', price: 1050 },
        { name: 'Brioche French Toast', desc: 'Berry compote, mascarpone', price: 1190, photo: IMG('1484723091739-30a097e8f929') },
      ]},
      { name: 'Coffee & Juice', items: [
        { name: 'Cold Brew', desc: '16 oz, single origin', price: 500, photo: IMG('1509042239860-f550ce710b93') },
        { name: 'Fresh Orange Juice', desc: 'Squeezed to order', price: 450 },
      ]},
    ],
    reviews: [ ['Nina S.', 5, 'French toast is heavenly. Weekend must.'], ['Omar E.', 4, 'Burrito travels well, still crispy.'], ['Beth C.', 4, 'Best pancakes in the Marina.'] ],
  },
  {
    org_name: 'Mediterraneo', type: 'caterer', cuisine: 'Mediterranean', price_range: 2, rating: 4.7, ratings: 640,
    image: IMG('1529006557810-274b9b2fc783', 1200), promo: 'Free baklava over $35', fee: 249, eta_min: 25, eta_max: 40,
    modes: { pickup: true, delivery: true }, lat: 37.786, lng: -122.44, address: '1793 Union St',
    sections: [
      { name: 'Plates', items: [
        { name: 'Chicken Shawarma Plate', desc: 'Spit-roasted, garlic toum, saffron rice', price: 1350, photo: IMG('1529006557810-274b9b2fc783'), popular: true },
        { name: 'Falafel Plate', desc: 'Herb falafel, tahini, Israeli salad (vegan)', price: 1190, popular: true },
        { name: 'Lamb Gyro Plate', desc: 'Shaved lamb, tzatziki, warm pita', price: 1450 },
      ]},
      { name: 'Mezze', items: [
        { name: 'Classic Hummus', desc: 'Silky chickpea, olive oil, warm pita', price: 650, photo: IMG('1593560708920-61dd98c46a4e') },
        { name: 'Baba Ganoush', desc: 'Fire-roasted eggplant', price: 700 },
        { name: 'Tabbouleh', desc: 'Parsley, bulgur, lemon', price: 600 },
      ]},
      { name: 'Sweets', items: [
        { name: 'Pistachio Baklava (3pc)', desc: 'Honey syrup, 40 layers', price: 550 },
      ]},
    ],
    reviews: [ ['Layla H.', 5, 'Toum so good I ordered a side of just toum.'], ['George K.', 5, 'Falafel stays crunchy. Rare for delivery.'], ['Dana M.', 4, 'Generous mezze portions.'] ],
  },
]

async function seedRichVendors(db: D1Database) {
  const row = await db.prepare('SELECT COUNT(1) AS n FROM vendors').first<{ n: number }>()
  if (Number(row?.n || 0) >= RICH_VENDORS.length) return
  // Wipe catalog + dependent demo data for a clean, consistent dataset
  for (const t of ['order_items', 'orders', 'group_order_items', 'group_orders', 'reviews', 'loyalty', 'reservations', 'options', 'option_groups', 'menu_items', 'menu_sections', 'menus', 'locations', 'vendors']) {
    try { await db.prepare(`DELETE FROM ${t}`).run() } catch {}
  }
  const HOURS = JSON.stringify({ mon: ['00:00-23:59'], tue: ['00:00-23:59'], wed: ['00:00-23:59'], thu: ['00:00-23:59'], fri: ['00:00-23:59'], sat: ['00:00-23:59'], sun: ['00:00-23:59'] })
  let demoUser = await queryOne<any>(db, "SELECT id FROM users WHERE email = 'alice@example.com'")
  if (!demoUser) {
    await db.prepare("INSERT INTO users (email, phone, role) VALUES ('alice@example.com','+15550000001','customer')").run()
    demoUser = await queryOne<any>(db, "SELECT id FROM users WHERE email = 'alice@example.com'")
  }
  for (const v of RICH_VENDORS) {
    const vr = await db.prepare(
      `INSERT INTO vendors (org_name, type, tier, verified, rating_avg, rating_count, service_modes_json, image_url, cuisine, price_range, delivery_fee_cents, eta_min, eta_max, promo_text)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(v.org_name, v.type, v.tier || 'basic', v.rating, v.ratings, JSON.stringify(v.modes), v.image, v.cuisine, v.price_range, v.fee, v.eta_min, v.eta_max, v.promo || null).run()
    const vendorId = Number(vr.meta.last_row_id)
    await db.prepare(
      `INSERT INTO locations (vendor_id, address, city, region, postal_code, country, lat, lng, hours_json, is_live_tracking) VALUES (?, ?, 'San Francisco', 'CA', '94100', 'US', ?, ?, ?, ?)`
    ).bind(vendorId, v.address, v.lat, v.lng, HOURS, v.live ? 1 : 0).run()
    const mr = await db.prepare(`INSERT INTO menus (vendor_id, title, is_active) VALUES (?, 'Full Menu', 1)`).bind(vendorId).run()
    const menuId = Number(mr.meta.last_row_id)
    let sort = 0
    for (const s of v.sections) {
      sort++
      const sr = await db.prepare(`INSERT INTO menu_sections (menu_id, name, sort_order) VALUES (?, ?, ?)`).bind(menuId, s.name, sort).run()
      const sectionId = Number(sr.meta.last_row_id)
      for (const it of s.items) {
        const ir = await db.prepare(
          `INSERT INTO menu_items (section_id, name, description, photo, base_price, is_available, is_popular) VALUES (?, ?, ?, ?, ?, 1, ?)`
        ).bind(sectionId, it.name, it.desc || null, it.photo || null, it.price, it.popular ? 1 : 0).run()
        const itemId = Number(ir.meta.last_row_id)
        for (const g of it.options || []) {
          const gr = await db.prepare(`INSERT INTO option_groups (item_id, name, min, max, required) VALUES (?, ?, ?, ?, ?)`).bind(itemId, g.name, g.min, g.max, g.required ? 1 : 0).run()
          const groupId = Number(gr.meta.last_row_id)
          for (const [name, delta] of g.choices) {
            await db.prepare(`INSERT INTO options (group_id, name, price_delta) VALUES (?, ?, ?)`).bind(groupId, name, delta).run()
          }
        }
      }
    }
    for (const [author, rating, text] of v.reviews) {
      await db.prepare(`INSERT INTO reviews (user_id, vendor_id, rating, text, status, author_name) VALUES (?, ?, ?, ?, 'published', ?)`).bind(Number(demoUser.id), vendorId, rating, text, author).run()
    }
  }
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

  // Column evolutions for the rich catalog (idempotent)
  const vendorCols: Array<[string, string]> = [
    ['image_url', 'TEXT'], ['cuisine', 'TEXT'], ['price_range', 'INTEGER'],
    ['delivery_fee_cents', 'INTEGER'], ['eta_min', 'INTEGER'], ['eta_max', 'INTEGER'], ['promo_text', 'TEXT'],
  ]
  for (const [col, typ] of vendorCols) {
    if (!(await columnExists(db, 'vendors', col))) {
      await db.prepare(`ALTER TABLE vendors ADD COLUMN ${col} ${typ}`).run()
    }
  }
  if (!(await columnExists(db, 'menu_items', 'is_popular'))) {
    await db.prepare(`ALTER TABLE menu_items ADD COLUMN is_popular INTEGER NOT NULL DEFAULT 0`).run()
  }
  if (!(await columnExists(db, 'reviews', 'author_name'))) {
    await db.prepare(`ALTER TABLE reviews ADD COLUMN author_name TEXT`).run()
  }

  // Upgrade to the rich demo catalog when the DB still has the old minimal seed
  await seedRichVendors(db)
}

// ---------- Vendor Registration ----------
const CUISINE_DEFAULT_IMG: Record<string, string> = {
  Mexican: IMG('1565299585323-38d6b0865b47', 1200), Burgers: IMG('1568901346375-23c9450c58cd', 1200),
  Pizza: IMG('1513104890138-7c749659a591', 1200), Sushi: IMG('1579871494447-9811cf80d66c', 1200),
  Healthy: IMG('1512621776951-a57141f2eefd', 1200), 'West African': IMG('1512058564366-18510be2db19', 1200),
  Korean: IMG('1529193591184-b1d58069ecdd', 1200), Chinese: IMG('1585032226651-759b368d7246', 1200),
  Bakery: IMG('1555507036-ab1f4038808a', 1200), Indian: IMG('1585937421612-70a008356fbe', 1200),
  Breakfast: IMG('1567620905732-2d1ec7ab7445', 1200), Mediterranean: IMG('1529006557810-274b9b2fc783', 1200),
}
const GENERIC_STORE_IMG = IMG('1517248135467-4c7edcad34c4', 1200)

app.post('/api/vendor/register', async (c) => {
  const db = c.env.DB
  const body = await c.req.json<{
    org_name: string; type?: string; cuisine?: string; email: string; phone?: string
    address?: string; city?: string
    delivery_fee_cents?: number; price_range?: number
    service_modes?: { pickup?: boolean; delivery?: boolean; dinein?: boolean }
    promo_text?: string; image_url?: string
  }>().catch(() => null)
  if (!body || !body.org_name || !body.email) return c.json({ error: 'org_name_and_email_required' }, 400)
  const email = body.email.toLowerCase().trim()
  const orgName = body.org_name.trim().slice(0, 80)
  const type = ['restaurant', 'truck', 'home_chef', 'street', 'baker', 'caterer'].includes(body.type || '') ? body.type : 'restaurant'
  const cuisine = (body.cuisine || 'Healthy').slice(0, 40)
  const modes = body.service_modes && typeof body.service_modes === 'object' ? body.service_modes : { pickup: true, delivery: true }
  const fee = Math.max(0, Math.min(999, Number(body.delivery_fee_cents ?? 199)))
  const priceRange = Math.max(1, Math.min(3, Number(body.price_range || 2)))
  const image = (body.image_url || '').trim() || CUISINE_DEFAULT_IMG[cuisine] || GENERIC_STORE_IMG

  // user (vendor role)
  let user = await queryOne<any>(db, 'SELECT * FROM users WHERE email = ?', [email])
  if (!user) {
    await db.prepare('INSERT INTO users (email, phone, role) VALUES (?, ?, ?)').bind(email, body.phone || null, 'vendor').run()
    user = await queryOne<any>(db, 'SELECT * FROM users WHERE email = ?', [email])
  } else {
    await db.prepare("UPDATE users SET role = 'vendor' WHERE id = ?").bind(user.id).run()
  }

  // vendor + location + starter menu
  const vr = await db.prepare(
    `INSERT INTO vendors (org_name, type, tier, verified, rating_avg, rating_count, service_modes_json, image_url, cuisine, price_range, delivery_fee_cents, eta_min, eta_max, promo_text)
     VALUES (?, ?, 'basic', 0, 0, 0, ?, ?, ?, ?, ?, 25, 40, ?)`
  ).bind(orgName, type, JSON.stringify(modes), image, cuisine, priceRange, fee, (body.promo_text || '').trim() || null).run()
  const vendorId = Number(vr.meta.last_row_id)
  const HOURS = JSON.stringify({ mon: ['00:00-23:59'], tue: ['00:00-23:59'], wed: ['00:00-23:59'], thu: ['00:00-23:59'], fri: ['00:00-23:59'], sat: ['00:00-23:59'], sun: ['00:00-23:59'] })
  await db.prepare(
    `INSERT INTO locations (vendor_id, address, city, region, postal_code, country, lat, lng, hours_json, is_live_tracking) VALUES (?, ?, ?, 'CA', '94100', 'US', 37.7749, -122.4194, ?, 0)`
  ).bind(vendorId, (body.address || '').trim() || null, (body.city || 'San Francisco').trim(), HOURS).run()
  const mr = await db.prepare(`INSERT INTO menus (vendor_id, title, is_active) VALUES (?, 'Full Menu', 1)`).bind(vendorId).run()
  await db.prepare(`INSERT INTO menu_sections (menu_id, name, sort_order) VALUES (?, 'Featured', 1)`).bind(Number(mr.meta.last_row_id)).run()

  const payload: any = { sub: String(user.id), email, role: 'vendor', vendor_id: vendorId }
  const token = await sign(payload, getJwtSecret(c))
  const vendor = await queryOne<any>(db, 'SELECT * FROM vendors WHERE id = ?', [vendorId])
  return c.json({ token, user: payload, vendor })
})

// ---------- Vendor Onboarding (Protected) ----------
app.get('/api/vendor/self', requireAuth, requireVendor, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const vendorId = Number(user.vendor_id)
  const vendor = await queryOne<any>(db, 'SELECT * FROM vendors WHERE id = ?', [vendorId])
  if (!vendor) return c.json({ error: 'vendor_not_found' }, 404)
  const menu = await queryOne<any>(db, 'SELECT * FROM menus WHERE vendor_id = ? ORDER BY last_updated DESC LIMIT 1', [vendorId])
  return c.json({ vendor, menu })
})

app.post('/api/vendor/service-modes', requireAuth, requireVendor, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const vendorId = Number(user.vendor_id)
  const body = await c.req.json<{ service_modes: any }>().catch(()=>({service_modes:null}))
  const modes = body.service_modes ? JSON.stringify(body.service_modes) : null
  if (!modes) return c.json({ error: 'service_modes_required' }, 400)
  await db.prepare('UPDATE vendors SET service_modes_json = ? WHERE id = ?').bind(modes, vendorId).run()
  return c.json({ ok: true })
})

// Update store profile (whitelisted fields)
app.post('/api/vendor/profile', requireAuth, requireVendor, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const vendorId = Number(user.vendor_id)
  const body = await c.req.json<any>().catch(() => ({}))
  const sets: string[] = []
  const bind: unknown[] = []
  const strFields: Array<[string, number]> = [['org_name', 80], ['cuisine', 40], ['promo_text', 60], ['image_url', 300]]
  for (const [f, max] of strFields) {
    if (typeof body[f] === 'string') { sets.push(`${f} = ?`); bind.push(body[f].trim().slice(0, max) || null) }
  }
  if (body.type && ['restaurant', 'truck', 'home_chef', 'street', 'baker', 'caterer'].includes(body.type)) { sets.push('type = ?'); bind.push(body.type) }
  if (body.price_range != null) { sets.push('price_range = ?'); bind.push(Math.max(1, Math.min(3, Number(body.price_range) || 2))) }
  if (body.delivery_fee_cents != null) { sets.push('delivery_fee_cents = ?'); bind.push(Math.max(0, Math.min(9999, Number(body.delivery_fee_cents) || 0))) }
  if (body.eta_min != null) { sets.push('eta_min = ?'); bind.push(Math.max(5, Math.min(120, Number(body.eta_min) || 20))) }
  if (body.eta_max != null) { sets.push('eta_max = ?'); bind.push(Math.max(10, Math.min(180, Number(body.eta_max) || 40))) }
  if (body.service_modes && typeof body.service_modes === 'object') { sets.push('service_modes_json = ?'); bind.push(JSON.stringify(body.service_modes)) }
  if (!sets.length) return c.json({ error: 'no_fields' }, 400)
  bind.push(vendorId)
  await db.prepare(`UPDATE vendors SET ${sets.join(', ')} WHERE id = ?`).bind(...bind).run()
  const vendor = await queryOne<any>(db, 'SELECT * FROM vendors WHERE id = ?', [vendorId])
  return c.json({ ok: true, vendor })
})

// ---- Menu management helpers ----
async function vendorMenuId(db: D1Database, vendorId: number): Promise<number | null> {
  let menu = await queryOne<any>(db, 'SELECT id FROM menus WHERE vendor_id = ? AND is_active = 1 ORDER BY last_updated DESC LIMIT 1', [vendorId])
  if (!menu) {
    const mr = await db.prepare(`INSERT INTO menus (vendor_id, title, is_active) VALUES (?, 'Full Menu', 1)`).bind(vendorId).run()
    return Number(mr.meta.last_row_id)
  }
  return Number(menu.id)
}
async function sectionOwnedByVendor(db: D1Database, sectionId: number, vendorId: number) {
  const row = await queryOne<any>(db, 'SELECT s.id FROM menu_sections s JOIN menus m ON m.id = s.menu_id WHERE s.id = ? AND m.vendor_id = ?', [sectionId, vendorId])
  return !!row
}
async function itemOwnedByVendor(db: D1Database, itemId: number, vendorId: number) {
  const row = await queryOne<any>(db, 'SELECT i.id FROM menu_items i JOIN menu_sections s ON s.id = i.section_id JOIN menus m ON m.id = s.menu_id WHERE i.id = ? AND m.vendor_id = ?', [itemId, vendorId])
  return !!row
}
async function touchMenu(db: D1Database, vendorId: number) {
  try { await db.prepare('UPDATE menus SET last_updated = CURRENT_TIMESTAMP WHERE vendor_id = ?').bind(vendorId).run() } catch {}
}

// Sections
app.post('/api/vendor/sections', requireAuth, requireVendor, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const vendorId = Number(user.vendor_id)
  const body = await c.req.json<{ name: string }>().catch(() => ({ name: '' }))
  const name = (body.name || '').trim().slice(0, 60)
  if (!name) return c.json({ error: 'name_required' }, 400)
  const menuId = await vendorMenuId(db, vendorId)
  const maxRow = await queryOne<any>(db, 'SELECT MAX(sort_order) AS m FROM menu_sections WHERE menu_id = ?', [menuId])
  const res = await db.prepare('INSERT INTO menu_sections (menu_id, name, sort_order) VALUES (?, ?, ?)').bind(menuId, name, Number(maxRow?.m || 0) + 1).run()
  await touchMenu(db, vendorId)
  return c.json({ ok: true, section_id: Number(res.meta.last_row_id) })
})

app.delete('/api/vendor/sections/:id', requireAuth, requireVendor, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const vendorId = Number(user.vendor_id)
  const sectionId = Number(c.req.param('id'))
  if (!(await sectionOwnedByVendor(db, sectionId, vendorId))) return c.json({ error: 'forbidden' }, 403)
  await db.prepare('DELETE FROM options WHERE group_id IN (SELECT id FROM option_groups WHERE item_id IN (SELECT id FROM menu_items WHERE section_id = ?))').bind(sectionId).run()
  await db.prepare('DELETE FROM option_groups WHERE item_id IN (SELECT id FROM menu_items WHERE section_id = ?)').bind(sectionId).run()
  await db.prepare('DELETE FROM menu_items WHERE section_id = ?').bind(sectionId).run()
  await db.prepare('DELETE FROM menu_sections WHERE id = ?').bind(sectionId).run()
  await touchMenu(db, vendorId)
  return c.json({ ok: true })
})

// Items
app.post('/api/vendor/items', requireAuth, requireVendor, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const vendorId = Number(user.vendor_id)
  const body = await c.req.json<any>().catch(() => null)
  if (!body || !body.section_id || !body.name || body.base_price == null) return c.json({ error: 'section_id_name_price_required' }, 400)
  const sectionId = Number(body.section_id)
  if (!(await sectionOwnedByVendor(db, sectionId, vendorId))) return c.json({ error: 'forbidden' }, 403)
  const price = Math.max(0, Math.min(100000, Math.round(Number(body.base_price))))
  const res = await db.prepare(
    'INSERT INTO menu_items (section_id, name, description, photo, base_price, is_available, is_popular) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(sectionId, String(body.name).trim().slice(0, 80), (body.description || '').trim().slice(0, 200) || null, (body.photo || '').trim() || null, price, body.is_available === false ? 0 : 1, body.is_popular ? 1 : 0).run()
  await touchMenu(db, vendorId)
  const item = await queryOne<any>(db, 'SELECT * FROM menu_items WHERE id = ?', [Number(res.meta.last_row_id)])
  return c.json({ ok: true, item })
})

app.put('/api/vendor/items/:id', requireAuth, requireVendor, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const vendorId = Number(user.vendor_id)
  const itemId = Number(c.req.param('id'))
  if (!(await itemOwnedByVendor(db, itemId, vendorId))) return c.json({ error: 'forbidden' }, 403)
  const body = await c.req.json<any>().catch(() => ({}))
  const sets: string[] = []
  const bind: unknown[] = []
  if (typeof body.name === 'string' && body.name.trim()) { sets.push('name = ?'); bind.push(body.name.trim().slice(0, 80)) }
  if (typeof body.description === 'string') { sets.push('description = ?'); bind.push(body.description.trim().slice(0, 200) || null) }
  if (typeof body.photo === 'string') { sets.push('photo = ?'); bind.push(body.photo.trim() || null) }
  if (body.base_price != null) { sets.push('base_price = ?'); bind.push(Math.max(0, Math.min(100000, Math.round(Number(body.base_price))))) }
  if (body.is_available != null) { sets.push('is_available = ?'); bind.push(body.is_available ? 1 : 0) }
  if (body.is_popular != null) { sets.push('is_popular = ?'); bind.push(body.is_popular ? 1 : 0) }
  if (!sets.length) return c.json({ error: 'no_fields' }, 400)
  bind.push(itemId)
  await db.prepare(`UPDATE menu_items SET ${sets.join(', ')} WHERE id = ?`).bind(...bind).run()
  await touchMenu(db, vendorId)
  const item = await queryOne<any>(db, 'SELECT * FROM menu_items WHERE id = ?', [itemId])
  return c.json({ ok: true, item })
})

app.delete('/api/vendor/items/:id', requireAuth, requireVendor, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const vendorId = Number(user.vendor_id)
  const itemId = Number(c.req.param('id'))
  if (!(await itemOwnedByVendor(db, itemId, vendorId))) return c.json({ error: 'forbidden' }, 403)
  await db.prepare('DELETE FROM options WHERE group_id IN (SELECT id FROM option_groups WHERE item_id = ?)').bind(itemId).run()
  await db.prepare('DELETE FROM option_groups WHERE item_id = ?').bind(itemId).run()
  await db.prepare('DELETE FROM menu_items WHERE id = ?').bind(itemId).run()
  await touchMenu(db, vendorId)
  return c.json({ ok: true })
})

// Vendor order queue
app.get('/api/vendor/orders', requireAuth, requireVendor, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const vendorId = Number(user.vendor_id)
  const orders = await queryAll<any>(db, 'SELECT * FROM orders WHERE vendor_id = ? ORDER BY id DESC LIMIT 30', [vendorId])
  const ids = orders.map((o) => o.id)
  let itemsByOrder: Record<number, any[]> = {}
  if (ids.length) {
    const ph = ids.map(() => '?').join(',')
    const items = await queryAll<any>(
      db,
      `SELECT oi.*, COALESCE(mi.name, 'Removed item') AS item_name FROM order_items oi LEFT JOIN menu_items mi ON mi.id = oi.item_id WHERE oi.order_id IN (${ph})`,
      ids as unknown[]
    )
    for (const it of items) (itemsByOrder[it.order_id] ||= []).push(it)
  }
  return c.json({ orders: orders.map((o) => ({ ...o, items: itemsByOrder[o.id] || [] })) })
})

app.post('/api/vendor/menu-skeleton', requireAuth, requireVendor, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const vendorId = Number(user.vendor_id)
  // create a simple menu with one section if none exists
  const exists = await queryOne<any>(db, 'SELECT id FROM menus WHERE vendor_id = ? LIMIT 1', [vendorId])
  if (!exists) {
    const m = await db.prepare('INSERT INTO menus (vendor_id, title, is_active) VALUES (?, ?, 1)').bind(vendorId, 'Main Menu').run()
    const menuId = Number(m.meta.last_row_id)
    await db.prepare('INSERT INTO menu_sections (menu_id, name, sort_order) VALUES (?, ?, 1)').bind(menuId, 'Featured', 1).run()
    return c.json({ ok: true, created: true, menu_id: menuId })
  }
  return c.json({ ok: true, created: false, menu_id: exists.id })
})

// ---------- Metrics endpoint (optional) ----------
app.post('/api/metrics/ab-hero', async (c) => {
  const v = (c.req.query('variant') || '').toLowerCase()
  if (v !== 'bg' && v !== 'card') return c.json({ error: 'invalid_variant' }, 400)
  try {
    const date = new Date().toISOString().slice(0, 10)
    await incKV(c, `impressions:hero:${v}:${date}`, 1)
  } catch {}
  return c.json({ ok: true })
})

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
    `SELECT id, org_name, type, tier, verified, rating_avg, rating_count, service_modes_json, image_url, cuisine, price_range, delivery_fee_cents, eta_min, eta_max, promo_text, created_at FROM vendors ${where} ORDER BY id DESC LIMIT 200`,
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

  const vendors = enriched.map((v) => {
    let modes: any = null
    try { modes = v.service_modes_json ? JSON.parse(v.service_modes_json) : null } catch {}
    return {
      id: v.id,
      org_name: v.org_name,
      type: v.type,
      tier: v.tier,
      verified: v.verified,
      rating_avg: v.rating_avg,
      rating_count: v.rating_count,
      open_now: v.open_now,
      distance_km: v.distance_km,
      image_url: v.image_url,
      cuisine: v.cuisine,
      price_range: v.price_range,
      delivery_fee_cents: v.delivery_fee_cents,
      eta_min: v.eta_min,
      eta_max: v.eta_max,
      promo_text: v.promo_text,
      service_modes: modes,
    }
  })
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
  const body = await c.req.json<{ user_id?: number; rating: number; text?: string; author_name?: string }>()
  const userId = body.user_id ?? 1 // demo user
  const rating = Math.max(1, Math.min(5, Number(body.rating)))
  const author = (body.author_name || '').trim().slice(0, 40) || 'Menu Customer'
  await db
    .prepare(`INSERT INTO reviews (user_id, vendor_id, rating, text, status, author_name) VALUES (?, ?, ?, ?, 'published', ?)`)
    .bind(userId, id, rating, body.text || null, author)
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
    .json<{ vendor_id: number; type: string; items: ItemReq[]; user_id?: number; tip_cents?: number; promo_code?: string; distance_km?: number; loyalty_points?: number; priority?: boolean }>({ vendor_id: 0, type: 'pickup', items: [] } as any)
  const userId = body.user_id ?? 1 // demo user
  const vendorId = body.vendor_id
  const type = body.type === 'delivery' ? 'delivery' : 'pickup'
  const vendorRow = await queryOne<any>(db, 'SELECT * FROM vendors WHERE id = ?', [vendorId])
  if (!vendorRow) return c.json({ error: 'vendor_not_found' }, 400)
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
  // Fees: vendor's advertised delivery fee (fallback to distance formula), 5% service fee, optional priority
  const serviceFee = Math.round(subtotal * 0.05)
  const priorityFee = body.priority && type === 'delivery' ? 149 : 0
  let deliveryFee = 0
  if (type === 'delivery') {
    if (vendorRow.delivery_fee_cents != null) {
      deliveryFee = Number(vendorRow.delivery_fee_cents)
    } else if (typeof body.distance_km === 'number' && !Number.isNaN(body.distance_km) && body.distance_km > 0) {
      deliveryFee = Math.round(199 + Math.max(0, Number(body.distance_km)) * 80)
    } else {
      deliveryFee = 399
    }
  }
  let fees = deliveryFee + serviceFee + priorityFee
  let etaStr: string | null = null
  if (type === 'delivery') {
    const lo = Number(vendorRow.eta_min || 25)
    const hi = Number(vendorRow.eta_max || 40)
    etaStr = body.priority ? `${Math.max(5, lo - 7)}-${Math.max(10, hi - 7)}m` : `${lo}-${hi}m`
  } else {
    etaStr = `${Math.max(10, Number(vendorRow.eta_min || 15) - 5)}m`
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
  const items = await queryAll<any>(db, "SELECT oi.*, COALESCE(mi.name, 'Removed item') AS item_name, mi.photo AS item_photo FROM order_items oi LEFT JOIN menu_items mi ON mi.id = oi.item_id WHERE oi.order_id = ?", [id])
  const vendor = await queryOne<any>(db, 'SELECT id, org_name, image_url, cuisine, eta_min, eta_max FROM vendors WHERE id = ?', [order.vendor_id])
  return c.json({ order, items, vendor })
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

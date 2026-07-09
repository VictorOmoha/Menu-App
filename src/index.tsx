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
// Ensure schema + seed on first API hit (local dev convenience).
// Memoized per isolate — dozens of DDL queries must not run on every request.
let schemaReady: Promise<void> | null = null
app.use('/api/*', async (c, next) => {
  if (!schemaReady) {
    schemaReady = ensureSchemaAndSeed(c.env.DB).catch((e) => {
      schemaReady = null
      throw e
    })
  }
  await schemaReady
  await next()
})

// Serve static assets from public/ at /static/*
app.use('/static/*', serveStatic({ root: './public' }))

// Browsers request /favicon.ico automatically — point it at the SVG icon
app.get('/favicon.ico', (c) => c.redirect('/static/favicon.svg', 301))

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
let warnedDevSecret = false
function getJwtSecret(c: any) {
  const secret = c.env?.JWT_SECRET
  if (!secret && !warnedDevSecret) {
    warnedDevSecret = true
    console.warn('[auth] JWT_SECRET is not set — falling back to an insecure dev secret. Set JWT_SECRET before deploying.')
  }
  return secret || 'dev-secret'
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

// Resolve the acting user's id from a Bearer token when present.
// Customer endpoints allow guest usage, so this falls back to the demo user (id 1)
// rather than rejecting — but a signed-in user always acts as themselves, and a
// client-supplied user_id can never override a verified token.
async function resolveUserId(c: any, bodyUserId?: unknown): Promise<number> {
  const h = c.req.header('Authorization') || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  if (m) {
    try {
      const payload: any = await verify(m[1], getJwtSecret(c))
      const sub = Number(payload?.sub)
      if (Number.isInteger(sub) && sub > 0) return sub
    } catch {}
  }
  const bid = Number(bodyUserId)
  if (Number.isInteger(bid) && bid > 0) return bid
  return 1
}

async function requireVendor(c: any, next: any) {
  const user: any = c.get('user')
  if (!user || (user.role !== 'vendor' && user.role !== 'admin')) {
    return c.json({ error: 'forbidden' }, 403)
  }
  if (!(Number(user.vendor_id) > 0)) {
    return c.json({ error: 'vendor_context_required' }, 400)
  }
  await next()
}

// ---------- Auth Endpoints ----------
app.post('/api/auth/login', async (c) => {
  try {
    const body = await c.req.json<{ email: string }>().catch(() => null)
    const email = (body?.email || '').toLowerCase().trim()
    if (!email || !email.includes('@')) return c.json({ error: 'email_required' }, 400)
    // Ensure user row exists (demo behavior)
    const db = c.env.DB
    let user = await queryOne<any>(db, 'SELECT * FROM users WHERE email = ?', [email])
    if (!user) {
      await db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').bind(email, 'customer').run()
      user = await queryOne<any>(db, 'SELECT * FROM users WHERE email = ?', [email])
    }
    // Role and vendor context come from the database — never from the request body
    const role = user.role === 'vendor' || user.role === 'admin' || user.role === 'driver' ? user.role : 'customer'
    const payload: any = { sub: String(user.id), email, role }
    if (role === 'vendor') {
      const owned = await queryOne<{ id: number }>(db, 'SELECT id FROM vendors WHERE owner_user_id = ? ORDER BY id DESC LIMIT 1', [user.id])
      if (owned) payload.vendor_id = Number(owned.id)
    }
    if (role === 'driver') {
      const drv = await queryOne<{ id: number }>(db, 'SELECT id FROM drivers WHERE user_id = ? LIMIT 1', [user.id])
      if (drv) payload.driver_id = Number(drv.id)
    }
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
            <a href="/driver" class="hover:text-black">Become a courier</a>
          </nav>
          <div class="flex items-center gap-2">
            <a href="/app" class="px-4 py-2 text-sm font-semibold rounded-full bg-gray-100 hover:bg-gray-200">Sign in</a>
            <a href="/app" class="px-4 py-2 text-sm font-semibold rounded-full bg-black text-white hover:bg-gray-800">Get started</a>
          </div>
        </div>
      </header>

      {/* Hero — brand red with address entry */}
      <section class="relative overflow-hidden" style="background:#EB1700">
        <img src={IMG('1512058564366-18510be2db19', 900)} alt="" class="hidden md:block absolute -left-16 -top-16 w-72 h-72 object-cover rounded-full opacity-95 rotate-[-8deg] shadow-2xl" />
        <img src={IMG('1529006557810-274b9b2fc783', 900)} alt="" class="hidden md:block absolute -right-20 top-8 w-80 h-80 object-cover rounded-full opacity-95 rotate-[7deg] shadow-2xl" />
        <img src={IMG('1555507036-ab1f4038808a', 700)} alt="" class="hidden lg:block absolute right-40 -bottom-24 w-56 h-56 object-cover rounded-full opacity-90 shadow-2xl" />
        <div class="relative max-w-3xl mx-auto px-6 py-20 md:py-28 text-center">
          <h1 class="text-4xl md:text-6xl font-extrabold tracking-tight text-white">Lagos &amp; Abuja flavors, delivered.</h1>
          <p class="mt-4 text-lg md:text-xl text-white/90">From buka classics and suya nights to pizza and sushi — restaurants, food trucks, home chefs and bakeries at your door.</p>
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
          <a href="/app#/?cat=Jollof" class="relative overflow-hidden rounded-2xl border border-gray-200 h-36 p-5 hover:shadow-lg transition-shadow bg-white">
            <div class="font-bold text-lg">Jollof</div>
            <img src={IMG('1512058564366-18510be2db19', 400)} alt="Jollof rice" class="absolute -bottom-7 -right-7 w-28 h-28 rounded-full object-cover" />
          </a>
          <a href="/app#/?cat=Suya+%26+Grills" class="relative overflow-hidden rounded-2xl border border-gray-200 h-36 p-5 hover:shadow-lg transition-shadow bg-white">
            <div class="font-bold text-lg">Suya &amp; Grills</div>
            <img src={IMG('1529006557810-274b9b2fc783', 400)} alt="Suya" class="absolute -bottom-7 -right-7 w-28 h-28 rounded-full object-cover" />
          </a>
          <a href="/app#/?cat=Swallow" class="relative overflow-hidden rounded-2xl border border-gray-200 h-36 p-5 hover:shadow-lg transition-shadow bg-white">
            <div class="font-bold text-lg">Amala &amp; Swallow</div>
            <img src={IMG('1547592166-23ac45744acd', 400)} alt="Amala and soup" class="absolute -bottom-7 -right-7 w-28 h-28 rounded-full object-cover" />
          </a>
          <a href="/app#/?cat=Pizza" class="relative overflow-hidden rounded-2xl border border-gray-200 h-36 p-5 hover:shadow-lg transition-shadow bg-white">
            <div class="font-bold text-lg">Pizza</div>
            <img src={IMG('1513104890138-7c749659a591', 400)} alt="Pizza" class="absolute -bottom-7 -right-7 w-28 h-28 rounded-full object-cover" />
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
            <p class="mt-3 text-white/80">From Lekki to Wuse 2 — reach new customers and manage orders, menus, loyalty, reservations and group orders in one place.</p>
            <a href="/app#/vendor/join" class="mt-6 inline-block px-6 py-3 rounded-full text-white text-sm font-bold" style="background:#EB1700">Join as a vendor</a>
          </div>
          <img src={IMG('1531123897727-8f129e1688ce', 900)} alt="Nigerian food entrepreneur" class="w-full h-64 md:h-full object-cover" />
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
            <div class="space-y-2 text-gray-600"><div><a href="/app#/vendor/join" class="hover:text-black">Become a vendor</a></div><div><a href="/driver" class="hover:text-black">Become a courier</a></div><div>API for partners</div></div>
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

// Courier app shell (driver.js renders everything into #driver-app)
app.get('/driver', (c) => {
  return c.render(
    <div>
      <link href="/static/driver.css" rel="stylesheet" />
      <div id="driver-app"></div>
      <script src="/static/driver.js"></script>
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
    .prepare(`SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = ? LIMIT 1`)
    .bind(table, column)
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

// ---------- Rich demo catalog ----------
const IMG = (id: string, w = 800) => `https://images.unsplash.com/photo-${id}?w=${w}&q=60&auto=format&fit=crop`

type SeedItem = { name: string; desc?: string; price: number; photo?: string; popular?: boolean; options?: Array<{ name: string; min: number; max: number; required: boolean; choices: Array<[string, number]> }> }
type SeedVendor = {
  org_name: string; type: string; cuisine: string; tier?: string; price_range: number
  rating: number; ratings: number; image: string; promo?: string | null
  fee: number; eta_min: number; eta_max: number; modes: any; live?: boolean
  city: string; lat: number; lng: number; address: string
  sections: Array<{ name: string; items: SeedItem[] }>
  reviews: Array<[string, number, string]>
}

const HEAT_OPTS = { name: 'Pepper Level', min: 1, max: 1, required: true, choices: [['Mild', 0], ['Medium', 0], ['Extra Pepper', 0]] as Array<[string, number]> }
const PROTEIN_NG = { name: 'Protein', min: 1, max: 1, required: true, choices: [['Chicken', 0], ['Beef', 0], ['Goat Meat', 50000], ['Croaker Fish', 80000]] as Array<[string, number]> }
const SWALLOW_OPTS = { name: 'Choice of Swallow', min: 1, max: 1, required: true, choices: [['Eba', 0], ['Amala', 0], ['Semovita', 0], ['Pounded Yam', 30000]] as Array<[string, number]> }
const MEAT_ADDONS = { name: 'Meat Add-ons', min: 0, max: 3, required: false, choices: [['Assorted Meat', 150000], ['Ponmo', 80000], ['Shaki', 100000], ['Boiled Egg', 30000]] as Array<[string, number]> }

const RICH_VENDORS: SeedVendor[] = [
  {
    org_name: 'Jollof & Grills Co.', type: 'restaurant', cuisine: 'Jollof', price_range: 2, rating: 4.7, ratings: 2130,
    image: IMG('1512058564366-18510be2db19', 1200), promo: '20% off, up to ₦2,000', fee: 0, eta_min: 25, eta_max: 40,
    modes: { pickup: true, delivery: true, dinein: true }, city: 'Lagos', lat: 6.4478, lng: 3.4723, address: '14 Admiralty Way, Lekki Phase 1',
    sections: [
      { name: 'Jollof Specials', items: [
        { name: 'Party Jollof & Grilled Chicken', desc: 'Smoky party-style jollof, grilled chicken lap, dodo', price: 450000, photo: IMG('1512058564366-18510be2db19'), popular: true, options: [HEAT_OPTS] },
        { name: 'Smoky Jollof & Beef', desc: 'Firewood-flavour jollof, peppered beef cubes', price: 480000, popular: true, options: [HEAT_OPTS] },
        { name: 'Jollof & Grilled Croaker', desc: 'Whole grilled croaker fish, pepper sauce', price: 650000 },
        { name: 'Coconut Fried Rice & Chicken', desc: 'Coconut-infused fried rice, mixed veg', price: 420000 },
      ]},
      { name: 'Grills', items: [
        { name: 'Half Grilled Chicken', desc: 'Char-grilled, house pepper marinade', price: 550000, photo: IMG('1529193591184-b1d58069ecdd'), popular: true, options: [HEAT_OPTS] },
        { name: 'Peppered Gizzard', desc: 'Wok-tossed gizzard in ata dindin', price: 300000 },
      ]},
      { name: 'Sides & Drinks', items: [
        { name: 'Fried Plantain (Dodo)', desc: 'Sweet, caramelized', price: 120000 },
        { name: 'Moi Moi', desc: 'Steamed bean pudding, egg inside', price: 100000 },
        { name: 'Chapman', desc: 'Classic Lagos Chapman with cucumber', price: 150000 },
        { name: 'Zobo', desc: 'Chilled hibiscus, ginger & pineapple', price: 80000 },
      ]},
    ],
    reviews: [ ['Funke A.', 5, 'This jollof tastes like proper owambe party rice. The smokiness is real!'], ['Chinedu O.', 5, 'Ordered for the whole office. Everybody kept quiet while eating — that says it all.'], ['Bisi L.', 4, 'Chicken was juicy, jollof arrived hot in Lekki traffic. Impressive.'] ],
  },
  {
    org_name: "Mama Put Kitchen", type: 'home_chef', cuisine: 'Nigerian', price_range: 2, rating: 4.9, ratings: 312,
    image: IMG('1585937421612-70a008356fbe', 1200), promo: null, fee: 70000, eta_min: 35, eta_max: 50,
    modes: { pickup: true, delivery: true }, city: 'Lagos', lat: 6.5095, lng: 3.3711, address: '23 Herbert Macaulay Way, Yaba',
    sections: [
      { name: 'Home Meals', items: [
        { name: 'Egusi Soup & Swallow', desc: 'Melon seed soup, spinach, assorted meat', price: 550000, popular: true, options: [SWALLOW_OPTS, MEAT_ADDONS] },
        { name: 'Efo Riro & Swallow', desc: 'Rich vegetable soup, smoked fish & ponmo', price: 480000, options: [SWALLOW_OPTS, MEAT_ADDONS] },
        { name: 'Ofada Rice & Ayamase', desc: 'Local rice, designer green-pepper stew, assorted', price: 500000, photo: IMG('1512058564366-18510be2db19'), popular: true, options: [HEAT_OPTS] },
        { name: 'Native Rice (Iwuk Edesi)', desc: 'Palm-oil rice with dried fish & crayfish', price: 420000 },
      ]},
      { name: 'Weekend Specials', items: [
        { name: 'Nkwobi', desc: 'Spicy cow-foot in palm-oil paste (Sat/Sun)', price: 450000 },
        { name: 'Isi Ewu', desc: 'Goat head delicacy, utazi leaves (Sat/Sun)', price: 600000 },
      ]},
    ],
    reviews: [ ['Adaeze O.', 5, 'Tastes exactly like my grandmother in the village used to make. The real thing.'], ['Emeka N.', 5, 'The egusi is loaded — actual meat, not decoration. Chef Mama is a legend.'], ['Yemi S.', 5, 'Ofada with extra ayamase... I nearly cried. 10/10.'] ],
  },
  {
    org_name: 'Suya Republic', type: 'street', cuisine: 'Suya & Grills', price_range: 1, rating: 4.6, ratings: 1800,
    image: IMG('1529006557810-274b9b2fc783', 1200), promo: 'Free delivery over ₦10,000', fee: 50000, eta_min: 20, eta_max: 35,
    modes: { pickup: true, delivery: true }, live: true, city: 'Lagos', lat: 6.4281, lng: 3.4219, address: 'Adeola Odeku St, Victoria Island',
    sections: [
      { name: 'Suya', items: [
        { name: 'Beef Suya', desc: 'Thin-cut beef, yaji spice, onions & fresh pepper', price: 300000, photo: IMG('1529006557810-274b9b2fc783'), popular: true, options: [HEAT_OPTS, { name: 'Extras', min: 0, max: 3, required: false, choices: [['Extra Yaji', 0], ['Onions & Tomato', 20000], ['Agege Bread', 60000]] }] },
        { name: 'Chicken Suya', desc: 'Boneless chicken thigh, charcoal-grilled', price: 350000, options: [HEAT_OPTS] },
        { name: 'Ram Suya', desc: 'Premium ram cuts — the connoisseur choice', price: 500000, popular: true, options: [HEAT_OPTS] },
      ]},
      { name: 'Night Grills', items: [
        { name: 'Asun (Spicy Goat)', desc: 'Smoked goat meat tossed in scotch bonnet', price: 450000, photo: IMG('1544025162-d76694265947'), popular: true },
        { name: 'Peppered Snail', desc: 'Giant snails, ata dindin glaze', price: 600000 },
        { name: 'Grilled Catfish', desc: 'Whole catfish, pepper sauce & side dodo', price: 750000 },
      ]},
    ],
    reviews: [ ['Tunde B.', 5, 'Mai suya energy with restaurant hygiene. Yaji is perfectly balanced.'], ['Zainab M.', 4, 'Asun is dangerously peppery — exactly how it should be.'], ['Ibrahim K.', 5, 'They track the cart live like Uber. Suya at my door in 25 mins, VI to Ikoyi.'] ],
  },
  {
    org_name: 'Shawarma King', type: 'truck', cuisine: 'Shawarma', price_range: 1, rating: 4.5, ratings: 2400,
    image: IMG('1626700051175-6818013e1d4f', 1200), promo: 'Buy 1, Get 1 Free', fee: 60000, eta_min: 20, eta_max: 30,
    modes: { pickup: true, delivery: true }, live: true, city: 'Abuja', lat: 9.081, lng: 7.4951, address: 'Aminu Kano Crescent, Wuse 2',
    sections: [
      { name: 'Shawarma', items: [
        { name: 'Chicken Shawarma', desc: 'Double-wrapped, creamy garlic sauce, crunchy veg', price: 350000, photo: IMG('1626700051175-6818013e1d4f'), popular: true, options: [{ name: 'Extras', min: 0, max: 3, required: false, choices: [['Double Sausage', 80000], ['Extra Chicken', 120000], ['Extra Cheese', 50000]] }] },
        { name: 'Beef Shawarma', desc: 'Spiced beef strips, chilli mayo', price: 380000 },
        { name: 'Mixed Shawarma', desc: 'Chicken + beef + double sausage. The heavyweight.', price: 450000, popular: true },
      ]},
      { name: 'Sides & Drinks', items: [
        { name: 'Loaded Fries', desc: 'Fries, cheese sauce, chicken bits', price: 280000, photo: IMG('1573080496219-bb080dd4f877') },
        { name: 'Vanilla Milkshake', desc: 'Thick, hand-spun', price: 250000 },
        { name: 'Chilled Soft Drink', desc: 'Coke, Fanta, Sprite', price: 60000 },
      ]},
    ],
    reviews: [ ['Aisha U.', 5, 'Best shawarma in Abuja, no debate. The garlic sauce is addictive.'], ['Segun P.', 4, 'Mixed shawarma is a full meal and a half.'], ['Halima Y.', 5, 'BOGO deal on Fridays is criminal value.'] ],
  },
  {
    org_name: 'Amala Sky', type: 'restaurant', cuisine: 'Swallow', price_range: 1, rating: 4.8, ratings: 950,
    image: IMG('1547592166-23ac45744acd', 1200), promo: '15% off orders ₦15,000+', fee: 40000, eta_min: 25, eta_max: 40,
    modes: { pickup: true, delivery: true, dinein: true }, city: 'Lagos', lat: 6.4926, lng: 3.3559, address: '12 Adeniran Ogunsanya St, Surulere',
    sections: [
      { name: 'Amala & Abula', items: [
        { name: 'Amala + Ewedu & Gbegiri (Abula)', desc: 'The Ibadan classic — with buka stew', price: 350000, photo: IMG('1547592166-23ac45744acd'), popular: true, options: [MEAT_ADDONS] },
        { name: 'Amala + Efo Riro', desc: 'Loaded vegetable soup, smoked panla', price: 400000, options: [MEAT_ADDONS] },
        { name: 'Amala + Gbegiri only', desc: 'For the purists', price: 280000 },
      ]},
      { name: 'Street Classics', items: [
        { name: 'Ewa Agoyin & Agege Bread', desc: 'Mashed beans, scorching black sauce, soft bread', price: 300000, popular: true },
        { name: 'Asaro (Yam Porridge)', desc: 'Smoky mashed yam, palm oil, dried fish', price: 320000 },
      ]},
      { name: 'Drinks', items: [
        { name: 'Zobo', desc: 'House-brewed, chilled', price: 80000 },
        { name: 'Palm Wine (50cl)', desc: 'Fresh, chilled', price: 200000 },
      ]},
    ],
    reviews: [ ['Bola F.', 5, 'Abula so good I forgot I was eating with cutlery. Proper buka standard.'], ['Kunle A.', 5, 'The ewa agoyin sauce should be studied in a lab.'], ['Ronke D.', 4, 'Fast delivery within Surulere. Portions are generous.'] ],
  },
  {
    org_name: 'Calabar Pot', type: 'restaurant', cuisine: 'Pepper Soup', price_range: 2, rating: 4.7, ratings: 640,
    image: IMG('1569718212165-3a8278d5f624', 1200), promo: null, fee: 70000, eta_min: 30, eta_max: 45,
    modes: { pickup: true, delivery: true, dinein: true }, city: 'Abuja', lat: 9.033, lng: 7.4893, address: 'Area 11, Garki',
    sections: [
      { name: 'Pepper Soup', items: [
        { name: 'Catfish Pepper Soup', desc: 'Fresh point-and-kill catfish, scent leaf, uziza', price: 650000, photo: IMG('1569718212165-3a8278d5f624'), popular: true, options: [HEAT_OPTS] },
        { name: 'Goat Meat Pepper Soup', desc: 'Tender goat, calabash nutmeg broth', price: 550000, popular: true, options: [HEAT_OPTS] },
        { name: 'Chicken Pepper Soup', desc: 'Native chicken, light and fiery', price: 450000, options: [HEAT_OPTS] },
      ]},
      { name: 'Calabar Kitchen', items: [
        { name: 'Afang Soup & Swallow', desc: 'Wild afang leaves, periwinkle, assorted', price: 580000, options: [SWALLOW_OPTS] },
        { name: 'Edikang Ikong & Swallow', desc: 'The king of vegetable soups', price: 600000, options: [SWALLOW_OPTS] },
      ]},
      { name: 'Drinks', items: [
        { name: 'Palm Wine (50cl)', desc: 'Chilled, fresh tap', price: 200000 },
        { name: 'Zobo', desc: 'With ginger burn', price: 80000 },
      ]},
    ],
    reviews: [ ['Ekaette B.', 5, 'As a Calabar girl, I certify this afang. It is correct.'], ['Musa L.', 5, 'Catfish pepper soup cleared my sinuses and my worries.'], ['Joy E.', 4, 'Perfect rainy-day order. Arrived steaming hot.'] ],
  },
  {
    org_name: 'Small Chops Lab', type: 'caterer', cuisine: 'Small Chops', price_range: 1, rating: 4.6, ratings: 780,
    image: IMG('1551024506-0bccd828d307', 1200), promo: '10% off first order', fee: 50000, eta_min: 25, eta_max: 40,
    modes: { pickup: true, delivery: true }, city: 'Abuja', lat: 9.1108, lng: 7.4165, address: '1st Avenue, Gwarinpa',
    sections: [
      { name: 'Small Chops Boxes', items: [
        { name: 'Classic Box', desc: 'Puff puff, samosa, spring rolls, peppered chicken & gizzard', price: 500000, photo: IMG('1551024506-0bccd828d307'), popular: true },
        { name: 'Party Box (feeds 4)', desc: 'Everything in the classic, times four + stick meat', price: 1200000, popular: true },
        { name: 'Mini Box', desc: 'Solo-sized sampler', price: 300000 },
      ]},
      { name: 'À la carte', items: [
        { name: 'Puff Puff (10pc)', desc: 'Golden, fluffy, sugar-dusted option', price: 150000 },
        { name: 'Samosa (6pc)', desc: 'Crispy beef-filled', price: 200000 },
        { name: 'Spring Rolls (6pc)', desc: 'Veg-packed, extra crunchy', price: 220000 },
        { name: 'Peppered Gizzard Cup', desc: 'Party favourite', price: 300000 },
      ]},
      { name: 'Drinks', items: [
        { name: 'Chapman Jug (1L)', desc: 'For the table', price: 400000 },
      ]},
    ],
    reviews: [ ['Ngozi I.', 5, 'Ordered the party box for a house-warming — finished in 20 minutes.'], ['Dayo T.', 4, 'Puff puff still soft on arrival. That is the real test and they passed.'], ['Maryam S.', 5, 'My go-to for office parties in Gwarinpa.'] ],
  },
  {
    org_name: 'Eko Pizza Works', type: 'restaurant', cuisine: 'Pizza', price_range: 2, rating: 4.4, ratings: 1600,
    image: IMG('1513104890138-7c749659a591', 1200), promo: 'Free delivery over ₦12,000', fee: 80000, eta_min: 30, eta_max: 45,
    modes: { pickup: true, delivery: true, dinein: true }, city: 'Lagos', lat: 6.4433, lng: 3.4907, address: 'Block 21, Lekki Phase 1',
    sections: [
      { name: 'Pizzas', items: [
        { name: 'Suya Pizza', desc: 'Beef suya, yaji drizzle, caramelized onion — Lagos original', price: 1050000, photo: IMG('1513104890138-7c749659a591'), popular: true, options: [
          { name: 'Size', min: 1, max: 1, required: true, choices: [['12" Regular', 0], ['16" Large', 300000]] },
        ]},
        { name: 'Pepperoni', desc: 'Cup-and-char pepperoni, mozzarella', price: 950000, popular: true, options: [
          { name: 'Size', min: 1, max: 1, required: true, choices: [['12" Regular', 0], ['16" Large', 300000]] },
        ]},
        { name: 'Margherita', desc: 'Tomato, fresh mozzarella, basil', price: 850000 },
        { name: 'BBQ Chicken', desc: 'Smoked chicken, red onion, BBQ swirl', price: 1000000 },
      ]},
      { name: 'Sides', items: [
        { name: 'Chicken Wings (6pc)', desc: 'Peppered or BBQ', price: 450000, photo: IMG('1608039755401-742074f0548d') },
        { name: 'Garlic Bread', desc: 'Butter-brushed, herbed', price: 250000 },
      ]},
      { name: 'Dessert', items: [
        { name: 'Chocolate Lava Cake', desc: 'Molten center, vanilla scoop', price: 350000, photo: IMG('1578985545062-69928b1d9587') },
      ]},
    ],
    reviews: [ ['Gbenga R.', 5, 'Suya pizza sounds like blasphemy until you taste it. Genius.'], ['Amara C.', 4, 'Solid pizza, arrived hot despite Lekki traffic.'], ['Femi J.', 4, 'Wings are properly peppered. Respect.'] ],
  },
  {
    org_name: 'Burger Republic', type: 'restaurant', cuisine: 'Burgers', price_range: 2, rating: 4.5, ratings: 1900,
    image: IMG('1568901346375-23c9450c58cd', 1200), promo: '₦0 delivery fee', fee: 0, eta_min: 20, eta_max: 35,
    modes: { pickup: true, delivery: true, dinein: true }, city: 'Abuja', lat: 9.0765, lng: 7.4256, address: 'Jabi Lake Mall Food Court',
    sections: [
      { name: 'Burgers', items: [
        { name: 'Classic Smash', desc: 'Double smashed patties, American cheese, house sauce', price: 550000, photo: IMG('1568901346375-23c9450c58cd'), popular: true, options: [
          { name: 'Toppings', min: 0, max: 4, required: false, choices: [['Beef Bacon', 100000], ['Fried Egg', 50000], ['Extra Cheese', 50000], ['Caramelized Onions', 0]] },
        ]},
        { name: 'Double Trouble', desc: 'Four patties, double cheese, pickles', price: 750000, photo: IMG('1550317138-10000687a72b'), popular: true },
        { name: 'Spicy Naija Burger', desc: 'Scotch-bonnet mayo, peppered beef patty', price: 650000, options: [HEAT_OPTS] },
      ]},
      { name: 'Fries & Shakes', items: [
        { name: 'Classic Fries', desc: 'Crispy, sea salt', price: 200000 },
        { name: 'Loaded Suya Fries', desc: 'Fries, suya beef, yaji mayo, onions', price: 450000, photo: IMG('1573080496219-bb080dd4f877'), popular: true },
        { name: 'Oreo Shake', desc: 'Hand-spun, real cookies', price: 350000, photo: IMG('1563805042-7684c019e1cb') },
      ]},
    ],
    reviews: [ ['Jide W.', 4, 'Smash burgers done right. Suya fries are elite.'], ['Fatima G.', 5, 'Free delivery to Wuse from Jabi — and it arrived in 25 minutes.'], ['Osas E.', 4, 'Naija burger has proper pepper. Not for the weak.'] ],
  },
  {
    org_name: 'Maitama Pâtisserie', type: 'baker', cuisine: 'Bakery', price_range: 2, rating: 4.9, ratings: 380,
    image: IMG('1555507036-ab1f4038808a', 1200), promo: '20% off pastries', fee: 60000, eta_min: 25, eta_max: 40,
    modes: { pickup: true, delivery: true }, city: 'Abuja', lat: 9.0873, lng: 7.4956, address: '3 Gana Street, Maitama',
    sections: [
      { name: 'Pastries', items: [
        { name: 'Butter Croissant', desc: '72-hour laminated, French butter', price: 250000, photo: IMG('1555507036-ab1f4038808a'), popular: true },
        { name: 'Meat Pie', desc: 'Flaky crust, spiced minced beef & potato', price: 150000, popular: true },
        { name: 'Sausage Roll', desc: 'All-butter pastry, seasoned sausage', price: 120000 },
        { name: 'Chin Chin Box', desc: 'Crunchy-sweet, house recipe', price: 200000 },
      ]},
      { name: 'Cakes', items: [
        { name: 'Red Velvet Slice', desc: 'Cream cheese frosting', price: 350000 },
        { name: 'Chocolate Fudge Slice', desc: '70% dark chocolate', price: 320000, photo: IMG('1578985545062-69928b1d9587') },
      ]},
      { name: 'Coffee', items: [
        { name: 'Latte', desc: 'Double shot, house blend', price: 280000, photo: IMG('1509042239860-f550ce710b93'), options: [ { name: 'Milk', min: 1, max: 1, required: true, choices: [['Whole', 0], ['Oat', 40000], ['Almond', 40000]] } ] },
        { name: 'Cappuccino', desc: 'Classic dry foam', price: 250000 },
      ]},
    ],
    reviews: [ ['Sophie B.', 5, 'Croissants as good as Paris, in Maitama. Not exaggerating.'], ['Ahmed D.', 5, 'The meat pie is what every other meat pie wishes it was.'], ['Grace T.', 4, 'Beautiful packaging, cakes arrive intact.'] ],
  },
  {
    org_name: 'Green Bowl', type: 'restaurant', cuisine: 'Healthy', price_range: 2, rating: 4.7, ratings: 560,
    image: IMG('1512621776951-a57141f2eefd', 1200), promo: 'Buy 1, Get 1 Free', fee: 60000, eta_min: 25, eta_max: 35,
    modes: { pickup: true, delivery: true }, city: 'Abuja', lat: 9.0812, lng: 7.49, address: 'Adetokunbo Ademola Cres, Wuse 2',
    sections: [
      { name: 'Bowls', items: [
        { name: 'Grilled Chicken Bowl', desc: 'Char-grilled chicken, quinoa, avocado, greens', price: 650000, photo: IMG('1512621776951-a57141f2eefd'), popular: true, options: [PROTEIN_NG] },
        { name: 'Naija Buddha Bowl', desc: 'Sweet potato, moi moi cubes, kale, ata rodo dressing', price: 550000, photo: IMG('1546069901-ba9599a7e63c') },
        { name: 'Tuna Salad Bowl', desc: 'Seared tuna, cucumber, sesame', price: 600000 },
      ]},
      { name: 'Smoothies & Juice', items: [
        { name: 'Mango Sunrise', desc: 'Mango, pineapple, ginger', price: 280000, photo: IMG('1505252585461-04db1eb84625') },
        { name: 'Green Detox', desc: 'Cucumber, celery, apple, tigernut milk', price: 300000, popular: true },
      ]},
      { name: 'Wraps', items: [
        { name: 'Chicken Avocado Wrap', desc: 'Whole-wheat wrap, grilled chicken, avo', price: 450000 },
      ]},
    ],
    reviews: [ ['Elena V.', 5, 'Finally, healthy food in Abuja that actually has flavour.'], ['Kelechi M.', 4, 'Buddha bowl with moi moi cubes is inspired.'], ['Hadiza B.', 5, 'My lunch subscription spot. Never misses.'] ],
  },
  {
    org_name: 'Sushi Ikoyi', type: 'restaurant', cuisine: 'Sushi', price_range: 3, rating: 4.8, ratings: 420,
    image: IMG('1579871494447-9811cf80d66c', 1200), promo: null, fee: 150000, eta_min: 40, eta_max: 60,
    modes: { pickup: true, delivery: true, dinein: true }, city: 'Lagos', lat: 6.4541, lng: 3.4316, address: '7 Awolowo Road, Ikoyi',
    sections: [
      { name: 'Signature Rolls', items: [
        { name: 'Lagos Dragon Roll', desc: 'Prawn tempura, avocado, unagi glaze', price: 1200000, photo: IMG('1579871494447-9811cf80d66c'), popular: true },
        { name: 'Spicy Tuna Roll', desc: 'Ahi tuna, scotch-bonnet mayo twist', price: 1050000, popular: true },
        { name: 'California Roll', desc: 'Crab, avocado, cucumber', price: 950000, photo: IMG('1553621042-f6e147245754') },
      ]},
      { name: 'Nigiri', items: [
        { name: 'Salmon Nigiri (2pc)', desc: 'Air-flown Scottish salmon', price: 700000, photo: IMG('1534482421-64566f976cfa') },
        { name: 'Prawn Nigiri (2pc)', desc: 'Butterflied tiger prawn', price: 650000 },
      ]},
      { name: 'Starters', items: [
        { name: 'Edamame', desc: 'Sea salt or spicy garlic', price: 400000 },
        { name: 'Pork Gyoza (5pc)', desc: 'Pan-fried, ponzu', price: 550000, photo: IMG('1496116218417-1a781b1c416c') },
      ]},
    ],
    reviews: [ ['Kenji M.', 5, 'Fish quality that rivals anywhere in West Africa.'], ['Lauren S.', 5, 'The scotch-bonnet spicy tuna is a brilliant local touch.'], ['Tom H.', 4, 'Premium prices but Ikoyi-worthy quality.'] ],
  },
]

async function seedRichVendors(db: D1Database) {
  // Nigerian catalog marker: if any Lagos/Abuja location exists, the current seed is already in place
  const row = await db.prepare("SELECT COUNT(1) AS n FROM locations WHERE city IN ('Lagos','Abuja')").first<{ n: number }>()
  if (Number(row?.n || 0) > 0) return
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
      `INSERT INTO locations (vendor_id, address, city, region, postal_code, country, lat, lng, hours_json, is_live_tracking) VALUES (?, ?, ?, ?, '900001', 'NG', ?, ?, ?, ?)`
    ).bind(vendorId, v.address, v.city, v.city === 'Abuja' ? 'FCT' : 'Lagos', v.lat, v.lng, HOURS, v.live ? 1 : 0).run()
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
    ['owner_user_id', 'INTEGER'],
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

  // ---- Courier (driver) tables ----
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT,
        phone TEXT,
        city TEXT NOT NULL DEFAULT 'Lagos',
        vehicle_type TEXT NOT NULL DEFAULT 'motorcycle',
        status TEXT NOT NULL DEFAULT 'active',
        rating_avg REAL NOT NULL DEFAULT 5.0,
        rating_count INTEGER NOT NULL DEFAULT 0,
        offers_received INTEGER NOT NULL DEFAULT 0,
        offers_accepted INTEGER NOT NULL DEFAULT 0,
        lifetime_deliveries INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`
    )
    .run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS driver_shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        driver_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ends_at DATETIME,
        ended_at DATETIME,
        FOREIGN KEY (driver_id) REFERENCES drivers(id)
      )`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_driver_shifts_driver_id ON driver_shifts(driver_id)`).run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER UNIQUE NOT NULL,
        driver_id INTEGER NOT NULL,
        shift_id INTEGER,
        status TEXT NOT NULL DEFAULT 'accepted',
        base_pay INTEGER NOT NULL DEFAULT 0,
        tip INTEGER NOT NULL DEFAULT 0,
        total_pay INTEGER NOT NULL DEFAULT 0,
        distance_km REAL NOT NULL DEFAULT 0,
        dropoff_address TEXT,
        customer_rating INTEGER,
        accepted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        picked_up_at DATETIME,
        delivered_at DATETIME,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (driver_id) REFERENCES drivers(id)
      )`
    )
    .run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_deliveries_driver_id ON deliveries(driver_id)`).run()
  if (!(await columnExists(db, 'orders', 'driver_id'))) {
    await db.prepare(`ALTER TABLE orders ADD COLUMN driver_id INTEGER`).run()
  }
  if (!(await columnExists(db, 'orders', 'is_demo'))) {
    await db.prepare(`ALTER TABLE orders ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0`).run()
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
  const fee = Math.max(0, Math.min(500000, Number(body.delivery_fee_cents ?? 50000)))
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
    `INSERT INTO vendors (org_name, type, tier, verified, rating_avg, rating_count, service_modes_json, image_url, cuisine, price_range, delivery_fee_cents, eta_min, eta_max, promo_text, owner_user_id)
     VALUES (?, ?, 'basic', 0, 0, 0, ?, ?, ?, ?, ?, 25, 40, ?, ?)`
  ).bind(orgName, type, JSON.stringify(modes), image, cuisine, priceRange, fee, (body.promo_text || '').trim() || null, Number(user.id)).run()
  const vendorId = Number(vr.meta.last_row_id)
  const HOURS = JSON.stringify({ mon: ['00:00-23:59'], tue: ['00:00-23:59'], wed: ['00:00-23:59'], thu: ['00:00-23:59'], fri: ['00:00-23:59'], sat: ['00:00-23:59'], sun: ['00:00-23:59'] })
  await db.prepare(
    `INSERT INTO locations (vendor_id, address, city, region, postal_code, country, lat, lng, hours_json, is_live_tracking) VALUES (?, ?, ?, ?, '900001', 'NG', ?, ?, ?, 0)`
  ).bind(
    vendorId,
    (body.address || '').trim() || null,
    body.city === 'Abuja' ? 'Abuja' : 'Lagos',
    body.city === 'Abuja' ? 'FCT' : 'Lagos',
    body.city === 'Abuja' ? 9.0765 : 6.455,
    body.city === 'Abuja' ? 7.3986 : 3.3841,
    HOURS
  ).run()
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
  if (body.delivery_fee_cents != null) { sets.push('delivery_fee_cents = ?'); bind.push(Math.max(0, Math.min(500000, Number(body.delivery_fee_cents) || 0))) }
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
  if (!Number.isInteger(sectionId) || sectionId <= 0) return c.json({ error: 'not_found' }, 404)
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
  // Prices are stored in kobo; cap at ₦100,000 per item
  const price = Math.max(0, Math.min(10000000, Math.round(Number(body.base_price) || 0)))
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
  if (!Number.isInteger(itemId) || itemId <= 0) return c.json({ error: 'not_found' }, 404)
  if (!(await itemOwnedByVendor(db, itemId, vendorId))) return c.json({ error: 'forbidden' }, 403)
  const body = await c.req.json<any>().catch(() => ({}))
  const sets: string[] = []
  const bind: unknown[] = []
  if (typeof body.name === 'string' && body.name.trim()) { sets.push('name = ?'); bind.push(body.name.trim().slice(0, 80)) }
  if (typeof body.description === 'string') { sets.push('description = ?'); bind.push(body.description.trim().slice(0, 200) || null) }
  if (typeof body.photo === 'string') { sets.push('photo = ?'); bind.push(body.photo.trim() || null) }
  if (body.base_price != null) { sets.push('base_price = ?'); bind.push(Math.max(0, Math.min(10000000, Math.round(Number(body.base_price) || 0)))) }
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
  if (!Number.isInteger(itemId) || itemId <= 0) return c.json({ error: 'not_found' }, 404)
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
  schemaReady = ensureSchemaAndSeed(c.env.DB)
  await schemaReady
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
      city: (locsByVendor[v.id] || [])[0]?.city || null,
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
  if (!Number.isInteger(id) || id <= 0) return c.notFound()
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
  const body = await c.req.json<{ org_name: string; type: string; tier?: string }>().catch(() => null)
  if (!body || !body.org_name || !body.type) return c.json({ error: 'org_name and type required' }, 400)
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
  if (!Number.isInteger(id) || id <= 0) return c.notFound()
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
  if (!Number.isInteger(id) || id <= 0) return c.notFound()
  const reviews = await queryAll<any>(db, 'SELECT * FROM reviews WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 20', [id])
  return c.json({ reviews })
})

app.post('/api/vendors/:id/reviews', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.notFound()
  const body = await c.req.json<{ user_id?: number; rating: number; text?: string; author_name?: string }>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body' }, 400)
  const rating = Math.round(Number(body.rating))
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return c.json({ error: 'rating_1_to_5_required' }, 400)
  const vendorExists = await queryOne<any>(db, 'SELECT id FROM vendors WHERE id = ?', [id])
  if (!vendorExists) return c.json({ error: 'vendor_not_found' }, 404)
  const userId = await resolveUserId(c, body.user_id)
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1000) || null : null
  const author = (body.author_name || '').trim().slice(0, 40) || 'Menu Customer'
  await db
    .prepare(`INSERT INTO reviews (user_id, vendor_id, rating, text, status, author_name) VALUES (?, ?, ?, ?, 'published', ?)`)
    .bind(userId, id, rating, text, author)
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
  if (!Number.isInteger(vendorId) || vendorId <= 0) return c.notFound()
  const userId = await resolveUserId(c)
  const row = await queryOne<{ points: number }>(db, 'SELECT points FROM loyalty WHERE user_id = ? AND vendor_id = ?', [userId, vendorId])
  return c.json({ points: row?.points || 0 })
})

app.get('/api/vendors/:id/reservations', async (c) => {
  const db = c.env.DB
  const vendorId = Number(c.req.param('id'))
  if (!Number.isInteger(vendorId) || vendorId <= 0) return c.notFound()
  const userId = await resolveUserId(c)
  const list = await queryAll<any>(db, 'SELECT * FROM reservations WHERE vendor_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20', [vendorId, userId])
  return c.json({ reservations: list })
})

app.post('/api/vendors/:id/reservations', async (c) => {
  const db = c.env.DB
  const vendorId = Number(c.req.param('id'))
  if (!Number.isInteger(vendorId) || vendorId <= 0) return c.notFound()
  const body = await c.req.json<{ party_size: number; datetime_iso: string; notes?: string }>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body' }, 400)
  const userId = await resolveUserId(c)
  const party = Math.max(1, Math.min(20, Math.round(Number(body.party_size) || 1)))
  const dt = String(body.datetime_iso || '').trim().slice(0, 40)
  if (!dt) return c.json({ error: 'datetime_iso required' }, 400)
  const res = await db
    .prepare('INSERT INTO reservations (user_id, vendor_id, party_size, datetime_iso, notes, status) VALUES (?, ?, ?, ?, ?, "requested")')
    .bind(userId, vendorId, party, dt, (body.notes || '').trim().slice(0, 500) || null)
    .run()
  const id = Number(res.meta.last_row_id)
  const rec = await queryOne<any>(db, 'SELECT * FROM reservations WHERE id = ?', [id])
  return c.json({ reservation: rec })
})

// ---------- Payments (stub for MVP) ----------
app.post('/api/payments/intent', async (c) => {
  const body = await c.req.json<{ amount: number; currency?: string }>().catch(() => ({ amount: 0 }))
  const amount = Number(body.amount || 0)
  const currency = (body.currency || 'NGN').toUpperCase()
  if (!(amount > 0)) return c.json({ error: 'amount required' }, 400)
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
  const vendorExists = await queryOne<{ id: number }>(db, 'SELECT id FROM vendors WHERE id = ?', [vendorId])
  if (!vendorExists) return c.json({ error: 'vendor_not_found' }, 400)
  const userId = await resolveUserId(c, body.user_id)
  // generate unique code
  let code: string | null = null
  for (let i=0;i<5;i++) {
    const candidate = randomCode(6)
    const exists = await queryOne<{id:number}>(db, 'SELECT id FROM group_orders WHERE code = ?', [candidate])
    if (!exists) { code = candidate; break }
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
  const body = await c.req.json<{ user_id?: number; user_name?: string; item_id: number; qty: number; selected_options?: number[] }>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body' }, 400)
  const userId = await resolveUserId(c, body.user_id)
  const userName = (body.user_name || '').trim().slice(0, 40) || 'Guest'
  // Item must belong to the group's vendor
  const row = await queryOne<any>(
    db,
    'SELECT i.id, i.base_price FROM menu_items i JOIN menu_sections s ON s.id = i.section_id JOIN menus m ON m.id = s.menu_id WHERE i.id = ? AND m.vendor_id = ?',
    [Number(body.item_id) || 0, group.vendor_id]
  )
  if (!row) return c.json({ error: 'item_not_found' }, 400)
  let unit = Number(row.base_price||0)
  const opts = (Array.isArray(body.selected_options) ? body.selected_options : []).map((o) => Number(o) || 0)
  if (opts.length) {
    const deltas = await queryAll<{ price_delta: number }>(db, `SELECT o.price_delta FROM options o JOIN option_groups g ON g.id = o.group_id WHERE o.id IN (${opts.map(()=>'?').join(',')}) AND g.item_id = ?`, [...opts, row.id] as unknown[])
    unit += deltas.reduce((s,d)=> s + (d.price_delta||0), 0)
  }
  const qty = Math.max(1, Math.min(99, Math.round(Number(body.qty) || 1)))
  const line = unit * qty
  await db.prepare('INSERT INTO group_order_items (group_id, user_id, user_name, item_id, qty, selected_options_json, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(group.id, userId, userName, row.id, qty, JSON.stringify(opts), line).run()
  const items = await queryAll<any>(db, 'SELECT * FROM group_order_items WHERE group_id = ? ORDER BY id', [group.id])
  const subtotal = items.reduce((s, it) => s + (it.line_total||0), 0)
  return c.json({ ok: true, subtotal, count: items.length })
})

app.post('/api/group/:code/submit', async (c) => {
  const db = c.env.DB
  const code = c.req.param('code')
  const group = await queryOne<any>(db, 'SELECT * FROM group_orders WHERE code = ? AND status = "open"', [code])
  if (!group) return c.json({ error: 'group_not_found_or_closed' }, 404)
  const body = await c.req.json<{ type: string; tip_cents?: number; promo_code?: string; distance_km?: number; loyalty_points?: number }>().catch(() => ({ type: 'pickup' } as any))
  const userId = group.owner_user_id || 1
  const vendorId = group.vendor_id
  const gItems = await queryAll<any>(db, 'SELECT * FROM group_order_items WHERE group_id = ? ORDER BY id', [group.id])
  if (gItems.length === 0) return c.json({ error: 'empty_group' }, 400)

  // Totals based on stored line totals (VAT 7.5% + 5% service fee + vendor delivery fee)
  const subtotal = gItems.reduce((s,it)=> s + (it.line_total||0), 0)
  const taxes = Math.round(subtotal * 0.075)
  const type = body.type === 'delivery' ? 'delivery' : 'pickup'
  const gVendor = await queryOne<any>(db, 'SELECT * FROM vendors WHERE id = ?', [vendorId])
  const gDeliveryFee = type === 'delivery' ? Number(gVendor?.delivery_fee_cents ?? 50000) : 0
  let fees = gDeliveryFee + Math.round(subtotal * 0.05)
  let etaStr: string | null = type === 'delivery'
    ? `${gVendor?.eta_min || 25}-${gVendor?.eta_max || 45}m`
    : `${Math.max(10, Number(gVendor?.eta_min || 20) - 5)}m`
  let discount = 0
  if (body.promo_code && body.promo_code.toUpperCase() === 'SAVE10') {
    discount = Math.min(Math.round(subtotal * 0.1), 100000)
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
  const tip = Math.max(0, Math.round(Number(body.tip_cents) || 0))
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
  const fee = Math.round(30000 + km * 10000) // ₦300 base + ₦100/km
  const eta_minutes = 30 + Math.round(km * 4)
  return c.json({ fee, eta_minutes })
})

// ---------- Orders ----------
app.post('/api/orders', async (c) => {
  const db = c.env.DB
  type ItemReq = { item_id: number; qty: number; selected_options?: number[] }
  const body = await c
    .req
    .json<{ vendor_id: number; type: string; items: ItemReq[]; user_id?: number; tip_cents?: number; promo_code?: string; distance_km?: number; loyalty_points?: number; priority?: boolean }>()
    .catch(() => null)
  if (!body || !(Number(body.vendor_id) > 0) || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'vendor_id_and_items_required' }, 400)
  }
  const userId = await resolveUserId(c, body.user_id)
  const vendorId = Number(body.vendor_id)
  const type = body.type === 'delivery' ? 'delivery' : 'pickup'
  const vendorRow = await queryOne<any>(db, 'SELECT * FROM vendors WHERE id = ?', [vendorId])
  if (!vendorRow) return c.json({ error: 'vendor_not_found' }, 400)
  // pricing
  let subtotal = 0
  const pricedItems: Array<{ item_id: number; qty: number; unit_price: number; line_total: number; selected_options: number[]; name: string }> = []
  for (const it of body.items) {
    // Item must belong to this vendor's menu
    const row = await queryOne<any>(
      db,
      'SELECT i.id, i.name, i.base_price FROM menu_items i JOIN menu_sections s ON s.id = i.section_id JOIN menus m ON m.id = s.menu_id WHERE i.id = ? AND m.vendor_id = ?',
      [Number(it.item_id) || 0, vendorId]
    )
    if (!row) return c.json({ error: `Item ${it.item_id} not found` }, 400)
    let unit = row.base_price as number
    const opts = (Array.isArray(it.selected_options) ? it.selected_options : []).map((o) => Number(o) || 0)
    if (opts.length) {
      const deltas = await queryAll<{ price_delta: number }>(
        db,
        `SELECT o.price_delta FROM options o JOIN option_groups g ON g.id = o.group_id WHERE o.id IN (${opts.map(() => '?').join(',')}) AND g.item_id = ?`,
        [...opts, row.id] as unknown[]
      )
      unit += deltas.reduce((s, d) => s + (d.price_delta || 0), 0)
    }
    const qty = Math.max(1, Math.min(99, Math.round(Number((it as any).qty) || 1)))
    const line = unit * qty
    subtotal += line
    pricedItems.push({ item_id: row.id, qty, unit_price: unit, line_total: line, selected_options: opts, name: row.name })
  }
  const taxes = Math.round(subtotal * 0.075) // VAT 7.5%
  // Fees: vendor's advertised delivery fee (fallback to distance formula), 5% service fee, optional priority
  const serviceFee = Math.round(subtotal * 0.05)
  const priorityFee = body.priority && type === 'delivery' ? 50000 : 0 // ₦500
  let deliveryFee = 0
  if (type === 'delivery') {
    if (vendorRow.delivery_fee_cents != null) {
      deliveryFee = Number(vendorRow.delivery_fee_cents)
    } else if (typeof body.distance_km === 'number' && !Number.isNaN(body.distance_km) && body.distance_km > 0) {
      deliveryFee = Math.round(30000 + Math.max(0, Number(body.distance_km)) * 10000) // ₦300 + ₦100/km
    } else {
      deliveryFee = 50000
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
  // promo: simple demo - SAVE10 gives 10% off up to ₦1,000
  let discount = 0
  if (body.promo_code && body.promo_code.toUpperCase() === 'SAVE10') {
    discount = Math.min(Math.round(subtotal * 0.1), 100000)
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
  const tip = Math.max(0, Math.round(Number(body.tip_cents) || 0))
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
  if (!Number.isInteger(id) || id <= 0) return c.notFound()
  const order = await queryOne<any>(db, 'SELECT * FROM orders WHERE id = ?', [id])
  if (!order) return c.notFound()
  const items = await queryAll<any>(db, "SELECT oi.*, COALESCE(mi.name, 'Removed item') AS item_name, mi.photo AS item_photo FROM order_items oi LEFT JOIN menu_items mi ON mi.id = oi.item_id WHERE oi.order_id = ?", [id])
  const vendor = await queryOne<any>(db, 'SELECT id, org_name, image_url, cuisine, eta_min, eta_max FROM vendors WHERE id = ?', [order.vendor_id])
  return c.json({ order, items, vendor })
})

app.post('/api/orders/:id/status', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.notFound()
  const body = await c.req.json<{ status: string; eta?: string }>().catch(() => ({ status: '' }))
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

// ============================================================
// Courier (driver) API — powers the Menu Courier app at /driver
// ============================================================

const VEHICLE_TYPES = ['car', 'motorcycle', 'scooter', 'ebike', 'bicycle']

// Plausible dropoff addresses per city for demo deliveries
const DROPOFFS: Record<string, string[]> = {
  Lagos: [
    '5 Fola Osibo Rd, Lekki Phase 1', '22 Bourdillon Rd, Ikoyi', '11 Ozumba Mbadiwe Ave, Victoria Island',
    '3 Akin Adesola St, Victoria Island', '18 Freedom Way, Lekki Phase 1', '7 Thompson Ave, Ikoyi',
    '41 Adelabu St, Surulere', '9 Allen Ave, Ikeja',
  ],
  Abuja: [
    '14 Gana St, Maitama', '2 Ademola Adetokunbo Cres, Wuse 2', '25 Lake Chad Cres, Maitama',
    '8 Usuma St, Maitama', '31 Aguiyi Ironsi St, Maitama', '6 Mississippi St, Maitama',
  ],
}

// Deterministic pseudo-distance for an order (1.2–8.1 km)
function orderDistanceKm(orderId: number) {
  return Math.round((1.2 + ((orderId * 37) % 70) / 10) * 10) / 10
}
function orderDropoff(orderId: number, city: string) {
  const list = DROPOFFS[city] || DROPOFFS.Lagos
  return list[orderId % list.length]
}
// Base pay: ₦600 + ₦120/km, in kobo
function basePayFor(km: number) {
  return 60000 + Math.round(km * 12000)
}

async function requireDriver(c: any, next: any) {
  const user: any = c.get('user')
  if (!user || user.role !== 'driver' || !(Number(user.driver_id) > 0)) {
    return c.json({ error: 'driver_forbidden' }, 403)
  }
  await next()
}

async function activeShift(db: D1Database, driverId: number) {
  return queryOne<any>(db, "SELECT * FROM driver_shifts WHERE driver_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", [driverId])
}
async function currentDelivery(db: D1Database, driverId: number) {
  return queryOne<any>(db, "SELECT * FROM deliveries WHERE driver_id = ? AND status != 'delivered' ORDER BY id DESC LIMIT 1", [driverId])
}

// Sign up as a courier (mirrors vendor register: instant demo onboarding)
app.post('/api/driver/register', async (c) => {
  const db = c.env.DB
  const body = await c.req.json<{
    first_name: string; last_name?: string; email: string; phone?: string
    city?: string; vehicle_type?: string
  }>().catch(() => null)
  const email = (body?.email || '').toLowerCase().trim()
  const firstName = (body?.first_name || '').trim().slice(0, 40)
  if (!email || !email.includes('@') || !firstName) return c.json({ error: 'name_and_email_required' }, 400)
  const lastName = (body?.last_name || '').trim().slice(0, 40) || null
  const phone = (body?.phone || '').trim().slice(0, 20) || null
  const city = body?.city === 'Abuja' ? 'Abuja' : 'Lagos'
  const vehicle = VEHICLE_TYPES.includes(body?.vehicle_type || '') ? body!.vehicle_type! : 'motorcycle'

  let user = await queryOne<any>(db, 'SELECT * FROM users WHERE email = ?', [email])
  if (!user) {
    await db.prepare('INSERT INTO users (email, phone, role) VALUES (?, ?, ?)').bind(email, phone, 'driver').run()
    user = await queryOne<any>(db, 'SELECT * FROM users WHERE email = ?', [email])
  } else if (user.role === 'customer' || user.role === 'driver') {
    await db.prepare("UPDATE users SET role = 'driver', phone = COALESCE(?, phone) WHERE id = ?").bind(phone, user.id).run()
  } else {
    return c.json({ error: 'email_in_use_by_business_account' }, 400)
  }

  let driver = await queryOne<any>(db, 'SELECT * FROM drivers WHERE user_id = ?', [user.id])
  if (!driver) {
    await db.prepare(
      'INSERT INTO drivers (user_id, first_name, last_name, phone, city, vehicle_type) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(Number(user.id), firstName, lastName, phone, city, vehicle).run()
    driver = await queryOne<any>(db, 'SELECT * FROM drivers WHERE user_id = ?', [user.id])
  } else {
    await db.prepare('UPDATE drivers SET first_name = ?, last_name = ?, phone = COALESCE(?, phone), city = ?, vehicle_type = ? WHERE id = ?')
      .bind(firstName, lastName, phone, city, vehicle, driver.id).run()
    driver = await queryOne<any>(db, 'SELECT * FROM drivers WHERE id = ?', [driver.id])
  }

  const payload: any = { sub: String(user.id), email, role: 'driver', driver_id: Number(driver.id) }
  const token = await sign(payload, getJwtSecret(c))
  return c.json({ token, user: payload, driver })
})

// Profile + live context (active shift, current delivery)
app.get('/api/driver/self', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const driverId = Number(user.driver_id)
  const driver = await queryOne<any>(db, 'SELECT * FROM drivers WHERE id = ?', [driverId])
  if (!driver) return c.json({ error: 'driver_not_found' }, 404)
  const shift = await activeShift(db, driverId)
  const delivery = await currentDelivery(db, driverId)
  let shiftEarnings = 0
  let shiftDeliveries = 0
  if (shift) {
    const agg = await queryOne<{ total: number; n: number }>(
      db,
      "SELECT COALESCE(SUM(total_pay),0) AS total, COUNT(1) AS n FROM deliveries WHERE shift_id = ? AND status = 'delivered'",
      [shift.id]
    )
    shiftEarnings = Number(agg?.total || 0)
    shiftDeliveries = Number(agg?.n || 0)
  }
  return c.json({ driver, shift, delivery, shift_earnings: shiftEarnings, shift_deliveries: shiftDeliveries })
})

// Start a shift (idempotent: returns the active shift if one exists)
app.post('/api/driver/shift/start', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const driverId = Number(user.driver_id)
  let shift = await activeShift(db, driverId)
  if (!shift) {
    const body = await c.req.json<{ duration_min?: number }>().catch(() => ({}))
    const mins = Math.max(30, Math.min(720, Math.round(Number(body?.duration_min) || 240)))
    await db.prepare(
      "INSERT INTO driver_shifts (driver_id, status, ends_at) VALUES (?, 'active', datetime('now', ?))"
    ).bind(driverId, `+${mins} minutes`).run()
    shift = await activeShift(db, driverId)
  }
  return c.json({ shift })
})

app.post('/api/driver/shift/end', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const driverId = Number(user.driver_id)
  const shift = await activeShift(db, driverId)
  if (!shift) return c.json({ error: 'no_active_shift' }, 400)
  const delivery = await currentDelivery(db, driverId)
  if (delivery) return c.json({ error: 'delivery_in_progress' }, 400)
  await db.prepare("UPDATE driver_shifts SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE id = ?").bind(shift.id).run()
  const agg = await queryOne<{ total: number; n: number }>(
    db,
    "SELECT COALESCE(SUM(total_pay),0) AS total, COUNT(1) AS n FROM deliveries WHERE shift_id = ? AND status = 'delivered'",
    [shift.id]
  )
  return c.json({ ok: true, earnings: Number(agg?.total || 0), deliveries: Number(agg?.n || 0) })
})

// Next available offer: oldest unassigned delivery order in the driver's city
app.get('/api/driver/offers', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const driverId = Number(user.driver_id)
  const driver = await queryOne<any>(db, 'SELECT * FROM drivers WHERE id = ?', [driverId])
  const shift = await activeShift(db, driverId)
  if (!shift) return c.json({ offer: null, reason: 'offline' })
  if (await currentDelivery(db, driverId)) return c.json({ offer: null, reason: 'busy' })
  const skipCsv = (c.req.query('skip') || '').split(',').map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50)
  const skipClause = skipCsv.length ? `AND o.id NOT IN (${skipCsv.map(() => '?').join(',')})` : ''
  const order = await queryOne<any>(
    db,
    `SELECT o.*, v.org_name AS vendor_name, v.image_url AS vendor_image, l.address AS vendor_address, l.city AS vendor_city
     FROM orders o
     JOIN vendors v ON v.id = o.vendor_id
     LEFT JOIN locations l ON l.vendor_id = v.id
     WHERE o.type = 'delivery' AND o.driver_id IS NULL
       AND o.status IN ('Submitted','Accepted','In-Prep','Ready')
       AND (l.city = ? OR l.city IS NULL)
       ${skipClause}
     ORDER BY o.id ASC LIMIT 1`,
    [driver.city, ...skipCsv] as unknown[]
  )
  if (!order) return c.json({ offer: null, reason: 'no_orders' })
  const itemsAgg = await queryOne<{ n: number }>(db, 'SELECT COALESCE(SUM(qty),0) AS n FROM order_items WHERE order_id = ?', [order.id])
  const km = orderDistanceKm(Number(order.id))
  const basePay = basePayFor(km)
  const tip = Number(order.tip || 0)
  return c.json({
    offer: {
      order_id: order.id,
      vendor_name: order.vendor_name,
      vendor_image: order.vendor_image,
      vendor_address: order.vendor_address,
      city: order.vendor_city || driver.city,
      items_count: Number(itemsAgg?.n || 0),
      distance_km: km,
      base_pay: basePay,
      tip,
      total_pay: basePay + tip,
      dropoff_address: orderDropoff(Number(order.id), order.vendor_city || driver.city),
      deliver_by_min: 12 + Math.round(km * 4),
      is_demo: Number(order.is_demo || 0) === 1,
    },
  })
})

// Accept an offer (atomic claim on orders.driver_id)
app.post('/api/driver/offers/:orderId/accept', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const driverId = Number(user.driver_id)
  const orderId = Number(c.req.param('orderId'))
  if (!Number.isInteger(orderId) || orderId <= 0) return c.json({ error: 'not_found' }, 404)
  const shift = await activeShift(db, driverId)
  if (!shift) return c.json({ error: 'not_on_shift' }, 400)
  if (await currentDelivery(db, driverId)) return c.json({ error: 'delivery_in_progress' }, 400)
  const claim = await db.prepare(
    "UPDATE orders SET driver_id = ? WHERE id = ? AND driver_id IS NULL AND type = 'delivery' AND status IN ('Submitted','Accepted','In-Prep','Ready')"
  ).bind(driverId, orderId).run()
  if (!claim.meta.changes) return c.json({ error: 'offer_gone' }, 409)
  const order = await queryOne<any>(db, 'SELECT o.*, (SELECT city FROM locations WHERE vendor_id = o.vendor_id LIMIT 1) AS vendor_city FROM orders o WHERE o.id = ?', [orderId])
  const km = orderDistanceKm(orderId)
  const basePay = basePayFor(km)
  const tip = Number(order?.tip || 0)
  await db.prepare(
    `INSERT INTO deliveries (order_id, driver_id, shift_id, status, base_pay, tip, total_pay, distance_km, dropoff_address)
     VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?, ?)`
  ).bind(orderId, driverId, shift.id, basePay, tip, basePay + tip, km, orderDropoff(orderId, order?.vendor_city || 'Lagos')).run()
  await db.prepare('UPDATE drivers SET offers_received = offers_received + 1, offers_accepted = offers_accepted + 1 WHERE id = ?').bind(driverId).run()
  const delivery = await queryOne<any>(db, 'SELECT * FROM deliveries WHERE order_id = ?', [orderId])
  return c.json({ delivery })
})

app.post('/api/driver/offers/:orderId/decline', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  await db.prepare('UPDATE drivers SET offers_received = offers_received + 1 WHERE id = ?').bind(Number(user.driver_id)).run()
  return c.json({ ok: true })
})

// Current delivery with order details for the pickup/dropoff flow
app.get('/api/driver/delivery', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const delivery = await currentDelivery(db, Number(user.driver_id))
  if (!delivery) return c.json({ delivery: null })
  const order = await queryOne<any>(db, 'SELECT * FROM orders WHERE id = ?', [delivery.order_id])
  const vendor = await queryOne<any>(db, 'SELECT id, org_name, image_url, cuisine FROM vendors WHERE id = ?', [order.vendor_id])
  const loc = await queryOne<any>(db, 'SELECT address, city FROM locations WHERE vendor_id = ? LIMIT 1', [order.vendor_id])
  const items = await queryAll<any>(db, "SELECT oi.qty, COALESCE(mi.name,'Item') AS name FROM order_items oi LEFT JOIN menu_items mi ON mi.id = oi.item_id WHERE oi.order_id = ?", [delivery.order_id])
  const customer = await queryOne<any>(db, 'SELECT email FROM users WHERE id = ?', [order.user_id])
  const customerName = (customer?.email || 'customer@menu.ng').split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase())
  return c.json({ delivery, order, vendor, vendor_address: loc?.address || null, items, customer_name: customerName })
})

// Advance the delivery: arrived_store → picked_up → arrived_customer → delivered
app.post('/api/driver/delivery/:id/advance', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const driverId = Number(user.driver_id)
  const id = Number(c.req.param('id'))
  const delivery = await queryOne<any>(db, 'SELECT * FROM deliveries WHERE id = ? AND driver_id = ?', [id, driverId])
  if (!delivery) return c.json({ error: 'not_found' }, 404)
  const flow = ['accepted', 'arrived_store', 'picked_up', 'arrived_customer', 'delivered']
  const idx = flow.indexOf(delivery.status)
  if (idx < 0 || idx >= flow.length - 1) return c.json({ error: 'already_delivered' }, 400)
  const next = flow[idx + 1]
  if (next === 'picked_up') {
    await db.prepare("UPDATE deliveries SET status = ?, picked_up_at = CURRENT_TIMESTAMP WHERE id = ?").bind(next, id).run()
    await db.prepare("UPDATE orders SET status = 'Out-for-Delivery' WHERE id = ?").bind(delivery.order_id).run()
  } else if (next === 'delivered') {
    // Simulated customer rating: mostly 5s, deterministic per delivery
    const rating = (id * 13) % 10 < 8 ? 5 : 4
    await db.prepare("UPDATE deliveries SET status = ?, delivered_at = CURRENT_TIMESTAMP, customer_rating = ? WHERE id = ?").bind(next, rating, id).run()
    await db.prepare("UPDATE orders SET status = 'Completed' WHERE id = ?").bind(delivery.order_id).run()
    await db.prepare(
      `UPDATE drivers SET lifetime_deliveries = lifetime_deliveries + 1,
         rating_avg = (rating_avg * rating_count + ?) / (rating_count + 1),
         rating_count = rating_count + 1
       WHERE id = ?`
    ).bind(rating, driverId).run()
  } else {
    await db.prepare('UPDATE deliveries SET status = ? WHERE id = ?').bind(next, id).run()
  }
  const updated = await queryOne<any>(db, 'SELECT * FROM deliveries WHERE id = ?', [id])
  return c.json({ delivery: updated })
})

// Earnings: last-7-day summary, per-day breakdown, recent shifts
app.get('/api/driver/earnings', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const driverId = Number(user.driver_id)
  const week = await queryOne<any>(
    db,
    `SELECT COALESCE(SUM(total_pay),0) AS total, COALESCE(SUM(base_pay),0) AS base, COALESCE(SUM(tip),0) AS tips, COUNT(1) AS n
     FROM deliveries WHERE driver_id = ? AND status = 'delivered' AND delivered_at >= datetime('now','-7 days')`,
    [driverId]
  )
  const byDay = await queryAll<any>(
    db,
    `SELECT date(delivered_at) AS day, COALESCE(SUM(total_pay),0) AS total, COUNT(1) AS n
     FROM deliveries WHERE driver_id = ? AND status = 'delivered' AND delivered_at >= datetime('now','-7 days')
     GROUP BY date(delivered_at) ORDER BY day DESC`,
    [driverId]
  )
  const lifetime = await queryOne<any>(
    db,
    `SELECT COALESCE(SUM(total_pay),0) AS total, COUNT(1) AS n FROM deliveries WHERE driver_id = ? AND status = 'delivered'`,
    [driverId]
  )
  const shifts = await queryAll<any>(
    db,
    `SELECT s.*, COALESCE((SELECT SUM(d.total_pay) FROM deliveries d WHERE d.shift_id = s.id AND d.status='delivered'),0) AS earnings,
            (SELECT COUNT(1) FROM deliveries d WHERE d.shift_id = s.id AND d.status='delivered') AS deliveries
     FROM driver_shifts s WHERE s.driver_id = ? ORDER BY s.id DESC LIMIT 14`,
    [driverId]
  )
  return c.json({ week, by_day: byDay, lifetime, shifts })
})

// Ratings & delivery quality
app.get('/api/driver/ratings', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const driverId = Number(user.driver_id)
  const driver = await queryOne<any>(db, 'SELECT * FROM drivers WHERE id = ?', [driverId])
  const recent = await queryAll<any>(
    db,
    `SELECT d.id, d.customer_rating, d.total_pay, d.delivered_at, v.org_name AS vendor_name
     FROM deliveries d JOIN orders o ON o.id = d.order_id JOIN vendors v ON v.id = o.vendor_id
     WHERE d.driver_id = ? AND d.status = 'delivered' ORDER BY d.id DESC LIMIT 20`,
    [driverId]
  )
  const received = Number(driver?.offers_received || 0)
  const accepted = Number(driver?.offers_accepted || 0)
  return c.json({
    rating_avg: Number(driver?.rating_avg || 5),
    rating_count: Number(driver?.rating_count || 0),
    lifetime_deliveries: Number(driver?.lifetime_deliveries || 0),
    acceptance_rate: received ? Math.round((accepted / received) * 100) : 100,
    completion_rate: 100,
    on_time_rate: 98,
    recent,
  })
})

// Create a demo order so a new courier always has something to deliver
app.post('/api/driver/demo-order', requireAuth, requireDriver, async (c) => {
  const db = c.env.DB
  const user: any = c.get('user')
  const driver = await queryOne<any>(db, 'SELECT * FROM drivers WHERE id = ?', [Number(user.driver_id)])
  const vendor = await queryOne<any>(
    db,
    `SELECT v.id, l.city FROM vendors v JOIN locations l ON l.vendor_id = v.id WHERE l.city = ? ORDER BY RANDOM() LIMIT 1`,
    [driver?.city || 'Lagos']
  )
  if (!vendor) return c.json({ error: 'no_vendors' }, 400)
  const items = await queryAll<any>(
    db,
    `SELECT i.id, i.base_price FROM menu_items i JOIN menu_sections s ON s.id = i.section_id JOIN menus m ON m.id = s.menu_id
     WHERE m.vendor_id = ? AND i.is_available = 1 ORDER BY RANDOM() LIMIT 2`,
    [vendor.id]
  )
  if (!items.length) return c.json({ error: 'no_items' }, 400)
  let subtotal = 0
  for (const it of items) subtotal += Number(it.base_price || 0)
  const taxes = Math.round(subtotal * 0.075)
  const fees = 50000 + Math.round(subtotal * 0.05)
  const tip = [20000, 50000, 80000, 100000, 150000][Math.floor(Math.random() * 5)]
  const total = subtotal + taxes + fees + tip
  const orderRes = await db.prepare(
    `INSERT INTO orders (user_id, vendor_id, type, subtotal, taxes, fees, tip, total, status, eta, is_demo) VALUES (1, ?, 'delivery', ?, ?, ?, ?, ?, 'Ready', '25-40m', 1)`
  ).bind(vendor.id, subtotal, taxes, fees, tip, total).run()
  const orderId = Number(orderRes.meta.last_row_id)
  for (const it of items) {
    await db.prepare('INSERT INTO order_items (order_id, item_id, qty, selected_options_json, line_total) VALUES (?, ?, 1, ?, ?)')
      .bind(orderId, it.id, '[]', Number(it.base_price || 0)).run()
  }
  return c.json({ ok: true, order_id: orderId })
})

// Item options
app.get('/api/items/:id/options', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.notFound()
  const groups = await queryAll<any>(db, 'SELECT id, name, min, max, required FROM option_groups WHERE item_id = ? ORDER BY id', [id])
  const result = [] as any[]
  for (const g of groups) {
    const opts = await queryAll<any>(db, 'SELECT id, name, price_delta FROM options WHERE group_id = ? ORDER BY id', [g.id])
    result.push({ ...g, options: opts })
  }
  return c.json({ groups: result })
})

export default app

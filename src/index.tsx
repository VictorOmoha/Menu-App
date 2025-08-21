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

// Serve static assets from public/ at /static/*
app.use('/static/*', serveStatic({ root: './public' }))

// Renderer for SSR shell
app.use(renderer)

// Home route renders shell with #app, frontend hydrates
app.get('/', (c) => {
  return c.render(
    <div class="max-w-5xl mx-auto p-4">
      <h1 class="text-2xl font-bold mb-4">Menu App</h1>
      <div id="app" class="space-y-3"></div>
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

// ---------- Catalog Endpoints ----------
app.get('/api/vendors', async (c) => {
  const db = c.env.DB
  const q = c.req.query('q')?.trim()
  const type = c.req.query('type')?.trim()
  const clauses: string[] = []
  const bind: unknown[] = []
  if (q) { clauses.push('org_name LIKE ?'); bind.push(`%${q}%`) }
  if (type) { clauses.push('type = ?'); bind.push(type) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const vendors = await queryAll(db, `SELECT id, org_name, type, tier, verified, rating_avg, rating_count FROM vendors ${where} ORDER BY rating_avg DESC, id DESC LIMIT 50`, bind)
  return c.json({ vendors })
})

app.get('/api/vendors/:id', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const vendor = await queryOne(db, 'SELECT * FROM vendors WHERE id = ?', [id])
  if (!vendor) return c.notFound()
  const locations = await queryAll(db, 'SELECT * FROM locations WHERE vendor_id = ?', [id])
  return c.json({ vendor, locations })
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
    (itemsBySection[it.section_id] ||= []).push(it)
  }
  const sectionsWithItems = sections.map((s) => ({ ...s, items: (itemsBySection[s.id] || []).map(i => ({...i})) }))
  return c.json({ menu, sections: sectionsWithItems })
})

// ---------- Orders ----------
app.post('/api/orders', async (c) => {
  const db = c.env.DB
  type ItemReq = { item_id: number; qty: number; selected_options?: number[] }
  const body = await c.req.json<{ vendor_id: number; type: string; items: ItemReq[]; user_id?: number }>({
    vendor_id: 0, type: 'pickup', items: []
  } as any)
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
      const deltas = await queryAll<{ price_delta: number }>(db, `SELECT price_delta FROM options WHERE id IN (${opts.map(()=>'?').join(',')})`, opts as unknown[])
      unit += deltas.reduce((s, d) => s + (d.price_delta || 0), 0)
    }
    const qty = Math.max(1, Number(it.qty||1))
    const line = unit * qty
    subtotal += line
    pricedItems.push({ item_id: row.id, qty, unit_price: unit, line_total: line, selected_options: opts, name: row.name })
  }
  const taxes = Math.round(subtotal * 0.08)
  const fees = type === 'delivery' ? 399 : 99
  const tip = 0
  const total = subtotal + taxes + fees + tip

  // create order
  const orderRes = await db.prepare(`INSERT INTO orders (user_id, vendor_id, type, subtotal, taxes, fees, tip, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Submitted')`).bind(userId, vendorId, type, subtotal, taxes, fees, tip, total).run()
  const orderId = Number(orderRes.meta.last_row_id)

  for (const it of pricedItems) {
    await db.prepare(`INSERT INTO order_items (order_id, item_id, qty, selected_options_json, line_total) VALUES (?, ?, ?, ?, ?)`)
      .bind(orderId, it.item_id, it.qty, JSON.stringify(it.selected_options), it.line_total)
      .run()
  }

  const order = await queryOne<any>(db, 'SELECT * FROM orders WHERE id = ?', [orderId])
  return c.json({ order })
})

app.get('/api/orders/:id', async (c) => {
  const db = c.env.DB
  const id = Number(c.req.param('id'))
  const order = await queryOne<any>(db, 'SELECT * FROM orders WHERE id = ?', [id])
  if (!order) return c.notFound()
  const items = await queryAll<any>(db, 'SELECT * FROM order_items WHERE order_id = ?', [id])
  return c.json({ order, items })
})

export default app

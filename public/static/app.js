/* Simple Menu App MVP Frontend */
const api = {
  getVendors: () => fetch('/api/vendors').then(r=>r.json()),
  getVendor: (id) => fetch(`/api/vendors/${id}`).then(r=>r.json()),
  getLoyalty: (vendorId) => fetch(`/api/vendors/${vendorId}/loyalty`).then(r=>r.json()),
  getMenus: (id) => fetch(`/api/vendors/${id}/menus`).then(r=>r.json()),
  getItemOptions: (id) => fetch(`/api/items/${id}/options`).then(r=>r.json()),
  getReviews: (vendorId) => fetch(`/api/vendors/${vendorId}/reviews`).then(r=>r.json()),
  postReview: (vendorId, payload) => fetch(`/api/vendors/${vendorId}/reviews`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}).then(r=>r.json()),
  getReservations: (vendorId) => fetch(`/api/vendors/${vendorId}/reservations`).then(r=>r.json()),
  postReservation: (vendorId, payload) => fetch(`/api/vendors/${vendorId}/reservations`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}).then(r=>r.json()),
  createOrder: (payload) => fetch('/api/orders', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}).then(r=>r.json()),
  getOrder: (id) => fetch(`/api/orders/${id}`).then(r=>r.json()),
  quote: (payload) => fetch('/api/delivery/quote', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}).then(r=>r.json()),
  groupStart: (vendor_id) => fetch('/api/group/start', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({vendor_id})}).then(r=>r.json()),
  groupGet: (code) => fetch(`/api/group/${code}`).then(r=>r.json()),
  groupAdd: (code, payload) => fetch(`/api/group/${code}/add`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}).then(r=>r.json()),
  groupSubmit: (code, payload) => fetch(`/api/group/${code}/submit`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}).then(r=>r.json())
}

const state = {
  vendors: [],
  vendor: null,
  menu: [],
  cart: { vendor_id: null, items: [] },
  filters: { q: '', type: '', pickup: false, delivery: false, open_now: false, sort: 'rating', near: null, max_km: '' },
  checkout: { type: 'pickup', tip_cents: 0, promo_code: '', quote: null, distance_km: '', use_points: false, loyalty_points: 0 },
  lastOrder: null,
  orderPoll: null,
  reviews: [],
  reservations: [],
  loyalty: 0,
  group: null,
  groupCode: '',
  groupCheckout: { type: 'pickup', tip_cents: 0, promo_code: '', quote: null, distance_km: '', use_points: false, loyalty_points: 0 },
  groupLoyalty: 0
}

function money(cents){ return `$${(cents/100).toFixed(2)}` }

async function loadVendors(){
  const p = new URLSearchParams()
  const f = state.filters
  if (f.q) p.set('q', f.q)
  if (f.type) p.set('type', f.type)
  if (f.pickup) p.set('pickup', '1')
  if (f.delivery) p.set('delivery', '1')
  if (f.open_now) p.set('open_now', '1')
  if (f.sort && f.sort !== 'rating') p.set('sort', f.sort)
  if (f.near) p.set('near', f.near)
  if (f.max_km) p.set('max_km', f.max_km)
  const url = '/api/vendors' + (p.toString() ? `?${p.toString()}` : '')
  const data = await fetch(url).then(r=>r.json())
  state.vendors = data.vendors
  renderHome()
}

function renderHome(){
  const el = document.getElementById('app')
  const f = state.filters
  el.innerHTML = `
    <div class="space-y-3">
      <div class="bg-white p-3 rounded shadow">
        <div class="grid md:grid-cols-6 gap-2">
          <input id="f-q" class="border rounded p-2" placeholder="Search" value="${f.q}">
          <select id="f-type" class="border rounded p-2">
            <option value="">All types</option>
            <option value="restaurant" ${f.type==='restaurant'?'selected':''}>Restaurant</option>
            <option value="truck" ${f.type==='truck'?'selected':''}>Truck</option>
            <option value="home_chef" ${f.type==='home_chef'?'selected':''}>Home Chef</option>
          </select>
          <label class="inline-flex items-center gap-1 text-sm"><input id="f-pickup" type="checkbox" ${f.pickup?'checked':''}>Pickup</label>
          <label class="inline-flex items-center gap-1 text-sm"><input id="f-delivery" type="checkbox" ${f.delivery?'checked':''}>Delivery</label>
          <label class="inline-flex items-center gap-1 text-sm"><input id="f-open" type="checkbox" ${f.open_now?'checked':''}>Open now</label>
          <select id="f-sort" class="border rounded p-2">
            <option value="rating" ${f.sort==='rating'?'selected':''}>Top Rated</option>
            <option value="distance" ${f.sort==='distance'?'selected':''}>Nearest</option>
            <option value="updated" ${f.sort==='updated'?'selected':''}>Recently Updated</option>
            <option value="trending" ${f.sort==='trending'?'selected':''}>Trending</option>
          </select>
          <input id="f-near" class="border rounded p-2 col-span-2" placeholder="near lat,lng (optional)" value="${f.near||''}">
          <input id="f-maxkm" class="border rounded p-2" placeholder="max km" value="${f.max_km||''}">
          <button id="f-apply" class="bg-blue-600 text-white rounded px-3">Apply</button>
        </div>
      </div>
      ${state.vendors.map(v => `
        <div class="p-4 bg-white rounded shadow flex items-center justify-between">
          <div>
            <div class="font-semibold text-lg">${v.org_name}</div>
            <div class="text-sm text-gray-500">${v.type} • ${v.rating_avg?.toFixed?.(1) || '0.0'} ⭐ (${v.rating_count||0})${v.distance_km!=null?` • ${v.distance_km} km`:''}${v.open_now?` • Open`:''}</div>
          </div>
          <button class="px-3 py-1 bg-blue-600 text-white rounded" data-view="${v.id}">View</button>
        </div>
      `).join('')}
    </div>
  `
  el.querySelector('#f-apply').onclick = () => {
    state.filters = {
      q: (document.getElementById('f-q')).value,
      type: (document.getElementById('f-type')).value,
      pickup: (document.getElementById('f-pickup')).checked,
      delivery: (document.getElementById('f-delivery')).checked,
      open_now: (document.getElementById('f-open')).checked,
      sort: (document.getElementById('f-sort')).value,
      near: (document.getElementById('f-near')).value,
      max_km: (document.getElementById('f-maxkm')).value,
    }
    loadVendors()
  }
  el.querySelectorAll('button[data-view]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-view')
    state.vendor = await api.getVendor(id)
    const menus = await api.getMenus(id)
    const revs = await api.getReviews(id)
    const resv = await api.getReservations(id)
    const loy = await api.getLoyalty(id)
    state.menu = menus.sections
    state.reviews = revs.reviews || []
    state.reservations = resv.reservations || []
    state.loyalty = loy.points || 0
    state.cart = { vendor_id: +id, items: [] }
    renderVendor()
  }))
}

function calcSubtotal(){
  return state.cart.items.reduce((sum, it) => sum + it.line_total, 0)
}

function renderVendor(){
  const el = document.getElementById('app')
  el.innerHTML = `
    <div class="mb-4 flex items-center gap-2">
      <button id="back" class="text-blue-600">← Back</button>
      <h2 class="text-2xl font-bold">${state.vendor.vendor.org_name}</h2>
      <span class="text-sm text-gray-600">${(state.vendor.vendor.rating_avg||0).toFixed(1)} ⭐ (${state.vendor.vendor.rating_count||0})</span>
    </div>
    <div class="grid md:grid-cols-3 gap-6">
      <div class="md:col-span-2 space-y-4">
        ${state.menu.map(sec => `
          <div class="bg-white rounded shadow">
            <div class="px-4 py-2 font-semibold border-b">${sec.name}</div>
            <div class="divide-y">
              ${sec.items.map(item => `
                <div class="p-4 flex items-center justify-between">
                  <div>
                    <div class="font-medium">${item.name}</div>
                    <div class="text-sm text-gray-600">${item.description||''}</div>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="text-sm font-semibold">${money(item.base_price)}</div>
                    <button class="px-2 py-1 text-sm bg-emerald-600 text-white rounded" data-add='${JSON.stringify({id:item.id, name:item.name, price:item.base_price}).replace(/'/g, "&apos;") }'>Add</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <div class="bg-white rounded shadow p-4">
        <div class="font-semibold mb-2">Cart</div>
        <div id="cart-items" class="space-y-2">
          ${state.cart.items.map(ci => `<div class="flex justify-between"><div>${ci.name} × ${ci.qty}</div><div>${money(ci.line_total)}</div></div>`).join('')}
        </div>
        <div class="mt-3 space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <label class="inline-flex items-center gap-2">
              <select id="ck-type" class="border rounded p-1 text-sm">
                <option value="pickup" ${state.checkout.type==='pickup'?'selected':''}>Pickup</option>
                <option value="delivery" ${state.checkout.type==='delivery'?'selected':''}>Delivery</option>
              </select>
            </label>
            <label class="inline-flex items-center gap-1">
              Tip: <input id="ck-tip" class="border rounded p-1 w-24" placeholder="0" value="${(state.checkout.tip_cents/100).toFixed(2)}" />
            </label>
          </div>
          <div class="flex items-center gap-2 text-xs">
            <span class="text-gray-600">Tip quick:</span>
            ${[0,10,15,20].map(p=>`<button class="px-2 py-1 border rounded" data-tip="${p}">${p}%</button>`).join('')}
          </div>
          ${state.checkout.type==='delivery' ? `
          <div class="flex items-center justify-between">
            <input id="ck-distance" class="border rounded p-1 w-28" placeholder="km" value="${state.checkout.distance_km||''}" />
            <button id="ck-quote" class="px-2 py-1 bg-slate-600 text-white rounded">Get quote</button>
          </div>
          <div id="ck-quote-view" class="text-xs text-gray-600">${state.checkout.quote ? `Delivery fee: ${money(state.checkout.quote.fee)} • ETA: ${state.checkout.quote.eta_minutes}m` : ''}</div>
          ` : ''}
          <div class="flex items-center justify-between">
            <input id="ck-promo" class="border rounded p-1 w-32" placeholder="Promo code" value="${state.checkout.promo_code||''}" />
            <div class="flex items-center gap-2">
              <button id="ck-max" class="px-2 py-1 border rounded text-xs">Max</button>
              <button id="ck-apply" class="px-2 py-1 border rounded">Apply</button>
            </div>
          </div>
          <div id="ck-promo-msg" class="text-xs ${state.checkout.promo_code ? ((state.checkout.promo_code||'').toUpperCase()==='SAVE10' ? 'text-emerald-700':'text-red-600') : 'text-gray-500'}">
            ${state.checkout.promo_code ? ((state.checkout.promo_code||'').toUpperCase()==='SAVE10' ? 'SAVE10 applied: 10% up to $5' : 'Invalid code') : ''}
          </div>
        </div>
        <div class="mt-2 space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <label class="inline-flex items-center gap-2">
              <input id="ck-use-points" type="checkbox" ${state.checkout.use_points?'checked':''}>
              <span>Use loyalty points (${state.loyalty||0} pts)</span>
            </label>
            <input id="ck-points" class="border rounded p-1 w-28" placeholder="points" value="${state.checkout.loyalty_points||0}" ${state.checkout.use_points?'':'disabled'} />
          </div>
        </div>
        <div class="border-t mt-2 pt-2 space-y-1 text-sm">
          <div class="flex justify-between"><div>Subtotal</div><div id="subtotal">${money(calcSubtotal())}</div></div>
          <div class="flex justify-between"><div>Taxes (8%)</div><div id="ck-taxes"></div></div>
          ${state.checkout.type==='delivery' ? `
            <div class="flex justify-between"><div>Service fee</div><div id="ck-fee-base"></div></div>
            <div class="flex justify-between"><div>Delivery (quote)</div><div id="ck-fee-quote"></div></div>
          ` : `
            <div class="flex justify-between"><div>Fees</div><div id="ck-fees"></div></div>
          `}
          <div class="flex justify-between"><div>Tip</div><div id="ck-tip-view"></div></div>
          <div class="flex justify-between"><div>Discount</div><div id="ck-discount"></div></div>
          ${state.checkout.use_points && state.checkout.loyalty_points ? `<div class="flex justify-between text-xs text-gray-600"><div>Loyalty applied</div><div id="ck-loyalty-applied"></div></div>`:''}
          <div class="flex justify-between font-semibold border-t pt-1"><div>Total</div><div id="ck-total"></div></div>
        </div>
        <button id="checkout" class="mt-3 w-full bg-blue-600 text-white py-2 rounded disabled:opacity-50" ${state.cart.items.length===0?'disabled':''}>Place order</button>
        <div id="order-status" class="text-sm text-gray-600 mt-2"></div>
      </div>
      <div class="bg-white rounded shadow p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="font-semibold">Reviews</div>
          <button id="rv-new" class="px-2 py-1 text-sm border rounded">Write a review</button>
        </div>
        <div id="rv-list" class="divide-y">
          ${(state.reviews||[]).map(r=>`<div class=\"py-2 text-sm\"><div class=\"font-medium\">${'⭐'.repeat(r.rating)}<span class=\"text-gray-500\"> (${new Date(r.created_at).toLocaleString()})</span></div><div>${r.text||''}</div></div>`).join('') || '<div class="text-sm text-gray-500">No reviews yet</div>'}
        </div>
      </div>

      <div class="bg-white rounded shadow p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="font-semibold">Group order</div>
        </div>
        <div class="grid gap-2 text-sm">
          <div class="flex items-center gap-2">
            <button id="go-start" class="px-2 py-1 border rounded">Start group order</button>
            ${state.groupCode ? `<span class="text-gray-700">Code: <span class="font-mono" id="go-code-view">${state.groupCode}</span></span>
            <button id="go-copy" class="px-2 py-1 border rounded text-xs">Copy</button>
            <button id="go-open" class="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>` : ''}
          </div>
          <div class="flex items-center gap-2">
            <input id="go-code" class="border rounded p-1 w-40" placeholder="Enter code" value="${state.groupCode||''}">
            <button id="go-join" class="px-2 py-1 border rounded">Join</button>
          </div>
        </div>
      </div>

      <div class="bg-white rounded shadow p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="font-semibold">Your reservations</div>
          <button id="rs-new" class="px-2 py-1 text-sm border rounded">Reserve</button>
        </div>
        <div id="rs-list" class="divide-y text-sm">
          ${(state.reservations||[]).map(r=>`<div class=\"py-2\">
            <div class=\"flex items-center justify-between\">
              <div>
                <div class=\"font-medium\">${r.datetime_iso} • party ${r.party_size}</div>
                <div class=\"text-gray-500\">Status: ${r.status}${r.notes?` • Notes: ${r.notes}`:''}</div>
              </div>
              <div class=\"text-gray-400\">${new Date(r.created_at).toLocaleString()}</div>
            </div>
          </div>`).join('') || '<div class="text-gray-500">No reservations yet</div>'}
        </div>
      </div>
    </div>
  `
  document.getElementById('back').onclick = () => renderHome()

  // Group order controls
  const goStart = document.getElementById('go-start')
  if (goStart) goStart.onclick = async () => {
    const resp = await api.groupStart(state.vendor.vendor.id)
    if (resp.error) { alert(resp.error); return }
    state.groupCode = resp.code
    renderVendor()
  }
  const goCopy = document.getElementById('go-copy')
  if (goCopy) goCopy.onclick = async () => {
    const code = (document.getElementById('go-code-view')).textContent
    try { await navigator.clipboard.writeText(code); goCopy.textContent = 'Copied!'; setTimeout(()=>{ goCopy.textContent='Copy' }, 1500) } catch {}
  }
  const goOpen = document.getElementById('go-open')
  if (goOpen) goOpen.onclick = async () => {
    renderGroup(state.groupCode)
  }
  const goJoin = document.getElementById('go-join')
  if (goJoin) goJoin.onclick = async () => {
    const code = (document.getElementById('go-code')).value.trim().toUpperCase()
    if (!code) return
    renderGroup(code)
  }


  // Reservations: open modal to create
  const resBtn = document.getElementById('rs-new')
  if (resBtn) resBtn.onclick = () => {
    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50'
    const content = document.createElement('div')
    content.className = 'bg-white rounded shadow max-w-md w-full p-4'
    content.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="font-semibold">Reserve a table</div>
        <button id="rs-close" class="text-gray-500">✕</button>
      </div>
      <div class="space-y-2 text-sm">
        <label class="block">Date/time (ISO)
          <input id="rs-dt" class="border rounded p-1 w-full" placeholder="2025-08-25T19:00:00Z" />
        </label>
        <label class="block">Party size
          <input id="rs-party" type="number" min="1" max="20" class="border rounded p-1 w-full" value="2" />
        </label>
        <label class="block">Notes
          <textarea id="rs-notes" class="border rounded p-2 w-full h-20" placeholder="Any special requests?"></textarea>
        </label>
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <button id="rs-cancel" class="px-3 py-2 border rounded">Cancel</button>
        <button id="rs-submit" class="px-3 py-2 bg-emerald-600 text-white rounded">Submit</button>
      </div>
    `
    overlay.appendChild(content)
    document.body.appendChild(overlay)
    const close = ()=> overlay.remove()
    content.querySelector('#rs-close').onclick = close
    content.querySelector('#rs-cancel').onclick = close
    overlay.addEventListener('click', (e)=>{ if (e.target === overlay) close() })
    content.querySelector('#rs-submit').onclick = async () => {
      const dt = (content.querySelector('#rs-dt')).value || ''
      const party = Number((content.querySelector('#rs-party')).value || 2)
      const notes = (content.querySelector('#rs-notes')).value || ''
      const resp = await api.postReservation(state.vendor.vendor.id, { datetime_iso: dt, party_size: party, notes })
      if (resp.error) {
        alert(resp.error)
        return
      }
      const resv = await api.getReservations(state.vendor.vendor.id)
      state.reservations = resv.reservations || []
      close()
      renderVendor()
    }
  }

  // Reviews: open modal to submit
  const revBtn = document.getElementById('rv-new')
  if (revBtn) revBtn.onclick = () => {
    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50'
    const content = document.createElement('div')
    content.className = 'bg-white rounded shadow max-w-md w-full p-4'
    content.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="font-semibold">Write a review</div>
        <button id="rv-close" class="text-gray-500">✕</button>
      </div>
      <div class="space-y-2 text-sm">
        <label class="block">Rating
          <select id="rv-rating" class="border rounded p-1 w-full">
            ${[5,4,3,2,1].map(r=>`<option value="${r}">${r} ⭐</option>`).join('')}
          </select>
        </label>
        <label class="block">Comments
          <textarea id="rv-text" class="border rounded p-2 w-full h-24" placeholder="How was it?"></textarea>
        </label>
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <button id="rv-cancel" class="px-3 py-2 border rounded">Cancel</button>
        <button id="rv-submit" class="px-3 py-2 bg-emerald-600 text-white rounded">Submit</button>
      </div>
    `
    overlay.appendChild(content)
    document.body.appendChild(overlay)
    const close = ()=> overlay.remove()
    content.querySelector('#rv-close').onclick = close
    content.querySelector('#rv-cancel').onclick = close
    overlay.addEventListener('click', (e)=>{ if (e.target === overlay) close() })
    content.querySelector('#rv-submit').onclick = async () => {
      const rating = Number((content.querySelector('#rv-rating')).value || 5)
      const text = (content.querySelector('#rv-text')).value || ''
      await api.postReview(state.vendor.vendor.id, { rating, text })
      const revs = await api.getReviews(state.vendor.vendor.id)
      state.reviews = revs.reviews || []
      state.vendor = await api.getVendor(state.vendor.vendor.id) // refresh aggregates
      close()
      renderVendor()
    }
  }

  const tax = Math.round(calcSubtotal()*0.08)
  const baseFees = state.checkout.type==='delivery' ? 399 : 99
  const quoteFee = state.checkout.type==='delivery' && state.checkout.quote ? state.checkout.quote.fee : 0
  const fees = baseFees + quoteFee
  const tipCents = Math.max(0, Math.round(Number(((document.getElementById('ck-tip')||{value:'0'}).value||'0'))*100))
  const subtotal = calcSubtotal()
  let discount = (state.checkout.promo_code||'').toUpperCase()==='SAVE10' ? Math.min(Math.round(subtotal*0.1), 500) : 0
  let loyaltyApplied = 0
  if (state.checkout.use_points) {
    const req = Math.max(0, Math.floor(Number(state.checkout.loyalty_points||0)))
    const avail = Math.max(0, Math.floor(Number(state.loyalty||0)))
    const maxBySubtotal = Math.max(0, subtotal - discount)
    loyaltyApplied = Math.max(0, Math.min(req, avail, maxBySubtotal))
    discount += loyaltyApplied
  }
  const total = Math.max(0, subtotal + tax + fees + tipCents - discount)
  document.getElementById('ck-taxes').textContent = money(tax)
  if (state.checkout.type==='delivery') {
    const base = baseFees
    const quote = quoteFee
    const baseEl = document.getElementById('ck-fee-base')
    const quoteEl = document.getElementById('ck-fee-quote')
    if (baseEl) baseEl.textContent = money(base)
    if (quoteEl) quoteEl.textContent = money(quote)
  } else {
    document.getElementById('ck-fees').textContent = money(fees)
  }
  document.getElementById('ck-tip-view').textContent = money(tipCents)
  document.getElementById('ck-discount').textContent = discount?`- ${money(discount)}`:'- $0.00'
  const loyEl = document.getElementById('ck-loyalty-applied')
  if (loyEl) loyEl.textContent = loyaltyApplied ? `- ${money(loyaltyApplied)}` : ''
  document.getElementById('ck-total').textContent = money(total)

  const recalc = async (ev) => {
    if (ev && ev.target && ev.target.id === 'ck-type') {
      state.checkout.type = (document.getElementById('ck-type')).value
      if (state.checkout.type === 'pickup') state.checkout.quote = null
      renderVendor(); return
    }
    if (ev && ev.target && ev.target.id === 'ck-apply') {
      state.checkout.promo_code = (document.getElementById('ck-promo')).value
    }
    if (ev && ev.target && ev.target.id === 'ck-tip') {
      const val = Number((document.getElementById('ck-tip')).value || 0)
      state.checkout.tip_cents = Math.max(0, Math.round(val*100))
    }
    if (ev && ev.target && ev.target.id === 'ck-use-points') {
      state.checkout.use_points = (document.getElementById('ck-use-points')).checked
      renderVendor(); return
    }
    if (ev && ev.target && ev.target.id === 'ck-points') {
      const pts = Math.max(0, Math.floor(Number((document.getElementById('ck-points')).value||0)))
      state.checkout.loyalty_points = pts
    }
    if (ev && ev.target && ev.target.id === 'ck-max') {
      // Fill points with max allowed
      state.checkout.use_points = true
      const subtotal = calcSubtotal()
      let discount = (state.checkout.promo_code||'').toUpperCase()==='SAVE10' ? Math.min(Math.round(subtotal*0.1), 500) : 0
      const maxBySubtotal = Math.max(0, subtotal - discount)
      const avail = Math.max(0, Math.floor(Number(state.loyalty||0)))
      const pts = Math.max(0, Math.min(avail, maxBySubtotal))
      state.checkout.loyalty_points = pts
      renderVendor(); return
    }
    if (ev && ev.target && ev.target.id === 'ck-quote') {
      const km = Number((document.getElementById('ck-distance')).value || 0)
      state.checkout.distance_km = (document.getElementById('ck-distance')).value
      state.checkout.quote = await api.quote({ vendor_id: state.cart.vendor_id, distance_km: km })
      renderVendor(); return
    }
    renderVendor()
  }
  ;['ck-type','ck-apply','ck-tip','ck-quote','ck-use-points','ck-points','ck-max'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.addEventListener('click', recalc)
  })
  document.querySelectorAll('[data-tip]').forEach(btn => btn.addEventListener('click', () => {
    const pct = Number(btn.getAttribute('data-tip')||'0')
    const sub = calcSubtotal()
    state.checkout.tip_cents = Math.round(sub * (pct/100))
    const tipInput = document.getElementById('ck-tip')
    if (tipInput) tipInput.value = (state.checkout.tip_cents/100).toFixed(2)
    renderVendor()
  }))
  ;['ck-tip'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.addEventListener('change', recalc)
  })

  document.querySelectorAll('button[data-add]').forEach(btn => btn.addEventListener('click', async () => {
    const payload = JSON.parse(btn.getAttribute('data-add').replace(/&apos;/g, "'"))
    const groups = (await api.getItemOptions(payload.id)).groups || []
    // If no option groups or all optional with min 0 -> quick add
    const requiresModal = groups.some(g => g.required || (g.min||0) > 0)
    if (!requiresModal && groups.length === 0) {
      addToCart(payload.id, payload.name, 1, payload.price, [])
      renderVendor()
      return
    }
    openOptionsModal(payload, groups)
  }))
  document.getElementById('checkout').onclick = async () => {
    const orderReq = {
      vendor_id: state.cart.vendor_id,
      type: state.checkout.type,
      items: state.cart.items.map(i => ({ item_id: i.item_id, qty: i.qty, selected_options: i.selected_options })),
      tip_cents: Math.max(0, Math.round(Number(((document.getElementById('ck-tip')||{value:'0'}).value||'0'))*100)),
      promo_code: (document.getElementById('ck-promo')||{value:''}).value,
      loyalty_points: state.checkout.use_points ? Math.max(0, Math.floor(Number((document.getElementById('ck-points')||{value:0}).value||0))) : 0
    }
    if (state.checkout.type === 'delivery') {
      const km = Number(state.checkout.distance_km || 0)
      if (!Number.isNaN(km) && km > 0) orderReq.distance_km = km
    }
    const res = await api.createOrder(orderReq)
    if (!res.order) {
      document.getElementById('order-status').textContent = res.error || 'Order failed'
      return
    }
    const details = await api.getOrder(res.order.id)
    state.lastOrder = details
    // Refresh loyalty balance immediately after order
    try {
      const loy = await api.getLoyalty(state.cart.vendor_id)
      state.loyalty = loy.points || 0
    } catch {}
    renderOrderSummary(details)
  }
}

function addToCart(itemId, name, qty, unitPrice, selectedOptions){
  // merge by same item + same options set
  const key = `${itemId}::${[...selectedOptions].sort((a,b)=>a-b).join(',')}`
  const existing = state.cart.items.find(i => `${i.item_id}::${[...i.selected_options].sort((a,b)=>a-b).join(',')}` === key)
  if(existing){
    existing.qty += qty
    existing.line_total = existing.qty * existing.unit_price
  } else {
    state.cart.items.push({ item_id: itemId, name, qty, unit_price: unitPrice, line_total: unitPrice*qty, selected_options: [...selectedOptions] })
  }
}

function openOptionsModal(item, groups){
  const overlay = document.createElement('div')
  overlay.id = 'modal-overlay'
  overlay.className = 'fixed inset-0 bg-black/40 flex items-center justify-center z-50'
  const content = document.createElement('div')
  content.className = 'bg-white rounded shadow max-w-lg w-full p-4'
  content.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <div class="font-semibold text-lg">Customize ${item.name}</div>
      <button id="modal-close" class="text-gray-500">✕</button>
    </div>
    <div class="text-sm text-gray-600 mb-2">Base price: ${money(item.price)}</div>
    <div class="space-y-4 max-h-[60vh] overflow-auto">
      ${groups.map(g => `
        <div>
          <div class="font-medium">${g.name} ${g.required?'<span class="text-red-600">*</span>':''}</div>
          <div class="text-xs text-gray-500 mb-1">${g.min||0}-${g.max||1} selectable</div>
          <div class="space-y-1">
            ${g.options.map(o => {
              const type = (g.max||1) === 1 ? 'radio' : 'checkbox'
              const name = `group-${g.id}`
              const price = o.price_delta ? ` (+${money(o.price_delta)})` : ''
              return `<label class="flex items-center gap-2 text-sm"><input type="${type}" name="${name}" value="${o.id}" data-price="${o.price_delta||0}"> ${o.name}${price}</label>`
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
    <div class="mt-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <button id="qty-dec" class="px-2 py-1 border rounded">-</button>
        <input id="qty" class="w-14 text-center border rounded py-1" value="1">
        <button id="qty-inc" class="px-2 py-1 border rounded">+</button>
      </div>
      <div class="font-semibold">Total: <span id="modal-total">${money(item.price)}</span></div>
    </div>
    <div class="mt-3 flex justify-end gap-2">
      <button id="modal-cancel" class="px-3 py-2 rounded border">Cancel</button>
      <button id="modal-add" class="px-3 py-2 rounded bg-emerald-600 text-white">Add to cart</button>
    </div>
  `
  overlay.appendChild(content)
  document.body.appendChild(overlay)

  const qtyEl = content.querySelector('#qty')
  const totalEl = content.querySelector('#modal-total')
  const close = ()=>{ overlay.remove() }
  content.querySelector('#modal-close').onclick = close
  content.querySelector('#modal-cancel').onclick = close
  overlay.addEventListener('click', (e) => { if(e.target === overlay) close() })

  const updateTotal = ()=>{
    const selectedDeltas = Array.from(content.querySelectorAll('input[type="checkbox"], input[type="radio"]'))
      .filter((el)=>el.checked)
      .map((el)=>Number(el.getAttribute('data-price')||0))
    const unit = item.price + selectedDeltas.reduce((s,v)=>s+v,0)
    const qty = Math.max(1, Number(qtyEl.value||1))
    totalEl.textContent = money(unit * qty)
  }
  content.querySelector('#qty-inc').onclick = ()=>{ qtyEl.value = String(Math.max(1, Number(qtyEl.value||1) + 1)); updateTotal() }
  content.querySelector('#qty-dec').onclick = ()=>{ qtyEl.value = String(Math.max(1, Number(qtyEl.value||1) - 1)); updateTotal() }
  content.querySelectorAll('input').forEach((el)=> el.addEventListener('change', () => {
    // enforce max selections for checkbox groups
    const name = el.getAttribute('name')
    const grp = groups.find(g => `group-${g.id}` === name)
    if (!grp) return updateTotal()
    const max = grp.max || 1
    const inputs = Array.from(content.querySelectorAll(`input[name="${name}"]`))
    const checked = inputs.filter(i => i.checked)
    if ((grp.max||1) > 1 && checked.length > max) {
      el.checked = false
      return
    }
    updateTotal()
  }))
  updateTotal()

  content.querySelector('#modal-add').onclick = () => {
    // validate per group
    const selectedOptions = []
    for (const g of groups) {
      const name = `group-${g.id}`
      const inputs = Array.from(content.querySelectorAll(`input[name="${name}"]`))
      const chosen = inputs.filter(i => i.checked).map(i => Number(i.value))
      const min = g.min || 0
      const max = g.max || 1
      if (g.required && chosen.length === 0) {
        alert(`Please select at least one option for ${g.name}`)
        return
      }
      if (chosen.length < min) {
        alert(`Please select at least ${min} for ${g.name}`)
        return
      }
      if (chosen.length > max) {
        alert(`Please select at most ${max} for ${g.name}`)
        return
      }
      selectedOptions.push(...chosen)
    }
    const selectedDeltas = Array.from(content.querySelectorAll('input[type="checkbox"], input[type="radio"]'))
      .filter((el)=>el.checked)
      .map((el)=>Number(el.getAttribute('data-price')||0))
    const unit = item.price + selectedDeltas.reduce((s,v)=>s+v,0)
    const qty = Math.max(1, Number(qtyEl.value||1))
    addToCart(item.id, item.name, qty, unit, selectedOptions)
    close()
    renderVendor()
  }
}

function renderOrderSummary(details){
  const el = document.getElementById('app')
  const order = details.order
  const items = details.items || []
  const baseFee = order.type === 'delivery' ? 399 : 99
  const deliveryQuote = order.type === 'delivery' ? Math.max(0, order.fees - baseFee) : 0
  el.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-3">
      <div>
        <button id="back-home" class="text-blue-600">← Back to Home</button>
      </div>
      <div class="bg-white rounded shadow p-4">
        <div class="flex items-center justify-between">
          <div class="font-semibold text-lg">Order #${order.id}</div>
          <div class="text-sm text-gray-600">Status: <span id="ord-status">${order.status}</span><span id="ord-eta">${order.eta?` • ETA: ${order.eta}`:''}</span></div>
        </div>
        <div class="text-sm text-gray-600">Vendor: ${state.vendor?.vendor?.org_name || ''}</div>
        <div class="mt-2 divide-y">
          ${items.map(it => `<div class=\"py-2 flex justify-between\"><div>${it.qty}× ${it.item_name || it.item_id}</div><div>${money(it.line_total)}</div></div>`).join('')}
        </div>
        <div class="mt-3 border-t pt-2 space-y-1 text-sm">
          <div class="flex justify-between"><div>Subtotal</div><div>${money(order.subtotal)}</div></div>
          <div class="flex justify-between"><div>Taxes</div><div>${money(order.taxes)}</div></div>
          ${order.type==='delivery' ? `
            <div class="flex justify-between"><div>Service fee</div><div>${money(baseFee)}</div></div>
            <div class="flex justify-between"><div>Delivery (quote)</div><div>${money(deliveryQuote)}</div></div>
          ` : `
            <div class="flex justify-between"><div>Fees</div><div>${money(order.fees)}</div></div>
          `}
          <div class="flex justify-between"><div>Tip</div><div>${money(order.tip)}</div></div>
          <div class="flex justify-between font-semibold border-t pt-1"><div>Total</div><div>${money(order.total)}</div></div>
        </div>
        <div class="mt-3 flex gap-2 justify-end">
          <button id="ord-refresh" class="px-3 py-2 border rounded">Refresh</button>
          <button id="ord-new" class="px-3 py-2 bg-blue-600 text-white rounded">New order</button>
        </div>
      </div>
    </div>
  `
  document.getElementById('back-home').onclick = () => { if (state.orderPoll) { clearInterval(state.orderPoll); state.orderPoll=null } ; loadVendors() }
  document.getElementById('ord-refresh').onclick = async () => {
    const d = await api.getOrder(order.id)
    state.lastOrder = d
    renderOrderSummary(d)
  }
  document.getElementById('ord-new').onclick = () => {
    if (state.orderPoll) { clearInterval(state.orderPoll); state.orderPoll=null }
    state.cart = { vendor_id: state.cart.vendor_id, items: [] }
    state.checkout = { type: 'pickup', tip_cents: 0, promo_code: '', quote: null, distance_km: '' }
    renderVendor()
  }

  // Live polling for status updates
  if (state.orderPoll) { clearInterval(state.orderPoll); state.orderPoll=null }
  const terminal = new Set(['Completed','Canceled','Refunded'])
  if (!terminal.has(order.status)) {
    state.orderPoll = setInterval(async () => {
      const d = await api.getOrder(order.id)
      const s = d.order.status
      const eta = d.order.eta
      const stEl = document.getElementById('ord-status')
      const etaEl = document.getElementById('ord-eta')
      if (stEl) stEl.textContent = s
      if (etaEl) etaEl.textContent = eta ? ` • ETA: ${eta}` : ''
      if (terminal.has(s)) { clearInterval(state.orderPoll); state.orderPoll = null }
    }, 5000)
  }
}

function renderGroup(code){
  state.groupCode = code
  const el = document.getElementById('app')
  el.innerHTML = `
    <div class="max-w-3xl mx-auto space-y-3">
      <div>
        <button id="back-vendor" class="text-blue-600">← Back to Vendor</button>
      </div>
      <div class="bg-white rounded shadow p-4">
        <div class="flex items-center justify-between">
          <div class="font-semibold text-lg">Group: <span class="font-mono">${code}</span></div>
          <div class="text-sm text-gray-500">Vendor: ${state.vendor?.vendor?.org_name || ''}</div>
        </div>
        <div id="go-body" class="mt-3 text-sm text-gray-600">Loading…</div>
      </div>
      <div class="bg-white rounded shadow p-4">
        <div class="font-semibold mb-2">Add item to group</div>
        <div class="text-xs text-gray-600 mb-2">Use the menu on the vendor page to pick items and note the ID; for MVP we quickly add by item ID.</div>
        <div class="flex items-center gap-2">
          <input id="gi-item" class="border rounded p-1 w-28" placeholder="item id">
          <input id="gi-qty" class="border rounded p-1 w-20" placeholder="qty" value="1">
          <input id="gi-name" class="border rounded p-1 w-40" placeholder="your name (optional)">
          <button id="gi-add" class="px-2 py-1 border rounded">Add</button>
        </div>
      </div>
      <div id="gs-panel" class="bg-white rounded shadow p-4">
        Loading submit panel…
      </div>
    </div>
  `
  const back = document.getElementById('back-vendor')
  back.onclick = () => renderVendor()

  const bodyEl = document.getElementById('go-body')
  const refresh = async () => {
    const data = await api.groupGet(code)
    if (!data.group) { bodyEl.textContent = 'Group not found'; return }
    const items = data.items || []
    const subtotal = data.subtotal || 0
    bodyEl.innerHTML = `
      <div class="divide-y">
        ${items.map(it => `<div class=\"py-2 flex justify-between\"><div>#${it.item_id} × ${it.qty} • ${it.user_name||'Guest'}</div><div>${money(it.line_total)}</div></div>`).join('')||'<div class=\"text-gray-500\">No items yet</div>'}
      </div>
      <div class="mt-2 flex justify-between font-semibold"><div>Subtotal</div><div>${money(subtotal)}</div></div>
    `
    const vendorId = Number(data.group.vendor_id)
    try {
      const loy = await api.getLoyalty(vendorId)
      state.groupLoyalty = Math.max(0, Number(loy.points||0))
    } catch {}
    // Ensure defaults
    if (!state.groupCheckout) state.groupCheckout = { type: 'pickup', tip_cents: 0, promo_code: '', quote: null, distance_km: '', use_points: false, loyalty_points: 0 }
    const panel = document.getElementById('gs-panel')
    const gc = state.groupCheckout
    const renderSubmit = () => {
      const isDelivery = gc.type === 'delivery'
      const tax = Math.round(subtotal * 0.08)
      const baseFees = isDelivery ? 399 : 99
      const quoteFee = isDelivery && gc.quote ? gc.quote.fee : 0
      const fees = baseFees + quoteFee
      const promoDiscount = (gc.promo_code||'').toUpperCase()==='SAVE10' ? Math.min(Math.round(subtotal*0.1), 500) : 0
      const tipCents = Math.max(0, Number(gc.tip_cents||0))
      let loyaltyApplied = 0
      if (gc.use_points) {
        const req = Math.max(0, Math.floor(Number(gc.loyalty_points||0)))
        const avail = Math.max(0, Math.floor(Number(state.groupLoyalty||0)))
        const maxBySubtotal = Math.max(0, subtotal - promoDiscount)
        loyaltyApplied = Math.max(0, Math.min(req, avail, maxBySubtotal))
      }
      const total = Math.max(0, subtotal + tax + fees + tipCents - promoDiscount - loyaltyApplied)
      panel.innerHTML = `
        <div class="font-semibold mb-2">Submit group order</div>
        <div class="space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <label class="inline-flex items-center gap-2">
              <select id="gs-type" class="border rounded p-1 text-sm">
                <option value="pickup" ${gc.type==='pickup'?'selected':''}>Pickup</option>
                <option value="delivery" ${gc.type==='delivery'?'selected':''}>Delivery</option>
              </select>
            </label>
            <label class="inline-flex items-center gap-1">
              Tip: <input id="gs-tip" class="border rounded p-1 w-24" placeholder="0" value="${(tipCents/100).toFixed(2)}" />
            </label>
          </div>
          <div class="flex items-center gap-2 text-xs">
            <span class="text-gray-600">Tip quick:</span>
            ${[0,10,15,20].map(p=>`<button class=\"px-2 py-1 border rounded\" data-gs-tip=\"${p}\">${p}%</button>`).join('')}
          </div>
          ${isDelivery ? `
          <div class="flex items-center justify-between">
            <input id="gs-distance" class="border rounded p-1 w-28" placeholder="km" value="${gc.distance_km||''}" />
            <button id="gs-quote" class="px-2 py-1 bg-slate-600 text-white rounded">Get quote</button>
          </div>
          <div id="gs-quote-view" class="text-xs text-gray-600">${gc.quote ? `Delivery fee: ${money(gc.quote.fee)} • ETA: ${gc.quote.eta_minutes}m` : ''}</div>
          ` : ''}
          <div class="flex items-center justify-between">
            <input id="gs-promo" class="border rounded p-1 w-32" placeholder="Promo code" value="${gc.promo_code||''}" />
            <div class="flex items-center gap-2">
              <button id="gs-max" class="px-2 py-1 border rounded text-xs">Max</button>
              <button id="gs-apply" class="px-2 py-1 border rounded">Apply</button>
            </div>
          </div>
          <div id="gs-promo-msg" class="text-xs ${(gc.promo_code||'').toUpperCase()==='SAVE10' ? 'text-emerald-700':'text-red-600'}">
            ${gc.promo_code ? ((gc.promo_code||'').toUpperCase()==='SAVE10' ? 'SAVE10 applied: 10% up to $5' : 'Invalid code') : ''}
          </div>
        </div>
        <div class="mt-2 space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <label class="inline-flex items-center gap-2">
              <input id="gs-use-points" type="checkbox" ${gc.use_points?'checked':''}>
              <span>Use loyalty points (${state.groupLoyalty||0} pts)</span>
            </label>
            <input id="gs-points" class="border rounded p-1 w-28" placeholder="points" value="${gc.loyalty_points||0}" ${gc.use_points?'':'disabled'} />
          </div>
        </div>
        <div class="border-t mt-2 pt-2 space-y-1 text-sm">
          <div class="flex justify-between"><div>Subtotal</div><div id="gs-subtotal">${money(subtotal)}</div></div>
          <div class="flex justify-between"><div>Taxes (8%)</div><div id="gs-taxes">${money(tax)}</div></div>
          ${isDelivery ? `
            <div class="flex justify-between"><div>Service fee</div><div id="gs-fee-base">${money(baseFees)}</div></div>
            <div class="flex justify-between"><div>Delivery (quote)</div><div id="gs-fee-quote">${money(quoteFee)}</div></div>
          ` : `
            <div class="flex justify-between"><div>Fees</div><div id="gs-fees">${money(fees)}</div></div>
          `}
          <div class="flex justify-between"><div>Tip</div><div id="gs-tip-view">${money(tipCents)}</div></div>
          <div class="flex justify-between"><div>Discount</div><div id="gs-discount">${(promoDiscount+loyaltyApplied)?`- ${money(promoDiscount+loyaltyApplied)}`:'- $0.00'}</div></div>
          ${gc.use_points && gc.loyalty_points ? `<div class="flex justify-between text-xs text-gray-600"><div>Loyalty applied</div><div id="gs-loyalty-applied">- ${money(loyaltyApplied)}</div></div>`:''}
          <div class="flex justify-between font-semibold border-t pt-1"><div>Total</div><div id="gs-total">${money(total)}</div></div>
        </div>
        <button id="gs-submit" class="mt-3 w-full bg-blue-600 text-white py-2 rounded ${subtotal===0?'opacity-50':''}" ${subtotal===0?'disabled':''}>Submit group order</button>
      `
      // Listeners
      const typeEl = document.getElementById('gs-type')
      if (typeEl) typeEl.addEventListener('change', () => { gc.type = typeEl.value; if (gc.type==='pickup') gc.quote=null; renderSubmit() })
      const tipEl = document.getElementById('gs-tip')
      if (tipEl) tipEl.addEventListener('change', () => { const v = Number((tipEl.value||'0')); gc.tip_cents = Math.max(0, Math.round(v*100)); renderSubmit() })
      document.querySelectorAll('[data-gs-tip]').forEach(btn => btn.addEventListener('click', () => {
        const pct = Number(btn.getAttribute('data-gs-tip')||'0')
        gc.tip_cents = Math.round(subtotal * (pct/100))
        const tipInput = document.getElementById('gs-tip')
        if (tipInput) tipInput.value = (gc.tip_cents/100).toFixed(2)
        renderSubmit()
      }))
      const applyEl = document.getElementById('gs-apply')
      if (applyEl) applyEl.addEventListener('click', () => { gc.promo_code = (document.getElementById('gs-promo')).value; renderSubmit() })
      const usePtsEl = document.getElementById('gs-use-points')
      if (usePtsEl) usePtsEl.addEventListener('change', () => { gc.use_points = usePtsEl.checked; renderSubmit() })
      const ptsEl = document.getElementById('gs-points')
      if (ptsEl) ptsEl.addEventListener('change', () => { gc.loyalty_points = Math.max(0, Math.floor(Number((ptsEl.value||0)))); })
      const maxEl = document.getElementById('gs-max')
      if (maxEl) maxEl.addEventListener('click', () => {
        gc.use_points = true
        const promoDisc = (gc.promo_code||'').toUpperCase()==='SAVE10' ? Math.min(Math.round(subtotal*0.1), 500) : 0
        const maxBySubtotal = Math.max(0, subtotal - promoDisc)
        const avail = Math.max(0, Math.floor(Number(state.groupLoyalty||0)))
        gc.loyalty_points = Math.max(0, Math.min(avail, maxBySubtotal))
        renderSubmit()
      })
      const quoteBtn = document.getElementById('gs-quote')
      if (quoteBtn) quoteBtn.addEventListener('click', async () => {
        const km = Number((document.getElementById('gs-distance')).value || 0)
        gc.distance_km = (document.getElementById('gs-distance')).value
        gc.quote = await api.quote({ vendor_id: vendorId, distance_km: km })
        renderSubmit()
      })
      const submitBtn = document.getElementById('gs-submit')
      if (submitBtn) submitBtn.addEventListener('click', async () => {
        const payload = {
          type: gc.type,
          tip_cents: Math.max(0, Math.round(Number(((document.getElementById('gs-tip')||{value:'0'}).value||'0'))*100)),
          promo_code: (document.getElementById('gs-promo')||{value:''}).value,
          loyalty_points: gc.use_points ? Math.max(0, Math.floor(Number((document.getElementById('gs-points')||{value:0}).value||0))) : 0
        }
        if (gc.type === 'delivery') {
          const km = Number(gc.distance_km || 0)
          if (!Number.isNaN(km) && km > 0) payload.distance_km = km
        }
        const res = await api.groupSubmit(code, payload)
        if (!res.order) { alert(res.error || 'Submit failed'); return }
        const details = await api.getOrder(res.order.id)
        state.lastOrder = details
        try {
          const loy = await api.getLoyalty(vendorId)
          state.groupLoyalty = Math.max(0, Number(loy.points||0))
          state.loyalty = state.groupLoyalty // also reflect in vendor view
        } catch {}
        renderOrderSummary(details)
      })
    }
    renderSubmit()
  }
  refresh()

  document.getElementById('gi-add').onclick = async () => {
    const itemId = Number((document.getElementById('gi-item')).value||0)
    const qty = Math.max(1, Number((document.getElementById('gi-qty')).value||1))
    const user_name = (document.getElementById('gi-name')).value||''
    if (!itemId) return
    await api.groupAdd(code, { item_id: itemId, qty, user_name })
    refresh()
  }
}

window.addEventListener('DOMContentLoaded', loadVendors)

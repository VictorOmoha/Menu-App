/* Simple Menu App MVP Frontend */
const api = {
  getVendors: () => fetch('/api/vendors').then(r=>r.json()),
  getVendor: (id) => fetch(`/api/vendors/${id}`).then(r=>r.json()),
  getMenus: (id) => fetch(`/api/vendors/${id}/menus`).then(r=>r.json()),
  createOrder: (payload) => fetch('/api/orders', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}).then(r=>r.json()),
  getOrder: (id) => fetch(`/api/orders/${id}`).then(r=>r.json())
}

const state = {
  vendors: [],
  vendor: null,
  menu: [],
  cart: { vendor_id: null, items: [] },
}

function money(cents){ return `$${(cents/100).toFixed(2)}` }

async function loadVendors(){
  const data = await api.getVendors()
  state.vendors = data.vendors
  renderHome()
}

function renderHome(){
  const el = document.getElementById('app')
  el.innerHTML = `
    <div class="space-y-3">
      ${state.vendors.map(v => `
        <div class="p-4 bg-white rounded shadow flex items-center justify-between">
          <div>
            <div class="font-semibold text-lg">${v.org_name}</div>
            <div class="text-sm text-gray-500">${v.type} • ${v.rating_avg?.toFixed?.(1) || '0.0'} ⭐ (${v.rating_count||0})</div>
          </div>
          <button class="px-3 py-1 bg-blue-600 text-white rounded" data-view="${v.id}">View</button>
        </div>
      `).join('')}
    </div>
  `
  el.querySelectorAll('button[data-view]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-view')
    state.vendor = await api.getVendor(id)
    const menus = await api.getMenus(id)
    state.menu = menus.sections
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
        <div class="border-t mt-2 pt-2 flex justify-between font-semibold"><div>Subtotal</div><div id="subtotal">${money(calcSubtotal())}</div></div>
        <button id="checkout" class="mt-3 w-full bg-blue-600 text-white py-2 rounded disabled:opacity-50" ${state.cart.items.length===0?'disabled':''}>Checkout</button>
        <div id="order-status" class="text-sm text-gray-600 mt-2"></div>
      </div>
    </div>
  `
  document.getElementById('back').onclick = () => renderHome()
  document.querySelectorAll('button[data-add]').forEach(btn => btn.addEventListener('click', () => {
    const payload = JSON.parse(btn.getAttribute('data-add').replace(/&apos;/g, "'"))
    const existing = state.cart.items.find(i => i.item_id === payload.id)
    if(existing){
      existing.qty += 1
      existing.line_total = existing.qty * existing.unit_price
    } else {
      state.cart.items.push({ item_id: payload.id, name: payload.name, qty: 1, unit_price: payload.price, line_total: payload.price, selected_options: [] })
    }
    renderVendor()
  }))
  document.getElementById('checkout').onclick = async () => {
    const orderReq = {
      vendor_id: state.cart.vendor_id,
      type: 'pickup',
      items: state.cart.items.map(i => ({ item_id: i.item_id, qty: i.qty, selected_options: i.selected_options }))
    }
    const res = await api.createOrder(orderReq)
    document.getElementById('order-status').textContent = `Order ${res.order?.id || ''} status: ${res.order?.status || res.error}`
  }
}

window.addEventListener('DOMContentLoaded', loadVendors)

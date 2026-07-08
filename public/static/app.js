/* ============================================================
   Menu — SPA frontend
   DoorDash/UberEats-inspired food delivery experience.
   Views: feed, store, checkout, order tracking, orders, group.
   ============================================================ */
(function () {
  const root = document.getElementById('app')
  if (!root) return // landing page also loads this script

  // ---------- utils ----------
  const $ = (sel, el) => (el || document).querySelector(sel)
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel))
  const money = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
  const fmtCount = (n) => (n >= 1000 ? `${Math.floor(n / 1000)},000+` : `${n}+`)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
  }
  window.__imgFail = function (el) {
    const em = el.getAttribute('data-emoji') || '🍽️'
    const d = document.createElement('div')
    d.className = 'food-fallback'
    d.textContent = em
    el.replaceWith(d)
  }

  const CUISINE_EMOJI = {
    Mexican: '🌮', Burgers: '🍔', Pizza: '🍕', Sushi: '🍣', Healthy: '🥗', 'West African': '🍲',
    Korean: '🍢', Chinese: '🥟', Bakery: '🥐', Indian: '🍛', Breakfast: '🥞', Mediterranean: '🧆',
  }
  const CATEGORIES = [
    ['Offers', '🏷️'], ['Pizza', '🍕'], ['Burgers', '🍔'], ['Mexican', '🌮'], ['Sushi', '🍣'],
    ['Healthy', '🥗'], ['Chinese', '🥟'], ['Korean', '🍢'], ['Indian', '🍛'], ['Breakfast', '🥞'],
    ['Bakery', '🥐'], ['Mediterranean', '🧆'], ['West African', '🍲'],
  ]
  const emojiFor = (v) => CUISINE_EMOJI[v.cuisine] || '🍽️'
  const priceRange = (n) => '$'.repeat(Math.max(1, Math.min(3, Number(n || 1))))
  const feeLabel = (v) => (Number(v.delivery_fee_cents || 0) === 0 ? '$0 Delivery Fee' : `${money(v.delivery_fee_cents)} Delivery Fee`)

  // ---------- api ----------
  const api = {
    vendors: (qs) => fetch('/api/vendors' + (qs ? `?${qs}` : '')).then((r) => r.json()),
    vendor: (id) => fetch(`/api/vendors/${id}`).then((r) => r.json()),
    menus: (id) => fetch(`/api/vendors/${id}/menus`).then((r) => r.json()),
    itemOptions: (id) => fetch(`/api/items/${id}/options`).then((r) => r.json()),
    reviews: (id) => fetch(`/api/vendors/${id}/reviews`).then((r) => r.json()),
    postReview: (id, p) => fetch(`/api/vendors/${id}/reviews`, post(p)).then((r) => r.json()),
    loyalty: (id) => fetch(`/api/vendors/${id}/loyalty`).then((r) => r.json()),
    postReservation: (id, p) => fetch(`/api/vendors/${id}/reservations`, post(p)).then((r) => r.json()),
    createOrder: (p) => fetch('/api/orders', post(p)).then((r) => r.json()),
    order: (id) => fetch(`/api/orders/${id}`).then((r) => r.json()),
    orderStatus: (id, p) => fetch(`/api/orders/${id}/status`, post(p)).then((r) => r.json()),
    login: (p) => fetch('/api/auth/login', post(p)).then((r) => r.json()),
    groupStart: (vendor_id) => fetch('/api/group/start', post({ vendor_id })).then((r) => r.json()),
    group: (code) => fetch(`/api/group/${code}`).then((r) => r.json()),
    groupAdd: (code, p) => fetch(`/api/group/${code}/add`, post(p)).then((r) => r.json()),
    groupSubmit: (code, p) => fetch(`/api/group/${code}/submit`, post(p)).then((r) => r.json()),
  }
  function post(p) { return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) } }

  // ---------- state ----------
  const state = {
    vendors: [],
    vendorsLoaded: false,
    mode: store.get('menu_mode', 'delivery'), // delivery | pickup
    address: store.get('menu_address', '1226 University Dr'),
    filters: { q: '', cat: '', offers: false, freeDelivery: false, under30: false, topRated: false, favs: false, sort: 'rating' },
    cart: store.get('menu_cart_v2', { vendor_id: null, vendor_name: '', items: [] }),
    favs: new Set(store.get('menu_favs', [])),
    myOrders: store.get('menu_orders', []),
    user: store.get('menu_user', null),
    checkout: { speed: 'standard', tipPct: 0.15, tipCustom: null, promo: '', usePoints: false, points: 0 },
    trackTimer: null,
    vendorCache: {},
  }
  const saveCart = () => { store.set('menu_cart_v2', state.cart); renderHeaderCart() }
  const cartCount = () => state.cart.items.reduce((s, i) => s + i.qty, 0)
  const cartSubtotal = () => state.cart.items.reduce((s, i) => s + i.line_total, 0)

  // Address from landing form (?addr=)
  try {
    const addr = new URLSearchParams(location.search).get('addr')
    if (addr && addr.trim()) { state.address = addr.trim(); store.set('menu_address', state.address) }
  } catch {}

  // ---------- toast ----------
  function toast(msg, icon) {
    let wrap = $('.toast-wrap')
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap) }
    const t = document.createElement('div')
    t.className = 'toast'
    t.innerHTML = `${icon ? `<i class="${icon}"></i>` : ''}<span>${esc(msg)}</span>`
    wrap.appendChild(t)
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320) }, 2200)
  }

  // ---------- shell ----------
  function renderShell() {
    root.innerHTML = `
      <header class="app-header">
        <div class="max-w-7xl mx-auto px-4 md:px-6 h-[72px] flex items-center gap-3 md:gap-5">
          <a href="/" class="text-2xl font-extrabold tracking-tight shrink-0">Menu<span style="color:var(--brand)">.</span></a>
          <div class="seg hidden md:inline-flex" id="mode-seg">
            <button data-mode="delivery" class="${state.mode === 'delivery' ? 'active' : ''}">Delivery</button>
            <button data-mode="pickup" class="${state.mode === 'pickup' ? 'active' : ''}">Pickup</button>
          </div>
          <button id="addr-btn" class="hidden lg:inline-flex items-center gap-2 text-sm font-bold hover:bg-gray-100 rounded-full px-3 py-2 max-w-[220px]">
            <i class="fa-solid fa-location-dot"></i>
            <span class="truncate">${esc(state.address)}</span>
            <span class="text-gray-400 font-medium shrink-0">• Now</span>
            <i class="fa-solid fa-chevron-down text-xs text-gray-400"></i>
          </button>
          <div class="search-input">
            <i class="fa-solid fa-magnifying-glass text-gray-500"></i>
            <input id="global-search" placeholder="Search Menu" value="${esc(state.filters.q)}" autocomplete="off" />
          </div>
          <button id="orders-btn" class="hidden md:inline-flex items-center gap-2 text-sm font-bold hover:bg-gray-100 rounded-full px-4 py-2.5 shrink-0"><i class="fa-solid fa-receipt"></i> Orders</button>
          ${state.user
            ? `<button id="user-btn" class="w-11 h-11 rounded-full bg-gray-900 text-white font-extrabold shrink-0" title="${esc(state.user.email)}">${esc((state.user.email || 'U')[0].toUpperCase())}</button>`
            : `<button id="signin-btn" class="btn btn-ghost btn-sm shrink-0" style="height:44px">Sign in</button>`}
          <button id="cart-btn" class="cart-btn shrink-0"><i class="fa-solid fa-cart-shopping"></i><span class="count" id="cart-count">${cartCount()}</span></button>
        </div>
      </header>
      <main id="view"></main>
      <div id="drawer-root"></div>
      <div id="modal-root"></div>
    `
    $('#mode-seg')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]')
      if (!b) return
      state.mode = b.dataset.mode
      store.set('menu_mode', state.mode)
      $$('#mode-seg button').forEach((x) => x.classList.toggle('active', x === b))
      if (currentRoute().name === 'feed') renderFeed()
    })
    $('#addr-btn')?.addEventListener('click', () => {
      const a = prompt('Delivery address', state.address)
      if (a && a.trim()) { state.address = a.trim(); store.set('menu_address', state.address); renderShell(); route() }
    })
    $('#global-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        state.filters.q = e.target.value.trim()
        location.hash = '#/'
        renderFeed()
      }
    })
    $('#orders-btn')?.addEventListener('click', () => { location.hash = '#/orders' })
    $('#cart-btn').addEventListener('click', openCartDrawer)
    $('#signin-btn')?.addEventListener('click', openSignInModal)
    $('#user-btn')?.addEventListener('click', () => {
      if (confirm('Sign out?')) { state.user = null; store.set('menu_user', null); renderShell(); route() }
    })
  }
  function renderHeaderCart() { const el = $('#cart-count'); if (el) el.textContent = cartCount() }

  // ---------- data ----------
  async function loadVendors() {
    if (state.vendorsLoaded) return state.vendors
    const data = await api.vendors('')
    state.vendors = data.vendors || []
    state.vendorsLoaded = true
    return state.vendors
  }

  // ---------- store card ----------
  function storeCardHTML(v, opts) {
    const fixed = opts && opts.fixedWidth
    const eta = state.mode === 'pickup' ? `${Math.max(10, (v.eta_min || 15) - 5)} min` : `${v.eta_min || 20}–${v.eta_max || 35} min`
    const fee = state.mode === 'pickup' ? 'Pickup ready' : feeLabel(v)
    const feeCls = state.mode !== 'pickup' && Number(v.delivery_fee_cents || 0) === 0 ? 'money-green' : 'text-gray-500'
    return `
      <div class="store-card ${fixed ? 'shrink-0 w-[300px]' : ''}" data-store="${v.id}">
        <div class="img-wrap">
          ${v.promo_text ? `<span class="badge-img">${esc(v.promo_text)}</span>` : ''}
          <button class="heart-btn ${state.favs.has(v.id) ? 'faved' : ''}" data-fav="${v.id}" title="Favorite">
            <i class="fa-${state.favs.has(v.id) ? 'solid' : 'regular'} fa-heart"></i>
          </button>
          <img class="cover" src="${esc(v.image_url || '')}" alt="${esc(v.org_name)}" loading="lazy" data-emoji="${emojiFor(v)}" onerror="__imgFail(this)" />
        </div>
        <div class="mt-2.5 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="font-bold text-[16px] leading-snug truncate">${esc(v.org_name)}</div>
            <div class="text-[13.5px] text-gray-500 mt-0.5">
              <span class="font-bold text-gray-900">${Number(v.rating_avg || 0).toFixed(1)}</span>
              <i class="fa-solid fa-star star text-xs"></i>
              <span>(${fmtCount(v.rating_count || 0)})</span>
              <span class="mx-1">•</span><span>${esc(v.cuisine || v.type)}</span>
              <span class="mx-1">•</span><span>${priceRange(v.price_range)}</span>
            </div>
            <div class="text-[13.5px] mt-0.5"><span class="${feeCls} font-semibold">${fee}</span><span class="text-gray-500"> • ${eta}</span></div>
          </div>
        </div>
      </div>`
  }
  function bindStoreCards(container) {
    $$('.store-card', container).forEach((card) => {
      card.addEventListener('click', (e) => {
        const favBtn = e.target.closest('[data-fav]')
        if (favBtn) {
          e.stopPropagation()
          const id = Number(favBtn.dataset.fav)
          if (state.favs.has(id)) { state.favs.delete(id); toast('Removed from favorites') }
          else { state.favs.add(id); toast('Added to favorites', 'fa-solid fa-heart') }
          store.set('menu_favs', Array.from(state.favs))
          favBtn.classList.toggle('faved', state.favs.has(id))
          favBtn.innerHTML = `<i class="fa-${state.favs.has(id) ? 'solid' : 'regular'} fa-heart"></i>`
          return
        }
        location.hash = `#/store/${card.dataset.store}`
      })
    })
  }

  // ---------- FEED ----------
  async function renderFeed() {
    const view = $('#view')
    view.innerHTML = `
      <div class="max-w-7xl mx-auto px-4 md:px-6 py-5">
        <div class="cat-row" id="cat-row"></div>
        <div class="flex items-center gap-2 overflow-x-auto py-3" id="filter-row" style="scrollbar-width:none"></div>
        <div id="feed-body">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-4">
            ${Array(8).fill(0).map(() => `<div><div class="skel" style="aspect-ratio:16/9"></div><div class="skel h-4 w-3/4 mt-3"></div><div class="skel h-3 w-1/2 mt-2"></div></div>`).join('')}
          </div>
        </div>
      </div>`

    // categories
    $('#cat-row').innerHTML = CATEGORIES.map(([name, emoji]) => `
      <button class="cat-item ${state.filters.cat === name || (name === 'Offers' && state.filters.offers) ? 'active' : ''}" data-cat="${esc(name)}">
        <span class="cat-emoji">${emoji}</span><span class="cat-label">${esc(name)}</span>
      </button>`).join('')
    $('#cat-row').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]')
      if (!b) return
      const name = b.dataset.cat
      if (name === 'Offers') { state.filters.offers = !state.filters.offers }
      else { state.filters.cat = state.filters.cat === name ? '' : name }
      renderFeed()
    })

    // filter chips
    const f = state.filters
    $('#filter-row').innerHTML = `
      <button class="chip ${f.offers ? 'active' : ''}" data-f="offers"><i class="fa-solid fa-tag"></i> Offers</button>
      <button class="chip ${f.freeDelivery ? 'active' : ''}" data-f="freeDelivery">$0 Delivery Fee</button>
      <button class="chip ${f.under30 ? 'active' : ''}" data-f="under30">Under 30 min</button>
      <button class="chip ${f.topRated ? 'active' : ''}" data-f="topRated">Over 4.5 <i class="fa-solid fa-star star text-xs"></i></button>
      <button class="chip ${f.favs ? 'active' : ''}" data-f="favs"><i class="fa-solid fa-heart"></i> Favorites</button>
      <button class="chip" data-f="sort"><i class="fa-solid fa-arrow-down-wide-short"></i> Sort: ${f.sort === 'rating' ? 'Rating' : f.sort === 'eta' ? 'Fastest' : 'Delivery fee'}</button>
      ${f.q || f.cat || f.offers || f.freeDelivery || f.under30 || f.topRated || f.favs ? '<button class="chip" data-f="reset" style="background:#fff;box-shadow:inset 0 0 0 1px var(--line)">Reset ✕</button>' : ''}
    `
    $('#filter-row').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]')
      if (!b) return
      const k = b.dataset.f
      if (k === 'reset') {
        state.filters = { q: '', cat: '', offers: false, freeDelivery: false, under30: false, topRated: false, favs: false, sort: 'rating' }
        const gs = $('#global-search'); if (gs) gs.value = ''
      } else if (k === 'sort') {
        state.filters.sort = f.sort === 'rating' ? 'eta' : f.sort === 'eta' ? 'fee' : 'rating'
      } else state.filters[k] = !state.filters[k]
      renderFeed()
    })

    await loadVendors()
    let list = state.vendors.slice()
    if (f.q) {
      const q = f.q.toLowerCase()
      list = list.filter((v) => v.org_name.toLowerCase().includes(q) || (v.cuisine || '').toLowerCase().includes(q) || (v.type || '').toLowerCase().includes(q))
    }
    if (f.cat) list = list.filter((v) => (v.cuisine || '') === f.cat)
    if (f.offers) list = list.filter((v) => !!v.promo_text)
    if (f.freeDelivery) list = list.filter((v) => Number(v.delivery_fee_cents || 0) === 0)
    if (f.under30) list = list.filter((v) => Number(v.eta_max || 99) <= 30)
    if (f.topRated) list = list.filter((v) => Number(v.rating_avg || 0) >= 4.5)
    if (f.favs) list = list.filter((v) => state.favs.has(v.id))
    if (state.mode === 'pickup') list = list.filter((v) => !v.service_modes || v.service_modes.pickup !== false)
    if (f.sort === 'eta') list.sort((a, b) => (a.eta_max || 99) - (b.eta_max || 99))
    else if (f.sort === 'fee') list.sort((a, b) => (a.delivery_fee_cents || 0) - (b.delivery_fee_cents || 0))
    else list.sort((a, b) => (b.rating_avg || 0) - (a.rating_avg || 0))

    const body = $('#feed-body')
    const isFiltered = f.q || f.cat || f.offers || f.freeDelivery || f.under30 || f.topRated || f.favs

    if (isFiltered) {
      body.innerHTML = `
        <div class="flex items-baseline justify-between mt-2 mb-4">
          <h2 class="text-xl md:text-2xl font-extrabold tracking-tight">${list.length} result${list.length === 1 ? '' : 's'}${f.q ? ` for “${esc(f.q)}”` : ''}${f.cat ? ` in ${esc(f.cat)}` : ''}</h2>
        </div>
        ${list.length ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8">${list.map((v) => storeCardHTML(v)).join('')}</div>`
          : `<div class="text-center py-20"><div class="text-5xl mb-4">🔍</div><div class="text-xl font-bold">No matches found</div><p class="text-gray-500 mt-1">Try a different search or clear your filters.</p></div>`}
      `
      bindStoreCards(body)
      return
    }

    const offers = list.filter((v) => v.promo_text)
    const fastest = list.slice().sort((a, b) => (a.eta_max || 99) - (b.eta_max || 99)).slice(0, 8)
    const featured = list.slice().sort((a, b) => (b.rating_avg || 0) - (a.rating_avg || 0)).slice(0, 8)

    body.innerHTML = `
      <h1 class="text-2xl md:text-[28px] font-extrabold tracking-tight mt-2">Crave it? Get it.</h1>
      <p class="text-gray-500 text-[15px] mt-0.5">Restaurants, trucks, home chefs and bakeries near <span class="font-semibold text-gray-800">${esc(state.address)}</span></p>

      <div class="grid md:grid-cols-2 gap-4 mt-6">
        <div class="rounded-2xl p-6 md:p-7 flex items-center justify-between overflow-hidden relative" style="background:linear-gradient(120deg,#EB1700,#FF5A3C)">
          <div class="text-white relative z-10">
            <div class="text-xl md:text-2xl font-extrabold">20% off your first order</div>
            <div class="text-white/85 text-sm mt-1">Use code <b>SAVE10</b> at checkout • up to $5</div>
            <button class="mt-4 bg-white text-gray-900 text-sm font-bold rounded-full px-5 py-2.5" data-promo-cta>Order now</button>
          </div>
          <div class="text-[90px] leading-none select-none relative z-10 hidden sm:block">🍕</div>
        </div>
        <div class="rounded-2xl p-6 md:p-7 flex items-center justify-between overflow-hidden relative" style="background:#191919">
          <div class="text-white relative z-10">
            <div class="flex items-center gap-2"><span class="text-xl md:text-2xl font-extrabold">Menu<span style="color:#F5A623">+</span></span></div>
            <div class="text-white/80 text-sm mt-1">$0 Delivery Fee on eligible stores near you</div>
            <button class="mt-4 text-sm font-bold rounded-full px-5 py-2.5" style="background:#F5A623;color:#191919" data-plus-cta>Try free for 4 weeks</button>
          </div>
          <div class="text-[90px] leading-none select-none relative z-10 hidden sm:block">✨</div>
        </div>
      </div>

      ${carouselHTML('offers-row', 'Top offers for you', offers)}
      ${carouselHTML('featured-row', 'Featured on Menu', featured)}
      ${carouselHTML('fastest-row', 'Fastest near you', fastest)}

      <div class="flex items-baseline justify-between mt-10 mb-4">
        <h2 class="text-xl md:text-2xl font-extrabold tracking-tight">All stores</h2>
        <span class="text-sm text-gray-500">${list.length} stores</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8" id="all-grid">
        ${list.map((v) => storeCardHTML(v)).join('')}
      </div>
    `
    bindStoreCards(body)
    bindCarousels(body)
    $('[data-promo-cta]')?.addEventListener('click', () => { state.filters.offers = true; renderFeed() })
    $('[data-plus-cta]')?.addEventListener('click', () => { state.filters.freeDelivery = true; renderFeed() })
  }

  function carouselHTML(id, title, vendors) {
    if (!vendors.length) return ''
    return `
      <div class="mt-10">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl md:text-2xl font-extrabold tracking-tight">${esc(title)}</h2>
          <div class="flex gap-2">
            <button class="paddle" data-scroll="-1" data-target="${id}"><i class="fa-solid fa-chevron-left text-sm"></i></button>
            <button class="paddle" data-scroll="1" data-target="${id}"><i class="fa-solid fa-chevron-right text-sm"></i></button>
          </div>
        </div>
        <div class="h-scroll" id="${id}">${vendors.map((v) => storeCardHTML(v, { fixedWidth: true })).join('')}</div>
      </div>`
  }
  function bindCarousels(container) {
    $$('[data-scroll]', container).forEach((b) => {
      b.addEventListener('click', () => {
        const el = $('#' + b.dataset.target)
        if (el) el.scrollBy({ left: Number(b.dataset.scroll) * 640, behavior: 'smooth' })
      })
    })
  }

  // ---------- STORE PAGE ----------
  async function renderStore(id) {
    const view = $('#view')
    view.innerHTML = `<div class="max-w-6xl mx-auto px-4 md:px-6 py-6">
      <div class="skel w-full" style="height:280px;border-radius:16px"></div>
      <div class="skel h-8 w-1/3 mt-6"></div><div class="skel h-4 w-1/2 mt-3"></div>
    </div>`
    const [vd, md, rd, ld] = await Promise.all([api.vendor(id), api.menus(id), api.reviews(id), api.loyalty(id)])
    const v = vd.vendor
    state.vendorCache[id] = v
    const sections = (md.sections || []).filter((s) => (s.items || []).length)
    const allItems = sections.flatMap((s) => s.items || [])
    const popular = allItems.filter((i) => i.is_popular).slice(0, 8)
    const reviews = rd.reviews || []
    const points = ld.points || 0
    const emoji = emojiFor(v)
    const isOpen = v.open_now

    view.innerHTML = `
      <div class="max-w-6xl mx-auto px-4 md:px-6 pt-6 pb-24">
        <!-- hero -->
        <div class="relative rounded-2xl overflow-hidden" style="height:min(320px,32vw + 140px)">
          <img src="${esc(v.image_url || '')}" class="w-full h-full object-cover" data-emoji="${emoji}" onerror="__imgFail(this)" alt="${esc(v.org_name)}" />
          <div class="absolute inset-0" style="background:linear-gradient(180deg,transparent 55%,rgba(0,0,0,.35))"></div>
          <div class="absolute top-4 right-4 flex gap-2">
            <button class="icon-btn on-img" id="store-fav"><i class="fa-${state.favs.has(v.id) ? 'solid' : 'regular'} fa-heart ${state.favs.has(v.id) ? '' : ''}" ${state.favs.has(v.id) ? 'style="color:var(--brand)"' : ''}></i></button>
            <button class="icon-btn on-img" id="store-more"><i class="fa-solid fa-ellipsis"></i></button>
          </div>
          <div class="absolute -bottom-0 left-6 translate-y-0 flex items-end pb-4">
            <div class="w-20 h-20 rounded-full bg-white shadow-xl flex items-center justify-center text-4xl border-4 border-white">${emoji}</div>
          </div>
        </div>

        <!-- title & meta -->
        <div class="mt-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight">${esc(v.org_name)}</h1>
            <div class="mt-1.5 text-[15px] text-gray-600">
              <span class="font-bold text-gray-900">${Number(v.rating_avg || 0).toFixed(1)}</span>
              <i class="fa-solid fa-star star text-sm"></i>
              <span>(${fmtCount(v.rating_count || 0)})</span>
              <span class="mx-1.5">•</span>${esc(v.cuisine || v.type)}
              <span class="mx-1.5">•</span>${priceRange(v.price_range)}
              <span class="mx-1.5">•</span>
              <span class="${isOpen ? 'money-green' : ''}" style="${isOpen ? '' : 'color:var(--promo-red);font-weight:700'}">${isOpen ? 'Open now' : 'Closed'}</span>
              ${points ? `<span class="mx-1.5">•</span><span class="badge-neutral"><i class="fa-solid fa-gem" style="color:var(--brand)"></i> ${points} points</span>` : ''}
            </div>
            ${v.promo_text ? `<div class="mt-2"><span class="badge-promo"><i class="fa-solid fa-tag"></i> ${esc(v.promo_text)}</span></div>` : ''}
          </div>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" id="store-group"><i class="fa-solid fa-user-group"></i> Group order</button>
            ${(v.service_modes && v.service_modes.dinein) ? '<button class="btn btn-ghost btn-sm" id="store-reserve"><i class="fa-solid fa-calendar-check"></i> Reserve</button>' : ''}
          </div>
        </div>

        <!-- fulfillment card -->
        <div class="mt-5 border rounded-2xl p-4 flex flex-wrap items-center gap-4" style="border-color:var(--line)">
          <div class="seg" id="store-mode">
            <button data-mode="delivery" class="${state.mode === 'delivery' ? 'active' : ''}">Delivery</button>
            <button data-mode="pickup" class="${state.mode === 'pickup' ? 'active' : ''}">Pickup</button>
          </div>
          <div class="flex items-center divide-x" style="--tw-divide-opacity:1">
            <div class="px-5 text-center">
              <div class="font-extrabold text-[15px] ${Number(v.delivery_fee_cents || 0) === 0 && state.mode === 'delivery' ? 'money-green' : ''}">${state.mode === 'pickup' ? '$0.00' : money(v.delivery_fee_cents || 0)}</div>
              <div class="text-xs text-gray-500">${state.mode === 'pickup' ? 'no fees' : 'delivery fee'}</div>
            </div>
            <div class="px-5 text-center">
              <div class="font-extrabold text-[15px]">${state.mode === 'pickup' ? Math.max(10, (v.eta_min || 15) - 5) : (v.eta_min || 20) + '–' + (v.eta_max || 35)} min</div>
              <div class="text-xs text-gray-500">earliest arrival</div>
            </div>
          </div>
        </div>

        ${popular.length ? `
        <div class="mt-8">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl md:text-2xl font-extrabold tracking-tight">Featured items</h2>
            <div class="flex gap-2">
              <button class="paddle" data-scroll="-1" data-target="pop-row"><i class="fa-solid fa-chevron-left text-sm"></i></button>
              <button class="paddle" data-scroll="1" data-target="pop-row"><i class="fa-solid fa-chevron-right text-sm"></i></button>
            </div>
          </div>
          <div class="h-scroll" id="pop-row">
            ${popular.map((it, idx) => `
              <div class="shrink-0 w-[220px] cursor-pointer group" data-item="${it.id}">
                <div class="relative rounded-xl overflow-hidden" style="aspect-ratio:1/.82;background:linear-gradient(135deg,#f6f6f6,#ececec)">
                  ${idx < 3 ? `<span class="absolute top-2.5 left-2.5 z-10 text-xs font-bold text-white rounded px-2 py-1" style="background:var(--green)">#${idx + 1} most liked</span>` : ''}
                  ${it.photo ? `<img src="${esc(it.photo)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" style="transition-duration:.3s" data-emoji="${emoji}" onerror="__imgFail(this)" alt="${esc(it.name)}" />` : `<div class="food-fallback">${emoji}</div>`}
                  <button class="quick-add" data-item="${it.id}" data-quick="1"><i class="fa-solid fa-plus"></i></button>
                </div>
                <div class="mt-2 font-bold text-[15px] line-clamp-1">${esc(it.name)}</div>
                <div class="text-sm text-gray-500">${money(it.base_price)}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}

        <!-- section tabs -->
        <div class="sticky z-30 bg-white -mx-4 md:-mx-6 px-4 md:px-6 mt-8" style="top:72px">
          <div class="tab-row" id="section-tabs">
            ${sections.map((s, i) => `<button data-tab="${s.id}" class="${i === 0 ? 'active' : ''}">${esc(s.name)}</button>`).join('')}
            <button data-tab="reviews-sec">Reviews</button>
          </div>
        </div>

        <!-- sections -->
        <div id="menu-sections">
          ${sections.map((s) => `
            <section class="pt-8" id="sec-${s.id}" data-section>
              <h2 class="text-xl md:text-2xl font-extrabold tracking-tight mb-4">${esc(s.name)}</h2>
              <div class="grid md:grid-cols-2 gap-4">
                ${(s.items || []).map((it) => `
                  <div class="menu-item-row" data-item="${it.id}">
                    <div class="min-w-0 py-1">
                      <div class="font-bold text-[16px]">${esc(it.name)}</div>
                      ${it.description ? `<div class="text-sm text-gray-500 mt-1 line-clamp-2">${esc(it.description)}</div>` : ''}
                      <div class="mt-2 text-[15px] font-semibold">${money(it.base_price)}
                        ${it.is_popular ? `<span class="ml-2 text-xs font-bold" style="color:var(--green)"><i class="fa-solid fa-thumbs-up"></i> Popular</span>` : ''}
                      </div>
                    </div>
                    <div class="menu-item-thumb">
                      ${it.photo ? `<img src="${esc(it.photo)}" data-emoji="${emoji}" onerror="__imgFail(this)" alt="${esc(it.name)}" />` : `<div class="food-fallback">${emoji}</div>`}
                      <button class="quick-add" data-item="${it.id}" data-quick="1"><i class="fa-solid fa-plus"></i></button>
                    </div>
                  </div>`).join('')}
              </div>
            </section>`).join('')}

          <!-- reviews -->
          <section class="pt-10" id="sec-reviews-sec" data-section>
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-xl md:text-2xl font-extrabold tracking-tight">Reviews</h2>
              <button class="btn btn-ghost btn-sm" id="add-review"><i class="fa-solid fa-pen"></i> Add a review</button>
            </div>
            <div class="flex items-center gap-3 mb-6">
              <div class="text-4xl font-extrabold">${Number(v.rating_avg || 0).toFixed(1)}</div>
              <div>
                <div>${starsHTML(Math.round(v.rating_avg || 0))}</div>
                <div class="text-sm text-gray-500 mt-0.5">${fmtCount(v.rating_count || 0)} ratings</div>
              </div>
            </div>
            <div class="grid md:grid-cols-2 gap-4" id="reviews-list">
              ${reviews.length ? reviews.map((r) => reviewCardHTML(r)).join('') : '<div class="text-gray-500 text-sm">No reviews yet — be the first!</div>'}
            </div>
          </section>
        </div>
      </div>`

    // bindings
    $('#store-fav').addEventListener('click', () => {
      if (state.favs.has(v.id)) { state.favs.delete(v.id); toast('Removed from favorites') } else { state.favs.add(v.id); toast('Added to favorites', 'fa-solid fa-heart') }
      store.set('menu_favs', Array.from(state.favs))
      $('#store-fav').innerHTML = `<i class="fa-${state.favs.has(v.id) ? 'solid' : 'regular'} fa-heart" ${state.favs.has(v.id) ? 'style="color:var(--brand)"' : ''}></i>`
    })
    $('#store-more').addEventListener('click', () => openStoreInfoModal(v, vd.locations || []))
    $('#store-group').addEventListener('click', async () => {
      const res = await api.groupStart(v.id)
      if (res.code) { toast('Group order started', 'fa-solid fa-user-group'); location.hash = `#/group/${res.code}` }
    })
    $('#store-reserve')?.addEventListener('click', () => openReservationModal(v))
    $('#store-mode').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]')
      if (!b) return
      state.mode = b.dataset.mode
      store.set('menu_mode', state.mode)
      renderStore(id)
    })
    $('#add-review').addEventListener('click', () => openReviewModal(v, () => renderStore(id)))
    bindCarousels(view)

    // item clicks (rows, featured, quick-add)
    view.addEventListener('click', (e) => {
      const quick = e.target.closest('[data-quick]')
      const itemEl = e.target.closest('[data-item]')
      if (!itemEl) return
      const itemId = Number(itemEl.dataset.item)
      const item = allItems.find((i) => i.id === itemId)
      if (!item) return
      e.stopPropagation()
      openItemModal(v, item, { quick: !!quick })
    })

    // tabs scrollspy
    const tabs = $('#section-tabs')
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]')
      if (!b) return
      const target = $(`#sec-${b.dataset.tab}`)
      if (target) {
        const y = target.getBoundingClientRect().top + window.scrollY - 130
        window.scrollTo({ top: y, behavior: 'smooth' })
      }
    })
    const sectionEls = $$('[data-section]', view)
    const spy = () => {
      let active = sectionEls[0] && sectionEls[0].id
      for (const s of sectionEls) { if (s.getBoundingClientRect().top - 140 <= 0) active = s.id }
      $$('#section-tabs button').forEach((b) => b.classList.toggle('active', `sec-${b.dataset.tab}` === active))
    }
    window.removeEventListener('scroll', state._spy || (() => {}))
    state._spy = spy
    window.addEventListener('scroll', spy, { passive: true })
  }

  function starsHTML(n) {
    return Array(5).fill(0).map((_, i) => `<i class="fa-solid fa-star ${i < n ? 'star' : 'text-gray-200'} text-sm"></i>`).join('')
  }
  function reviewCardHTML(r) {
    const initial = (r.author_name || 'M')[0].toUpperCase()
    const date = r.created_at ? new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
    return `
      <div class="border rounded-2xl p-4" style="border-color:var(--line)">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-white" style="background:var(--green)">${esc(initial)}</div>
          <div>
            <div class="font-bold text-sm">${esc(r.author_name || 'Menu Customer')}</div>
            <div class="flex items-center gap-2">${starsHTML(r.rating)} <span class="text-xs text-gray-400">${esc(date)}</span></div>
          </div>
        </div>
        ${r.text ? `<p class="mt-3 text-sm text-gray-700 leading-relaxed">${esc(r.text)}</p>` : ''}
      </div>`
  }

  // ---------- MODALS ----------
  function openModal(html, maxWidth) {
    const rootEl = $('#modal-root')
    rootEl.innerHTML = `<div class="overlay" id="modal-overlay"><div class="modal" style="max-width:${maxWidth || '560px'}">${html}</div></div>`
    $('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal() })
    document.body.style.overflow = 'hidden'
    return rootEl
  }
  function closeModal() { $('#modal-root').innerHTML = ''; document.body.style.overflow = '' }

  async function openItemModal(vendor, item, opts) {
    const emoji = emojiFor(vendor)
    openModal(`
      <div class="modal-body">
        <div class="grid ${item.photo ? 'md:grid-cols-2' : ''}">
          ${item.photo ? `<div class="relative" style="min-height:280px"><img src="${esc(item.photo)}" class="absolute inset-0 w-full h-full object-cover" data-emoji="${emoji}" onerror="__imgFail(this)" alt="${esc(item.name)}" /></div>` : ''}
          <div class="p-6">
            <div class="flex items-start justify-between gap-3">
              <h2 class="text-2xl font-extrabold tracking-tight">${esc(item.name)}</h2>
              <button class="icon-btn shrink-0" id="modal-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="mt-1 text-lg font-bold">${money(item.base_price)}</div>
            ${item.is_popular ? `<div class="mt-1"><span class="text-xs font-bold rounded-full px-2.5 py-1" style="background:var(--green-tint);color:var(--green)"><i class="fa-solid fa-thumbs-up"></i> Popular</span></div>` : ''}
            ${item.description ? `<p class="mt-3 text-sm text-gray-600 leading-relaxed">${esc(item.description)}</p>` : ''}
            <div id="opt-groups" class="mt-5"><div class="skel h-16 w-full"></div></div>
            <div class="mt-5">
              <div class="font-bold text-sm mb-2">Special instructions <span class="text-gray-400 font-medium">(optional)</span></div>
              <textarea id="item-note" rows="2" class="w-full text-sm rounded-xl p-3 outline-none" style="background:var(--fill)" placeholder="Add a note (allergies, extra sauce...)"></textarea>
            </div>
          </div>
        </div>
      </div>
      <div class="p-4 flex items-center gap-3 border-t" style="border-color:var(--line)">
        <div class="stepper shrink-0">
          <button id="qty-dec"><i class="fa-solid fa-minus"></i></button>
          <span class="qty" id="qty-val">1</span>
          <button id="qty-inc"><i class="fa-solid fa-plus"></i></button>
        </div>
        <button class="btn btn-primary flex-1" id="add-to-cart" style="height:52px">Add 1 to cart • ${money(item.base_price)}</button>
      </div>
    `, item.photo ? '900px' : '560px')

    $('#modal-close').addEventListener('click', closeModal)
    let qty = 1
    const selected = {} // groupId -> Set(optionIds)
    let groups = []
    try {
      const od = await api.itemOptions(item.id)
      groups = od.groups || []
    } catch {}
    const optEl = $('#opt-groups')
    if (!optEl) return
    optEl.innerHTML = groups.map((g) => `
      <div class="mb-4">
        <div class="flex items-center justify-between">
          <div class="font-bold">${esc(g.name)}</div>
          ${g.required ? '<span class="badge-required"><i class="fa-solid fa-check"></i> Required</span>' : `<span class="text-xs text-gray-400 font-semibold">Optional • up to ${g.max}</span>`}
        </div>
        <div class="mt-1">
          ${(g.options || []).map((o) => `
            <div class="opt-row" data-group="${g.id}" data-opt="${o.id}" data-max="${g.max}" data-type="${g.max <= 1 ? 'radio' : 'check'}">
              <div class="flex items-center gap-3">
                <span class="${g.max <= 1 ? 'radio-dot' : 'check-box'}"><i class="fa-solid fa-check"></i></span>
                <span class="text-[15px]">${esc(o.name)}</span>
              </div>
              ${o.price_delta ? `<span class="text-sm text-gray-500">+${money(o.price_delta)}</span>` : ''}
            </div>`).join('')}
        </div>
      </div>`).join('')

    groups.forEach((g) => { selected[g.id] = new Set() })
    const optionPrice = () => {
      let sum = 0
      for (const g of groups) for (const o of g.options || []) if (selected[g.id] && selected[g.id].has(o.id)) sum += o.price_delta || 0
      return sum
    }
    const unit = () => item.base_price + optionPrice()
    const refreshCTA = () => {
      const missing = groups.some((g) => g.required && (!selected[g.id] || selected[g.id].size < Math.max(1, g.min)))
      const btn = $('#add-to-cart')
      btn.textContent = `Add ${qty} to cart • ${money(unit() * qty)}`
      btn.disabled = missing
    }
    optEl.addEventListener('click', (e) => {
      const row = e.target.closest('.opt-row')
      if (!row) return
      const gid = Number(row.dataset.group), oid = Number(row.dataset.opt), max = Number(row.dataset.max)
      const set = selected[gid]
      if (row.dataset.type === 'radio') {
        set.clear(); set.add(oid)
        $$(`.opt-row[data-group="${gid}"]`, optEl).forEach((r) => r.classList.toggle('selected', Number(r.dataset.opt) === oid))
      } else {
        if (set.has(oid)) set.delete(oid)
        else if (set.size < max) set.add(oid)
        else { toast(`Select up to ${max}`); return }
        row.classList.toggle('selected', set.has(oid))
      }
      refreshCTA()
    })
    $('#qty-inc').addEventListener('click', () => { qty++; $('#qty-val').textContent = qty; refreshCTA() })
    $('#qty-dec').addEventListener('click', () => { if (qty > 1) { qty--; $('#qty-val').textContent = qty; refreshCTA() } })
    refreshCTA()

    $('#add-to-cart').addEventListener('click', () => {
      // cart is per-store
      if (state.cart.vendor_id && state.cart.vendor_id !== vendor.id && state.cart.items.length) {
        if (!confirm(`Start a new cart? Your cart from ${state.cart.vendor_name} will be cleared.`)) return
        state.cart = { vendor_id: null, vendor_name: '', items: [] }
      }
      const optIds = groups.flatMap((g) => Array.from(selected[g.id] || []))
      const optNames = []
      for (const g of groups) for (const o of g.options || []) if (selected[g.id] && selected[g.id].has(o.id)) optNames.push(o.name)
      const note = ($('#item-note') && $('#item-note').value.trim()) || ''
      const key = `${item.id}:${optIds.slice().sort().join(',')}:${note}`
      const existing = state.cart.items.find((i) => i.key === key)
      if (existing) { existing.qty += qty; existing.line_total = existing.unit_price * existing.qty }
      else state.cart.items.push({ key, item_id: item.id, name: item.name, photo: item.photo || null, qty, unit_price: unit(), line_total: unit() * qty, selected_options: optIds, option_names: optNames, note })
      state.cart.vendor_id = vendor.id
      state.cart.vendor_name = vendor.org_name
      saveCart()
      closeModal()
      toast(`Added to cart • ${money(unit() * qty)}`, 'fa-solid fa-cart-shopping')
    })
  }

  function openStoreInfoModal(v, locations) {
    const loc = locations[0] || {}
    openModal(`
      <div class="p-6">
        <div class="flex items-start justify-between">
          <h2 class="text-2xl font-extrabold tracking-tight">${esc(v.org_name)}</h2>
          <button class="icon-btn" id="modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="mt-1 text-sm text-gray-500">${esc(v.cuisine || v.type)} • ${priceRange(v.price_range)} • ${esc(v.type.replace('_', ' '))}</div>
        <div class="map-ph mt-4" style="height:150px">
          <div class="map-road" style="left:0;right:0;top:52%;height:14px"></div>
          <div class="map-road" style="top:0;bottom:0;left:32%;width:12px"></div>
          <div class="map-pin brand" style="left:32.5%;top:53%"><i class="fa-solid fa-store"></i></div>
        </div>
        <div class="mt-4 space-y-3 text-sm">
          <div class="flex items-center gap-3"><i class="fa-solid fa-location-dot text-gray-400 w-5"></i> ${esc(loc.address || '—')}, ${esc(loc.city || '')}</div>
          <div class="flex items-center gap-3"><i class="fa-regular fa-clock text-gray-400 w-5"></i> ${v.open_now ? '<span class="money-green">Open now</span>' : '<span style="color:var(--promo-red)">Closed</span>'} • Daily until late</div>
          <div class="flex items-center gap-3"><i class="fa-solid fa-star star w-5"></i> ${Number(v.rating_avg || 0).toFixed(1)} (${fmtCount(v.rating_count || 0)} ratings)</div>
          ${v.promo_text ? `<div class="flex items-center gap-3"><i class="fa-solid fa-tag w-5" style="color:var(--promo-red)"></i> <span class="badge-promo">${esc(v.promo_text)}</span></div>` : ''}
        </div>
      </div>`)
    $('#modal-close').addEventListener('click', closeModal)
  }

  function openReviewModal(v, onDone) {
    let rating = 5
    openModal(`
      <div class="p-6">
        <div class="flex items-start justify-between">
          <h2 class="text-2xl font-extrabold tracking-tight">Rate ${esc(v.org_name)}</h2>
          <button class="icon-btn" id="modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="mt-5 rounded-2xl p-5 text-center" style="background:var(--fill)">
          <div id="star-picker" class="text-3xl space-x-2 cursor-pointer">
            ${Array(5).fill(0).map((_, i) => `<i class="fa-solid fa-star star" data-star="${i + 1}"></i>`).join('')}
          </div>
        </div>
        <input id="rev-name" class="w-full mt-4 text-sm rounded-xl p-3 outline-none" style="background:var(--fill)" placeholder="Your name" value="${esc(state.user ? state.user.email.split('@')[0] : '')}" />
        <textarea id="rev-text" rows="3" class="w-full mt-3 text-sm rounded-xl p-3 outline-none" style="background:var(--fill)" placeholder="Share details about your experience..."></textarea>
        <button class="btn btn-brand btn-lg mt-4" id="rev-submit">Submit review</button>
      </div>`)
    $('#modal-close').addEventListener('click', closeModal)
    $('#star-picker').addEventListener('click', (e) => {
      const s = e.target.closest('[data-star]')
      if (!s) return
      rating = Number(s.dataset.star)
      $$('#star-picker i').forEach((el, i) => el.classList.toggle('star', i < rating), $$('#star-picker i').forEach((el, i) => el.classList.toggle('text-gray-300', i >= rating)))
    })
    $('#rev-submit').addEventListener('click', async () => {
      await api.postReview(v.id, { rating, text: $('#rev-text').value.trim(), author_name: $('#rev-name').value.trim() })
      closeModal(); toast('Review submitted — thank you!', 'fa-solid fa-star')
      onDone && onDone()
    })
  }

  function openReservationModal(v) {
    const today = new Date()
    const dateStr = today.toISOString().slice(0, 10)
    openModal(`
      <div class="p-6">
        <div class="flex items-start justify-between">
          <h2 class="text-2xl font-extrabold tracking-tight">Reserve a table</h2>
          <button class="icon-btn" id="modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="text-sm text-gray-500 mt-1">${esc(v.org_name)}</div>
        <div class="mt-5 grid grid-cols-2 gap-3">
          <div>
            <div class="font-bold text-sm mb-1.5">Date</div>
            <input type="date" id="res-date" min="${dateStr}" value="${dateStr}" class="w-full text-sm rounded-xl p-3 outline-none" style="background:var(--fill)" />
          </div>
          <div>
            <div class="font-bold text-sm mb-1.5">Time</div>
            <select id="res-time" class="w-full text-sm rounded-xl p-3 outline-none" style="background:var(--fill)">
              ${['17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'].map((t) => `<option ${t === '19:00' ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="mt-4">
          <div class="font-bold text-sm mb-1.5">Party size</div>
          <div class="stepper"><button id="res-dec"><i class="fa-solid fa-minus"></i></button><span class="qty" id="res-qty">2</span><button id="res-inc"><i class="fa-solid fa-plus"></i></button></div>
        </div>
        <textarea id="res-notes" rows="2" class="w-full mt-4 text-sm rounded-xl p-3 outline-none" style="background:var(--fill)" placeholder="Notes (occasion, seating preference...)"></textarea>
        <button class="btn btn-primary btn-lg mt-4" id="res-submit">Request reservation</button>
      </div>`)
    $('#modal-close').addEventListener('click', closeModal)
    let party = 2
    $('#res-inc').addEventListener('click', () => { party = Math.min(20, party + 1); $('#res-qty').textContent = party })
    $('#res-dec').addEventListener('click', () => { party = Math.max(1, party - 1); $('#res-qty').textContent = party })
    $('#res-submit').addEventListener('click', async () => {
      const dt = `${$('#res-date').value}T${$('#res-time').value}:00`
      await api.postReservation(v.id, { party_size: party, datetime_iso: dt, notes: $('#res-notes').value.trim() })
      closeModal(); toast('Reservation requested', 'fa-solid fa-calendar-check')
    })
  }

  function openSignInModal() {
    openModal(`
      <div class="p-6">
        <div class="flex items-start justify-between">
          <h2 class="text-2xl font-extrabold tracking-tight">Sign in or sign up</h2>
          <button class="icon-btn" id="modal-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <p class="text-sm text-gray-500 mt-1">Demo sign-in — just enter your email.</p>
        <input id="auth-email" type="email" class="w-full mt-5 text-[15px] rounded-xl p-3.5 outline-none" style="background:var(--fill)" placeholder="Email address" />
        <button class="btn btn-primary btn-lg mt-3" id="auth-go">Continue</button>
        <div class="flex items-center gap-3 my-4"><div class="divider flex-1"></div><span class="text-xs text-gray-400 font-semibold">or</span><div class="divider flex-1"></div></div>
        <button class="btn btn-outline btn-lg" disabled><i class="fa-brands fa-google"></i> Continue with Google</button>
        <button class="btn btn-outline btn-lg mt-2" disabled><i class="fa-brands fa-apple"></i> Continue with Apple</button>
      </div>`)
    $('#modal-close').addEventListener('click', closeModal)
    $('#auth-go').addEventListener('click', async () => {
      const email = $('#auth-email').value.trim()
      if (!email || !email.includes('@')) { toast('Enter a valid email'); return }
      const res = await api.login({ email })
      if (res.token) {
        state.user = { email, token: res.token }
        store.set('menu_user', state.user)
        closeModal(); renderShell(); route()
        toast(`Welcome, ${email.split('@')[0]}!`, 'fa-solid fa-circle-check')
      }
    })
  }

  // ---------- CART DRAWER ----------
  function openCartDrawer() {
    const dr = $('#drawer-root')
    const items = state.cart.items
    dr.innerHTML = `
      <div class="drawer-overlay" id="drawer-overlay"></div>
      <div class="drawer">
        <div class="p-5 flex items-center justify-between border-b" style="border-color:var(--line)">
          <button class="icon-btn" id="drawer-close"><i class="fa-solid fa-xmark"></i></button>
          <div class="font-extrabold text-lg">${items.length ? esc(state.cart.vendor_name) : 'Your cart'}</div>
          <span class="w-9"></span>
        </div>
        <div class="flex-1 overflow-y-auto p-5" id="drawer-body">
          ${items.length ? items.map((it, idx) => `
            <div class="flex gap-3 py-3 ${idx ? 'border-t' : ''}" style="border-color:var(--line)">
              <div class="w-16 h-16 rounded-lg overflow-hidden shrink-0" style="background:var(--fill)">
                ${it.photo ? `<img src="${esc(it.photo)}" class="w-full h-full object-cover" data-emoji="🍽️" onerror="__imgFail(this)" />` : '<div class="food-fallback" style="font-size:22px">🍽️</div>'}
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-bold text-[15px] line-clamp-1">${esc(it.name)}</div>
                ${it.option_names && it.option_names.length ? `<div class="text-xs text-gray-500 line-clamp-1">${esc(it.option_names.join(', '))}</div>` : ''}
                ${it.note ? `<div class="text-xs text-gray-400 line-clamp-1 italic">"${esc(it.note)}"</div>` : ''}
                <div class="text-sm font-semibold mt-1">${money(it.line_total)}</div>
              </div>
              <div class="stepper shrink-0 self-center" data-key="${esc(it.key)}">
                <button data-act="dec">${it.qty === 1 ? '<i class="fa-regular fa-trash-can"></i>' : '<i class="fa-solid fa-minus"></i>'}</button>
                <span class="qty">${it.qty}</span>
                <button data-act="inc"><i class="fa-solid fa-plus"></i></button>
              </div>
            </div>`).join('')
          : `<div class="text-center py-16">
              <div class="text-6xl mb-4">🛒</div>
              <div class="text-xl font-extrabold">Your cart is empty</div>
              <p class="text-gray-500 text-sm mt-1">Add items from a store to get started.</p>
              <button class="btn btn-primary mt-5" id="browse-btn">Browse stores</button>
            </div>`}
        </div>
        ${items.length ? `
        <div class="p-5 border-t" style="border-color:var(--line)">
          <div class="flex justify-between text-[15px] mb-3"><span class="text-gray-600">Subtotal</span><b>${money(cartSubtotal())}</b></div>
          <button class="btn btn-primary btn-lg" id="go-checkout">Go to checkout</button>
          <button class="btn btn-ghost btn-lg mt-2" id="add-more">Add more items</button>
        </div>` : ''}
      </div>`
    const close = () => { dr.innerHTML = '' }
    $('#drawer-overlay').addEventListener('click', close)
    $('#drawer-close').addEventListener('click', close)
    $('#browse-btn')?.addEventListener('click', () => { close(); location.hash = '#/' })
    $('#add-more')?.addEventListener('click', () => { close(); location.hash = `#/store/${state.cart.vendor_id}` })
    $('#go-checkout')?.addEventListener('click', () => { close(); location.hash = '#/checkout' })
    $('#drawer-body').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]')
      if (!btn) return
      const key = btn.closest('[data-key]').dataset.key
      const it = state.cart.items.find((i) => i.key === key)
      if (!it) return
      if (btn.dataset.act === 'inc') { it.qty++; it.line_total = it.unit_price * it.qty }
      else { it.qty--; if (it.qty <= 0) state.cart.items = state.cart.items.filter((i) => i.key !== key); else it.line_total = it.unit_price * it.qty }
      if (!state.cart.items.length) { state.cart.vendor_id = null; state.cart.vendor_name = '' }
      saveCart(); openCartDrawer()
    })
  }

  // ---------- CHECKOUT ----------
  async function renderCheckout() {
    const view = $('#view')
    if (!state.cart.items.length) { location.hash = '#/'; return }
    const vid = state.cart.vendor_id
    let v = state.vendorCache[vid]
    if (!v) { const vd = await api.vendor(vid); v = vd.vendor; state.vendorCache[vid] = v }
    const ld = await api.loyalty(vid).catch(() => ({ points: 0 }))
    state.checkout.points = ld.points || 0

    const co = state.checkout
    const calc = () => {
      const subtotal = cartSubtotal()
      const isDelivery = state.mode === 'delivery'
      const deliveryFee = isDelivery ? Number(v.delivery_fee_cents || 0) : 0
      const priority = isDelivery && co.speed === 'priority' ? 149 : 0
      const service = Math.round(subtotal * 0.05)
      const taxes = Math.round(subtotal * 0.08)
      let discount = 0
      if ((co.promo || '').toUpperCase() === 'SAVE10') discount = Math.min(Math.round(subtotal * 0.1), 500)
      let pointsUsed = 0
      if (co.usePoints && co.points > 0) pointsUsed = Math.min(co.points, subtotal - discount)
      const tip = co.tipCustom != null ? co.tipCustom : Math.round(subtotal * co.tipPct)
      const total = Math.max(0, subtotal + deliveryFee + priority + service + taxes + tip - discount - pointsUsed)
      return { subtotal, deliveryFee, priority, service, taxes, discount, pointsUsed, tip, total, isDelivery }
    }

    const paint = () => {
      const t = calc()
      const eta = t.isDelivery
        ? (co.speed === 'priority' ? `${Math.max(5, (v.eta_min || 20) - 7)}–${Math.max(10, (v.eta_max || 35) - 7)} min` : `${v.eta_min || 20}–${v.eta_max || 35} min`)
        : `${Math.max(10, (v.eta_min || 15) - 5)} min`
      view.innerHTML = `
      <div style="background:#F6F6F6;min-height:calc(100vh - 72px)">
        <div class="max-w-6xl mx-auto px-4 md:px-6 py-8">
          <button class="text-sm font-bold mb-5 hover:underline" id="back-store"><i class="fa-solid fa-arrow-left mr-2"></i>Back to store</button>
          <div class="grid lg:grid-cols-5 gap-6 items-start">
            <!-- left -->
            <div class="lg:col-span-3 space-y-5">
              <div class="card">
                <div class="flex items-center justify-between">
                  <h2 class="text-xl font-extrabold tracking-tight">${t.isDelivery ? 'Delivery' : 'Pickup'} details</h2>
                  <div class="seg" id="co-mode">
                    <button data-mode="delivery" class="${state.mode === 'delivery' ? 'active' : ''}">Delivery</button>
                    <button data-mode="pickup" class="${state.mode === 'pickup' ? 'active' : ''}">Pickup</button>
                  </div>
                </div>
                <div class="mt-5 space-y-1">
                  <div class="flex items-center justify-between py-3 border-b" style="border-color:var(--line)">
                    <div class="flex items-center gap-3.5"><i class="fa-solid ${t.isDelivery ? 'fa-location-dot' : 'fa-store'} text-gray-400"></i>
                      <div><div class="font-bold text-[15px]">${t.isDelivery ? esc(state.address) : esc(v.org_name)}</div>
                      <div class="text-xs text-gray-500">${t.isDelivery ? 'Delivery address' : 'Pickup location'}</div></div>
                    </div>
                    ${t.isDelivery ? '<button class="btn btn-ghost btn-sm" id="co-addr">Edit</button>' : ''}
                  </div>
                  <div class="flex items-center justify-between py-3">
                    <div class="flex items-center gap-3.5"><i class="fa-solid fa-person-walking text-gray-400"></i>
                      <div><div class="font-bold text-[15px]">${t.isDelivery ? 'Meet at my door' : 'In-store pickup'}</div>
                      <div class="text-xs money-green cursor-pointer">Add ${t.isDelivery ? 'delivery' : 'pickup'} instructions</div></div>
                    </div>
                  </div>
                </div>
              </div>

              ${t.isDelivery ? `
              <div class="card">
                <h2 class="text-xl font-extrabold tracking-tight">Delivery options</h2>
                <div class="mt-4 space-y-3" id="speed-opts">
                  <div class="select-card ${co.speed === 'priority' ? 'selected' : ''}" data-speed="priority">
                    <span class="text-lg">⚡</span>
                    <div class="flex-1"><div class="font-bold text-[15px]">Priority</div><div class="text-xs text-gray-500">${Math.max(5, (v.eta_min || 20) - 7)}–${Math.max(10, (v.eta_max || 35) - 7)} min • Direct to you</div></div>
                    <span class="text-sm font-bold">+$1.49</span>
                  </div>
                  <div class="select-card ${co.speed === 'standard' ? 'selected' : ''}" data-speed="standard">
                    <span class="text-lg">🛵</span>
                    <div class="flex-1"><div class="font-bold text-[15px]">Standard</div><div class="text-xs text-gray-500">${v.eta_min || 20}–${v.eta_max || 35} min</div></div>
                  </div>
                  <div class="select-card ${co.speed === 'schedule' ? 'selected' : ''}" data-speed="schedule">
                    <span class="text-lg">📅</span>
                    <div class="flex-1"><div class="font-bold text-[15px]">Schedule</div><div class="text-xs text-gray-500">Choose a time</div></div>
                  </div>
                </div>
              </div>` : ''}

              <div class="card">
                <h2 class="text-xl font-extrabold tracking-tight">Payment</h2>
                <div class="flex items-center justify-between py-3 mt-2">
                  <div class="flex items-center gap-3.5">
                    <span class="text-xl">💳</span>
                    <div><div class="font-bold text-[15px]">Visa •••• 4242</div><div class="text-xs text-gray-500">Demo payment method</div></div>
                  </div>
                  <button class="btn btn-ghost btn-sm">Edit</button>
                </div>
                ${co.points > 0 ? `
                <div class="flex items-center justify-between py-3 border-t" style="border-color:var(--line)">
                  <div class="flex items-center gap-3.5">
                    <i class="fa-solid fa-gem" style="color:var(--brand)"></i>
                    <div><div class="font-bold text-[15px]">Use ${co.points} loyalty points</div><div class="text-xs text-gray-500">Save ${money(Math.min(co.points, t.subtotal))} on this order</div></div>
                  </div>
                  <button class="chip ${co.usePoints ? 'active' : ''}" id="co-points">${co.usePoints ? 'Applied ✓' : 'Apply'}</button>
                </div>` : ''}
              </div>

              <div class="card">
                <h2 class="text-xl font-extrabold tracking-tight">Add a tip ${t.isDelivery ? 'for your courier' : ''}</h2>
                <p class="text-xs text-gray-500 mt-1">100% of your tip goes to your ${t.isDelivery ? 'courier' : 'server'}.</p>
                <div class="flex items-center gap-2 mt-4 flex-wrap" id="tip-row">
                  ${[0, 0.1, 0.15, 0.2, 0.25].map((p) => `<button class="tip-chip ${co.tipCustom == null && co.tipPct === p ? 'active' : ''}" data-tip="${p}">${p === 0 ? 'Not now' : Math.round(p * 100) + '%'}</button>`).join('')}
                  <button class="tip-chip ${co.tipCustom != null ? 'active' : ''}" data-tip="other">Other</button>
                  <span class="ml-auto font-extrabold">${money(t.tip)}</span>
                </div>
              </div>
            </div>

            <!-- right rail -->
            <div class="lg:col-span-2 space-y-5">
              <div class="card">
                <div class="flex items-center gap-3 pb-4 border-b" style="border-color:var(--line)">
                  <div class="w-12 h-12 rounded-full overflow-hidden shrink-0" style="background:var(--fill)">
                    <img src="${esc(v.image_url || '')}" class="w-full h-full object-cover" data-emoji="${emojiFor(v)}" onerror="__imgFail(this)" />
                  </div>
                  <div class="min-w-0">
                    <div class="font-extrabold truncate">${esc(v.org_name)}</div>
                    <div class="text-xs text-gray-500">Arrives in ${eta}</div>
                  </div>
                </div>
                <button class="btn btn-primary btn-lg mt-4" id="place-order">Place order • ${money(t.total)}</button>
                <details class="mt-4">
                  <summary class="font-bold text-sm cursor-pointer">Cart summary (${cartCount()} item${cartCount() === 1 ? '' : 's'})</summary>
                  <div class="mt-3 space-y-2">
                    ${state.cart.items.map((it) => `
                      <div class="flex justify-between text-sm"><span class="text-gray-600">${it.qty}× ${esc(it.name)}</span><span class="font-semibold">${money(it.line_total)}</span></div>`).join('')}
                  </div>
                </details>
              </div>

              <div class="card">
                <h3 class="font-extrabold">Promotion</h3>
                <div class="flex gap-2 mt-3">
                  <input id="promo-input" class="flex-1 min-w-0 text-sm rounded-xl px-3.5 outline-none" style="background:var(--fill);height:44px" placeholder="Add promo code (try SAVE10)" value="${esc(co.promo)}" />
                  <button class="btn btn-ghost btn-sm" style="height:44px" id="promo-apply">Apply</button>
                </div>
                ${t.discount ? `<div class="mt-2 text-sm money-green"><i class="fa-solid fa-tag"></i> SAVE10 applied — you save ${money(t.discount)}</div>` : ''}
              </div>

              <div class="card">
                <h3 class="font-extrabold text-lg">Order total</h3>
                <div class="mt-3 space-y-2.5 text-[14.5px]">
                  <div class="flex justify-between"><span class="text-gray-600">Subtotal</span><span>${money(t.subtotal)}</span></div>
                  ${t.isDelivery ? `<div class="flex justify-between"><span class="text-gray-600">Delivery fee</span><span class="${t.deliveryFee === 0 ? 'money-green' : ''}">${t.deliveryFee === 0 ? 'Free' : money(t.deliveryFee)}</span></div>` : ''}
                  ${t.priority ? `<div class="flex justify-between"><span class="text-gray-600">Priority delivery</span><span>${money(t.priority)}</span></div>` : ''}
                  <div class="flex justify-between"><span class="text-gray-600">Taxes &amp; service fee</span><span>${money(t.taxes + t.service)}</span></div>
                  ${t.discount ? `<div class="flex justify-between money-green"><span>Promo discount</span><span>-${money(t.discount)}</span></div>` : ''}
                  ${t.pointsUsed ? `<div class="flex justify-between money-green"><span>Loyalty points</span><span>-${money(t.pointsUsed)}</span></div>` : ''}
                  ${t.tip ? `<div class="flex justify-between"><span class="text-gray-600">Tip</span><span>${money(t.tip)}</span></div>` : ''}
                  <div class="divider my-1"></div>
                  <div class="flex justify-between text-lg font-extrabold"><span>Total</span><span>${money(t.total)}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`

      // bindings
      $('#back-store').addEventListener('click', () => { location.hash = `#/store/${vid}` })
      $('#co-mode').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-mode]')
        if (!b) return
        state.mode = b.dataset.mode; store.set('menu_mode', state.mode); paint()
      })
      $('#co-addr')?.addEventListener('click', () => {
        const a = prompt('Delivery address', state.address)
        if (a && a.trim()) { state.address = a.trim(); store.set('menu_address', state.address); paint() }
      })
      $('#speed-opts')?.addEventListener('click', (e) => {
        const cardEl = e.target.closest('[data-speed]')
        if (!cardEl) return
        co.speed = cardEl.dataset.speed
        if (co.speed === 'schedule') toast('Scheduled for the next available window')
        paint()
      })
      $('#co-points')?.addEventListener('click', () => { co.usePoints = !co.usePoints; paint() })
      $('#tip-row').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tip]')
        if (!b) return
        if (b.dataset.tip === 'other') {
          const val = prompt('Custom tip amount ($)', '3.00')
          const n = Number(val)
          if (!Number.isNaN(n) && n >= 0) co.tipCustom = Math.round(n * 100)
        } else { co.tipCustom = null; co.tipPct = Number(b.dataset.tip) }
        paint()
      })
      $('#promo-apply').addEventListener('click', () => {
        co.promo = $('#promo-input').value.trim()
        if (co.promo && co.promo.toUpperCase() !== 'SAVE10') toast('Promo code not recognized')
        else if (co.promo) toast('Promo applied!', 'fa-solid fa-tag')
        paint()
      })
      $('#place-order').addEventListener('click', async () => {
        const btn = $('#place-order')
        btn.disabled = true
        btn.textContent = 'Placing order...'
        const t2 = calc()
        try {
          const res = await api.createOrder({
            vendor_id: vid,
            type: state.mode === 'pickup' ? 'pickup' : 'delivery',
            items: state.cart.items.map((i) => ({ item_id: i.item_id, qty: i.qty, selected_options: i.selected_options })),
            tip_cents: t2.tip,
            promo_code: co.promo || undefined,
            loyalty_points: t2.pointsUsed || undefined,
            priority: co.speed === 'priority',
          })
          if (res.order && res.order.id) {
            state.myOrders.unshift({ id: res.order.id, vendor_name: v.org_name, total: res.order.total, at: Date.now(), items: cartCount() })
            state.myOrders = state.myOrders.slice(0, 20)
            store.set('menu_orders', state.myOrders)
            state.cart = { vendor_id: null, vendor_name: '', items: [] }
            saveCart()
            state.checkout = { speed: 'standard', tipPct: 0.15, tipCustom: null, promo: '', usePoints: false, points: 0 }
            location.hash = `#/order/${res.order.id}`
          } else {
            toast('Could not place order — try again')
            btn.disabled = false; btn.textContent = `Place order • ${money(t2.total)}`
          }
        } catch {
          toast('Could not place order — try again')
          btn.disabled = false; btn.textContent = `Place order • ${money(t2.total)}`
        }
      })
    }
    paint()
  }

  // ---------- ORDER TRACKING ----------
  const DELIVERY_STAGES = ['Submitted', 'Accepted', 'In-Prep', 'Out-for-Delivery', 'Completed']
  const PICKUP_STAGES = ['Submitted', 'Accepted', 'In-Prep', 'Ready', 'Completed']
  const STAGE_META = {
    Submitted: ['fa-receipt', 'Order received', 'We sent your order to the store.'],
    Accepted: ['fa-store', 'Order confirmed', 'The store is getting started.'],
    'In-Prep': ['fa-fire-burner', 'Preparing your order', 'Your food is being made fresh.'],
    Ready: ['fa-bag-shopping', 'Ready for pickup', 'Head to the counter and show your name.'],
    'Out-for-Delivery': ['fa-motorcycle', 'Almost here!', 'Your courier is on the way.'],
    Completed: ['fa-house', 'Delivered', 'Enjoy your meal!'],
  }

  async function renderTracking(id) {
    clearInterval(state.trackTimer)
    const view = $('#view')
    view.innerHTML = `<div class="max-w-6xl mx-auto px-4 md:px-6 py-8"><div class="skel w-full" style="height:400px;border-radius:16px"></div></div>`
    const paint = async (autoAdvanced) => {
      let data
      try { data = await api.order(id) } catch { return }
      if (!data || !data.order) return
      const o = data.order
      const vv = data.vendor || {}
      const isDelivery = o.type === 'delivery'
      const stages = isDelivery ? DELIVERY_STAGES : PICKUP_STAGES
      let idx = stages.indexOf(o.status)
      if (o.status === 'Ready' && isDelivery) idx = 2
      if (idx < 0) idx = o.status === 'Canceled' || o.status === 'Refunded' ? 0 : 0
      const done = o.status === 'Completed'
      const meta = STAGE_META[o.status] || STAGE_META.Submitted
      const progress = (idx + 1) / stages.length
      // courier position along the "route"
      const cx = 18 + progress * 64
      const cy = 62 - progress * 26

      const etaText = done ? 'Delivered' : (o.eta ? `${o.eta.replace('m', ' min')}` : `${vv.eta_min || 20}–${vv.eta_max || 35} min`)

      view.innerHTML = `
      <div class="max-w-6xl mx-auto px-4 md:px-6 py-6 pb-20">
        <button class="text-sm font-bold mb-4 hover:underline" id="track-back"><i class="fa-solid fa-arrow-left mr-2"></i>Back to home</button>
        <div class="grid lg:grid-cols-5 gap-6 items-start">
          <!-- map -->
          <div class="lg:col-span-3">
            <div class="map-ph" style="height:min(460px, 52vw)">
              <div class="map-road" style="left:0;right:0;top:58%;height:16px"></div>
              <div class="map-road" style="top:0;bottom:0;left:24%;width:14px"></div>
              <div class="map-road" style="top:0;bottom:0;left:72%;width:14px"></div>
              <div class="map-road" style="left:24%;right:0;top:28%;height:12px"></div>
              <div class="map-pin brand" style="left:24.7%;top:60%"><i class="fa-solid fa-store"></i></div>
              <div class="map-pin" style="left:72.7%;top:29%"><i class="fa-solid fa-house"></i></div>
              ${isDelivery && !done ? `<div class="map-pin map-courier" style="left:${cx}%;top:${cy}%;background:#fff;color:#191919;border:3px solid #191919"><i class="fa-solid fa-motorcycle"></i></div>` : ''}
              <div class="absolute bottom-4 left-4 bg-white rounded-full shadow px-4 py-2 text-sm font-bold">${esc(vv.org_name || 'Store')} → ${esc(state.address)}</div>
            </div>
          </div>
          <!-- status panel -->
          <div class="lg:col-span-2 space-y-5">
            <div class="card">
              <h1 class="text-2xl font-extrabold tracking-tight">${esc(meta[1])}</h1>
              <div class="mt-1 text-gray-500 text-sm">${done ? 'Thanks for ordering with Menu.' : `Estimated arrival: <b class="text-gray-900">${etaText}</b>`} ${!done ? '<span class="ml-1 text-xs font-bold rounded-full px-2 py-0.5" style="background:var(--green-tint);color:var(--green)">On time</span>' : ''}</div>
              <div class="eta-bar mt-4">
                ${stages.map((_, i) => `<div class="eta-seg ${i <= idx ? 'fill' : ''}"></div>`).join('')}
              </div>
              <div class="progress-track mt-6">
                ${stages.map((s, i) => `
                  <div class="progress-node ${i < idx ? 'done' : ''} ${i === idx && !done ? 'current' : ''} ${done ? 'done' : ''}"><i class="fa-solid ${STAGE_META[s][0]}"></i></div>
                  ${i < stages.length - 1 ? `<div class="progress-line ${i < idx || done ? 'done' : ''}"></div>` : ''}`).join('')}
              </div>
              <p class="mt-4 text-sm text-gray-600">${esc(meta[2])}</p>
              ${isDelivery && idx >= 3 && !done ? `
              <div class="mt-4 flex items-center gap-3 rounded-2xl p-3.5" style="background:var(--fill)">
                <div class="w-11 h-11 rounded-full bg-gray-900 text-white flex items-center justify-center font-extrabold">J</div>
                <div class="flex-1"><div class="font-bold text-sm">Jordan is your courier</div><div class="text-xs text-gray-500">Silver scooter • #${String(o.id).padStart(4, '0')}</div></div>
                <button class="icon-btn"><i class="fa-solid fa-phone"></i></button>
                <button class="icon-btn"><i class="fa-regular fa-comment"></i></button>
              </div>` : ''}
              ${done ? `<button class="btn btn-brand btn-lg mt-5" id="rate-order"><i class="fa-solid fa-star"></i> Rate your order</button>` : ''}
            </div>

            <div class="card">
              <div class="flex items-center justify-between">
                <h3 class="font-extrabold">Order details</h3>
                <span class="badge-neutral">#${String(o.id).padStart(4, '0')}</span>
              </div>
              <div class="mt-3 space-y-2.5">
                ${(data.items || []).map((it) => `
                  <div class="flex items-center gap-3 text-sm">
                    <div class="w-10 h-10 rounded-lg overflow-hidden shrink-0" style="background:var(--fill)">
                      ${it.item_photo ? `<img src="${esc(it.item_photo)}" class="w-full h-full object-cover" data-emoji="🍽️" onerror="__imgFail(this)" />` : '<div class="food-fallback" style="font-size:16px">🍽️</div>'}
                    </div>
                    <span class="flex-1 text-gray-700">${it.qty}× ${esc(it.item_name)}</span>
                    <span class="font-semibold">${money(it.line_total)}</span>
                  </div>`).join('')}
              </div>
              <div class="divider my-3"></div>
              <div class="space-y-1.5 text-sm">
                <div class="flex justify-between"><span class="text-gray-500">Subtotal</span><span>${money(o.subtotal)}</span></div>
                <div class="flex justify-between"><span class="text-gray-500">Taxes &amp; fees</span><span>${money(o.taxes + o.fees)}</span></div>
                ${o.tip ? `<div class="flex justify-between"><span class="text-gray-500">Tip</span><span>${money(o.tip)}</span></div>` : ''}
                <div class="flex justify-between font-extrabold text-base pt-1"><span>Total</span><span>${money(o.total)}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>`
      $('#track-back').addEventListener('click', () => { location.hash = '#/' })
      $('#rate-order')?.addEventListener('click', () => {
        const vObj = { id: o.vendor_id, org_name: vv.org_name || 'this store' }
        openReviewModal(vObj, () => {})
      })

      // demo auto-advance
      if (!done && o.status !== 'Canceled') {
        state.trackTimer = setTimeout(async () => {
          const next = stages[Math.min(idx + 1, stages.length - 1)]
          try { await api.orderStatus(id, { status: next }) } catch {}
          if (currentRoute().name === 'order') paint(true)
        }, 12000)
      }
    }
    paint()
  }

  // ---------- ORDERS LIST ----------
  function renderOrders() {
    const view = $('#view')
    const orders = state.myOrders
    view.innerHTML = `
      <div class="max-w-3xl mx-auto px-4 md:px-6 py-8">
        <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight mb-6">Past orders</h1>
        ${orders.length ? orders.map((o) => `
          <div class="border rounded-2xl p-5 mb-4 flex items-center justify-between gap-4" style="border-color:var(--line)">
            <div>
              <div class="font-extrabold">${esc(o.vendor_name)}</div>
              <div class="text-sm text-gray-500 mt-0.5">${o.items} item${o.items === 1 ? '' : 's'} for ${money(o.total)} • ${new Date(o.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
            </div>
            <button class="btn btn-primary btn-sm" data-view-order="${o.id}">View order</button>
          </div>`).join('')
        : `<div class="text-center py-20">
            <div class="text-6xl mb-4">🧾</div>
            <div class="text-xl font-extrabold">No orders yet</div>
            <p class="text-gray-500 text-sm mt-1">When you place your first order, it will show up here.</p>
            <button class="btn btn-primary mt-5" id="find-food">Find food</button>
          </div>`}
      </div>`
    $('#find-food')?.addEventListener('click', () => { location.hash = '#/' })
    $$('[data-view-order]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/order/${b.dataset.viewOrder}` }))
  }

  // ---------- GROUP ORDER ----------
  async function renderGroup(code) {
    const view = $('#view')
    view.innerHTML = `<div class="max-w-4xl mx-auto px-4 md:px-6 py-8"><div class="skel h-40 w-full" style="border-radius:16px"></div></div>`
    let gd
    try { gd = await api.group(code) } catch {}
    if (!gd || !gd.group) {
      view.innerHTML = `<div class="max-w-3xl mx-auto px-6 py-20 text-center"><div class="text-5xl mb-4">😕</div><div class="text-xl font-extrabold">Group order not found</div><p class="text-gray-500 mt-1">It may have been submitted or expired.</p></div>`
      return
    }
    const g = gd.group
    const vid = g.vendor_id
    const [vd, md] = await Promise.all([api.vendor(vid), api.menus(vid)])
    const v = vd.vendor
    const sections = (md.sections || []).filter((s) => (s.items || []).length)
    const myName = store.get('menu_group_name', state.user ? state.user.email.split('@')[0] : '')
    const emoji = emojiFor(v)

    view.innerHTML = `
      <div class="max-w-5xl mx-auto px-4 md:px-6 py-8 pb-24">
        <div class="rounded-2xl p-6 md:p-8 text-white relative overflow-hidden" style="background:#191919">
          <div class="relative z-10">
            <div class="text-xs font-bold uppercase tracking-widest text-white/60">Group order • ${esc(v.org_name)}</div>
            <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">Everyone adds, one person pays.</h1>
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <div class="bg-white/10 border border-white/20 rounded-full px-5 py-2.5 font-mono font-extrabold text-lg tracking-[.3em]">${esc(g.code)}</div>
              <button class="btn btn-sm" style="background:#fff;color:#191919" id="copy-link"><i class="fa-solid fa-link"></i> Copy invite link</button>
              <span class="text-white/60 text-sm">${g.status === 'open' ? 'Open for orders' : 'Submitted'}</span>
            </div>
          </div>
          <div class="absolute -right-6 -bottom-8 text-[130px] opacity-20 select-none">👥</div>
        </div>

        <div class="grid lg:grid-cols-5 gap-6 mt-6 items-start">
          <div class="lg:col-span-3">
            <h2 class="text-xl font-extrabold tracking-tight mb-3">Add your items</h2>
            <div class="mb-4">
              <input id="group-name" class="w-full text-sm rounded-xl p-3 outline-none" style="background:var(--fill)" placeholder="Your name (shown to the group)" value="${esc(myName)}" />
            </div>
            ${sections.map((s) => `
              <div class="mb-6">
                <h3 class="font-extrabold mb-2.5">${esc(s.name)}</h3>
                <div class="space-y-3">
                  ${(s.items || []).map((it) => `
                    <div class="menu-item-row" data-gitem="${it.id}" style="padding:12px">
                      <div class="min-w-0 py-0.5">
                        <div class="font-bold text-[15px]">${esc(it.name)}</div>
                        <div class="text-sm text-gray-500">${money(it.base_price)}</div>
                      </div>
                      <div class="menu-item-thumb" style="width:76px;height:76px">
                        ${it.photo ? `<img src="${esc(it.photo)}" data-emoji="${emoji}" onerror="__imgFail(this)" />` : `<div class="food-fallback" style="font-size:22px">${emoji}</div>`}
                        <button class="quick-add" style="width:30px;height:30px;font-size:12px"><i class="fa-solid fa-plus"></i></button>
                      </div>
                    </div>`).join('')}
                </div>
              </div>`).join('')}
          </div>

          <div class="lg:col-span-2 card sticky" style="top:88px">
            <h3 class="font-extrabold text-lg">Group cart</h3>
            <div class="mt-3 space-y-2 text-sm" id="group-items">
              ${(gd.items || []).length ? gd.items.map((it) => `
                <div class="flex justify-between gap-2">
                  <span class="text-gray-600 min-w-0 truncate"><b class="text-gray-900">${esc(it.user_name || 'Guest')}</b> • ${it.qty}× item #${it.item_id}</span>
                  <span class="font-semibold shrink-0">${money(it.line_total)}</span>
                </div>`).join('') : '<div class="text-gray-400">No items yet — share the code!</div>'}
            </div>
            <div class="divider my-4"></div>
            <div class="flex justify-between font-extrabold"><span>Subtotal</span><span>${money(gd.subtotal || 0)}</span></div>
            ${g.status === 'open' ? `
            <button class="btn btn-primary btn-lg mt-4" id="group-submit" ${!(gd.items || []).length ? 'disabled' : ''}>Submit group order</button>
            <p class="text-xs text-gray-400 mt-2 text-center">The organizer pays. Taxes, fees and tip are added at submit.</p>` : `<div class="mt-4 badge-neutral">Order submitted ✓</div>`}
          </div>
        </div>
      </div>`

    $('#copy-link').addEventListener('click', async () => {
      const url = `${location.origin}/app#/group/${g.code}`
      try { await navigator.clipboard.writeText(url); toast('Link copied', 'fa-solid fa-link') } catch { prompt('Copy this link:', url) }
    })
    $('#group-name').addEventListener('change', (e) => store.set('menu_group_name', e.target.value.trim()))
    view.addEventListener('click', async (e) => {
      const row = e.target.closest('[data-gitem]')
      if (!row) return
      const itemId = Number(row.dataset.gitem)
      const name = ($('#group-name').value || '').trim() || 'Guest'
      store.set('menu_group_name', name)
      const res = await api.groupAdd(g.code, { item_id: itemId, qty: 1, user_name: name })
      if (res.ok) { toast('Added to group cart', 'fa-solid fa-user-group'); renderGroup(code) }
      else toast(res.error || 'Could not add item')
    })
    $('#group-submit')?.addEventListener('click', async () => {
      const res = await api.groupSubmit(g.code, { type: state.mode === 'pickup' ? 'pickup' : 'delivery', tip_cents: Math.round((gd.subtotal || 0) * 0.15) })
      if (res.order && res.order.id) {
        state.myOrders.unshift({ id: res.order.id, vendor_name: v.org_name, total: res.order.total, at: Date.now(), items: (gd.items || []).length })
        store.set('menu_orders', state.myOrders)
        location.hash = `#/order/${res.order.id}`
      } else toast(res.error || 'Could not submit')
    })
  }

  // ---------- router ----------
  function currentRoute() {
    const h = location.hash.replace(/^#\/?/, '')
    const [path, qs] = h.split('?')
    const parts = path.split('/').filter(Boolean)
    if (!parts.length) return { name: 'feed', qs }
    if (parts[0] === 'store' && parts[1]) return { name: 'store', id: Number(parts[1]) }
    if (parts[0] === 'checkout') return { name: 'checkout' }
    if (parts[0] === 'order' && parts[1]) return { name: 'order', id: Number(parts[1]) }
    if (parts[0] === 'orders') return { name: 'orders' }
    if (parts[0] === 'group' && parts[1]) return { name: 'group', code: parts[1] }
    return { name: 'feed', qs }
  }
  function route() {
    clearTimeout(state.trackTimer)
    window.scrollTo({ top: 0 })
    // replace #view with a fresh node so per-view listeners don't accumulate
    const oldView = $('#view')
    if (oldView) {
      const fresh = oldView.cloneNode(false)
      oldView.replaceWith(fresh)
    }
    const r = currentRoute()
    // feed query params (?cat=)
    if (r.name === 'feed' && r.qs) {
      const p = new URLSearchParams(r.qs)
      if (p.get('cat')) state.filters.cat = p.get('cat')
    }
    if (r.name === 'feed') renderFeed()
    else if (r.name === 'store') renderStore(r.id)
    else if (r.name === 'checkout') renderCheckout()
    else if (r.name === 'order') renderTracking(r.id)
    else if (r.name === 'orders') renderOrders()
    else if (r.name === 'group') renderGroup(r.code)
  }

  // landing category deep links arrive as /app?cat=X or /app#/?cat=X
  try {
    const cat = new URLSearchParams(location.search).get('cat')
    if (cat) state.filters.cat = cat
  } catch {}

  window.addEventListener('hashchange', route)
  renderShell()
  route()
})()

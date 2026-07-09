/* ============================================================
   Menu Courier — delivery driver app for the Menu marketplace
   Views: welcome → signup → verify, home (map + offers),
   active delivery flow, earnings, ratings, account.
   ============================================================ */
(function () {
  const root = document.getElementById('driver-app')
  if (!root) return
  document.body.classList.add('driver-body')

  // ---------- utils ----------
  const $ = (sel, el) => (el || document).querySelector(sel)
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel))
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
  const money = (k) => {
    const n = Number(k || 0) / 100
    const opts = Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    return '₦' + n.toLocaleString('en-NG', opts)
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
    del(k) { try { localStorage.removeItem(k) } catch {} },
  }
  const fmtTime = (d) => {
    const dt = d instanceof Date ? d : new Date(d)
    let h = dt.getHours(); const m = dt.getMinutes(); const am = h < 12 ? 'AM' : 'PM'
    h = h % 12 || 12
    return `${h}:${m < 10 ? '0' + m : m} ${am}`
  }
  const fmtDay = (iso) => {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-NG', { weekday: 'long', month: 'short', day: 'numeric' })
  }
  const VEHICLES = [
    ['car', 'Car', 'Four-wheeled motor vehicle', 'fa-car-side'],
    ['motorcycle', 'Motorcycle', 'Step-over motor vehicle', 'fa-motorcycle'],
    ['scooter', 'Scooter', 'Step-through motor vehicle', 'fa-motorcycle'],
    ['ebike', 'EBike', 'Powered bicycle', 'fa-person-biking'],
    ['bicycle', 'Bicycle', 'Unpowered bicycle', 'fa-bicycle'],
  ]
  const vehicleMeta = (t) => VEHICLES.find((v) => v[0] === t) || VEHICLES[1]

  // ---------- session & api ----------
  let session = store.get('menu_driver', null)
  const saveSession = (s) => { session = s; if (s) store.set('menu_driver', s); else store.del('menu_driver') }
  function dfetch(url, opts) {
    const o = opts || {}
    o.headers = Object.assign({}, o.headers || {}, session && session.token ? { Authorization: `Bearer ${session.token}` } : {})
    return fetch(url, o).then((r) => r.json())
  }
  const post = (p) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p || {}) })
  const api = {
    register: (p) => fetch('/api/driver/register', post(p)).then((r) => r.json()),
    self: () => dfetch('/api/driver/self'),
    shiftStart: (p) => dfetch('/api/driver/shift/start', post(p)),
    shiftEnd: () => dfetch('/api/driver/shift/end', post({})),
    offers: (skip) => dfetch('/api/driver/offers' + (skip && skip.length ? `?skip=${skip.join(',')}` : '')),
    accept: (orderId) => dfetch(`/api/driver/offers/${orderId}/accept`, post({})),
    decline: (orderId) => dfetch(`/api/driver/offers/${orderId}/decline`, post({})),
    delivery: () => dfetch('/api/driver/delivery'),
    advance: (id) => dfetch(`/api/driver/delivery/${id}/advance`, post({})),
    earnings: () => dfetch('/api/driver/earnings'),
    ratings: () => dfetch('/api/driver/ratings'),
    demoOrder: () => dfetch('/api/driver/demo-order', post({})),
  }

  // ---------- state ----------
  const state = {
    tab: 'home',
    self: null,          // { driver, shift, delivery, shift_earnings, shift_deliveries }
    deliveryCtx: null,   // { delivery, order, vendor, vendor_address, items, customer_name }
    offer: null,
    skips: [],
    pollTimer: null,
    countTimer: null,
    paused: false,
    emptyPolls: 0,
    prefs: store.get('menu_driver_prefs', { autoAccept: false, arrivalNotes: true, safeAlerts: true }),
    bank: store.get('menu_driver_bank', null),
  }
  const savePrefs = () => store.set('menu_driver_prefs', state.prefs)

  function toast(msg, icon) {
    let wrap = $('.dx-toast-wrap', root)
    if (!wrap) {
      const frame = $('.dx-frame', root) || root
      wrap = document.createElement('div'); wrap.className = 'dx-toast-wrap'; frame.appendChild(wrap)
    }
    const t = document.createElement('div')
    t.className = 'dx-toast'
    t.innerHTML = `${icon ? `<i class="${icon}"></i>` : ''}<span>${esc(msg)}</span>`
    wrap.appendChild(t)
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320) }, 2400)
  }

  function stopTimers() {
    clearTimeout(state.pollTimer); state.pollTimer = null
    clearInterval(state.countTimer); state.countTimer = null
  }

  // ---------- decorative map ----------
  function mapSvg(city) {
    const labels = city === 'Abuja'
      ? [['MAITAMA', 26, 30], ['WUSE 2', 58, 55], ['GARKI', 34, 78], ['JABI', 74, 26]]
      : [['IKOYI', 30, 34], ['VICTORIA ISLAND', 52, 58], ['LEKKI PHASE 1', 72, 40], ['LAGOS LAGOON', 46, 14]]
    const streetsV = [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="100" stroke="#fff" stroke-width="0.9"/>`).join('')
    const streetsH = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => `<line x1="0" y1="${y}" x2="100" y2="${y}" stroke="#fff" stroke-width="0.9"/>`).join('')
    const texts = labels.map(([t, x, y]) => `<text x="${x}" y="${y}" font-size="2.6" font-weight="600" letter-spacing="0.6" fill="#9AA0A6" text-anchor="middle" font-family="sans-serif">${t}</text>`).join('')
    return `
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <rect width="100" height="100" fill="#E8EAED"/>
        <path d="M0,0 L100,0 L100,10 Q60,20 30,8 L0,14 Z" fill="#AECBFA" opacity="0.85"/>
        <rect x="12" y="62" width="18" height="14" rx="2" fill="#CEEAD6"/>
        <rect x="66" y="70" width="22" height="16" rx="2" fill="#CEEAD6"/>
        ${streetsV}${streetsH}
        <path d="M0,46 Q30,42 52,50 T100,44" stroke="#FDD663" stroke-width="2.4" fill="none"/>
        <path d="M20,100 Q34,60 28,30 T44,0" stroke="#FDD663" stroke-width="1.8" fill="none"/>
        <path d="M100,72 Q70,66 48,78 T0,74" stroke="#F8BBAF" stroke-width="1.4" fill="none"/>
        ${texts}
      </svg>`
  }

  // ============================================================
  //  ONBOARDING
  // ============================================================
  function renderWelcome() {
    stopTimers()
    root.innerHTML = `
      <div class="dx-frame">
        <div class="dx-screen no-nav">
          <div class="dx-hero" style="min-height:340px">
            <div style="position:relative">
              <span style="font-size:110px">🛵</span>
              <span style="position:absolute;top:-14px;right:-34px;font-size:44px">💬</span>
              <span style="position:absolute;top:-24px;right:-30px;font-size:20px;font-weight:800;color:var(--dx-green)"></span>
            </div>
          </div>
          <div style="padding:28px 20px 20px;flex:1;display:flex;flex-direction:column">
            <div class="dx-sub" style="font-weight:600">Welcome to Menu Courier</div>
            <h1 class="dx-h1" style="margin-top:8px">Start delivering today and <span style="color:var(--dx-red)">earn money your way</span></h1>
            <div style="flex:1"></div>
            <button class="dx-btn dx-btn-primary" id="w-start">Start earning</button>
            <div style="text-align:center;margin-top:18px;font-size:15px;color:var(--dx-muted)">
              Looking to order? <a href="/app" style="color:var(--dx-ink);font-weight:800;text-decoration:underline">Get the Menu app</a>
            </div>
          </div>
        </div>
      </div>`
    $('#w-start').addEventListener('click', renderSignup)
  }

  function renderSignup() {
    stopTimers()
    const draft = { city: 'Lagos', vehicle: 'motorcycle', insurance: false }
    root.innerHTML = `
      <div class="dx-frame">
        <div class="dx-screen no-nav">
          <div class="dx-topbar">
            <button class="dx-icon-btn" id="s-back"><i class="fa-solid fa-arrow-left"></i></button>
            <span style="font-weight:700;color:var(--dx-muted);font-size:15px"><i class="fa-regular fa-circle-question"></i> Help</span>
          </div>
          <div class="dx-progress"><span style="width:33%"></span></div>
          <div style="padding:22px 20px 28px">
            <h1 class="dx-h2" style="font-size:26px">How will you deliver?</h1>
            <p class="dx-sub" style="margin-top:6px">Your method of transport will determine what offers you will be eligible for</p>

            <div style="margin-top:20px" id="veh-list">
              ${VEHICLES.map(([key, t, d, ic]) => `
                <button class="dx-opt ${draft.vehicle === key ? 'sel' : ''}" data-veh="${key}">
                  <span class="radio"></span>
                  <span><span class="t">${t}</span><br/><span class="d">${d}</span></span>
                  <i class="fa-solid ${ic} ic"></i>
                </button>`).join('')}
            </div>

            <div style="margin-top:8px">
              <label class="dx-label">Where will you deliver?</label>
              <div class="dx-seg" id="city-seg">
                <button data-city="Lagos" class="active">Lagos</button>
                <button data-city="Abuja">Abuja</button>
              </div>
            </div>

            <div style="margin-top:22px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label class="dx-label">First name</label><input class="dx-input" id="f-first" placeholder="Tunde" /></div>
              <div><label class="dx-label">Last name</label><input class="dx-input" id="f-last" placeholder="Adeyemi" /></div>
            </div>
            <div style="margin-top:14px"><label class="dx-label">Email</label><input class="dx-input" id="f-email" type="email" placeholder="you@example.com" /></div>
            <div style="margin-top:14px"><label class="dx-label">Phone number</label><input class="dx-input" id="f-phone" type="tel" placeholder="+234 801 234 5678" /></div>

            <label class="dx-check" style="margin-top:20px">
              <input type="checkbox" id="f-ins" />
              <span style="font-size:15px">Yes, I have insurance and agree to <a href="#" style="font-weight:800;text-decoration:underline" onclick="return false">insurance requirements</a></span>
            </label>

            <button class="dx-btn dx-btn-primary" id="f-continue" style="margin-top:26px" disabled>Continue</button>
            <div id="f-err" style="color:var(--dx-red);font-weight:700;font-size:14px;margin-top:10px;display:none"></div>
          </div>
        </div>
      </div>`

    $('#s-back').addEventListener('click', renderWelcome)
    $$('#veh-list .dx-opt').forEach((b) => b.addEventListener('click', () => {
      draft.vehicle = b.dataset.veh
      $$('#veh-list .dx-opt').forEach((x) => x.classList.toggle('sel', x === b))
    }))
    $$('#city-seg button').forEach((b) => b.addEventListener('click', () => {
      draft.city = b.dataset.city
      $$('#city-seg button').forEach((x) => x.classList.toggle('active', x === b))
    }))
    const gate = () => {
      const ok = $('#f-first').value.trim() && $('#f-email').value.includes('@') && $('#f-ins').checked
      $('#f-continue').disabled = !ok
    }
    ;['f-first', 'f-last', 'f-email', 'f-phone'].forEach((id) => $('#' + id).addEventListener('input', gate))
    $('#f-ins').addEventListener('change', gate)
    $('#f-continue').addEventListener('click', async () => {
      $('#f-continue').disabled = true
      const res = await api.register({
        first_name: $('#f-first').value.trim(),
        last_name: $('#f-last').value.trim(),
        email: $('#f-email').value.trim(),
        phone: $('#f-phone').value.trim(),
        city: draft.city,
        vehicle_type: draft.vehicle,
      })
      if (res.token) {
        saveSession({ token: res.token, user: res.user, driver: res.driver })
        renderVerifying()
      } else {
        const el = $('#f-err'); el.style.display = 'block'
        el.textContent = res.error === 'email_in_use_by_business_account' ? 'That email belongs to a business account. Use a different email.' : 'Sign up failed. Check your details and try again.'
        $('#f-continue').disabled = false
      }
    })
  }

  function renderVerifying() {
    stopTimers()
    root.innerHTML = `
      <div class="dx-frame">
        <div class="dx-screen no-nav" style="justify-content:center;text-align:center;padding:0 28px">
          <div style="font-size:84px">🪪</div>
          <h1 class="dx-h2" style="font-size:26px;margin-top:22px" id="v-title">Verification in progress</h1>
          <p class="dx-sub" style="margin-top:10px" id="v-sub">We're confirming your identity — this usually takes a few seconds in the demo.</p>
          <div class="dx-looking" style="margin-top:28px;border-radius:99px"></div>
        </div>
      </div>`
    setTimeout(async () => {
      const t = $('#v-title'); const s = $('#v-sub')
      if (t) { t.textContent = "You're verified!"; s.textContent = 'Your account is ready. Time to hit the road.' }
      await refreshSelf()
      setTimeout(() => { state.tab = 'home'; renderApp() }, 900)
    }, 1800)
  }

  // ============================================================
  //  SHARED SHELL
  // ============================================================
  async function refreshSelf() {
    const res = await api.self()
    if (res && res.driver) { state.self = res; return res }
    if (res && (res.error === 'unauthorized' || res.error === 'driver_forbidden')) { saveSession(null); renderWelcome() }
    return null
  }

  function navHtml() {
    const items = [
      ['home', 'Home', 'fa-house'],
      ['earnings', 'Earnings', 'fa-chart-simple'],
      ['ratings', 'Ratings', 'fa-star'],
      ['account', 'Account', 'fa-user'],
    ]
    return `<nav class="dx-nav">${items.map(([k, t, ic]) => `
      <button data-tab="${k}" class="${state.tab === k ? 'active' : ''}"><i class="fa-solid ${ic}"></i>${t}</button>`).join('')}</nav>`
  }
  function bindNav() {
    $$('.dx-nav button').forEach((b) => b.addEventListener('click', () => {
      state.tab = b.dataset.tab
      renderApp()
    }))
  }

  async function renderApp() {
    if (!session) return renderWelcome()
    stopTimers()
    if (!state.self) await refreshSelf()
    if (!state.self) return
    // an in-flight delivery takes over the screen
    if (state.self.delivery) return renderDelivery()
    if (state.tab === 'home') return renderHome()
    if (state.tab === 'earnings') return renderEarnings()
    if (state.tab === 'ratings') return renderRatings()
    if (state.tab === 'account') return renderAccount()
    renderHome()
  }

  // ============================================================
  //  HOME
  // ============================================================
  function renderHome() {
    const d = state.self.driver
    const online = !!state.self.shift
    const endsAt = online && state.self.shift.ends_at ? new Date(state.self.shift.ends_at.replace(' ', 'T') + 'Z') : null
    root.innerHTML = `
      <div class="dx-frame">
        <div class="dx-screen" style="padding-bottom:0">
          ${online ? `
            <div class="dx-topbar" style="background:#fff">
              <button class="dx-icon-btn" id="h-shift-menu"><i class="fa-solid fa-bars"></i></button>
              <div style="font-weight:800;font-size:17px">Looking for offers</div>
              <button class="dx-icon-btn" id="h-help"><i class="fa-regular fa-circle-question"></i></button>
            </div>
            <div class="dx-looking"></div>` : `
            <div class="dx-topbar" style="background:#fff">
              <div style="font-weight:800;font-size:20px">Menu Courier<span style="color:var(--dx-red)">.</span></div>
              <span class="dx-badge gray"><i class="fa-solid fa-location-dot"></i> ${esc(d.city)}</span>
            </div>`}
          <div class="dx-map">
            ${mapSvg(d.city)}
            ${online ? `
              <div class="dx-map-float" style="top:14px;right:14px">
                <div style="background:#fff;border-radius:14px;padding:10px 14px;box-shadow:0 2px 10px rgba(0,0,0,.15);text-align:right">
                  <div style="font-size:22px;font-weight:800;color:var(--dx-green)">${money(state.self.shift_earnings)}</div>
                  <div style="font-size:12px;color:var(--dx-muted);font-weight:600">this shift <i class="fa-solid fa-circle-info"></i></div>
                </div>
              </div>` : ''}
            <div class="dx-map-float" style="top:46%;left:50%;transform:translate(-50%,-50%)">
              <div class="dx-pin" style="background:${online ? 'var(--dx-red)' : 'var(--dx-ink)'}"><i class="fa-solid ${vehicleMeta(d.vehicle_type)[3]}"></i></div>
            </div>
          </div>
          <div class="dx-sheet with-nav">
            <div class="grab"></div>
            ${online ? `
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div>
                  <div style="font-weight:800;font-size:19px">${state.paused ? 'Offers paused' : 'Finding offers near you…'}</div>
                  <div class="dx-sub" style="margin-top:2px">${endsAt ? `Shift ends at ${fmtTime(endsAt)}` : 'Open-ended shift'} · ${state.self.shift_deliveries} ${state.self.shift_deliveries === 1 ? 'delivery' : 'deliveries'}</div>
                </div>
                <span class="dx-badge ${state.paused ? 'gray' : 'green'}">${state.paused ? 'Paused' : 'Online'}</span>
              </div>
              <div id="h-empty" style="display:none;margin-top:14px" class="dx-card">
                <div style="padding:14px 16px">
                  <div style="font-weight:800">It's quiet right now</div>
                  <div class="dx-sub" style="font-size:14px;margin-top:2px">No live orders nearby. Send yourself a practice order to see how deliveries work.</div>
                  <button class="dx-btn dx-btn-secondary dx-btn-sm" id="h-demo" style="margin-top:12px"><i class="fa-solid fa-wand-magic-sparkles"></i> Try a demo order</button>
                </div>
              </div>
              <div style="display:flex;gap:10px;margin-top:16px">
                <button class="dx-btn dx-btn-secondary" id="h-pause">${state.paused ? '<i class="fa-solid fa-play"></i> Resume' : '<i class="fa-solid fa-pause"></i> Pause'}</button>
                <button class="dx-btn dx-btn-secondary" id="h-end" style="color:var(--dx-red)"><i class="fa-solid fa-xmark"></i> End shift</button>
              </div>` : `
              <div style="font-weight:800;font-size:22px;letter-spacing:-0.3px">Ready to earn, ${esc(d.first_name)}?</div>
              <div class="dx-sub" style="margin-top:4px">It's a great time to deliver in ${esc(d.city)}. Demand is steady near you.</div>
              <div style="display:flex;gap:10px;margin-top:16px;align-items:center">
                <div style="flex:1">
                  <label class="dx-label" style="font-size:13px;color:var(--dx-muted)">Go online for</label>
                  <select class="dx-input" id="h-duration" style="padding:12px 14px">
                    <option value="120">2 hours</option>
                    <option value="240" selected>4 hours</option>
                    <option value="360">6 hours</option>
                    <option value="480">8 hours</option>
                  </select>
                </div>
                <div style="flex:1.4;align-self:flex-end">
                  <button class="dx-btn dx-btn-primary" id="h-goonline">Go Online</button>
                </div>
              </div>`}
          </div>
          ${navHtml()}
        </div>
      </div>`
    bindNav()

    if (!online) {
      $('#h-goonline').addEventListener('click', async () => {
        const res = await api.shiftStart({ duration_min: Number($('#h-duration').value) })
        if (res.shift) { toast("You're online — let's deliver!", 'fa-solid fa-bolt'); state.emptyPolls = 0; await refreshSelf(); renderHome() }
      })
      return
    }

    $('#h-pause').addEventListener('click', () => { state.paused = !state.paused; renderHome() })
    $('#h-end').addEventListener('click', showEndShift)
    $('#h-shift-menu').addEventListener('click', showCurrentShift)
    $('#h-help').addEventListener('click', () => toast('Support is a demo away 😄', 'fa-regular fa-circle-question'))
    const demoBtn = () => $('#h-demo') && $('#h-demo').addEventListener('click', async () => {
      $('#h-demo').disabled = true
      const res = await api.demoOrder()
      if (res.ok) toast('Demo order placed nearby', 'fa-solid fa-wand-magic-sparkles')
      state.emptyPolls = 0
      pollOffers()
    })
    demoBtn()
    pollOffers()
  }

  function pollOffers() {
    clearTimeout(state.pollTimer)
    if (!state.self || !state.self.shift || state.self.delivery || state.offer || state.paused) return
    state.pollTimer = setTimeout(async () => {
      if (!state.self || !state.self.shift || state.paused) return
      const res = await api.offers(state.skips)
      if (res.offer) {
        state.offer = res.offer
        state.emptyPolls = 0
        showOfferSheet(res.offer)
        return
      }
      if (res.reason === 'no_orders') {
        state.emptyPolls++
        const empty = $('#h-empty')
        if (empty && state.emptyPolls >= 2) empty.style.display = 'block'
      }
      pollOffers()
    }, 3500)
  }

  // ---------- offer sheet ----------
  function showOfferSheet(offer) {
    clearTimeout(state.pollTimer)
    const frame = $('.dx-frame', root)
    const deliverBy = fmtTime(new Date(Date.now() + offer.deliver_by_min * 60000))
    const ov = document.createElement('div')
    ov.className = 'dx-overlay'
    ov.innerHTML = `
      <div class="dx-modal" style="padding-top:16px">
        <div style="display:flex;justify-content:flex-end"><button class="dx-btn dx-btn-secondary dx-btn-sm" id="o-decline">Decline</button></div>
        <div style="display:flex;align-items:baseline;gap:10px;margin-top:4px">
          <span class="dx-offer-pay">${money(offer.total_pay)}</span>
          <span class="dx-sub" style="font-size:16px">Guaranteed (incl. tips)</span>
        </div>
        <div class="dx-offer-meta">${offer.distance_km} km</div>
        <div class="dx-offer-meta" style="color:var(--dx-muted)">Deliver by ${deliverBy}</div>
        <div class="dx-hair" style="margin:16px 0 4px"></div>
        <div class="dx-timeline">
          <div class="tl-line"></div>
          <div class="tl-row">
            <span class="tl-ic" style="color:var(--dx-red)"><i class="fa-solid fa-bag-shopping"></i></span>
            <span>
              <span style="color:var(--dx-red);font-weight:800;font-size:14px">Restaurant pickup${offer.is_demo ? ' · DEMO' : ''}</span><br/>
              <span style="font-weight:800;font-size:17px">${esc(offer.vendor_name)}</span> <span class="dx-sub">(${offer.items_count} ${offer.items_count === 1 ? 'item' : 'items'})</span><br/>
              <span class="dx-sub" style="font-size:14px">${esc(offer.vendor_address || '')}</span>
            </span>
          </div>
          <div class="tl-row">
            <span class="tl-ic"><i class="fa-solid fa-house"></i></span>
            <span><span style="font-weight:800;font-size:16px">Customer dropoff</span><br/>
            <span class="dx-sub" style="font-size:14px">${esc(offer.dropoff_address)}</span></span>
          </div>
        </div>
        <button class="dx-btn dx-btn-primary dx-accept-btn" id="o-accept">Accept <span class="count" id="o-count">45</span></button>
      </div>`
    frame.appendChild(ov)

    let count = 45
    state.countTimer = setInterval(() => {
      count--
      const el = $('#o-count')
      if (el) el.textContent = String(count)
      if (count <= 0) doDecline()
    }, 1000)

    const cleanup = () => { clearInterval(state.countTimer); state.countTimer = null; ov.remove(); state.offer = null }
    const doDecline = async () => {
      cleanup()
      state.skips.push(offer.order_id)
      api.decline(offer.order_id)
      toast('Offer declined', 'fa-solid fa-xmark')
      pollOffers()
    }
    $('#o-decline', ov).addEventListener('click', doDecline)
    $('#o-accept', ov).addEventListener('click', async () => {
      const res = await api.accept(offer.order_id)
      cleanup()
      if (res.delivery) {
        await refreshSelf()
        renderDelivery()
      } else {
        toast('Offer no longer available', 'fa-solid fa-circle-exclamation')
        state.skips.push(offer.order_id)
        pollOffers()
      }
    })
  }

  // ---------- current shift / end shift ----------
  function showCurrentShift() {
    const frame = $('.dx-frame', root)
    const s = state.self.shift
    const endsAt = s && s.ends_at ? fmtTime(new Date(s.ends_at.replace(' ', 'T') + 'Z')) : '—'
    const ov = document.createElement('div')
    ov.className = 'dx-overlay'
    ov.innerHTML = `
      <div class="dx-modal">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 class="dx-h2">Current shift</h2>
          <button class="dx-icon-btn" id="cd-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="dx-money-row" style="margin-top:10px"><span class="k">Earnings this shift</span><span class="v" style="font-weight:800">${money(state.self.shift_earnings)}</span></div>
        <div class="dx-money-row"><span class="k">Deliveries</span><span class="v" style="font-weight:800">${state.self.shift_deliveries}</span></div>
        <div class="dx-money-row"><span class="k">Shift ends at</span><span class="v" style="font-weight:800">${endsAt}</span></div>
        <div style="display:flex;gap:10px;margin-top:18px">
          <button class="dx-btn dx-btn-secondary" id="cd-pause">${state.paused ? '<i class="fa-solid fa-play"></i> Resume offers' : '<i class="fa-solid fa-pause"></i> Pause offers'}</button>
          <button class="dx-btn dx-btn-secondary" id="cd-end" style="color:var(--dx-red)"><i class="fa-solid fa-xmark"></i> End now</button>
        </div>
      </div>`
    frame.appendChild(ov)
    $('#cd-close', ov).addEventListener('click', () => ov.remove())
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove() })
    $('#cd-pause', ov).addEventListener('click', () => { state.paused = !state.paused; ov.remove(); renderHome() })
    $('#cd-end', ov).addEventListener('click', () => { ov.remove(); showEndShift() })
  }

  async function showEndShift() {
    const res = await api.shiftEnd()
    if (res.error === 'delivery_in_progress') return toast('Finish your current delivery first', 'fa-solid fa-circle-exclamation')
    if (res.error) return toast('Could not end shift', 'fa-solid fa-circle-exclamation')
    stopTimers()
    const frame = $('.dx-frame', root)
    const ov = document.createElement('div')
    ov.className = 'dx-overlay'
    ov.innerHTML = `
      <div class="dx-modal" style="text-align:center;padding-bottom:34px">
        <div style="font-size:56px;margin-top:6px">🎉</div>
        <h2 class="dx-h2" style="margin-top:10px">Nice work out there!</h2>
        <div class="dx-sub" style="margin-top:4px">Here's how you did</div>
        <div class="dx-stats" style="margin-top:18px;text-align:left">
          <div class="dx-stat"><div class="v" style="color:var(--dx-green)">${money(res.earnings)}</div><div class="k">Earned this shift</div></div>
          <div class="dx-stat"><div class="v">${res.deliveries}</div><div class="k">Deliveries</div></div>
        </div>
        <button class="dx-btn dx-btn-primary" id="ed-done" style="margin-top:22px">Done</button>
      </div>`
    frame.appendChild(ov)
    $('#ed-done', ov).addEventListener('click', async () => { ov.remove(); state.paused = false; await refreshSelf(); renderApp() })
  }

  // ============================================================
  //  ACTIVE DELIVERY FLOW
  // ============================================================
  async function renderDelivery() {
    stopTimers()
    const res = await api.delivery()
    if (!res.delivery) { state.deliveryCtx = null; await refreshSelf(); return renderApp() }
    state.deliveryCtx = res
    const { delivery, vendor, vendor_address, items, customer_name } = res
    const d = state.self.driver
    const flow = ['accepted', 'arrived_store', 'picked_up', 'arrived_customer']
    const stepIdx = Math.max(0, flow.indexOf(delivery.status))
    const toStore = delivery.status === 'accepted' || delivery.status === 'arrived_store'
    const itemsHtml = items.map((it, i) => `
      <label class="dx-check" style="padding:10px 0;border-bottom:1px solid var(--dx-line)">
        <input type="checkbox" class="pick-check" data-i="${i}" ${delivery.status !== 'arrived_store' ? 'checked disabled' : ''} />
        <span style="font-size:16px"><b>${it.qty}×</b> ${esc(it.name)}</span>
      </label>`).join('')

    const stage = {
      accepted: {
        title: `Pick up from ${esc(vendor.org_name)}`,
        sub: vendor_address ? esc(vendor_address) : 'Head to the restaurant',
        icon: 'fa-bag-shopping',
        btn: "Arrived at store",
        body: `<div class="dx-sub" style="margin-top:10px;font-weight:700;color:var(--dx-ink)">Order ${delivery.order_id} · ${items.reduce((s, i2) => s + i2.qty, 0)} items</div>${itemsHtml}`,
      },
      arrived_store: {
        title: 'Confirm you have the order',
        sub: `Check each item from ${esc(vendor.org_name)} before leaving`,
        icon: 'fa-list-check',
        btn: 'Confirm pickup',
        body: itemsHtml,
      },
      picked_up: {
        title: `Deliver to ${esc(customer_name)}`,
        sub: esc(delivery.dropoff_address || ''),
        icon: 'fa-house',
        btn: 'Arrived at customer',
        body: `<div class="dx-card" style="margin-top:12px"><div style="padding:12px 16px;display:flex;gap:12px;align-items:center">
          <i class="fa-regular fa-message" style="color:var(--dx-red)"></i>
          <span class="dx-sub" style="font-size:14px">"Please call when you arrive at the gate. Thanks!"</span>
        </div></div>`,
      },
      arrived_customer: {
        title: `Hand order to ${esc(customer_name)}`,
        sub: 'Follow the drop-off instructions to complete this delivery',
        icon: 'fa-hand-holding-heart',
        btn: 'Complete delivery',
        body: `
          <div style="margin-top:12px">
            <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 0">
              <span style="width:26px;height:26px;border-radius:99px;border:2px solid var(--dx-ink);display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0">1</span>
              <span><b>Hand the order to the customer</b><br/><span class="dx-sub" style="font-size:14px">Greet ${esc(customer_name)} and confirm the order name.</span></span>
            </div>
            <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 0">
              <span style="width:26px;height:26px;border-radius:99px;border:2px solid var(--dx-ink);display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0">2</span>
              <span><b>Be kind — ratings matter</b><br/><span class="dx-sub" style="font-size:14px">A smile goes a long way to a 5-star rating.</span></span>
            </div>
          </div>`,
      },
    }[delivery.status]

    root.innerHTML = `
      <div class="dx-frame">
        <div class="dx-screen no-nav" style="padding-bottom:0">
          <div class="dx-topbar">
            <span class="dx-badge red">${toStore ? 'Pickup' : 'Dropoff'}${Number(delivery.tip) ? '' : ''}</span>
            <span style="font-weight:800">${money(delivery.total_pay)} guaranteed</span>
            <button class="dx-icon-btn" id="dv-help"><i class="fa-regular fa-circle-question"></i></button>
          </div>
          <div class="dx-map" style="min-height:220px;flex:0.8">
            ${mapSvg(d.city)}
            <div class="dx-map-float" style="top:30%;left:${toStore ? '62%' : '30%'};transform:translate(-50%,-50%)">
              <div class="dx-pin"><i class="fa-solid ${toStore ? 'fa-bag-shopping' : 'fa-house'}"></i></div>
            </div>
            <div class="dx-map-float" style="top:64%;left:${toStore ? '34%' : '66%'};transform:translate(-50%,-50%)">
              <div class="dx-pin" style="background:var(--dx-red);width:44px;height:44px;font-size:16px"><i class="fa-solid ${vehicleMeta(d.vehicle_type)[3]}"></i></div>
            </div>
          </div>
          <div class="dx-sheet" style="flex:1">
            <div class="grab"></div>
            <div class="dx-steps">${flow.map((f2, i) => `<span class="${i <= stepIdx ? 'on' : ''}"></span>`).join('')}</div>
            <div style="display:flex;gap:14px;align-items:flex-start">
              <div class="dx-pin" style="width:44px;height:44px;font-size:16px;flex-shrink:0"><i class="fa-solid ${stage.icon}"></i></div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:800;font-size:20px;letter-spacing:-0.3px">${stage.title}</div>
                <div class="dx-sub" style="margin-top:2px">${stage.sub}</div>
              </div>
            </div>
            <div id="dv-body">${stage.body}</div>
            <button class="dx-btn dx-btn-primary" id="dv-advance" style="margin-top:18px">${stage.btn}</button>
          </div>
        </div>
      </div>`

    $('#dv-help').addEventListener('click', () => toast('Support is a demo away 😄'))
    const advBtn = $('#dv-advance')
    if (delivery.status === 'arrived_store') {
      advBtn.disabled = true
      const gate = () => { advBtn.disabled = !$$('.pick-check').every((c2) => c2.checked) }
      $$('.pick-check').forEach((c2) => c2.addEventListener('change', gate))
      gate()
    }
    advBtn.addEventListener('click', async () => {
      advBtn.disabled = true
      const res2 = await api.advance(delivery.id)
      if (!res2.delivery) { toast('Something went wrong'); advBtn.disabled = false; return }
      if (res2.delivery.status === 'delivered') {
        await refreshSelf()
        showDeliveryComplete(res2.delivery)
      } else {
        await refreshSelf()
        renderDelivery()
      }
    })
  }

  function showDeliveryComplete(delivery) {
    const d = state.self.driver
    root.innerHTML = `
      <div class="dx-frame">
        <div class="dx-screen no-nav" style="padding-bottom:0">
          <div class="dx-map" style="flex:0.7;min-height:200px;filter:saturate(.7)">${mapSvg(d.city)}</div>
          <div class="dx-sheet" style="flex:1">
            <div class="grab"></div>
            <h2 class="dx-h2" style="text-align:center;margin-top:4px">Delivery complete!</h2>
            <div class="dx-hair" style="margin:16px 0 6px"></div>
            <div class="dx-money-row"><span class="k">Base pay</span><span class="v">${money(delivery.base_pay)}</span></div>
            <div style="font-weight:800;margin-top:8px">Tip</div>
            <div class="dx-money-row sub"><span class="k">Customer tip</span><span class="v">${money(delivery.tip)}</span></div>
            <div class="dx-money-row total"><span class="k">Total <i class="fa-solid fa-circle-info" style="color:var(--dx-faint);font-size:14px"></i></span><span class="v">${money(delivery.total_pay)}</span></div>
            <div style="text-align:center;margin-top:10px">
              <span class="dx-stars">${'★'.repeat(delivery.customer_rating || 5)}</span>
              <div class="dx-sub" style="font-size:13px;margin-top:2px">${esc('Customer rated this delivery')}</div>
            </div>
            <button class="dx-btn dx-btn-primary" id="dc-got" style="margin-top:18px">Got it</button>
          </div>
        </div>
      </div>`
    $('#dc-got').addEventListener('click', async () => {
      state.deliveryCtx = null
      await refreshSelf()
      state.tab = 'home'
      renderApp()
    })
  }

  // ============================================================
  //  EARNINGS
  // ============================================================
  async function renderEarnings() {
    const res = await api.earnings()
    const week = res.week || { total: 0, base: 0, tips: 0, n: 0 }
    const byDay = res.by_day || []
    const lifetime = res.lifetime || { total: 0, n: 0 }
    const shifts = (res.shifts || []).filter((s) => s.status === 'ended' || Number(s.earnings) > 0)

    // build a 7-day bar strip (oldest → newest)
    const days = []
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 86400000)
      const iso = dt.toISOString().slice(0, 10)
      const hit = byDay.find((r) => r.day === iso)
      days.push({ lbl: dt.toLocaleDateString('en-NG', { weekday: 'narrow' }), total: Number(hit?.total || 0) })
    }
    const max = Math.max(1, ...days.map((d2) => d2.total))

    root.innerHTML = `
      <div class="dx-frame">
        <div class="dx-screen">
          <div class="dx-topbar"><h1 class="dx-h2" style="font-size:26px">Earnings</h1><button class="dx-icon-btn"><i class="fa-regular fa-circle-question"></i></button></div>
          <div style="padding:6px 20px 20px">
            <div class="dx-sub" style="font-weight:700">This week</div>
            <div style="font-size:40px;font-weight:800;letter-spacing:-1px;margin-top:2px">${money(week.total)}</div>
            <div class="dx-bars">
              ${days.map((d2) => `<div class="bar"><div class="fill" style="height:${Math.round((d2.total / max) * 100)}%;${d2.total ? '' : 'background:var(--dx-line)'}"></div><div class="lbl">${d2.lbl}</div></div>`).join('')}
            </div>
            <div class="dx-hair" style="margin:16px 0 6px"></div>
            <div class="dx-money-row"><span class="k">Base pay</span><span class="v">${money(week.base)}</span></div>
            <div class="dx-money-row"><span class="k">Customer tips</span><span class="v">${money(week.tips)}</span></div>
            <div class="dx-money-row"><span class="k">Completed deliveries</span><span class="v">${week.n}</span></div>
            <div class="dx-money-row total"><span class="k">Total</span><span class="v">${money(week.total)}</span></div>
          </div>
          <div class="dx-divider"></div>
          <div style="padding:20px">
            <h2 class="dx-h2" style="font-size:20px">Shifts</h2>
            ${shifts.length ? shifts.map((s) => {
              const st = new Date(String(s.started_at).replace(' ', 'T') + 'Z')
              const en = s.ended_at ? new Date(String(s.ended_at).replace(' ', 'T') + 'Z') : null
              const mins = en ? Math.max(1, Math.round((en - st) / 60000)) : null
              return `<div class="dx-money-row" style="align-items:center">
                <span class="k"><b>${st.toLocaleDateString('en-NG', { weekday: 'long', month: 'short', day: 'numeric' })}</b><br/>
                <span class="dx-sub" style="font-size:13px">${fmtTime(st)}${en ? ` – ${fmtTime(en)}` : ' · active'}${mins ? ` · ${mins}m` : ''} · ${s.deliveries} ${Number(s.deliveries) === 1 ? 'delivery' : 'deliveries'}</span></span>
                <span class="v" style="font-weight:800">${money(s.earnings)}</span>
              </div>`
            }).join('') : `<div class="dx-sub" style="margin-top:8px">No shifts yet. Hit <b>Go Online</b> to start earning.</div>`}
          </div>
          <div class="dx-divider"></div>
          <div style="padding:20px">
            <div class="dx-money-row"><span class="k">Lifetime earnings</span><span class="v" style="font-weight:800;color:var(--dx-green)">${money(lifetime.total)}</span></div>
            <div class="dx-money-row"><span class="k">Lifetime deliveries</span><span class="v" style="font-weight:800">${lifetime.n}</span></div>
          </div>
          ${navHtml()}
        </div>
      </div>`
    bindNav()
  }

  // ============================================================
  //  RATINGS
  // ============================================================
  async function renderRatings() {
    const res = await api.ratings()
    const stars = Math.round(Number(res.rating_avg || 5))
    root.innerHTML = `
      <div class="dx-frame">
        <div class="dx-screen">
          <div class="dx-topbar"><h1 class="dx-h2" style="font-size:26px">Ratings</h1><button class="dx-icon-btn"><i class="fa-regular fa-circle-question"></i></button></div>
          <div style="padding:6px 20px 20px;text-align:center">
            <div style="font-size:52px;font-weight:800;letter-spacing:-1px">${Number(res.rating_avg || 5).toFixed(1)}</div>
            <div class="dx-stars" style="font-size:24px">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</div>
            <div class="dx-sub" style="margin-top:4px">Customer rating · ${res.rating_count} ${res.rating_count === 1 ? 'rating' : 'ratings'}</div>
          </div>
          <div style="padding:0 20px 20px">
            <div class="dx-stats">
              <div class="dx-stat"><div class="v">${res.acceptance_rate}%</div><div class="k">Acceptance rate</div></div>
              <div class="dx-stat"><div class="v">${res.completion_rate}%</div><div class="k">Completion rate</div></div>
              <div class="dx-stat"><div class="v">${res.on_time_rate}%</div><div class="k">On-time or early</div></div>
              <div class="dx-stat"><div class="v">${res.lifetime_deliveries}</div><div class="k">Lifetime deliveries</div></div>
            </div>
          </div>
          <div class="dx-divider"></div>
          <div style="padding:20px">
            <h2 class="dx-h2" style="font-size:20px">Recent deliveries</h2>
            ${(res.recent || []).length ? res.recent.map((r) => `
              <div class="dx-money-row" style="align-items:center">
                <span class="k"><b>${esc(r.vendor_name)}</b><br/><span class="dx-stars" style="font-size:14px">${'★'.repeat(r.customer_rating || 5)}</span>
                <span class="dx-sub" style="font-size:13px"> · On time</span></span>
                <span class="v" style="font-weight:800;color:var(--dx-green)">${money(r.total_pay)}</span>
              </div>`).join('') : '<div class="dx-sub" style="margin-top:8px">Complete your first delivery to see ratings here.</div>'}
          </div>
          ${navHtml()}
        </div>
      </div>`
    bindNav()
  }

  // ============================================================
  //  ACCOUNT
  // ============================================================
  function renderAccount() {
    const d = state.self.driver
    const vm = vehicleMeta(d.vehicle_type)
    root.innerHTML = `
      <div class="dx-frame">
        <div class="dx-screen">
          <div class="dx-topbar"><h1 class="dx-h2" style="font-size:26px">Account</h1></div>
          <div style="padding:6px 20px 20px;display:flex;gap:14px;align-items:center">
            <div style="width:60px;height:60px;border-radius:999px;background:var(--dx-ink);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800">${esc((d.first_name || 'D')[0].toUpperCase())}</div>
            <div>
              <div style="font-weight:800;font-size:19px">${esc(d.first_name)} ${esc(d.last_name || '')}</div>
              <div class="dx-sub" style="font-size:14px"><i class="fa-solid ${vm[3]}"></i> ${vm[1]} · ${esc(d.city)} · <span class="dx-stars" style="font-size:13px">★</span> ${Number(d.rating_avg || 5).toFixed(1)}</div>
            </div>
          </div>
          <div class="dx-divider"></div>
          <div>
            <button class="dx-row" id="a-vehicle"><i class="fa-solid fa-car-side"></i><span class="grow"><b>Vehicle management</b><br/><span class="dx-sub" style="font-size:13px">${vm[1]}</span></span><i class="fa-solid fa-chevron-right chev"></i></button>
            <button class="dx-row" id="a-bank"><i class="fa-solid fa-building-columns"></i><span class="grow"><b>Payout method</b><br/><span class="dx-sub" style="font-size:13px">${state.bank ? `Bank ····${esc(String(state.bank.account).slice(-4))}` : 'Add a bank account'}</span></span><i class="fa-solid fa-chevron-right chev"></i></button>
            <button class="dx-row" id="a-sched"><i class="fa-regular fa-calendar"></i><span class="grow"><b>Schedule</b><br/><span class="dx-sub" style="font-size:13px">Deliver whenever — no slots needed in ${esc(d.city)}</span></span><i class="fa-solid fa-chevron-right chev"></i></button>
          </div>
          <div class="dx-divider"></div>
          <div style="padding:16px 20px 6px"><h2 style="font-weight:800;font-size:17px">Preferences</h2></div>
          <div>
            <div class="dx-row" style="cursor:default"><i class="fa-solid fa-bolt"></i><span class="grow"><b>Flash offers</b><br/><span class="dx-sub" style="font-size:13px">Get notified about new offers near you</span></span>
              <label class="dx-toggle"><input type="checkbox" id="p-flash" ${state.prefs.autoAccept ? 'checked' : ''} /><span class="tr"></span></label></div>
            <div class="dx-row" style="cursor:default"><i class="fa-regular fa-message"></i><span class="grow"><b>Read instructions on arrival</b><br/><span class="dx-sub" style="font-size:13px">Show customer notes when you arrive</span></span>
              <label class="dx-toggle"><input type="checkbox" id="p-notes" ${state.prefs.arrivalNotes ? 'checked' : ''} /><span class="tr"></span></label></div>
            <div class="dx-row" style="cursor:default"><i class="fa-solid fa-shield-heart"></i><span class="grow"><b>Safety check-in</b><br/><span class="dx-sub" style="font-size:13px">We check in if a shift isn't going as planned</span></span>
              <label class="dx-toggle"><input type="checkbox" id="p-safe" ${state.prefs.safeAlerts ? 'checked' : ''} /><span class="tr"></span></label></div>
          </div>
          <div class="dx-divider"></div>
          <div>
            <button class="dx-row" id="a-order"><i class="fa-solid fa-burger"></i><span class="grow"><b>Order food on Menu</b></span><i class="fa-solid fa-chevron-right chev"></i></button>
            <button class="dx-row" id="a-signout" style="color:var(--dx-red)"><i class="fa-solid fa-arrow-right-from-bracket"></i><span class="grow"><b>Sign out</b></span></button>
          </div>
          ${navHtml()}
        </div>
      </div>`
    bindNav()
    $('#a-order').addEventListener('click', () => { location.href = '/app' })
    $('#a-signout').addEventListener('click', () => {
      if (confirm('Sign out of Menu Courier?')) { stopTimers(); saveSession(null); state.self = null; renderWelcome() }
    })
    $('#a-vehicle').addEventListener('click', showVehicleModal)
    $('#a-bank').addEventListener('click', showBankModal)
    $('#a-sched').addEventListener('click', () => toast('Open scheduling is on — deliver any time', 'fa-regular fa-calendar-check'))
    const bindPref = (id, key) => $('#' + id).addEventListener('change', (e) => { state.prefs[key] = e.target.checked; savePrefs() })
    bindPref('p-flash', 'autoAccept'); bindPref('p-notes', 'arrivalNotes'); bindPref('p-safe', 'safeAlerts')
  }

  function showVehicleModal() {
    const d = state.self.driver
    const frame = $('.dx-frame', root)
    const ov = document.createElement('div')
    ov.className = 'dx-overlay'
    ov.innerHTML = `
      <div class="dx-modal">
        <div style="display:flex;justify-content:space-between;align-items:center"><h2 class="dx-h2">Vehicle management</h2>
        <button class="dx-icon-btn" id="vm-close"><i class="fa-solid fa-xmark"></i></button></div>
        <p class="dx-sub" style="margin:6px 0 14px">Your method of transport determines what offers you're eligible for.</p>
        <div id="vm-list">
          ${VEHICLES.map(([key, t, ds, ic]) => `
            <button class="dx-opt ${d.vehicle_type === key ? 'sel' : ''}" data-veh="${key}">
              <span class="radio"></span>
              <span><span class="t">${t}</span><br/><span class="d">${ds}</span></span>
              <i class="fa-solid ${ic} ic"></i>
            </button>`).join('')}
        </div>
        <button class="dx-btn dx-btn-primary" id="vm-save">Save</button>
      </div>`
    frame.appendChild(ov)
    let sel = d.vehicle_type
    $$('#vm-list .dx-opt', ov).forEach((b) => b.addEventListener('click', () => {
      sel = b.dataset.veh
      $$('#vm-list .dx-opt', ov).forEach((x) => x.classList.toggle('sel', x === b))
    }))
    $('#vm-close', ov).addEventListener('click', () => ov.remove())
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove() })
    $('#vm-save', ov).addEventListener('click', async () => {
      const res = await api.register({
        first_name: d.first_name, last_name: d.last_name, email: session.user.email,
        phone: d.phone, city: d.city, vehicle_type: sel,
      })
      if (res.driver) { saveSession({ token: res.token, user: res.user, driver: res.driver }); await refreshSelf(); ov.remove(); toast('Vehicle updated', 'fa-solid fa-circle-check'); renderAccount() }
    })
  }

  function showBankModal() {
    const frame = $('.dx-frame', root)
    const ov = document.createElement('div')
    ov.className = 'dx-overlay'
    ov.innerHTML = `
      <div class="dx-modal">
        <div style="display:flex;justify-content:space-between;align-items:center"><h2 class="dx-h2">Add a bank account</h2>
        <button class="dx-icon-btn" id="bk-close"><i class="fa-solid fa-xmark"></i></button></div>
        <p class="dx-sub" style="margin:6px 0 16px">Earnings are deposited weekly. For your security, payouts pause for 24 hours after changing bank details.</p>
        <label class="dx-label">Bank name</label>
        <input class="dx-input" id="bk-bank" placeholder="GTBank" value="${esc(state.bank?.bank || '')}" />
        <label class="dx-label" style="margin-top:14px">Account number</label>
        <input class="dx-input" id="bk-acct" inputmode="numeric" placeholder="0123456789" value="${esc(state.bank?.account || '')}" />
        <button class="dx-btn dx-btn-primary" id="bk-save" style="margin-top:20px">Submit</button>
        <button class="dx-btn dx-btn-secondary" id="bk-cancel" style="margin-top:10px">Cancel</button>
      </div>`
    frame.appendChild(ov)
    const close = () => ov.remove()
    $('#bk-close', ov).addEventListener('click', close)
    $('#bk-cancel', ov).addEventListener('click', close)
    ov.addEventListener('click', (e) => { if (e.target === ov) close() })
    $('#bk-save', ov).addEventListener('click', () => {
      const bank = $('#bk-bank', ov).value.trim()
      const account = $('#bk-acct', ov).value.trim()
      if (!bank || account.length < 10) return toast('Enter a valid bank and 10-digit account', 'fa-solid fa-circle-exclamation')
      state.bank = { bank, account }
      store.set('menu_driver_bank', state.bank)
      close(); toast('Bank account saved', 'fa-solid fa-circle-check')
      renderAccount()
    })
  }

  // ---------- boot ----------
  if (session) {
    refreshSelf().then((s) => { if (s) renderApp() })
  } else {
    renderWelcome()
  }
})()

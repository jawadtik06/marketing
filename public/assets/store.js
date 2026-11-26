/* 3Dway store logic: catalog, cart, checkout, reviews, newsletter.
   Works on its own; assets/scene.js adds 3D thumbnails and viewers through window.STORE3D. */
(() => {
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let DB = {products:[], settings:{currency:'$'}, categories:[]}, cat = 'All', cart = [], promoOn = false;
try { cart = JSON.parse(localStorage.getItem('w3d-cart') || '[]') } catch { cart = [] }
const money = n => DB.settings.currency + n.toFixed(2);
const avg = p => p.reviews.length ? p.reviews.reduce((a, r) => a + r.rating, 0) / p.reviews.length : 0;
const stars = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const find = id => DB.products.find(x => x.id === id);
const ICON = {
  plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  cube:'<svg viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg>',
  tick:'<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
};

// ---------- Product art: 3D render when available, else image, else flat illustration ----------
function svgArt(p){
  const c = p.color, s = {
    cube:`<path d="M100 60l60 30v70l-60 30-60-30V90z" fill="#fff" fill-opacity=".9"/><path d="M100 60l60 30-60 30-60-30z" fill="#fff"/><path d="M100 120v70M40 90l60 30 60-30" stroke="${c}" stroke-width="3" fill="none"/>`,
    vase:`<path d="M80 50h40c0 25 30 40 30 80 0 30-20 50-50 50s-50-20-50-50c0-40 30-55 30-80z" fill="#fff"/><path d="M62 110h76M58 135h84M64 160h72" stroke="${c}" stroke-width="3"/>`,
    nozzle:`<path d="M75 45h50v45H75z" fill="#fff"/><path d="M80 90h40l-14 55h-12z" fill="#fff"/><path d="M96 145h8v22h-8z" fill="#fff"/><path d="M75 62h50M75 76h50" stroke="${c}" stroke-width="3"/>`,
    gear:`<circle cx="100" cy="100" r="48" fill="#fff"/><g fill="#fff">${Array.from({length:8},(_,i)=>`<rect x="88" y="38" width="24" height="26" transform="rotate(${i*45} 100 100)"/>`).join('')}</g><circle cx="100" cy="100" r="18" fill="${c}"/>`,
    plate:`<path d="M30 95l70-30 70 30-70 30z" fill="#fff"/><path d="M30 95v14l70 30 70-30V95l-70 30z" fill="#fff" fill-opacity=".7"/><path d="M60 95l40-17 40 17-40 17z" stroke="${c}" stroke-width="3" fill="none"/>`};
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${esc(p.name)}"><rect width="200" height="200" fill="${c}"/><g>${s[p.shape] || s.cube}</g></svg>`;
}
function art(p){
  if (p.image) return `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`;
  const url = window.STORE3D && window.STORE3D.thumb(p);
  if (url) return `<img src="${url}" alt="${esc(p.name)}">`;
  return svgArt(p);
}

// ---------- Catalog ----------
function card(p){
  const a = avg(p), dig = p.type === 'digital';
  return `<article class="card">
    <button class="thumb" style="--c:${esc(p.color)}" data-view="${p.id}" aria-label="View ${esc(p.name)} in 3D">${art(p)}
      ${p.badge ? `<span class="tag">${esc(p.badge)}</span>` : ''}<span class="view">${ICON.cube}View in 3D</span></button>
    <div class="info">
      <span class="kind${dig ? '' : ' ship'}">${dig ? 'Digital file' : 'Ships to you'}</span>
      <h3>${esc(p.name)}</h3>
      <div class="stars" aria-label="${a.toFixed(1)} out of 5">${stars(a)}<i>${p.reviews.length ? `(${p.reviews.length})` : 'No reviews yet'}</i></div>
      <div class="row"><div class="price">${money(p.price)}${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ''}</div>
      <button class="add" data-add="${p.id}" aria-label="Add ${esc(p.name)} to cart">${ICON.plus}</button></div>
    </div></article>`;
}
function render(){
  const q = $('#q').value.toLowerCase(), s = $('#sort').value;
  let list = DB.products.filter(p => (cat === 'All' || p.category === cat) && (p.name + p.desc).toLowerCase().includes(q));
  if (s === 'lo') list.sort((a, b) => a.price - b.price);
  if (s === 'hi') list.sort((a, b) => b.price - a.price);
  if (s === 'rate') list.sort((a, b) => avg(b) - avg(a));
  $('#grid').innerHTML = list.map(card).join('');
  $('#empty').hidden = list.length > 0;
  const revs = DB.products.flatMap(p => p.reviews.map(r => ({...r, p:p.name}))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  $('#revs').innerHTML = revs.map(r => `<figure class="rev" style="margin:0"><div class="stars" aria-label="${r.rating} out of 5">${stars(r.rating)}</div>
    <p>${esc(r.text)}</p><footer><span class="av" aria-hidden="true">${esc(r.name.trim()[0] || '?')}</span><span><b>${esc(r.name)}</b>${esc(r.p)}</span></footer></figure>`).join('')
    || '<p class="note">No reviews yet. Be the first after your order arrives.</p>';
}
function chips(){
  $('#cats').innerHTML = ['All', ...DB.categories].map(c => `<button class="chip" aria-pressed="${c === cat}" data-cat="${esc(c)}">${esc(c === 'All' ? 'Everything' : c)}</button>`).join('');
}

// ---------- Cart ----------
const count = () => cart.reduce((a, i) => a + i.qty, 0);
const save = () => { try { localStorage.setItem('w3d-cart', JSON.stringify(cart)) } catch {} $('#count').textContent = count() };
function bump(){ const b = $('#openCart'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump') }
let toastT;
function toast(msg){ $('#toastT').textContent = msg; $('#toast').classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => $('#toast').classList.remove('show'), 3200) }

// Thumbnail flies into the cart button
function fly(fromEl, p){
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const target = $('#openCart').getBoundingClientRect();
  if (reduce || !fromEl || !fromEl.animate){ bump(); return }
  const r = fromEl.getBoundingClientRect(), el = document.createElement('div');
  el.className = 'fly'; el.innerHTML = art(p);
  Object.assign(el.style, {left:r.left + 'px', top:r.top + 'px', width:r.width + 'px', height:r.height + 'px'});
  document.body.appendChild(el);
  const dx = target.left + target.width / 2 - (r.left + r.width / 2), dy = target.top + target.height / 2 - (r.top + r.height / 2);
  el.animate([
    {transform:'translate(0,0) scale(1) rotate(0)', opacity:1},
    {transform:`translate(${dx * .35}px,${dy * .35 - 80}px) scale(.55) rotate(-8deg)`, opacity:1, offset:.45},
    {transform:`translate(${dx}px,${dy}px) scale(.08) rotate(12deg)`, opacity:.4}
  ], {duration:750, easing:'cubic-bezier(.5,0,.3,1)'}).onfinish = () => { el.remove(); bump() };
}
function add(id, srcEl){
  const p = find(id); if (!p) return;
  const i = cart.find(x => x.id === id); i ? i.qty++ : cart.push({id, qty:1});
  save(); fly(srcEl, p); toast(`${p.name} added to cart`);
}
function totals(){
  const S = DB.settings; let sub = 0, phys = false;
  cart.forEach(i => { const p = find(i.id); if (p){ sub += p.price * i.qty; if (p.type === 'physical') phys = true } });
  const disc = promoOn ? sub * S.promoPercent / 100 : 0, after = sub - disc, ship = phys && sub < S.freeShippingOver ? S.shippingFee : 0;
  return {sub, disc, ship, phys, total:after + ship};
}
const X = '<button class="x" data-close aria-label="Close">&times;</button>';
function openCart(step = 'cart'){
  cart = cart.filter(i => find(i.id)); save();
  const d = $('#cdBody');
  if (!cart.length){
    d.innerHTML = `${X}<h2>Your cart</h2><div class="done"><p>Your cart is empty. Pick a template or a printer part to get started.</p><a class="btn" href="#shop" data-close>Browse the catalog</a></div>`;
    if (!$('#cd').open) $('#cd').showModal(); return;
  }
  const t = totals();
  const lines = cart.map(i => { const p = find(i.id); return `<div class="line"><div class="pic">${art(p)}</div>
    <div><b>${esc(p.name)}</b><span class="qty"><button data-q="${p.id}" data-d="-1" aria-label="Remove one ${esc(p.name)}">−</button>${i.qty}<button data-q="${p.id}" data-d="1" aria-label="Add one ${esc(p.name)}">+</button></span></div>
    <span>${money(p.price * i.qty)}</span></div>` }).join('');
  const sum = `<div class="sum"><span>Subtotal</span><span>${money(t.sub)}</span>${t.disc ? `<span>Discount (${esc(DB.settings.promoCode)})</span><span>−${money(t.disc)}</span>` : ''}
    <span>Shipping</span><span>${t.phys ? (t.ship ? money(t.ship) : 'Free') : 'Not needed'}</span><span class="t">Total</span><span class="t">${money(t.total)}</span></div>`;
  if (step === 'cart'){
    d.innerHTML = `${X}<h2>Your cart</h2>${lines}
      <div class="f"><label>Promo code<input id="pc" placeholder="${esc(DB.settings.promoCode)}" value="${promoOn ? esc(DB.settings.promoCode) : ''}"></label><div class="err" id="pe"></div></div>${sum}
      <button class="btn" id="goPay">Checkout</button>`;
  } else {
    d.innerHTML = `${X}<h2>Checkout</h2>${sum}
      <form class="f" id="cf"><input name="name" placeholder="Full name" autocomplete="name" aria-label="Full name" required>
      <input name="email" type="email" placeholder="Email (files are sent here)" autocomplete="email" aria-label="Email" required>
      ${t.phys ? '<textarea name="address" rows="2" placeholder="Delivery address" autocomplete="street-address" aria-label="Delivery address" required></textarea>' : ''}
      <div class="pay" role="radiogroup" aria-label="Payment method"><label><input type="radio" name="payment" value="card" checked>Card</label><label><input type="radio" name="payment" value="paypal">PayPal</label>${t.phys ? '<label><input type="radio" name="payment" value="cod">Cash on delivery</label>' : ''}</div>
      <p class="note">Card and PayPal details are entered on the payment provider's secure page, never on this server.</p>
      <div class="err" id="ce" role="alert"></div><button class="btn">Place order · ${money(t.total)}</button>
      <button type="button" class="btn ghost" id="backCart">Back to cart</button></form>`;
  }
  if (!$('#cd').open) $('#cd').showModal();
}

// ---------- Product dialog with 3D viewer ----------
function view(id){
  const p = find(id), a = avg(p), dig = p.type === 'digital';
  $('#pdBody').innerHTML = `${X}<div class="pd">
    <div class="viewer" id="viewer" style="--c:${esc(p.color)}">${art(p)}</div>
    <div class="pdinfo">
      <span class="kind${dig ? '' : ' ship'}">${dig ? 'Digital file' : 'Ships to you'}</span>
      <h2>${esc(p.name)}</h2>
      <div class="stars">${stars(a)} <i>${p.reviews.length} review${p.reviews.length === 1 ? '' : 's'}</i></div>
      <p class="desc">${esc(p.desc)}</p>
      <div class="buy"><div class="price">${money(p.price)}${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ''}</div>
      <button class="btn" data-add="${p.id}">Add to cart</button></div>
      <h3>Reviews</h3>
      ${p.reviews.map(r => `<div class="rline"><span class="stars">${stars(r.rating)}</span> <b>${esc(r.name)}</b><p>${esc(r.text)}</p></div>`).join('') || '<p class="note">No reviews yet. Bought this? Tell other makers how it went.</p>'}
      <form class="f" data-rev="${p.id}"><h3 style="margin:18px 0 0">Write a review</h3>
        <input name="name" placeholder="Your name" aria-label="Your name" required>
        <select name="rating" aria-label="Rating"><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option></select>
        <textarea name="text" rows="2" placeholder="How did it print or fit?" aria-label="Review" required></textarea>
        <div class="err" role="alert"></div><button class="btn ghost">Post review</button></form>
    </div></div>`;
  if (!$('#pd').open) $('#pd').showModal();
  if (!p.image && window.STORE3D) window.STORE3D.mountViewer($('#viewer'), p);
}
$('#pd').addEventListener('close', () => window.STORE3D && window.STORE3D.unmountViewer());

// ---------- Events ----------
async function post(url, body){
  const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The request failed. Check your connection and try again.');
  return j;
}
document.addEventListener('click', e => {
  const t = e.target.closest('button,a'); if (!t) return;
  if (t.dataset.add){
    const inDialog = t.closest('#pd');
    const src = inDialog ? $('#viewer') : t.closest('.card')?.querySelector('.thumb');
    add(t.dataset.add, src);
    if (inDialog) setTimeout(() => $('#pd').close(), 120);
  }
  else if (t.dataset.view) view(t.dataset.view);
  else if (t.dataset.cat){ cat = t.dataset.cat; chips(); render() }
  else if (t.dataset.close !== undefined) t.closest('dialog').close();
  else if (t.dataset.q){ const i = cart.find(x => x.id === t.dataset.q); i.qty += +t.dataset.d; if (i.qty < 1) cart = cart.filter(x => x !== i); save(); openCart() }
  else if (t.id === 'goPay'){
    const c = $('#pc').value.trim().toUpperCase();
    if (c && c !== DB.settings.promoCode.toUpperCase()){ $('#pe').textContent = 'That code is not valid. Check the spelling and try again.'; return }
    promoOn = !!c; openCart('pay');
  }
  else if (t.id === 'backCart') openCart();
  else if (t.id === 'openCart' || t.id === 'toastBtn'){ $('#toast').classList.remove('show'); openCart() }
  else if (t.id === 'copyCode'){
    const code = DB.settings.promoCode || $('#codeT').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => { t.textContent = 'Copied' }, () => { t.textContent = code })
      .finally(() => setTimeout(() => { t.textContent = 'Copy code' }, 2000));
  }
});
// close dialogs when clicking the backdrop
['#pd', '#cd'].forEach(s => $(s).addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close() }));

document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, fd = Object.fromEntries(new FormData(f));
  const btn = f.querySelector('button:not([type=button])'); if (btn) btn.disabled = true;
  try {
    if (f.id === 'nf'){
      await post('/api/newsletter', {email:$('#ne').value});
      $('#nm').className = 'msg ok'; $('#nm').textContent = 'You are subscribed. Watch your inbox for new drops.'; f.reset();
    } else if (f.dataset.rev){
      const j = await post('/api/reviews', {productId:f.dataset.rev, ...fd});
      const i = DB.products.findIndex(p => p.id === j.product.id); DB.products[i] = j.product; render(); view(j.product.id);
    } else if (f.id === 'cf'){
      const j = await post('/api/orders', {items:cart, customer:{name:fd.name, email:fd.email, address:fd.address}, payment:fd.payment, promo:promoOn ? DB.settings.promoCode : ''});
      if (j.url){ location.href = j.url; return }
      cart = []; promoOn = false; save();
      $('#cdBody').innerHTML = `${X}<div class="done"><div class="tick">${ICON.tick}</div><h2>Order placed</h2><p>Order <b>${esc(j.orderId)}</b> is confirmed. A receipt is on its way to your email.</p><button class="btn" data-close>Keep shopping</button></div>`;
    }
  } catch (err){
    const el = f.querySelector('.err') || $('#nm'); el.textContent = err.message; if (f.id === 'nf') el.className = 'msg err';
  } finally { if (btn && btn.isConnected) btn.disabled = false }
});
['q', 'sort'].forEach(id => $('#' + id).addEventListener('input', render));

// Header turns solid once you leave the top
const hdr = $('#hdr');
const onScroll = () => hdr.classList.toggle('solid', scrollY > 40);
addEventListener('scroll', onScroll, {passive:true}); onScroll();

// Hero headline prints once fonts are ready
const go = () => $('#hero').classList.add('go');
(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(go));
setTimeout(go, 1500);

// Re-render cards when 3D thumbnails become available
addEventListener('store3d:ready', () => { if (DB.products.length) render() });

fetch('/api/products').then(r => r.json()).then(d => {
  DB = d; const S = d.settings;
  $('#promo').textContent = `Use code ${S.promoCode} for ${S.promoPercent}% off your first order`;
  $('#bannerT').textContent = `Take ${S.promoPercent}% off your first order`;
  $('#codeT').textContent = S.promoCode;
  $('#freeShip').textContent = `On printer parts over ${S.currency}${S.freeShippingOver}`;
  const ord = new URLSearchParams(location.search).get('order');
  if (ord){ $('#promo').textContent = 'Payment received. Order ' + ord + ': check your email for your download links.'; cart = [] }
  chips(); render(); save();
}).catch(() => { $('#grid').innerHTML = '<p class="empty">The catalog didn\'t load. Refresh the page to try again.</p>' });
})();

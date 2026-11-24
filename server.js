require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sendMail = require('./lib/mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
const SECRET = process.env.DOWNLOAD_SECRET || 'dev-secret-change-me';
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const DATA = path.join(__dirname, 'data');
const FILES = path.join(__dirname, 'private-files');

const read = (n, fb) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8')); } catch { return fb; } };
const write = (n, d) => fs.writeFileSync(path.join(DATA, n), JSON.stringify(d, null, 2));
const clean = (s, max = 200) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---------- Signed download links ----------
const sign = (oid, pid, exp) => crypto.createHmac('sha256', SECRET).update(`${oid}.${pid}.${exp}`).digest('hex');
const linkFor = (order, pid) => {
  const exp = Date.now() + 7 * 864e5;
  return `${BASE}/download/${order.id}/${pid}/${exp}/${sign(order.id, pid, exp)}`;
};

// ---------- Mark paid + email the files ----------
async function fulfill(orderId) {
  const orders = read('orders.json', []);
  const order = orders.find((o) => o.id === orderId);
  if (!order || order.status === 'paid' || order.status === 'shipped') return;
  order.status = 'paid';
  order.paidAt = new Date().toISOString();
  write('orders.json', orders);
  const products = read('products.json', { products: [] }).products;
  const digital = order.lines.map((l) => products.find((p) => p.id === l.id)).filter((p) => p && p.type === 'digital' && p.file);
  const links = digital.map((p) => `<li><a href="${linkFor(order, p.id)}">Download ${p.name}</a></li>`).join('');
  const html = `<h2>Thank you for your order ${order.id}</h2><p>Hi ${order.customer.name}, your payment is confirmed.</p>`
    + (links ? `<p>Your files (links work for 7 days):</p><ul>${links}</ul>` : '')
    + (order.lines.some((l) => products.find((p) => p.id === l.id)?.type === 'physical') ? '<p>Your printer parts will be shipped soon.</p>' : '')
    + `<p>Total paid: ${order.total.toFixed(2)}</p><p>3Dway</p>`;
  try { await sendMail(order.customer.email, `3Dway order ${order.id}`, html); } catch (e) { console.error('Email failed:', e.message); }
}

// ---------- Stripe webhook (needs the raw body, so it goes before express.json) ----------
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.sendStatus(404);
  let ev;
  try { ev = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).send('Invalid signature'); }
  if (ev.type === 'checkout.session.completed') fulfill(ev.data.object.client_reference_id);
  res.json({ received: true });
});

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Store API ----------
app.get('/api/products', (req, res) => {
  const db = read('products.json', { products: [] });
  db.products = db.products.map(({ file, ...p }) => p); // never expose private file names
  res.json(db);
});

app.post('/api/reviews', (req, res) => {
  const { productId, name, rating, text } = req.body;
  const db = read('products.json', { products: [] });
  const p = db.products.find((x) => x.id === productId);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const r = Math.round(Number(rating));
  if (!clean(name) || !clean(text) || !(r >= 1 && r <= 5))
    return res.status(400).json({ error: 'Add your name, a rating from 1 to 5, and a comment.' });
  p.reviews.unshift({ name: clean(name, 50), rating: r, text: clean(text, 500), date: new Date().toISOString().slice(0, 10) });
  write('products.json', db);
  const { file, ...safe } = p;
  res.json({ ok: true, product: safe });
});

app.post('/api/newsletter', (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  if (!emailOk(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const list = read('subscribers.json', []);
  if (!list.includes(email)) { list.push(email); write('subscribers.json', list); }
  res.json({ ok: true });
});

app.post('/api/orders', async (req, res) => {
  const { items, customer, payment, promo } = req.body;
  const db = read('products.json', { products: [] });
  const S = db.settings;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your cart is empty.' });
  let sub = 0, physical = false;
  const lines = [];
  for (const it of items) {
    const p = db.products.find((x) => x.id === it.id);
    const qty = Math.min(Math.max(parseInt(it.qty, 10) || 0, 0), 20);
    if (!p || !qty) return res.status(400).json({ error: 'A product in your cart is no longer available.' });
    if (p.type === 'physical') physical = true;
    sub += p.price * qty;
    lines.push({ id: p.id, name: p.name, qty, price: p.price });
  }
  const c = customer || {};
  if (!clean(c.name) || !emailOk(clean(c.email)) || (physical && !clean(c.address)))
    return res.status(400).json({ error: 'Complete your name, email and (for printer parts) delivery address.' });
  const promoOk = promo && String(promo).toUpperCase() === S.promoCode.toUpperCase();
  const discount = promoOk ? +(sub * S.promoPercent / 100).toFixed(2) : 0;
  const shipping = physical && sub < S.freeShippingOver ? S.shippingFee : 0;
  const pay = ['card', 'paypal', 'cod'].includes(payment) ? payment : 'card';
  const order = {
    id: 'W3D-' + Date.now().toString(36).toUpperCase(), date: new Date().toISOString(),
    customer: { name: clean(c.name, 80), email: clean(c.email, 120).toLowerCase(), address: clean(c.address, 250) },
    payment: pay, lines, discount, shipping, total: +(sub - discount + shipping).toFixed(2), status: 'pending'
  };
  const orders = read('orders.json', []);
  orders.push(order);
  write('orders.json', orders);

  if (pay === 'card' && stripe) {
    try {
      const cur = process.env.STRIPE_CURRENCY || 'usd';
      const factor = 1 - (promoOk ? S.promoPercent / 100 : 0);
      const line_items = lines.map((l) => ({ quantity: l.qty,
        price_data: { currency: cur, product_data: { name: l.name }, unit_amount: Math.round(l.price * factor * 100) } }));
      if (shipping) line_items.push({ quantity: 1, price_data: { currency: cur, product_data: { name: 'Shipping' }, unit_amount: Math.round(shipping * 100) } });
      const session = await stripe.checkout.sessions.create({
        mode: 'payment', line_items, customer_email: order.customer.email, client_reference_id: order.id,
        success_url: `${BASE}/?order=${order.id}`, cancel_url: `${BASE}/#shop`
      });
      return res.json({ ok: true, orderId: order.id, total: order.total, url: session.url });
    } catch (e) {
      console.error('Stripe error:', e.message);
      return res.status(502).json({ error: 'Card payment is unavailable right now. Try PayPal or try again later.' });
    }
  }
  res.json({ ok: true, orderId: order.id, total: order.total });
});

// ---------- Secure download ----------
app.get('/download/:oid/:pid/:exp/:sig', (req, res) => {
  const { oid, pid, exp, sig } = req.params;
  if (Date.now() > Number(exp) || !same(sig, sign(oid, pid, exp))) return res.status(403).send('This link is invalid or has expired.');
  const order = read('orders.json', []).find((o) => o.id === oid);
  if (!order || !['paid', 'shipped'].includes(order.status) || !order.lines.some((l) => l.id === pid)) return res.status(403).send('Order not paid.');
  const p = read('products.json', { products: [] }).products.find((x) => x.id === pid);
  if (!p || !p.file) return res.sendStatus(404);
  const full = path.join(FILES, path.basename(p.file));
  if (!fs.existsSync(full)) return res.status(404).send('File is not available yet. Contact support.');
  res.download(full);
});

// ---------- Admin (Basic auth: user "admin") ----------
function auth(req, res, next) {
  if (!process.env.ADMIN_PASSWORD) return res.status(503).send('Set ADMIN_PASSWORD in .env to enable the admin.');
  const [u, ...rest] = Buffer.from((req.headers.authorization || '').slice(6), 'base64').toString().split(':');
  if (u === 'admin' && same(rest.join(':'), process.env.ADMIN_PASSWORD)) return next();
  res.set('WWW-Authenticate', 'Basic realm="3Dway admin"').status(401).send('Login required');
}
app.get('/admin', auth, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'admin.html')));
app.get('/api/admin/data', auth, (req, res) => res.json({
  orders: read('orders.json', []).reverse(), subscribers: read('subscribers.json', []), products: read('products.json', { products: [] }).products }));
app.post('/api/admin/orders/:id/status', auth, async (req, res) => {
  const status = req.body.status;
  if (status === 'paid') { await fulfill(req.params.id); return res.json({ ok: true }); }
  if (!['pending', 'shipped', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  const orders = read('orders.json', []);
  const o = orders.find((x) => x.id === req.params.id);
  if (!o) return res.sendStatus(404);
  o.status = status; write('orders.json', orders); res.json({ ok: true });
});
app.post('/api/admin/products', auth, (req, res) => {
  const b = req.body, db = read('products.json', { products: [] });
  const id = clean(b.id, 20);
  if (!id || !clean(b.name) || !(Number(b.price) > 0)) return res.status(400).json({ error: 'ID, name and a price above 0 are required.' });
  const old = db.products.find((p) => p.id === id);
  const p = { id, name: clean(b.name, 100), category: clean(b.category, 40) || db.categories[0], type: b.type === 'physical' ? 'physical' : 'digital',
    price: Number(b.price), oldPrice: Number(b.oldPrice) || null, badge: clean(b.badge, 20), shape: clean(b.shape, 10) || 'cube',
    color: clean(b.color, 9) || '#00A5B8', image: clean(b.image, 200), file: clean(b.file, 100), desc: clean(b.desc, 500), reviews: old ? old.reviews : [] };
  if (!db.categories.includes(p.category)) db.categories.push(p.category);
  old ? Object.assign(old, p) : db.products.push(p);
  write('products.json', db); res.json({ ok: true });
});

app.listen(PORT, () => console.log(`3Dway store running at ${BASE}`));

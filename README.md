# 3Dway store v2

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in
3. Put your sellable files in `private-files/` (names match the "file" field in data/products.json)
4. `npm start` then open http://localhost:3000 (admin: http://localhost:3000/admin, user `admin`)

Stripe: set STRIPE_SECRET_KEY, then add a webhook to `BASE_URL/api/stripe-webhook`
(event: checkout.session.completed) and copy its signing secret to STRIPE_WEBHOOK_SECRET.
Local testing: `stripe listen --forward-to localhost:3000/api/stripe-webhook`
PayPal and cash on delivery orders stay "pending" until you click "Mark paid + send files" in /admin.

## Front end
- `public/index.html`: page markup
- `public/assets/styles.css`: theme ("slicer viewport": navy, filament teal, hot-end orange)
- `public/assets/store.js`: catalog, cart drawer, checkout, reviews, newsletter (works without 3D)
- `public/assets/scene.js`: Three.js layer. Hero print animation with a draggable layer slider, a scroll story (mesh, then slices, then finished print), rendered 3D product thumbnails and a live viewer in the product dialog.
  Libraries load from CDNs (three@0.160.0 on jsDelivr, GSAP 3.12.5 on cdnjs). If WebGL is unavailable the store falls back to the flat illustrations.
  Product models are picked from `shape` (cube, vase, nozzle, gear, plate), with special models when the name mentions dragon, chess or a stepper driver. A product with `image` set uses that image instead.

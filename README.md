# 3Dway store v2

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in
3. Put your sellable files in `private-files/` (names match the "file" field in data/products.json)
4. `npm start` then open http://localhost:3000 (admin: http://localhost:3000/admin, user `admin`)

Stripe: set STRIPE_SECRET_KEY, then add a webhook to `BASE_URL/api/stripe-webhook`
(event: checkout.session.completed) and copy its signing secret to STRIPE_WEBHOOK_SECRET.
Local testing: `stripe listen --forward-to localhost:3000/api/stripe-webhook`
PayPal and cash on delivery orders stay "pending" until you click "Mark paid + send files" in /admin.

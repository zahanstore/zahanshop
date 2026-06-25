/* ============================================================
   ZAHAN SHOP — api/stripe-webhook.js
   Stripe webhook — payment confirmed → mark order paid
   POST /api/stripe-webhook
   Register this URL in: Stripe Dashboard → Developers → Webhooks
   Events to subscribe: checkout.session.completed,
                        checkout.session.expired
   ============================================================ */

const stripe           = require('stripe');
const { createClient } = require('@supabase/supabase-js');

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);
  const supabase     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const rawBody  = await getRawBody(req);
    const signature = req.headers['stripe-signature'];

    /* ── Verify Stripe signature ── */
    let event;
    try {
      event = stripeClient.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[stripe-webhook] Signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    console.log('[stripe-webhook] Event:', event.type);

    /* ── checkout.session.completed → order paid ── */
    if (event.type === 'checkout.session.completed') {
      const session         = event.data.object;
      const orderId         = session.metadata?.supabase_order_id;
      const paymentIntentId = session.payment_intent;

      if (!orderId) {
        console.warn('[stripe-webhook] No supabase_order_id in session metadata');
        return res.status(200).json({ received: true });
      }

      /* Build shipping address from Stripe session */
      const addr = session.shipping_details?.address;
      const shippingAddress = addr
        ? {
            name:    session.shipping_details.name,
            line1:   addr.line1,
            line2:   addr.line2   || '',
            city:    addr.city,
            state:   addr.state   || '',
            country: addr.country,
            postal:  addr.postal_code,
          }
        : null;

      await supabase
        .from('orders')
        .update({
          status:               'paid',
          payment_id:           paymentIntentId,
          shipping_address:     shippingAddress,
          fulfillment_provider: 'printful',   // Phase 4 will auto-fire on this
        })
        .eq('id', orderId);

      console.log(`[stripe-webhook] ✅ Order ${orderId} → paid (${paymentIntentId})`);
      /* Phase 4 hook: triggerPrintful(orderId) */
    }

    /* ── checkout.session.expired → order cancelled ── */
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const orderId = session.metadata?.supabase_order_id;

      if (orderId) {
        await supabase
          .from('orders')
          .update({ status: 'cancelled' })
          .eq('id', orderId);

        console.log(`[stripe-webhook] ❌ Order ${orderId} → cancelled (session expired)`);
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[stripe-webhook] Error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

/* ============================================================
   ZAHAN SHOP — api/stripe-webhook.js
   Stripe webhook — payment confirmed → mark paid → fire Printful
   POST /api/stripe-webhook
   Phase 4 update: auto-triggers Printful + sends confirmation email
   ============================================================ */

const stripe           = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const printful         = require('../lib/printful');
const email            = require('../lib/email');

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
        rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[stripe-webhook] Signature failed:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    console.log('[stripe-webhook] Event:', event.type);

    /* ── checkout.session.completed → paid + fulfill ── */
    if (event.type === 'checkout.session.completed') {
      const session         = event.data.object;
      const orderId         = session.metadata?.supabase_order_id;
      const paymentIntentId = session.payment_intent;

      if (!orderId) {
        console.warn('[stripe-webhook] No supabase_order_id in metadata');
        return res.status(200).json({ received: true });
      }

      /* Build shipping address from Stripe */
      const addr = session.shipping_details?.address;
      const shippingAddress = addr ? {
        name:    session.shipping_details.name,
        line1:   addr.line1,
        line2:   addr.line2    || '',
        city:    addr.city,
        state:   addr.state    || '',
        country: addr.country,
        postal:  addr.postal_code,
      } : null;

      /* Mark paid */
      await supabase
        .from('orders')
        .update({
          status:               'paid',
          payment_id:           paymentIntentId,
          shipping_address:     shippingAddress,
          fulfillment_provider: 'printful',
        })
        .eq('id', orderId);

      console.log(`[stripe-webhook] ✅ Order ${orderId} → paid`);

      /* Fetch full order for fulfillment + email */
      const { data: fullOrder } = await supabase
        .from('orders')
        .select(`
          id, shipping_address, total_usd,
          customers ( email, name, phone ),
          order_items (
            quantity, unit_price,
            product_variants (
              printful_sync_variant_id,
              size, color,
              products ( name, brand )
            )
          )
        `)
        .eq('id', orderId)
        .single();

      /* ── Fire Printful fulfillment ── */
      try {
        await printful.submitOrder(fullOrder, supabase);
      } catch (err) {
        console.error(`[stripe-webhook] Printful error for order ${orderId}:`, err.message);
      }

      /* ── Send order confirmed email ── */
      const customerEmail = session.customer_details?.email || fullOrder?.customers?.email;
      if (customerEmail) {
        const firstItem = fullOrder?.order_items?.[0];
        const variant   = firstItem?.product_variants;
        const product   = variant?.products;
        const label     = [variant?.size, variant?.color].filter(Boolean).join(' / ');
        try {
          await email.sendOrderConfirmed({
            to:           customerEmail,
            orderId,
            productName:  product?.name  || '',
            brand:        product?.brand || '',
            variantLabel: label,
            price:        fullOrder?.total_usd ? `$${Number(fullOrder.total_usd).toFixed(2)}` : null,
            market:       'global',
          });
        } catch (err) {
          console.error(`[stripe-webhook] Email error:`, err.message);
        }
      }
    }

    /* ── checkout.session.expired → cancelled ── */
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const orderId = session.metadata?.supabase_order_id;
      if (orderId) {
        await supabase
          .from('orders')
          .update({ status: 'cancelled' })
          .eq('id', orderId);
        console.log(`[stripe-webhook] ❌ Order ${orderId} → cancelled`);
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[stripe-webhook] Fatal error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

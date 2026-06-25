/* ============================================================
   ZAHAN SHOP — api/razorpay-webhook.js
   Razorpay webhook — payment confirmed → mark paid → fire Qikink
   POST /api/razorpay-webhook
   Phase 4 update: auto-triggers Qikink + sends confirmation email
   ============================================================ */

const crypto           = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const qikink           = require('../lib/qikink');
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

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const rawBody  = await getRawBody(req);
    const signature = req.headers['x-razorpay-signature'];

    /* ── Verify signature ── */
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (expected !== signature) {
      console.error('[razorpay-webhook] Signature mismatch');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    console.log('[razorpay-webhook] Event:', event.event);

    /* ── payment.captured → paid + fulfill ── */
    if (event.event === 'payment.captured') {
      const payment         = event.payload.payment.entity;
      const razorpayOrderId = payment.order_id;
      const paymentId       = payment.id;

      /* Find Supabase order */
      const { data: order } = await supabase
        .from('orders')
        .select('id')
        .eq('payment_id', razorpayOrderId)
        .single();

      if (!order) {
        console.warn(`[razorpay-webhook] No order for Razorpay order: ${razorpayOrderId}`);
        return res.status(200).json({ received: true });
      }

      /* Mark paid */
      await supabase
        .from('orders')
        .update({
          status:               'paid',
          payment_id:           paymentId,
          fulfillment_provider: 'qikink',
        })
        .eq('id', order.id);

      console.log(`[razorpay-webhook] ✅ Order ${order.id} → paid`);

      /* Fetch full order for fulfillment + email */
      const { data: fullOrder } = await supabase
        .from('orders')
        .select(`
          id, shipping_address, total_inr,
          customers ( email, name, phone ),
          order_items (
            quantity, unit_price,
            product_variants (
              qikink_product_id, qikink_variant_id,
              size, color,
              products ( name, brand )
            )
          )
        `)
        .eq('id', order.id)
        .single();

      /* ── Fire Qikink fulfillment ── */
      try {
        await qikink.submitOrder(fullOrder, supabase);
      } catch (err) {
        /* Log but don't fail the webhook — order is paid, fulfillment can be retried */
        console.error(`[razorpay-webhook] Qikink error for order ${order.id}:`, err.message);
      }

      /* ── Send order confirmed email ── */
      const customerEmail = fullOrder?.customers?.email;
      if (customerEmail) {
        const firstItem = fullOrder?.order_items?.[0];
        const variant   = firstItem?.product_variants;
        const product   = variant?.products;
        const label     = [variant?.size, variant?.color].filter(Boolean).join(' / ');
        try {
          await email.sendOrderConfirmed({
            to:           customerEmail,
            orderId:      order.id,
            productName:  product?.name  || '',
            brand:        product?.brand || '',
            variantLabel: label,
            price:        fullOrder?.total_inr ? `₹${Number(fullOrder.total_inr).toLocaleString('en-IN')}` : null,
            market:       'in',
          });
        } catch (err) {
          console.error(`[razorpay-webhook] Email error:`, err.message);
        }
      }
    }

    /* ── payment.failed → cancelled ── */
    if (event.event === 'payment.failed') {
      const payment         = event.payload.payment.entity;
      const razorpayOrderId = payment.order_id;

      const { data: order } = await supabase
        .from('orders')
        .select('id')
        .eq('payment_id', razorpayOrderId)
        .single();

      if (order) {
        await supabase
          .from('orders')
          .update({ status: 'cancelled' })
          .eq('id', order.id);
        console.log(`[razorpay-webhook] ❌ Order ${order.id} → cancelled`);
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[razorpay-webhook] Fatal error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

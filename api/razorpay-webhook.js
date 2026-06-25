/* ============================================================
   ZAHAN SHOP — api/razorpay-webhook.js
   Razorpay webhook — payment confirmed → mark order paid
   POST /api/razorpay-webhook
   Register this URL in: Razorpay Dashboard → Webhooks
   Events to subscribe: payment.captured, payment.failed
   ============================================================ */

const crypto           = require('crypto');
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

    /* ── payment.captured → order paid ── */
    if (event.event === 'payment.captured') {
      const payment        = event.payload.payment.entity;
      const razorpayOrderId = payment.order_id;
      const paymentId       = payment.id;

      /* Find the Supabase order by Razorpay order ID */
      const { data: order } = await supabase
        .from('orders')
        .select('id')
        .eq('payment_id', razorpayOrderId)
        .single();

      if (order) {
        await supabase
          .from('orders')
          .update({
            status:               'paid',
            payment_id:           paymentId,        // overwrite with actual payment ID
            fulfillment_provider: 'qikink',         // Phase 4 will auto-fire on this
          })
          .eq('id', order.id);

        console.log(`[razorpay-webhook] ✅ Order ${order.id} → paid (${paymentId})`);
        /* Phase 4 hook: triggerQikink(order.id) */
      } else {
        console.warn(`[razorpay-webhook] No order found for Razorpay order: ${razorpayOrderId}`);
      }
    }

    /* ── payment.failed → order cancelled ── */
    if (event.event === 'payment.failed') {
      const payment        = event.payload.payment.entity;
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

        console.log(`[razorpay-webhook] ❌ Order ${order.id} → cancelled (payment failed)`);
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[razorpay-webhook] Error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

/* ============================================================
   ZAHAN SHOP — api/qikink-webhook.js
   Qikink → tracking update → fulfillment_jobs + shipped email
   POST /api/qikink-webhook
   Register in: Qikink Dashboard → Settings → Webhooks
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');
const email            = require('../lib/email');

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end',  () => {
      try { resolve(JSON.parse(raw)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

/* Qikink status → our status */
const STATUS_MAP = {
  pending:     'pending',
  processing:  'in_production',
  production:  'in_production',
  shipped:     'shipped',
  delivered:   'delivered',
  cancelled:   'failed',
  failed:      'failed',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const body = await readBody(req);
    console.log('[qikink-webhook] Event:', JSON.stringify(body).slice(0, 200));

    /* Qikink sends: order_id (their ref), status, tracking_url, carrier */
    const qikinkOrderId = body.order_id || body.id;
    const qikinkStatus  = (body.status  || '').toLowerCase();
    const trackingUrl   = body.tracking_url  || body.tracking_link || null;
    const carrier       = body.carrier || body.shipping_partner    || null;

    if (!qikinkOrderId) {
      console.warn('[qikink-webhook] No order_id in payload');
      return res.status(200).json({ received: true });
    }

    const mappedStatus = STATUS_MAP[qikinkStatus] || 'in_production';

    /* Update fulfillment_jobs */
    const { data: job } = await supabase
      .from('fulfillment_jobs')
      .update({
        status:       mappedStatus,
        tracking_url: trackingUrl,
        last_updated: new Date().toISOString(),
      })
      .eq('external_order_id', String(qikinkOrderId))
      .eq('provider', 'qikink')
      .select('order_id')
      .single();

    if (!job) {
      console.warn(`[qikink-webhook] No fulfillment_job for Qikink order: ${qikinkOrderId}`);
      return res.status(200).json({ received: true });
    }

    /* Update order status */
    if (['shipped', 'delivered'].includes(mappedStatus)) {
      await supabase
        .from('orders')
        .update({ status: mappedStatus === 'delivered' ? 'delivered' : 'fulfilled' })
        .eq('id', job.order_id);
    }

    console.log(`[qikink-webhook] Order ${job.order_id} → ${mappedStatus}`);

    /* Send shipped email */
    if (mappedStatus === 'shipped' && trackingUrl) {
      const { data: order } = await supabase
        .from('orders')
        .select('id, order_items(product_variants(products(name))), customers(email)')
        .eq('id', job.order_id)
        .single();

      const customerEmail = order?.customers?.email;
      const productName   = order?.order_items?.[0]?.product_variants?.products?.name || '';

      if (customerEmail) {
        try {
          await email.sendOrderShipped({
            to:          customerEmail,
            orderId:     job.order_id,
            productName,
            trackingUrl,
            carrier,
            market:      'in',
          });
        } catch (err) {
          console.error('[qikink-webhook] Email error:', err.message);
        }
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[qikink-webhook] Error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

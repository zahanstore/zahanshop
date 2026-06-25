/* ============================================================
   ZAHAN SHOP — api/printful-webhook.js
   Printful → tracking update → fulfillment_jobs + shipped email
   POST /api/printful-webhook
   Register in: Printful Dashboard → Settings → Webhooks
   Events: package_shipped, order_updated, order_failed
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const body = await readBody(req);
    const type = body.type;
    console.log('[printful-webhook] Event:', type);

    /* ── package_shipped ── */
    if (type === 'package_shipped') {
      const shipment       = body.data?.shipment  || {};
      const order          = body.data?.order      || {};
      const printfulOrderId = String(order.id      || '');
      const trackingUrl    = shipment.tracking_url || null;
      const carrier        = shipment.carrier      || null;
      const trackingNumber = shipment.tracking_number || null;

      /* Update fulfillment_jobs */
      const { data: job } = await supabase
        .from('fulfillment_jobs')
        .update({
          status:       'shipped',
          tracking_url: trackingUrl || (trackingNumber ? `https://parcelsapp.com/en/tracking/${trackingNumber}` : null),
          last_updated: new Date().toISOString(),
        })
        .eq('external_order_id', printfulOrderId)
        .eq('provider', 'printful')
        .select('order_id')
        .single();

      if (!job) {
        console.warn(`[printful-webhook] No fulfillment_job for Printful order: ${printfulOrderId}`);
        return res.status(200).json({ received: true });
      }

      /* Update Supabase order → fulfilled */
      await supabase
        .from('orders')
        .update({ status: 'fulfilled' })
        .eq('id', job.order_id);

      console.log(`[printful-webhook] ✅ Order ${job.order_id} → shipped`);

      /* Send shipped email */
      const { data: fullOrder } = await supabase
        .from('orders')
        .select('id, order_items(product_variants(products(name))), customers(email)')
        .eq('id', job.order_id)
        .single();

      const customerEmail = fullOrder?.customers?.email;
      const productName   = fullOrder?.order_items?.[0]?.product_variants?.products?.name || '';

      if (customerEmail && trackingUrl) {
        try {
          await email.sendOrderShipped({
            to:          customerEmail,
            orderId:     job.order_id,
            productName,
            trackingUrl,
            carrier,
            market:      'global',
          });
        } catch (err) {
          console.error('[printful-webhook] Email error:', err.message);
        }
      }
    }

    /* ── order_updated ── */
    if (type === 'order_updated') {
      const order          = body.data?.order || {};
      const printfulOrderId = String(order.id || '');
      const printfulStatus = (order.status || '').toLowerCase();

      const statusMap = {
        pending:     'pending',
        inprocess:   'in_production',
        onhold:      'in_production',
        partial:     'in_production',
        fulfilled:   'shipped',
        archived:    'delivered',
        canceled:    'failed',
      };
      const mapped = statusMap[printfulStatus] || 'in_production';

      await supabase
        .from('fulfillment_jobs')
        .update({ status: mapped, last_updated: new Date().toISOString() })
        .eq('external_order_id', printfulOrderId)
        .eq('provider', 'printful');

      console.log(`[printful-webhook] Order ${printfulOrderId} → ${mapped}`);
    }

    /* ── order_failed ── */
    if (type === 'order_failed') {
      const order          = body.data?.order || {};
      const printfulOrderId = String(order.id || '');

      const { data: job } = await supabase
        .from('fulfillment_jobs')
        .update({ status: 'failed', last_updated: new Date().toISOString() })
        .eq('external_order_id', printfulOrderId)
        .eq('provider', 'printful')
        .select('order_id')
        .single();

      if (job) {
        console.error(`[printful-webhook] ❌ Order ${job.order_id} fulfillment failed`);
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[printful-webhook] Error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

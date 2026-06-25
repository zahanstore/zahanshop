/* ============================================================
   ZAHAN SHOP — lib/qikink.js
   Qikink POD fulfillment — India orders
   Docs: https://www.qikink.com/api-docs (check your dashboard)
   ============================================================
   Required Supabase columns on product_variants:
     qikink_product_id  TEXT   — from Qikink dashboard > Products
     qikink_variant_id  TEXT   — from Qikink dashboard > Products > Variants
   ============================================================ */

const BASE = 'https://www.qikink.com/api';

/* ── Low-level fetch wrapper ── */
async function qikinkFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.QIKINK_API_KEY}`,
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Qikink API error ${res.status}: ${data.message || JSON.stringify(data)}`);
    err.status = res.status;
    err.data   = data;
    throw err;
  }
  return data;
}

/* ── Submit order to Qikink ──
   Called from api/razorpay-webhook.js after payment.captured
   supabaseOrder shape expected:
   {
     id, shipping_address,
     customers: { email, name, phone },
     order_items: [{
       quantity,
       product_variants: { qikink_product_id, qikink_variant_id, size, color }
     }]
   }
   ----------------------------------------------------------- */
async function submitOrder(supabaseOrder, supabase) {
  const addr     = supabaseOrder.shipping_address || {};
  const customer = supabaseOrder.customers        || {};
  const items    = supabaseOrder.order_items      || [];

  /* Validate all items have Qikink IDs */
  const missingIds = items.filter(i =>
    !i.product_variants?.qikink_product_id ||
    !i.product_variants?.qikink_variant_id
  );
  if (missingIds.length) {
    throw new Error(
      `Qikink IDs missing on ${missingIds.length} variant(s). ` +
      'Add qikink_product_id and qikink_variant_id in Supabase product_variants.'
    );
  }

  /* Build Qikink order payload */
  const payload = {
    order_id: supabaseOrder.id,           // your reference
    customer: {
      name:    addr.name    || customer.name  || '',
      email:   customer.email                 || '',
      phone:   addr.phone   || customer.phone || '',
      address: {
        line1:   addr.line1  || '',
        line2:   addr.line2  || '',
        city:    addr.city   || '',
        state:   addr.state  || '',
        pincode: addr.postal || '',
        country: addr.country || 'IN',
      },
    },
    items: items.map(item => ({
      product_id: item.product_variants.qikink_product_id,
      variant_id: item.product_variants.qikink_variant_id,
      quantity:   item.quantity,
    })),
  };

  const result = await qikinkFetch('/orders/create', {
    method: 'POST',
    body:   JSON.stringify(payload),
  });

  const externalOrderId = result?.order_id || result?.id || String(result?.data?.id || '');

  /* Write to fulfillment_jobs */
  await supabase.from('fulfillment_jobs').insert({
    order_id:          supabaseOrder.id,
    provider:          'qikink',
    external_order_id: externalOrderId,
    status:            'submitted',
  });

  /* Update order with fulfillment_id */
  await supabase
    .from('orders')
    .update({ fulfillment_id: externalOrderId })
    .eq('id', supabaseOrder.id);

  console.log(`[qikink] ✅ Order ${supabaseOrder.id} submitted → Qikink ${externalOrderId}`);
  return result;
}

/* ── Get Qikink order status ── */
async function getOrder(qikinkOrderId) {
  return qikinkFetch(`/orders/${qikinkOrderId}`);
}

module.exports = { submitOrder, getOrder };

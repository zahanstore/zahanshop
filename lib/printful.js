/* ============================================================
   ZAHAN SHOP — lib/printful.js
   Printful POD fulfillment — International orders
   Docs: https://developers.printful.com/docs
   ============================================================
   Required Supabase column on product_variants:
     printful_sync_variant_id  BIGINT
     — from: Printful Dashboard > My Products > [product] > Edit
             or GET /store/products → sync_variants[].id
   ============================================================ */

const BASE = 'https://api.printful.com';

async function printfulFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.PRINTFUL_API_KEY}`,
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.result || data?.error?.message || JSON.stringify(data);
    const err = new Error(`Printful API error ${res.status}: ${msg}`);
    err.status = res.status;
    err.data   = data;
    throw err;
  }
  return data;
}

/* ── Submit order to Printful ──
   supabaseOrder shape:
   {
     id, shipping_address, total_usd,
     customers: { email, name, phone },
     order_items: [{
       quantity, unit_price,
       product_variants: {
         printful_sync_variant_id, size, color,
         products: { name }
       }
     }]
   }
   ----------------------------------------------------------- */
async function submitOrder(supabaseOrder, supabase) {
  const addr     = supabaseOrder.shipping_address || {};
  const customer = supabaseOrder.customers        || {};
  const items    = supabaseOrder.order_items      || [];

  /* Validate all items have Printful sync variant IDs */
  const missingIds = items.filter(i => !i.product_variants?.printful_sync_variant_id);
  if (missingIds.length) {
    throw new Error(
      `printful_sync_variant_id missing on ${missingIds.length} variant(s). ` +
      'Get this from: Printful Dashboard > My Products > Edit > sync_variants[].id'
    );
  }

  const payload = {
    external_id: supabaseOrder.id,
    shipping:    'STANDARD',          // Printful shipping method
    recipient: {
      name:          addr.name     || customer.name || '',
      address1:      addr.line1    || '',
      address2:      addr.line2    || '',
      city:          addr.city     || '',
      state_code:    addr.state    || '',
      country_code:  addr.country  || 'US',
      zip:           addr.postal   || '',
      email:         customer.email || '',
      phone:         customer.phone || '',
    },
    items: items.map(item => ({
      sync_variant_id: item.product_variants.printful_sync_variant_id,
      quantity:        item.quantity,
      retail_price:    item.unit_price?.toFixed(2),
    })),
    retail_costs: {
      currency: 'USD',
      subtotal: supabaseOrder.total_usd?.toFixed(2),
    },
    gift: null,
    packing_slip: {
      email:       customer.email || '',
      phone:       customer.phone || '',
      message:     'Thank you for your order — Zahan Store® 🌙',
      logo_url:    'https://www.zahan.one/images/brand/logo.png',
      store_name:  'Zahan Store®',
    },
  };

  const result = await printfulFetch('/orders', {
    method: 'POST',
    body:   JSON.stringify(payload),
  });

  const externalOrderId = String(result?.result?.id || '');

  /* Write to fulfillment_jobs */
  await supabase.from('fulfillment_jobs').insert({
    order_id:          supabaseOrder.id,
    provider:          'printful',
    external_order_id: externalOrderId,
    status:            'submitted',
  });

  /* Update order */
  await supabase
    .from('orders')
    .update({ fulfillment_id: externalOrderId })
    .eq('id', supabaseOrder.id);

  console.log(`[printful] ✅ Order ${supabaseOrder.id} submitted → Printful ${externalOrderId}`);
  return result;
}

/* ── Get Printful order status ── */
async function getOrder(printfulOrderId) {
  return printfulFetch(`/orders/${printfulOrderId}`);
}

module.exports = { submitOrder, getOrder };

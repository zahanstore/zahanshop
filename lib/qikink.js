/* ============================================================
   ZAHAN SHOP — lib/qikink.js
   Qikink POD fulfillment — India orders
   Auth: ClientId + client_secret → access_token (OAuth2)
   Docs: https://documenter.getpostman.com/view/26157218/2sB3QKqpma
   ============================================================
   Vercel env vars required:
     QIKINK_CLIENT_ID      — from Qikink Dashboard → Integration → Custom API
     QIKINK_CLIENT_SECRET  — same location
     QIKINK_ENV            — "sandbox" | "live"  (default: sandbox)
   ============================================================
   Supabase columns required on product_variants:
     qikink_product_id  TEXT  — Qikink Dashboard → Products → Product ID
     qikink_variant_id  TEXT  — Qikink Dashboard → Products → Variant ID
   ============================================================ */

const BASE = process.env.QIKINK_ENV === 'live'
  ? 'https://api.qikink.com'
  : 'https://sandbox.qikink.com';

/* ── Token cache (in-memory, per serverless instance) ── */
let _tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  const now = Date.now();

  /* Return cached token if still valid (with 60s buffer) */
  if (_tokenCache.token && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.token;
  }

  const res = await fetch(`${BASE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     process.env.QIKINK_CLIENT_ID,
      client_secret: process.env.QIKINK_CLIENT_SECRET,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      `Qikink auth failed (${res.status}): ${data.message || JSON.stringify(data)}`
    );
  }

  /* Qikink returns access_token + expires_in (seconds) */
  const token     = data.access_token;
  const expiresIn = (data.expires_in || 3600) * 1000; // convert to ms

  _tokenCache = { token, expiresAt: now + expiresIn };
  console.log(`[qikink] Access token obtained (expires in ${data.expires_in || 3600}s)`);
  return token;
}

/* ── Authenticated fetch wrapper ── */
async function qikinkFetch(path, options = {}) {
  const token = await getAccessToken();

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.message || data.error || JSON.stringify(data);
    const err = new Error(`Qikink API error (${res.status}): ${msg}`);
    err.status = res.status;
    err.data   = data;
    throw err;
  }
  return data;
}

/* ── Submit order to Qikink ──
   supabaseOrder shape:
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

  /* Validate fulfillment IDs are set */
  const missingIds = items.filter(i =>
    !i.product_variants?.qikink_product_id ||
    !i.product_variants?.qikink_variant_id
  );
  if (missingIds.length) {
    throw new Error(
      `Qikink IDs missing on ${missingIds.length} variant(s). ` +
      'Set qikink_product_id + qikink_variant_id in Supabase product_variants.'
    );
  }

  const payload = {
    order_id: supabaseOrder.id,
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

  const externalOrderId = String(
    result?.order_id || result?.id || result?.data?.id || ''
  );

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

module.exports = { submitOrder, getOrder, getAccessToken };

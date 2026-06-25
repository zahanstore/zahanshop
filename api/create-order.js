/* ============================================================
   ZAHAN SHOP — api/create-order.js
   India payments — Razorpay (INR)
   POST /api/create-order
   ============================================================ */

const Razorpay              = require('razorpay');
const { createClient }      = require('@supabase/supabase-js');

/* ── Helpers ── */
async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ── Handler ── */
module.exports = async (req, res) => {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  /* Clients */
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY   // service role — bypasses RLS for server writes
  );
  const razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  try {
    const body     = await readBody(req);
    const { variantId, quantity = 1, shipping, email, phone } = body;

    /* Validate */
    if (!variantId || !shipping || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields: variantId, shipping, email, phone' });
    }

    /* Fetch variant + product */
    const { data: variant, error: vErr } = await supabase
      .from('product_variants')
      .select('id, sku, size, color, price_inr, stock_qty, products(id, name, brand)')
      .eq('id', variantId)
      .single();

    if (vErr || !variant)          return res.status(404).json({ error: 'Variant not found' });
    if (!variant.price_inr)        return res.status(400).json({ error: 'INR price not set for this variant' });
    if (variant.stock_qty < quantity) return res.status(400).json({ error: 'Insufficient stock' });

    const totalInr   = parseFloat(variant.price_inr) * quantity;
    const amountPaise = Math.round(totalInr * 100);  // Razorpay uses paise

    /* Upsert customer */
    const { data: customer } = await supabase
      .from('customers')
      .upsert(
        { email, name: shipping.name, phone, market: 'india' },
        { onConflict: 'email', ignoreDuplicates: false }
      )
      .select('id')
      .single();

    /* Create Supabase order (status: pending) */
    const { data: order, error: oErr } = await supabase
      .from('orders')
      .insert({
        customer_id:      customer?.id || null,
        market:           'india',
        status:           'pending',
        total_inr:        totalInr,
        payment_provider: 'razorpay',
        shipping_address: shipping,
      })
      .select('id')
      .single();

    if (oErr) throw oErr;

    /* Create order item */
    await supabase.from('order_items').insert({
      order_id:   order.id,
      variant_id: variantId,
      quantity,
      unit_price: variant.price_inr,
    });

    /* Create Razorpay order */
    const rzpOrder = await razorpay.orders.create({
      amount:   amountPaise,
      currency: 'INR',
      receipt:  order.id.slice(0, 40),   // Razorpay receipt max 40 chars
      notes: {
        supabase_order_id: order.id,
        sku:               variant.sku    || '',
        brand:             variant.products?.brand || '',
      },
    });

    /* Store Razorpay order ID in Supabase */
    await supabase
      .from('orders')
      .update({ payment_id: rzpOrder.id })
      .eq('id', order.id);

    return res.status(200).json({
      orderId:         order.id,
      razorpayOrderId: rzpOrder.id,
      amount:          amountPaise,
      currency:        'INR',
      keyId:           process.env.RAZORPAY_KEY_ID,
      productName:     variant.products?.name  || 'Zahan Product',
      brand:           variant.products?.brand || '',
      email,
      phone,
      shippingName:    shipping.name,
    });

  } catch (err) {
    console.error('[create-order]', err);
    return res.status(500).json({ error: 'Order creation failed', detail: err.message });
  }
};

/* ============================================================
   ZAHAN SHOP — api/create-stripe-session.js
   International payments — Stripe (USD / GBP / AED)
   POST /api/create-stripe-session
   ============================================================ */

const stripe           = require('stripe');
const { createClient } = require('@supabase/supabase-js');

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

module.exports = async (req, res) => {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);
  const SHOP_URL   = process.env.SHOP_URL || 'https://shop.zahan.one';

  try {
    const body                    = await readBody(req);
    const { variantId, quantity = 1, email } = body;

    if (!variantId || !email) {
      return res.status(400).json({ error: 'Missing required fields: variantId, email' });
    }

    /* Fetch variant + product + images */
    const { data: variant, error: vErr } = await supabase
      .from('product_variants')
      .select(`
        id, sku, size, color, price_usd, stock_qty,
        products ( id, name, brand, description ),
        product_images ( url, type, display_order )
      `)
      .eq('id', variantId)
      .single();

    if (vErr || !variant)             return res.status(404).json({ error: 'Variant not found' });
    if (!variant.price_usd)           return res.status(400).json({ error: 'USD price not set for this variant' });
    if (variant.stock_qty < quantity) return res.status(400).json({ error: 'Insufficient stock' });

    const totalUsd = parseFloat(variant.price_usd) * quantity;

    /* Primary image */
    const imgs = (variant.product_images || [])
      .filter(i => i.type === 'main')
      .sort((a, b) => a.display_order - b.display_order);
    const imageUrl = imgs[0]?.url || null;

    /* Upsert customer */
    const { data: customer } = await supabase
      .from('customers')
      .upsert(
        { email, market: 'international' },
        { onConflict: 'email', ignoreDuplicates: false }
      )
      .select('id')
      .single();

    /* Create Supabase order (pending) */
    const { data: order, error: oErr } = await supabase
      .from('orders')
      .insert({
        customer_id:      customer?.id || null,
        market:           'international',
        status:           'pending',
        total_usd:        totalUsd,
        payment_provider: 'stripe',
      })
      .select('id')
      .single();

    if (oErr) throw oErr;

    /* Create order item */
    await supabase.from('order_items').insert({
      order_id:   order.id,
      variant_id: variantId,
      quantity,
      unit_price: variant.price_usd,
    });

    /* Build line item name */
    const variantLabel = [variant.size, variant.color].filter(Boolean).join(' / ');
    const productName  = `Zahan® ${variant.products?.brand || ''}™ — ${variant.products?.name || 'Product'}`;
    const lineItemName = variantLabel ? `${productName} (${variantLabel})` : productName;

    /* Create Stripe Checkout Session */
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      mode:                 'payment',
      customer_email:       email,
      line_items: [{
        price_data: {
          currency:     'usd',
          product_data: {
            name:        lineItemName,
            description: variant.products?.description || `Zahan® ${variant.products?.brand || ''}™`,
            images:      imageUrl ? [imageUrl] : [],
          },
          unit_amount: Math.round(parseFloat(variant.price_usd) * 100),
        },
        quantity,
      }],
      shipping_address_collection: {
        allowed_countries: ['US', 'GB', 'AE', 'AU', 'CA', 'DE', 'FR',
                            'NL', 'SE', 'NO', 'DK', 'SG', 'NZ', 'IN',
                            'JP', 'MY', 'PH', 'TH', 'IT', 'ES', 'PL'],
      },
      metadata: {
        supabase_order_id: order.id,
        variant_id:        variantId,
      },
      success_url: `${SHOP_URL}/success?orderId=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${SHOP_URL}/product?id=${variant.products?.id}&market=global`,
    });

    /* Store Stripe session ID */
    await supabase
      .from('orders')
      .update({ payment_id: session.id })
      .eq('id', order.id);

    return res.status(200).json({ sessionUrl: session.url, orderId: order.id });

  } catch (err) {
    console.error('[create-stripe-session]', err);
    return res.status(500).json({ error: 'Stripe session creation failed', detail: err.message });
  }
};

/* ============================================================
   ZAHAN SHOP — app.js
   shop.zahan.one · Zahan Earth Group®
   Phase 2 — Storefront · Supabase Client & Utilities
   ============================================================
   ⚠️  SETUP: Replace the two config values below with your
       Supabase project URL and anon key.
       Find them in: Supabase Dashboard → Settings → API
   ============================================================ */

const SUPABASE_URL      = '__YOUR_SUPABASE_URL__';
const SUPABASE_ANON_KEY = '__YOUR_SUPABASE_ANON_KEY__';

/* ── BRAND METADATA ── */
const BRANDS = {
  all:       { label: 'All Collections', color: null },
  GenX:      { label: 'GenX™',       color: '#60c0ff' },
  Signature: { label: 'Signature™',  color: '#a78bfa' },
  Heritage:  { label: 'Heritage™',   color: '#e879f9' },
  Selene:    { label: 'Selene™',     color: '#e8c860' },
};

/* ── SUPABASE CLIENT ── */
let _db = null;
function getDB() {
  if (!_db) {
    const { createClient } = supabase;
    _db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _db;
}

/* ── URL PARAMS ── */
function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    market: p.get('market') || 'in',       // 'in' | 'global'
    brand:  p.get('brand')  || 'all',      // 'all' | 'GenX' | 'Signature' | 'Heritage' | 'Selene'
    id:     p.get('id')     || null,       // product UUID
  };
}

/* ── DATA FETCHING ── */

/**
 * Fetch product listing.
 * @param {string} market - 'in' or 'global'
 * @param {string} brand  - 'all' or specific brand name
 * @returns {Promise<Array>} products array
 */
async function fetchProducts(market, brand = 'all') {
  const db = getDB();

  // Products with market = selected OR 'both'
  const marketValues = market === 'in'
    ? ['india', 'both']
    : ['international', 'both'];

  let query = db
    .from('products')
    .select(`
      id, name, slug, brand, category, description,
      product_variants ( id, price_inr, price_usd, stock_qty ),
      product_images   ( url, alt_text, display_order, type )
    `)
    .eq('status', 'active')
    .in('market', marketValues);

  if (brand && brand !== 'all') {
    query = query.eq('brand', brand);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Fetch a single product with full variant + image data.
 * @param {string} productId - UUID
 * @returns {Promise<Object|null>} product or null
 */
async function fetchProduct(productId) {
  const db = getDB();

  const { data, error } = await db
    .from('products')
    .select(`
      id, name, slug, brand, category, description, tags,
      product_variants (
        id, sku, size, color, material,
        price_inr, price_usd, stock_qty
      ),
      product_images (
        id, url, alt_text, display_order, type, variant_id
      )
    `)
    .eq('id', productId)
    .eq('status', 'active')
    .single();

  if (error) { console.error('fetchProduct error:', error); return null; }
  return data;
}

/* ── PRICE HELPERS ── */

/**
 * Get the minimum display price for a product (for listing cards).
 * Returns null if no prices set yet.
 */
function getMinPrice(variants, market) {
  if (!variants || !variants.length) return null;
  const prices = variants
    .map(v => market === 'in' ? v.price_inr : v.price_usd)
    .filter(p => p != null && p > 0);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * Get the price for a specific variant.
 */
function getVariantPrice(variant, market) {
  return market === 'in' ? variant.price_inr : variant.price_usd;
}

/**
 * Format a price for display.
 */
function formatPrice(amount, market) {
  if (!amount) return null;
  if (market === 'in') {
    return '₹' + Number(amount).toLocaleString('en-IN');
  }
  return '$' + Number(amount).toFixed(2);
}

/**
 * Currency label for display.
 */
function getCurrencyLabel(market) {
  return market === 'in' ? 'INR' : 'USD';
}

/* ── IMAGE HELPERS ── */

/**
 * Get the primary/main image for a product (used in listing cards).
 */
function getPrimaryImage(images) {
  if (!images || !images.length) return null;
  const mainImgs = images.filter(i => i.type === 'main');
  const pool = mainImgs.length ? mainImgs : images;
  return pool.sort((a, b) => a.display_order - b.display_order)[0];
}

/**
 * Get all images sorted by display_order (used in product gallery).
 */
function getSortedImages(images) {
  if (!images || !images.length) return [];
  return [...images].sort((a, b) => a.display_order - b.display_order);
}

/* ── STOCK HELPERS ── */

function getStockStatus(variants) {
  if (!variants || !variants.length) return 'unknown';
  const total = variants.reduce((sum, v) => sum + (v.stock_qty || 0), 0);
  if (total === 0) return 'out';
  if (total <= 5) return 'low';
  return 'in';
}

function getVariantStock(variant) {
  const qty = variant.stock_qty || 0;
  if (qty === 0) return 'out';
  if (qty <= 3) return 'low';
  return 'in';
}

/* ── MARKET UTILS ── */

function getMarketLabel(market) {
  return market === 'in' ? '🇮🇳 India' : '🌍 International';
}

function getOppositeMarket(market) {
  return market === 'in' ? 'global' : 'in';
}

function getOppositeMarketLabel(market) {
  return market === 'in' ? '🌍 Switch to International' : '🇮🇳 Switch to India';
}

/* ── BRAND UTILS ── */

function getBrandColor(brand) {
  return BRANDS[brand]?.color || '#5b8dee';
}

function getBrandLabel(brand) {
  return BRANDS[brand]?.label || brand;
}

/* ── TOAST NOTIFICATIONS ── */

function showToast(message, icon = 'fa-check-circle') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s';
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

/* ── CART (Phase 3 placeholder) ── */

const Cart = {
  get() {
    try { return JSON.parse(localStorage.getItem('zahan_cart') || '[]'); }
    catch { return []; }
  },
  save(items) {
    localStorage.setItem('zahan_cart', JSON.stringify(items));
    Cart._updateBadge();
  },
  add(product, variant, market) {
    const items = Cart.get();
    const key = `${product.id}::${variant.id}`;
    const existing = items.find(i => i.key === key);
    if (existing) {
      existing.qty = Math.min(existing.qty + 1, variant.stock_qty || 99);
    } else {
      items.push({
        key,
        productId:   product.id,
        productName: product.name,
        brand:       product.brand,
        variantId:   variant.id,
        sku:         variant.sku,
        size:        variant.size,
        color:       variant.color,
        price:       getVariantPrice(variant, market),
        market,
        qty: 1,
      });
    }
    Cart.save(items);
    showToast(`${product.name} added to cart`);
    return items;
  },
  count() { return Cart.get().reduce((s, i) => s + i.qty, 0); },
  _updateBadge() {
    const badge = document.querySelector('.cart-count');
    if (!badge) return;
    const n = Cart.count();
    badge.textContent = n;
    badge.classList.toggle('visible', n > 0);
  },
};

/* ── INIT CART BADGE ON LOAD ── */
document.addEventListener('DOMContentLoaded', () => Cart._updateBadge());

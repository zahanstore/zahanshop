/* ============================================================
   ZAHAN SHOP — lib/email.js
   Resend transactional emails — Order Confirmed + Shipped
   Used by: api/razorpay-webhook.js, api/stripe-webhook.js,
            api/qikink-webhook.js, api/printful-webhook.js
   ============================================================ */

const { Resend } = require('resend');

const FROM     = 'Zahan Store® <orders@mail.zahan.one>';
const SHOP_URL = process.env.SHOP_URL || 'https://shop.zahan.one';

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

/* ── Shared email shell ── */
function shell(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Zahan Store®</title>
</head>
<body style="margin:0;padding:0;background:#0b0d17;font-family:'Inter',Arial,sans-serif;color:#e8e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0d17;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#161b2e;border-radius:20px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0d1120,#161b2e);padding:32px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.07);">
          <p style="margin:0;font-family:'Poppins',Arial,sans-serif;font-size:1.2rem;font-weight:700;color:#fff;letter-spacing:0.02em;">
            Zahan Store®
          </p>
          <p style="margin:4px 0 0;font-size:0.72rem;color:rgba(255,255,255,0.35);letter-spacing:0.12em;text-transform:uppercase;">
            Designed in the desert, made for the world
          </p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          ${content}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 40px 28px;border-top:1px solid rgba(255,255,255,0.07);">
          <p style="margin:0;font-size:0.72rem;color:rgba(232,232,240,0.3);line-height:1.7;">
            © 2026 Zahan Earth Group® · Abu Dhabi, UAE 🌙<br>
            Questions? <a href="mailto:support@mail.zahan.one" style="color:#5b8dee;text-decoration:none;">support@mail.zahan.one</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* ── Order Confirmed ── */
async function sendOrderConfirmed({ to, orderId, productName, brand, variantLabel, price, market }) {
  const resend   = getResend();
  const currency = market === 'in' ? 'INR' : 'USD';
  const subject  = `Order confirmed — ${productName || 'Zahan Store®'} 🎉`;

  const html = shell(`
    <h1 style="margin:0 0 8px;font-family:'Poppins',Arial,sans-serif;font-size:1.4rem;font-weight:700;color:#fff;">
      Your order is confirmed 🎉
    </h1>
    <p style="margin:0 0 24px;font-size:0.9rem;color:#8892b0;line-height:1.7;">
      Thank you for shopping with Zahan Store®. Your item is being prepared for production.
    </p>

    <!-- Order card -->
    <table width="100%" style="background:#111520;border-radius:12px;border:1px solid rgba(255,255,255,0.07);margin-bottom:24px;">
      <tr><td style="padding:20px 24px;">
        ${brand ? `<p style="margin:0 0 4px;font-size:0.62rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.3);">${brand}™</p>` : ''}
        <p style="margin:0 0 8px;font-size:1rem;font-weight:600;color:#fff;">${productName || 'Your product'}</p>
        ${variantLabel ? `<p style="margin:0 0 12px;font-size:0.8rem;color:#8892b0;">${variantLabel}</p>` : ''}
        <table width="100%" style="border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;margin-top:4px;">
          <tr>
            <td style="font-size:0.78rem;color:#8892b0;">Order ID</td>
            <td align="right" style="font-family:monospace;font-size:0.72rem;color:#5b8dee;">${orderId}</td>
          </tr>
          ${price ? `<tr><td style="font-size:0.78rem;color:#8892b0;padding-top:6px;">Total</td><td align="right" style="font-size:0.9rem;font-weight:700;color:#fff;padding-top:6px;">${price} ${currency}</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    <!-- Steps -->
    <p style="margin:0 0 12px;font-size:0.72rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.3);">What happens next</p>
    <table width="100%" style="margin-bottom:28px;">
      ${['Your item enters production with our fulfilment partner.',
         'We\'ll email you a tracking link the moment it ships.',
         'Estimated delivery: 5–10 business days.'].map((txt, i) => `
      <tr><td style="padding:6px 0;vertical-align:top;">
        <table><tr>
          <td style="width:24px;height:24px;background:rgba(91,141,238,0.15);border:1px solid rgba(91,141,238,0.3);border-radius:50%;text-align:center;vertical-align:middle;">
            <span style="font-size:0.7rem;font-weight:700;color:#5b8dee;">${i+1}</span>
          </td>
          <td style="padding-left:12px;font-size:0.82rem;color:#8892b0;line-height:1.6;">${txt}</td>
        </tr></table>
      </td></tr>`).join('')}
    </table>

    <a href="${SHOP_URL}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#5b8dee,#a78bfa);border-radius:100px;font-size:0.85rem;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.04em;">
      Continue Shopping →
    </a>
  `);

  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) throw error;
  console.log(`[email] Order confirmed sent → ${to}`);
}

/* ── Order Shipped ── */
async function sendOrderShipped({ to, orderId, productName, trackingUrl, carrier, market }) {
  const resend  = getResend();
  const subject = `Your order has shipped! 🚚`;

  const html = shell(`
    <h1 style="margin:0 0 8px;font-family:'Poppins',Arial,sans-serif;font-size:1.4rem;font-weight:700;color:#fff;">
      Your order is on its way 🚚
    </h1>
    <p style="margin:0 0 24px;font-size:0.9rem;color:#8892b0;line-height:1.7;">
      ${productName ? `<strong style="color:#e8e8f0;">${productName}</strong> has shipped` : 'Your order has shipped'} and is heading your way.
    </p>

    ${trackingUrl ? `
    <!-- Tracking CTA -->
    <table width="100%" style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);border-radius:12px;margin-bottom:24px;">
      <tr><td style="padding:20px 24px;text-align:center;">
        <p style="margin:0 0 4px;font-size:0.72rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#34d399;">Live Tracking</p>
        ${carrier ? `<p style="margin:0 0 16px;font-size:0.82rem;color:#8892b0;">Carrier: ${carrier}</p>` : '<p style="margin:0 0 16px;"></p>'}
        <a href="${trackingUrl}" style="display:inline-block;padding:13px 28px;background:#34d399;border-radius:100px;font-size:0.85rem;font-weight:700;color:#0b0d17;text-decoration:none;letter-spacing:0.04em;">
          Track My Order →
        </a>
      </td></tr>
    </table>` : ''}

    <!-- Order ref -->
    <table width="100%" style="background:#111520;border-radius:12px;border:1px solid rgba(255,255,255,0.07);margin-bottom:28px;">
      <tr><td style="padding:16px 24px;">
        <table width="100%">
          <tr>
            <td style="font-size:0.78rem;color:#8892b0;">Order ID</td>
            <td align="right" style="font-family:monospace;font-size:0.72rem;color:#5b8dee;">${orderId}</td>
          </tr>
          <tr>
            <td style="font-size:0.78rem;color:#8892b0;padding-top:6px;">Market</td>
            <td align="right" style="font-size:0.78rem;color:#8892b0;padding-top:6px;">${market === 'in' ? '🇮🇳 India' : '🌍 International'}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <p style="margin:0 0 20px;font-size:0.82rem;color:#8892b0;line-height:1.7;">
      If you have any questions about your delivery, reply to this email or reach us at
      <a href="mailto:support@mail.zahan.one" style="color:#5b8dee;text-decoration:none;">support@mail.zahan.one</a>
    </p>

    <a href="${SHOP_URL}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#5b8dee,#a78bfa);border-radius:100px;font-size:0.85rem;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.04em;">
      Shop Again →
    </a>
  `);

  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) throw error;
  console.log(`[email] Shipped email sent → ${to}`);
}

module.exports = { sendOrderConfirmed, sendOrderShipped };

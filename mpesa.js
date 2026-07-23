// mpesa.js — KCB Buni M-Pesa STK Push integration
// Uses KCB Buni API (https://accounts.buni.kcbgroup.com)
// Falls back to a simulated flow when MPESA_MODE=sandbox and no live credentials are reachable.

const { v4: uuid } = require('uuid');

const KCB_ENV = (process.env.KCB_ENV || 'production').toLowerCase();
const KCB_BASE_URL = process.env.KCB_BASE_URL || (KCB_ENV === 'production' ? 'https://api.buni.kcbgroup.com' : 'https://accounts.buni.kcbgroup.com');
const KCB_TOKEN_ENDPOINT = process.env.KCB_TOKEN_ENDPOINT || `${KCB_BASE_URL.replace(/\/$/, '')}/token`;
const KCB_CONSUMER_KEY = process.env.KCB_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY || '';
const KCB_CONSUMER_SECRET = process.env.KCB_CONSUMER_SECRET || process.env.MPESA_CONSUMER_SECRET || '';
const KCB_API_KEY = process.env.KCB_API_KEY || '';
const KCB_CALLBACK_URL = process.env.KCB_CALLBACK_URL || process.env.MPESA_CALLBACK_URL || 'https://www.galaaward.co.ke/callback';
const KCB_SHORTCODE = process.env.KCB_SHORTCODE || process.env.MPESA_SHORTCODE || '';
const KCB_TILL = process.env.KCB_TILL || KCB_SHORTCODE;
const KCB_STK_ENDPOINT = process.env.KCB_STK_ENDPOINT || `${KCB_BASE_URL.replace(/\/$/, '')}/mpesa/stkpush/v1/processrequest`;
const MODE = (process.env.MPESA_MODE || (KCB_ENV === 'production' ? 'live' : 'sandbox')).toLowerCase();

// In-memory state for pending simulated transactions (sandbox mode only)
const pending = new Map();

// Cache of KCB OAuth access tokens
let cachedToken = null;
let cachedTokenExpiresAt = 0;

/**
 * Fetch (and cache) an OAuth access token from KCB Buni.
 * Buni exposes standard OAuth2 client-credentials at /oauth2/token.
 */
async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 30_000) return cachedToken;

  if (!KCB_CONSUMER_KEY || !KCB_CONSUMER_SECRET) {
    throw new Error('KCB credentials not configured');
  }

  const creds = Buffer.from(`${KCB_CONSUMER_KEY}:${KCB_CONSUMER_SECRET}`).toString('base64');
  const url = KCB_TOKEN_ENDPOINT;

  const body = new URLSearchParams({ grant_type: 'client_credentials' });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`KCB token request failed: ${resp.status} ${txt.slice(0, 200)}`);
  }
  const j = await resp.json();
  cachedToken = j.access_token;
  cachedTokenExpiresAt = Date.now() + ((j.expires_in || 3600) * 1000);
  return cachedToken;
}

/**
 * Trigger an STK push (customer receives a prompt on their phone).
 *
 * Real KCB Buni STK Push endpoint. If the call fails (network / credentials
 * unavailable) and MPESA_MODE=sandbox, we fall back to a simulated push so the
 * frontend still functions end-to-end for testing.
 */
async function stkPush({ phone, amount, accountRef, description }) {
  // Sandbox / simulated path (used when explicitly requested or when creds are missing)
  const simulated = () => {
    const checkoutId = 'ws_CO_' + Date.now() + '_' + uuid().slice(0, 8);
    const merchantId = uuid().slice(0, 12);
    console.log(`[mpesa:sim] STK push (fallback) phone=${phone} amount=${amount} checkoutId=${checkoutId}`);
    pending.set(checkoutId, { phone, amount, at: Date.now() });
    return {
      MerchantRequestID: merchantId,
      CheckoutRequestID: checkoutId,
      ResponseCode: '0',
      ResponseDescription: 'Success. Request accepted for processing',
      CustomerMessage: 'Success. Request accepted for processing',
      _simulated: true,
    };
  };

  if (MODE === 'sandbox' && (!KCB_CONSUMER_KEY || !KCB_CONSUMER_SECRET)) {
    return simulated();
  }

  try {
    const token = await getAccessToken();
    // KCB Buni STK Push endpoint. Payload mirrors Safaricom / KCB Buni Mpesa "STKPush" contract.
    const url = KCB_STK_ENDPOINT;

    const payload = {
      BusinessShortCode: KCB_SHORTCODE || '174379',
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: KCB_TILL || KCB_SHORTCODE || '174379',
      PhoneNumber: phone,
      CallBackURL: KCB_CALLBACK_URL,
      AccountReference: (accountRef || 'GALA').slice(0, 12),
      TransactionDesc: (description || 'Gala vote').slice(0, 20),
    };

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (KCB_API_KEY) headers['apikey'] = KCB_API_KEY;

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    if (!resp.ok || body.ResponseCode && body.ResponseCode !== '0') {
      console.error('[mpesa:kcb] STK push failed', resp.status, text.slice(0, 300));
      if (MODE === 'sandbox') return simulated();
      throw new Error('stk_push_failed');
    }

    console.log(`[mpesa:kcb] STK push OK phone=${phone} amount=${amount} checkoutId=${body.CheckoutRequestID}`);
    // Track live push for callback matching; no auto-resolve.
    pending.set(body.CheckoutRequestID, { phone, amount, at: Date.now(), live: true });

    return {
      MerchantRequestID: body.MerchantRequestID,
      CheckoutRequestID: body.CheckoutRequestID,
      ResponseCode: body.ResponseCode,
      ResponseDescription: body.ResponseDescription,
      CustomerMessage: body.CustomerMessage,
    };
  } catch (e) {
    console.error('[mpesa:kcb] error:', e.message);
    if (MODE === 'sandbox') return simulated();
    throw e;
  }
}

/**
 * Simulates the customer entering their PIN and paying (sandbox only).
 * In production the confirmation comes via the CallBackURL, not this method.
 */
function simulateConfirm(checkoutId, success = true) {
  const item = pending.get(checkoutId);
  if (!item) return null;
  pending.delete(checkoutId);
  return {
    checkoutId,
    success,
    receipt: success ? 'TEST' + Date.now().toString(36).toUpperCase() : null,
    resultCode: success ? 0 : 1032,
    resultDesc: success ? 'The service request is processed successfully.' : 'Request cancelled by user',
  };
}

module.exports = { stkPush, simulateConfirm, getAccessToken };

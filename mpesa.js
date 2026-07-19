// mpesa.js — Simulated M-Pesa STK Push (safe for testing)
// When you replace with real KCB / Daraja API keys, swap the two functions
// below with real HTTPS calls to Safaricom's Daraja endpoints. The rest of
// the server code stays exactly the same.
const { v4: uuid } = require('uuid');

const pending = new Map(); // checkoutId -> { phone, amount, resolveTimer }

/**
 * Simulated STK push. In real production you'd:
 *   1. POST to https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest
 *   2. Return the CheckoutRequestID from Safaricom
 *   3. Wait for Safaricom to POST back to your CallBackURL
 */
async function stkPush({ phone, amount, accountRef, description }) {
  const checkoutId = 'ws_CO_' + Date.now() + '_' + uuid().slice(0, 8);
  const merchantId = uuid().slice(0, 12);

  // Log for visibility
  console.log(`[mpesa:sim] STK push initiated → phone=${phone} amount=${amount} checkoutId=${checkoutId}`);

  pending.set(checkoutId, { phone, amount, at: Date.now() });

  return {
    MerchantRequestID: merchantId,
    CheckoutRequestID: checkoutId,
    ResponseCode: '0',
    ResponseDescription: 'Success. Request accepted for processing',
    CustomerMessage: 'Success. Request accepted for processing',
  };
}

/**
 * Simulates the customer entering their PIN and paying.
 * Called by the frontend after the "PIN prompt" UI completes.
 * In production this would be triggered by Safaricom's callback,
 * NOT by the frontend.
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

module.exports = { stkPush, simulateConfirm };

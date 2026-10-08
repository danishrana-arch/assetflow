// The one place payment-provider (Stripe) calls belong. Checkout, the customer
// portal, cancelling and webhooks get connected here later; nothing else in
// the app talks to a payment provider, and no secret key ever reaches the
// frontend. Until then every call reports "not configured" and the billing
// controller turns that into a clear 402 — nothing is faked.

class PaymentsNotConfiguredError extends Error {
  constructor() {
    super("Online payments aren't connected yet. Please contact the ManagementDock team to activate a paid plan.")
    this.code = "PAYMENT_NOT_CONFIGURED"
  }
}

function isConfigured() {
  return false
}

// Should return { url } for the hosted checkout page.
async function createCheckoutSession() {
  throw new PaymentsNotConfiguredError()
}

// Should return { url } for the customer portal.
async function createPortalSession() {
  throw new PaymentsNotConfiguredError()
}

// Called when an organization moves to the Free plan. Should cancel the
// provider-side subscription; nothing to cancel yet.
async function cancelSubscription() {}

module.exports = { PaymentsNotConfiguredError, isConfigured, createCheckoutSession, createPortalSession, cancelSubscription }

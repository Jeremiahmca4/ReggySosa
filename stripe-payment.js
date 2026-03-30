// stripe-payment.js
// Handles the Stripe Elements embedded payment modal for tournament entry fees.
// Loaded on tournaments.html alongside script.js.
//
// Publishable key — safe to be in frontend code.
const STRIPE_PUBLISHABLE_KEY = 'pk_live_51SszQNRs4pL76Ew3hynTNA3ohO3joHOZfPXkY2rPUHvtIXWyRgod753hkrfUOYC5weI8EOQr8MysE0TSHzrEUGal00MuZxojww';
const BACKEND_URL = 'https://reggysosa-backend.vercel.app';

// ─── Inject modal HTML into the page ────────────────────────────────────────
(function injectModal() {
  const modal = document.createElement('div');
  modal.id = 'stripe-payment-modal';
  modal.innerHTML = `
    <div class="stripe-modal-overlay" id="stripe-modal-overlay">
      <div class="stripe-modal-box">
        <button class="stripe-modal-close" id="stripe-modal-close" aria-label="Close">&times;</button>
        <div class="stripe-modal-header">
          <span class="stripe-modal-icon">🏆</span>
          <h2 id="stripe-modal-title">Pay Entry Fee</h2>
          <p id="stripe-modal-tournament-name" class="stripe-modal-sub"></p>
        </div>
        <div class="stripe-modal-amount-row">
          <span>Entry Fee</span>
          <span id="stripe-modal-amount" class="stripe-modal-amount-value">$0.00</span>
        </div>
        <div id="stripe-payment-element"></div>
        <div id="stripe-payment-message" class="stripe-payment-message" style="display:none;"></div>
        <button id="stripe-submit-btn" class="stripe-submit-btn">
          <span id="stripe-submit-text">Pay & Register</span>
          <span id="stripe-submit-spinner" class="stripe-spinner" style="display:none;"></span>
        </button>
        <p class="stripe-secure-note">🔒 Secured by Stripe — we never see your card details</p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #stripe-payment-modal { display: none; }
    #stripe-payment-modal.active { display: block; }

    .stripe-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.75);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      animation: stripeOverlayFadeIn 0.2s ease;
    }

    @keyframes stripeOverlayFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .stripe-modal-box {
      background: #1a1a2e;
      border: 1px solid #d4a017;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 460px;
      position: relative;
      animation: stripeModalSlideIn 0.25s ease;
    }

    @keyframes stripeModalSlideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .stripe-modal-close {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: none;
      border: none;
      color: #aaa;
      font-size: 1.5rem;
      cursor: pointer;
      line-height: 1;
      padding: 0;
      transition: color 0.2s;
    }
    .stripe-modal-close:hover { color: #fff; }

    .stripe-modal-header {
      text-align: center;
      margin-bottom: 1.5rem;
    }
    .stripe-modal-icon { font-size: 2rem; display: block; margin-bottom: 0.5rem; }
    .stripe-modal-header h2 {
      color: #d4a017;
      font-size: 1.4rem;
      margin: 0 0 0.25rem;
    }
    .stripe-modal-sub {
      color: #ccc;
      margin: 0;
      font-size: 0.9rem;
    }

    .stripe-modal-amount-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(212,160,23,0.1);
      border: 1px solid rgba(212,160,23,0.3);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-bottom: 1.5rem;
      color: #eee;
      font-size: 0.95rem;
    }
    .stripe-modal-amount-value {
      color: #d4a017;
      font-weight: 700;
      font-size: 1.1rem;
    }

    #stripe-payment-element {
      margin-bottom: 1.25rem;
    }

    .stripe-payment-message {
      background: rgba(255,80,80,0.15);
      border: 1px solid rgba(255,80,80,0.4);
      border-radius: 8px;
      color: #ff6b6b;
      padding: 0.75rem 1rem;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    .stripe-payment-message.success {
      background: rgba(80,200,120,0.15);
      border-color: rgba(80,200,120,0.4);
      color: #50c878;
    }

    .stripe-submit-btn {
      width: 100%;
      background: linear-gradient(135deg, #d4a017, #f0c040);
      color: #1a1a2e;
      border: none;
      border-radius: 8px;
      padding: 0.85rem;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: opacity 0.2s, transform 0.1s;
    }
    .stripe-submit-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
    .stripe-submit-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

    .stripe-spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(26,26,46,0.3);
      border-top-color: #1a1a2e;
      border-radius: 50%;
      animation: stripeSpin 0.7s linear infinite;
    }
    @keyframes stripeSpin {
      to { transform: rotate(360deg); }
    }

    .stripe-secure-note {
      text-align: center;
      color: #777;
      font-size: 0.78rem;
      margin: 0.75rem 0 0;
    }
  `;
  document.head.appendChild(style);
})();

// ─── State ───────────────────────────────────────────────────────────────────
let stripeInstance = null;
let stripeElements = null;
let currentPaymentData = null; // { tournamentId, teamId, amount, tournamentName }

// ─── Load Stripe.js dynamically ──────────────────────────────────────────────
function loadStripeJs() {
  return new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe);
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => resolve(window.Stripe);
    script.onerror = () => reject(new Error('Failed to load Stripe.js'));
    document.head.appendChild(script);
  });
}

// ─── Open the payment modal ───────────────────────────────────────────────────
// Called from script.js: openStripeModal({ tournamentId, teamId, amount (dollars), tournamentName })
window.openStripeModal = async function({ tournamentId, teamId, amount, tournamentName }) {
  currentPaymentData = { tournamentId, teamId, amount, tournamentName };

  // Update modal UI
  document.getElementById('stripe-modal-tournament-name').textContent = tournamentName || '';
  document.getElementById('stripe-modal-amount').textContent = `$${parseFloat(amount).toFixed(2)}`;
  hideMessage();
  setSubmitLoading(false);

  // Show modal
  document.getElementById('stripe-payment-modal').classList.add('active');
  document.body.style.overflow = 'hidden';

  try {
    // Load Stripe if not already loaded
    if (!stripeInstance) {
      const StripeConstructor = await loadStripeJs();
      stripeInstance = StripeConstructor(STRIPE_PUBLISHABLE_KEY);
    }

    // Create PaymentIntent on backend
    const res = await fetch(`${BACKEND_URL}/api/stripe/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournamentId,
        teamId,
        amount: Math.round(amount * 100), // convert to cents
        tournamentName,
      }),
    });

    const data = await res.json();

    if (!data.ok || !data.clientSecret) {
      showMessage(data.error || 'Failed to initialize payment. Please try again.');
      return;
    }

    // Mount Stripe Elements
    stripeElements = stripeInstance.elements({
      clientSecret: data.clientSecret,
      appearance: {
        theme: 'night',
        variables: {
          colorPrimary: '#d4a017',
          colorBackground: '#1a1a2e',
          colorText: '#eee',
          colorDanger: '#ff6b6b',
          fontFamily: 'system-ui, sans-serif',
          borderRadius: '6px',
        },
      },
    });

    const paymentElement = stripeElements.create('payment');
    document.getElementById('stripe-payment-element').innerHTML = '';
    paymentElement.mount('#stripe-payment-element');

  } catch (err) {
    showMessage('Failed to load payment form. Please try again.');
    console.error('Stripe init error:', err);
  }
};

// ─── Close modal ──────────────────────────────────────────────────────────────
function closeStripeModal() {
  document.getElementById('stripe-payment-modal').classList.remove('active');
  document.body.style.overflow = '';
  document.getElementById('stripe-payment-element').innerHTML = '';
  stripeElements = null;
  currentPaymentData = null;
}

// ─── Submit payment ───────────────────────────────────────────────────────────
async function handleStripeSubmit() {
  if (!stripeInstance || !stripeElements) return;
  setSubmitLoading(true);
  hideMessage();

  try {
    const { error, paymentIntent } = await stripeInstance.confirmPayment({
      elements: stripeElements,
      redirect: 'if_required', // No redirect — stay on site
      confirmParams: {
        return_url: window.location.href, // fallback only
      },
    });

    if (error) {
      showMessage(error.message || 'Payment failed. Please try again.');
      setSubmitLoading(false);
      return;
    }

    if (paymentIntent && paymentIntent.status === 'succeeded') {
      // Payment succeeded — the webhook will register the team in Supabase.
      // We also optimistically update the UI immediately.
      showMessage('🎉 Payment successful! Your team is registered.', true);
      setSubmitLoading(false);

      // Notify script.js that payment succeeded so it can refresh the UI
      if (typeof window.onStripePaymentSuccess === 'function') {
        window.onStripePaymentSuccess(currentPaymentData);
      }

      // Auto-close after 2.5 seconds
      setTimeout(closeStripeModal, 2500);
    }
  } catch (err) {
    showMessage('An unexpected error occurred. Please try again.');
    setSubmitLoading(false);
    console.error('Stripe submit error:', err);
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function showMessage(msg, isSuccess = false) {
  const el = document.getElementById('stripe-payment-message');
  el.textContent = msg;
  el.className = 'stripe-payment-message' + (isSuccess ? ' success' : '');
  el.style.display = 'block';
}

function hideMessage() {
  const el = document.getElementById('stripe-payment-message');
  el.style.display = 'none';
  el.textContent = '';
}

function setSubmitLoading(loading) {
  const btn = document.getElementById('stripe-submit-btn');
  const text = document.getElementById('stripe-submit-text');
  const spinner = document.getElementById('stripe-submit-spinner');
  btn.disabled = loading;
  text.style.display = loading ? 'none' : 'inline';
  spinner.style.display = loading ? 'inline-block' : 'none';
}

// ─── Event listeners ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('stripe-modal-close').addEventListener('click', closeStripeModal);
  document.getElementById('stripe-modal-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeStripeModal();
  });
  document.getElementById('stripe-submit-btn').addEventListener('click', handleStripeSubmit);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeStripeModal();
  });
});

const { $, api, session, showToast, HOME } = App;

if (session.token && HOME[session.role]) location.replace(HOME[session.role]);   // already logged in

const params = new URLSearchParams(location.search);
if (params.get('verified') === 'true') showToast('Email verified! You can now log in.');
if (params.get('verified') === 'false') showToast('Verification link is invalid or expired. Use "Resend verification email".', 'error', 6000);
if (params.get('reset') === 'true') showToast('Password updated. Please log in.');

const form = $('#loginForm');
const errorMsg = $('#errorMsg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.textContent = '';
  $('#resendBox').hidden = true;
  const btn = $('#loginBtn');
  btn.disabled = true;
  btn.textContent = 'Logging in...';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST', auth: false,
      body: { email: $('#email').value.trim(), password: $('#password').value }
    });
    session.set(data);
    location.href = HOME[data.role] || 'index.html';        // role-based redirect
  } catch (err) {
    errorMsg.textContent = err.message;
    if (err.status === 403 && /verify/i.test(err.message)) $('#resendBox').hidden = false;
    btn.disabled = false;
    btn.textContent = 'Login';
  }
});

$('#resendBtn').addEventListener('click', async () => {
  try {
    const d = await api('/api/auth/resend-verification', { method: 'POST', auth: false, body: { email: $('#email').value.trim() } });
    showToast(d.message);
  } catch (err) { showToast(err.message, 'error'); }
});
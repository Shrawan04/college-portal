const { $, api, session, HOME } = App;

// Landing page: send logged-in users straight to their dashboard
if ($('#landing') && session.token && HOME[session.role]) location.replace(HOME[session.role]);

const msg = $('#msg');
const say = (text, ok) => { msg.className = ok ? 'success-msg' : 'error-msg'; msg.textContent = text; };

const forgot = $('#forgotForm');
if (forgot) {
  forgot.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = forgot.querySelector('button');
    btn.disabled = true;
    try {
      const d = await api('/api/auth/forgot-password', {
        method: 'POST', auth: false, body: { email: forgot.elements.email.value.trim() }
      });
      say(d.message, true);
    } catch (err) { say(err.message, false); }
    btn.disabled = false;
  });
}

const reset = $('#resetForm');
if (reset) {
  const p = new URLSearchParams(location.search);
  const id = p.get('id');
  const token = p.get('token');
  if (!/^\d+$/.test(id || '') || !token) { say('This reset link is invalid.', false); reset.hidden = true; }

  reset.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = reset.elements.password.value;
    if (!(pw.length >= 8 && pw.length <= 72 && /[A-Z]/.test(pw) && /\d/.test(pw))) {
      return say('Use 8-72 characters with 1 uppercase letter and 1 number', false);
    }
    if (pw !== reset.elements.confirm_password.value) return say('Passwords do not match', false);
    try {
      await api('/api/auth/reset-password', { method: 'POST', auth: false, body: { id: Number(id), token, password: pw } });
      location.href = 'login.html?reset=true';
    } catch (err) { say(err.message, false); }
  });
}
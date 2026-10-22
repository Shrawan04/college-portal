const { $, api } = App;
const form = $('#registerForm');
const msg = $('#formMsg');
const thisYear = new Date().getFullYear();

const rules = {
  name: (v) => v.trim().length >= 2 || 'Name must be at least 2 characters',
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Enter a valid email address',
  password: (v) => (v.length >= 8 && v.length <= 72 && /[A-Z]/.test(v) && /\d/.test(v)) ||
    'Use 8-72 characters with 1 uppercase letter and 1 number',
  confirm_password: (v) => v === form.elements.password.value || 'Passwords do not match',
  college_id: (v) => /^[A-Za-z0-9\-\/]{1,50}$/.test(v.trim()) || 'College ID may contain letters, numbers, - and /'
};
const alumniRules = {
  graduation_year: (v) => (/^\d{4}$/.test(v) && +v >= 1950 && +v <= thisYear + 6) || `Enter a year between 1950 and ${thisYear + 6}`,
  degree: (v) => v.trim().length >= 2 || 'Degree is required',
  linkedin_url: (v) => v.trim() === '' || /^https:\/\/\S+$/.test(v.trim()) || 'LinkedIn URL must start with https://'
};

const isAlumni = () => form.elements.role.value === 'alumni';
const activeRules = () => (isAlumni() ? { ...rules, ...alumniRules } : rules);
const setError = (name, text) => { const s = $('#err-' + name); if (s) s.textContent = text || ''; };

function check(name) {
  const rule = activeRules()[name];
  if (!rule) return true;
  const r = rule(form.elements[name].value);
  setError(name, r === true ? '' : r);
  return r === true;
}

// pre-select the role when the user came from the landing page buttons
const preset = new URLSearchParams(location.search).get('role');
if (preset === 'student' || preset === 'alumni') form.elements.role.value = preset;
const toggle = () => { $('#alumniFields').hidden = !isAlumni(); };
form.elements.role.addEventListener('change', toggle);
toggle();
for (const name of [...Object.keys(rules), ...Object.keys(alumniRules)]) {
  form.elements[name].addEventListener('blur', () => check(name));
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const results = Object.keys(activeRules()).map(check);      // run all checks so every error is shown
  if (results.includes(false)) return;

  const fields = ['name', 'email', 'password', 'confirm_password', 'role', 'college_id'];
  if (isAlumni()) fields.push('graduation_year', 'degree', 'company', 'designation', 'linkedin_url');
  const body = {};
  for (const f of fields) {
    const v = form.elements[f].value;
    body[f] = f.includes('password') ? v : v.trim();          // never trim passwords
  }

  const btn = $('#submitBtn');
  btn.disabled = true;
  btn.textContent = 'Creating account...';
  try {
    const d = await api('/api/auth/register', { method: 'POST', body, auth: false });
    form.hidden = true;
    $('#doneBox').hidden = false;
    $('#doneMsg').textContent = d.message;
  } catch (err) {
    ((err.data && err.data.errors) || []).forEach((x) => setError(x.field, x.message));
    msg.textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Register';
  }
});
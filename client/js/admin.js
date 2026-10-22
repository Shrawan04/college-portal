const { $, el, api, request, qs, fmtDate, badge, pager, showToast, start } = App;

// ---------- small helpers ----------
const td = (...c) => el('td', {}, ...c);
const btn = (text, cls, fn) => el('button', { class: `btn btn-small ${cls}`, type: 'button', text, onclick: fn });
function fillRows(sel, items, cols, build) {
  $(sel).replaceChildren(...(items.length
    ? items.map(build)
    : [el('tr', {}, el('td', { colspan: String(cols), class: 'muted', text: 'Nothing to show.' }))]));
}
async function act(fn) {                    // run an API call, show the server message, report success
  try {
    const d = await fn();
    if (d && d.message) showToast(d.message);
    return true;
  } catch (err) { showToast(err.message, 'error'); return false; }
}

// ---------- tabs ----------
const loaders = { overview: loadStats, events: loadEvents, users: loadUsers, alumni: loadAlumni, news: loadNews };
function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll("section[id^='tab-']").forEach((s) => { s.hidden = s.id !== 'tab-' + name; });
  loaders[name]();
}

// ---------- overview ----------
async function loadStats() {
  try {
    const { stats: s } = await api('/api/admin/stats');
    const item = (n, label) => el('div', { class: 'stat' }, el('strong', { text: String(n) }), label);
    $('#stats').replaceChildren(
      item(s.users, 'Total users'), item(s.events, 'Total events'),
      item(s.registrations, 'Confirmed registrations'), item(s.activeAlumni, 'Active alumni'),
      item(s.pendingAlumni, 'Alumni awaiting approval')
    );
  } catch (err) { showToast(err.message, 'error'); }
}

// ---------- events ----------
let editingId = null;
let toolsEvent = null;
const toLocal = (s) => String(s).slice(0, 16).replace(' ', 'T');       // MySQL date -> datetime-local value

function resetForm() {
  editingId = null;
  $('#eventForm').reset();
  $('#eventFormTitle').textContent = 'Create event';
  $('#cancelEdit').hidden = true;
}

function editEvent(ev) {
  editingId = ev.event_id;
  const f = $('#eventForm');
  f.elements.title.value = ev.title;
  f.elements.category.value = ev.category;
  f.elements.event_date.value = toLocal(ev.event_date);
  f.elements.registration_deadline.value = toLocal(ev.registration_deadline);
  f.elements.venue.value = ev.venue;
  f.elements.capacity.value = ev.capacity;
  f.elements.description.value = ev.description;
  $('#eventFormTitle').textContent = 'Edit event #' + ev.event_id;
  $('#cancelEdit').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#cancelEdit').addEventListener('click', resetForm);
$('#eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const banner = fd.get('banner');
  if (!banner || !banner.name) fd.delete('banner');                  // no new image chosen
  const url = editingId ? '/api/admin/events/' + editingId : '/api/admin/events';
  if (await act(() => api(url, { method: editingId ? 'PUT' : 'POST', body: fd }))) { resetForm(); loadEvents(); }
});

async function removeEvent(ev) {
  if (!confirm(`Delete ${ev.title}? All its registrations will be deleted too.`)) return;
  if (await act(() => api('/api/admin/events/' + ev.event_id, { method: 'DELETE' }))) {
    if (toolsEvent && toolsEvent.event_id === ev.event_id) $('#eventTools').hidden = true;
    loadEvents();
  }
}

async function exportCsv(ev) {
  try {
    const res = await request(`/api/admin/events/${ev.event_id}/export`);   // sends the Bearer token
    if (!res.ok) throw new Error('Export failed');
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: `event-${ev.event_id}-registrations.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) { showToast(err.message, 'error'); }
}

async function openTools(ev) {
  toolsEvent = ev;
  $('#eventTools').hidden = false;
  $('#toolsTitle').textContent = 'Registrations: ' + ev.title;
  try {
    const d = await api(`/api/admin/events/${ev.event_id}/registrations`);
    fillRows('#regRows', d.registrations, 5, (r) =>
      el('tr', {}, td(r.name), td(r.email), td(r.college_id), td(badge(r.status)), td(fmtDate(r.registered_at))));
  } catch (err) { showToast(err.message, 'error'); }
  $('#eventTools').scrollIntoView({ behavior: 'smooth' });
}

$('#notifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!toolsEvent) return;
  const f = e.currentTarget;
  const body = { subject: f.elements.subject.value.trim(), message: f.elements.message.value.trim() };
  if (await act(() => api(`/api/admin/events/${toolsEvent.event_id}/notify`, { method: 'POST', body }))) f.reset();
});

async function loadEvents() {
  try {
    const d = await api('/api/admin/events');
    fillRows('#eventRows', d.events, 6, (ev) => el('tr', {},
      td(ev.title), td(fmtDate(ev.event_date)), td(`${ev.confirmed_count} / ${ev.capacity}`),
      td(String(ev.waitlist_count)), td(ev.category),
      td(el('div', { class: 'actions' },
        btn('Edit', '', () => editEvent(ev)),
        btn('Registrations', '', () => openTools(ev)),
        btn('CSV', '', () => exportCsv(ev)),
        btn('Delete', 'btn-danger', () => removeEvent(ev))))
    ));
  } catch (err) { showToast(err.message, 'error'); }
}

// ---------- users ----------
let userPage = 1;

async function setRole(u, role) {
  if (!confirm(`Change ${u.name} to ${role}?`)) return;
  if (await act(() => api(`/api/admin/users/${u.user_id}/role`, { method: 'PUT', body: { role } }))) loadUsers();
}

async function loadUsers() {
  try {
    const d = await api('/api/admin/users' + qs({ page: userPage, q: $('#u-q').value.trim(), role: $('#u-role').value }));
    fillRows('#userRows', d.users, 6, (u) => el('tr', {},
      td(u.name), td(u.email), td(u.role), td(u.is_verified ? 'Yes' : 'No'),
      td(badge(u.is_active ? 'active' : 'suspended')),
      td(el('div', { class: 'actions' },
        btn(u.is_active ? 'Suspend' : 'Activate', u.is_active ? 'btn-danger' : 'btn-success', async () => {
          const body = { is_active: !u.is_active };
          if (await act(() => api(`/api/admin/users/${u.user_id}/status`, { method: 'PUT', body }))) loadUsers();
        }),
        u.role !== 'admin' ? btn('Make admin', '', () => setRole(u, 'admin')) : null,
        u.role !== 'student' ? btn('Make student', '', () => setRole(u, 'student')) : null))
    ));
    pager($('#userPager'), d.page, d.totalPages, (p) => { userPage = p; loadUsers(); });
  } catch (err) { showToast(err.message, 'error'); }
}
$('#userForm').addEventListener('submit', (e) => { e.preventDefault(); userPage = 1; loadUsers(); });

// ---------- alumni approval ----------
async function approve(a, approved) {
  if (await act(() => api(`/api/admin/alumni/${a.alumni_id}/approval`, { method: 'PUT', body: { approved } }))) loadAlumni();
}

async function loadAlumni() {
  try {
    const d = await api('/api/admin/alumni' + qs({ status: $('#a-status').value }));
    fillRows('#alumniRows', d.alumni, 6, (a) => el('tr', {},
      td(a.name), td(a.email), td(`${a.degree}, ${a.graduation_year}`),
      td([a.designation, a.company].filter(Boolean).join(' at ')),
      td(badge(a.is_approved ? 'approved' : 'pending')),
      td(a.is_approved ? btn('Revoke', 'btn-danger', () => approve(a, false)) : btn('Approve', 'btn-success', () => approve(a, true)))
    ));
  } catch (err) { showToast(err.message, 'error'); }
}
$('#a-status').addEventListener('change', loadAlumni);

// ---------- news ----------
$('#newsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const body = { title: f.elements.title.value.trim(), body: f.elements.body.value.trim() };
  if (await act(() => api('/api/admin/news', { method: 'POST', body }))) { f.reset(); loadNews(); }
});

async function loadNews() {
  try {
    const d = await api('/api/news');
    $('#newsList').replaceChildren(...(d.news.length
      ? d.news.map((n) => el('div', { class: 'list-item' },
          el('div', {}, el('h3', { text: n.title }), el('p', { class: 'event-meta', text: `${fmtDate(n.created_at)} | ${n.comment_count} comment(s)` })),
          btn('Delete', 'btn-danger', async () => {
            if (confirm('Delete this article and its comments?') && await act(() => api('/api/admin/news/' + n.news_id, { method: 'DELETE' }))) loadNews();
          })))
      : [el('p', { class: 'muted', text: 'No news published yet.' })]));
  } catch (err) { showToast(err.message, 'error'); }
}

// ---------- start ----------
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
if (start(['admin'])) showTab('overview');
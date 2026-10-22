const { $, el, api, qs, fmtDate, pager, showToast, session, start } = App;
let page = 1;

async function remove(id) {
  if (!confirm('Delete this job post?')) return;
  try {
    const d = await api('/api/jobs/' + id, { method: 'DELETE' });
    showToast(d.message);
  } catch (err) { showToast(err.message, 'error'); }
  load();
}

function jobCard(j, me) {
  const canDelete = session.role === 'admin' || j.poster_user_id === me;   // the server checks this again
  return el('article', { class: 'card' },
    el('h3', { text: j.title }),
    el('p', { class: 'event-meta', text: `${j.company} | ${j.location}` }),
    el('p', { class: 'event-meta', text: `Posted by ${j.posted_by} on ${fmtDate(j.posted_at)} | Apply before ${fmtDate(j.deadline)}` }),
    el('p', { class: 'pre', text: j.description }),
    canDelete ? el('button', { class: 'btn btn-danger btn-small', type: 'button', text: 'Delete', onclick: () => remove(j.job_id) }) : null
  );
}

async function load() {
  const box = $('#jobs');
  try {
    const d = await api('/api/jobs' + qs({ page, q: $('#q').value.trim() }));
    box.replaceChildren(...(d.jobs.length ? d.jobs.map((j) => jobCard(j, d.me)) : [el('p', { class: 'muted', text: 'No open job posts.' })]));
    pager($('#pager'), d.page, d.totalPages, (p) => { page = p; load(); });
  } catch (err) { box.replaceChildren(el('p', { class: 'error-msg', text: err.message })); }
}

if (start(['student', 'alumni', 'admin'])) {
  const form = $('#jobForm');
  $('#postCard').hidden = session.role !== 'alumni';      // only alumni can post
  form.elements.deadline.min = new Date().toISOString().slice(0, 10);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    for (const k of ['title', 'company', 'location', 'description', 'deadline']) body[k] = form.elements[k].value.trim();
    try {
      const d = await api('/api/jobs', { method: 'POST', body });
      showToast(d.message);
      form.reset();
      page = 1;
      load();
    } catch (err) { showToast(err.message, 'error'); }
  });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); page = 1; load(); });
  load();
}
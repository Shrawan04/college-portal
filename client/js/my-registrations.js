const { $, el, api, fmtDate, badge, showToast, start } = App;

async function cancel(r) {
  if (!confirm(`Cancel your registration for ${r.title}?`)) return;
  try {
    const d = await api('/api/registrations/' + r.reg_id, { method: 'DELETE' });
    showToast(d.message);
  } catch (err) { showToast(err.message, 'error'); }
  load();
}

function row(r) {
  return el('div', { class: 'list-item' },
    el('div', {},
      el('h3', {}, el('a', { href: 'event-detail.html?id=' + r.event_id, text: r.title })),
      el('p', { class: 'event-meta', text: `${fmtDate(r.event_date)} | ${r.venue}` }),
      el('p', { class: 'event-meta', text: 'Registered on ' + fmtDate(r.registered_at) })
    ),
    el('div', { class: 'actions' },
      badge(r.status),
      r.status === 'cancelled' ? null
        : el('button', { class: 'btn btn-danger btn-small', type: 'button', text: 'Cancel', onclick: () => cancel(r) })
    )
  );
}

async function load() {
  const box = $('#list');
  try {
    const { registrations } = await api('/api/my-registrations');
    if (!registrations.length) {
      box.replaceChildren(el('p', { class: 'muted' }, 'You have not registered for any event yet. ',
        el('a', { href: 'student-dashboard.html', text: 'Browse events' })));
      return;
    }
    box.replaceChildren(...registrations.map(row));
  } catch (err) {
    box.replaceChildren(el('p', { class: 'error-msg', text: err.message }));
  }
}

if (start(['student'])) load();
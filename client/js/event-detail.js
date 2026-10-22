const { $, el, api, fmtDate, assetUrl, badge, showToast, start } = App;
let timer = null;

const parseDate = (s) => new Date(String(s).replace(' ', 'T'));

// live countdown to the event start
function countdown(box, when) {
  const unit = (n, label) => el('div', {}, el('strong', { text: String(n).padStart(2, '0') }), label);
  function tick() {
    const ms = parseDate(when) - Date.now();
    if (ms <= 0) {
      box.replaceChildren(el('p', { class: 'muted', text: 'This event has started.' }));
      clearInterval(timer);
      return;
    }
    const s = Math.floor(ms / 1000);
    box.replaceChildren(
      unit(Math.floor(s / 86400), 'days'),
      unit(Math.floor((s % 86400) / 3600), 'hours'),
      unit(Math.floor((s % 3600) / 60), 'min'),
      unit(s % 60, 'sec')
    );
  }
  clearInterval(timer);
  tick();
  timer = setInterval(tick, 1000);
}

async function register(id, btn) {
  btn.disabled = true;                       // prevents double clicks
  try {
    const d = await api(`/api/events/${id}/register`, { method: 'POST' });
    showToast(d.message, d.status === 'confirmed' ? 'success' : 'warning');
  } catch (err) { showToast(err.message, 'error'); }
  load(id);
}

async function cancel(id, regId) {
  if (!confirm('Cancel this registration?')) return;
  try {
    const d = await api('/api/registrations/' + regId, { method: 'DELETE' });
    showToast(d.message);
  } catch (err) { showToast(err.message, 'error'); }
  load(id);
}

async function load(id) {
  const box = $('#eventBox');
  try {
    const { event: e } = await api('/api/events/' + id);
    document.title = e.title + ' | College Portal';
    const mine = e.my_registration && e.my_registration.status !== 'cancelled' ? e.my_registration : null;
    const closed = parseDate(e.event_date) <= new Date() || Boolean(e.registration_closed);
    const full = e.seats_left === 0;

    const action = el('div', { class: 'actions' });
    if (mine) {
      action.append(badge(mine.status),
        el('button', { class: 'btn btn-danger', type: 'button', text: 'Cancel registration', onclick: () => cancel(id, mine.reg_id) }));
    } else if (closed) {
      action.append(el('button', { class: 'btn', type: 'button', disabled: true, text: 'Registration closed' }));
    } else {
      action.append(el('button', {
        class: 'btn btn-primary', type: 'button', text: full ? 'Join waitlist' : 'Register now',
        onclick: (ev) => register(id, ev.currentTarget)
      }));
    }

    const cd = el('div', { class: 'countdown' });
    box.className = '';
    box.replaceChildren(el('div', { class: 'detail' },
      el('div', { class: 'card' },
        e.banner_url ? el('img', { class: 'detail-banner', src: assetUrl(e.banner_url), alt: '' }) : null,
        el('span', { class: 'chip', text: e.category }),
        el('h1', { text: e.title }),
        el('p', { class: 'muted', text: 'Organised by ' + e.organizer_name }),
        el('p', { class: 'pre', text: e.description })
      ),
      el('aside', { class: 'card' },
        el('h3', { text: 'Event details' }),
        el('p', { text: 'Date: ' + fmtDate(e.event_date) }),
        el('p', { text: 'Venue: ' + e.venue }),
        el('p', { text: 'Register before: ' + fmtDate(e.registration_deadline) }),
        el('p', { class: full ? 'low' : '', text: full ? `Event full (${e.waitlist_count} on the waitlist)` : `${e.seats_left} of ${e.capacity} seats left` }),
        cd,
        action
      )
    ));
    countdown(cd, e.event_date);
  } catch (err) {
    box.className = 'error-msg';
    box.textContent = err.message;
  }
}

if (start(['student'])) {
  const id = new URLSearchParams(location.search).get('id');
  if (/^\d+$/.test(id || '')) load(id);
  else $('#eventBox').textContent = 'Invalid event link.';
}
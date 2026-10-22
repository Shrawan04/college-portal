const { $, el, api, qs, fmtDate, assetUrl, pager, start } = App;
let page = 1;

function card(e) {
  const full = e.seats_left === 0;
  const low = !full && e.seats_left <= 5;
  return el('article', { class: 'event-card' },
    e.banner_url
      ? el('img', { src: assetUrl(e.banner_url), alt: '', loading: 'lazy' })
      : el('div', { class: 'banner-placeholder', text: e.category }),
    el('div', { class: 'event-card-body' },
      el('span', { class: 'chip', text: e.category }),
      el('h3', { text: e.title }),
      el('p', { class: 'event-meta', text: fmtDate(e.event_date) }),
      el('p', { class: 'event-meta', text: e.venue }),
      el('p', {
        class: 'event-meta' + (full || low ? ' low' : ''),
        text: full ? 'Event full: waitlist open' : `${e.seats_left} of ${e.capacity} seats left`
      }),
      el('a', {
        class: 'btn btn-primary',
        href: 'event-detail.html?id=' + encodeURIComponent(e.event_id),
        text: full ? 'Join waitlist' : 'View and register'
      })
    )
  );
}

async function load() {
  const grid = $('#events');
  grid.replaceChildren(el('p', { class: 'muted', text: 'Loading events...' }));
  try {
    const d = await api('/api/events' + qs({ page, category: $('#category').value, sort: $('#sort').value }));
    grid.replaceChildren(...(d.events.length ? d.events.map(card) : [el('p', { class: 'muted', text: 'No upcoming events found.' })]));
    pager($('#pager'), d.page, d.totalPages, (p) => { page = p; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  } catch (err) {
    grid.replaceChildren(el('p', { class: 'error-msg', text: err.message }));
  }
}

async function init() {
  try {
    const d = await api('/api/events/categories');
    d.categories.forEach((c) => $('#category').append(el('option', { value: c, text: c })));
  } catch { /* the filter is optional */ }
  for (const id of ['category', 'sort']) {
    $('#' + id).addEventListener('change', () => { page = 1; load(); });
  }
  load();
}

if (start(['student'])) init();
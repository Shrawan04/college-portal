const { $, el, api, qs, fmtDate, assetUrl, safeUrl, initials, badge, pager, showToast, session, start } = App;
let dirPage = 1;

// ---------- tabs ----------
const loaders = { directory: loadDirectory, profile: loadProfile, network: loadNetwork, news: () => loadNews(1) };
function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll("section[id^='tab-']").forEach((s) => { s.hidden = s.id !== 'tab-' + name; });
  loaders[name]();
}

// ---------- directory ----------
function alumniCard(a) {
  const link = safeUrl(a.linkedin_url);
  return el('article', { class: 'alumni-card' },
    el('div', { class: 'person' },
      a.profile_pic_url
        ? el('img', { class: 'avatar', src: assetUrl(a.profile_pic_url), alt: '' })
        : el('div', { class: 'avatar', text: initials(a.name) }),
      el('div', {}, el('h3', { text: a.name }), el('p', { class: 'event-meta', text: `Batch ${a.graduation_year} | ${a.degree}` }))
    ),
    a.designation || a.company ? el('p', { text: [a.designation, a.company].filter(Boolean).join(' at ') }) : null,
    a.bio ? el('p', { class: 'event-meta pre', text: a.bio.length > 160 ? a.bio.slice(0, 160) + '...' : a.bio }) : null,
    el('div', { class: 'actions' },
      link ? el('a', { class: 'btn btn-small', href: link, target: '_blank', rel: 'noopener noreferrer', text: 'LinkedIn' }) : null,
      el('button', { class: 'btn btn-primary btn-small', type: 'button', text: 'Connect', onclick: (ev) => connect(a.user_id, ev.currentTarget) })
    )
  );
}

async function connect(userId, btn) {
  btn.disabled = true;
  try {
    const d = await api('/api/alumni/connect/' + userId, { method: 'POST' });
    showToast(d.message);
    btn.textContent = 'Request sent';
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
  }
}

async function loadDirectory() {
  const box = $('#dirResults');
  box.replaceChildren(el('p', { class: 'muted', text: 'Loading...' }));
  try {
    const d = await api('/api/alumni' + qs({
      page: dirPage, q: $('#d-q').value.trim(), year: $('#d-year').value,
      degree: $('#d-degree').value.trim(), company: $('#d-company').value.trim()
    }));
    box.replaceChildren(...(d.alumni.length ? d.alumni.map(alumniCard) : [el('p', { class: 'muted', text: 'No alumni match your search.' })]));
    pager($('#dirPager'), d.page, d.totalPages, (p) => { dirPage = p; loadDirectory(); });
  } catch (err) {
    box.replaceChildren(el('p', { class: 'error-msg', text: err.message }));
  }
}

// ---------- profile ----------
const PROFILE_FIELDS = ['graduation_year', 'degree', 'company', 'designation', 'linkedin_url', 'bio'];

function showAvatar(url) {
  $('#avatarBox').replaceChildren(url
    ? el('img', { class: 'avatar', src: assetUrl(url) + '?t=' + Date.now(), alt: 'Profile picture' })
    : el('div', { class: 'avatar', text: initials(session.name) }));
}

async function loadProfile() {
  try {
    const { profile: p } = await api('/api/alumni/me');
    const f = $('#profileForm');
    PROFILE_FIELDS.forEach((k) => { f.elements[k].value = p[k] ?? ''; });
    showAvatar(p.profile_pic_url);
    $('#approvalNote').hidden = Boolean(p.is_approved);
  } catch (err) { showToast(err.message, 'error'); }
}

$('#profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {};
  PROFILE_FIELDS.forEach((k) => { body[k] = e.currentTarget.elements[k].value.trim(); });
  try {
    const d = await api('/api/alumni/me', { method: 'PUT', body });
    showToast(d.message);
  } catch (err) { showToast(err.message, 'error'); }
});

$('#pic').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return showToast('Choose a JPG, PNG or WEBP image', 'error');
  if (file.size > 2 * 1024 * 1024) return showToast('Image must be smaller than 2 MB', 'error');
  const fd = new FormData();
  fd.append('profilePic', file);                       // field name must match upload.single('profilePic')
  try {
    const d = await api('/api/alumni/me/picture', { method: 'PUT', body: fd });
    showAvatar(d.profile_pic_url);
    showToast('Picture updated');
  } catch (err) { showToast(err.message, 'error'); }
});

// ---------- network ----------
function fill(sel, items, emptyText, actions) {
  $(sel).replaceChildren(...(items.length
    ? items.map((c) => el('div', { class: 'list-item' },
        el('div', {},
          el('h3', { text: c.other_name }),
          el('p', { class: 'event-meta', text: [c.designation, c.company, c.graduation_year && 'Batch ' + c.graduation_year].filter(Boolean).join(' | ') })),
        el('div', { class: 'actions' }, ...actions(c))))
    : [el('p', { class: 'muted', text: emptyText })]));
}

async function respond(id, status) {
  try {
    const d = await api('/api/alumni/connections/' + id, { method: 'PUT', body: { status } });
    showToast(d.message);
  } catch (err) { showToast(err.message, 'error'); }
  loadNetwork();
}

async function loadNetwork() {
  try {
    const d = await api('/api/alumni/connections');
    fill('#incoming', d.incoming, 'No pending requests.', (c) => [
      el('button', { class: 'btn btn-success btn-small', type: 'button', text: 'Accept', onclick: () => respond(c.conn_id, 'accepted') }),
      el('button', { class: 'btn btn-danger btn-small', type: 'button', text: 'Reject', onclick: () => respond(c.conn_id, 'rejected') })
    ]);
    fill('#outgoing', d.outgoing, 'No requests sent.', () => [badge('pending')]);
    fill('#network', d.network, 'Your network is empty. Connect with alumni from the directory.', () => []);
  } catch (err) { showToast(err.message, 'error'); }
}

// ---------- news and comments ----------
async function loadComments(newsId, box, page) {
  try {
    const d = await api(`/api/news/${newsId}/comments` + qs({ page }));
    const list = el('div', { class: 'list' }, ...(d.comments.length
      ? d.comments.map((c) => el('div', { class: 'list-item' },
          el('div', {}, el('strong', { text: c.author }), el('p', { class: 'pre', text: c.body }), el('span', { class: 'event-meta', text: fmtDate(c.created_at) }))))
      : [el('p', { class: 'muted', text: 'No comments yet.' })]));
    const pg = el('div', { class: 'pager' });
    pager(pg, d.page, d.totalPages, (p) => loadComments(newsId, box, p));
    const form = el('form', {
      class: 'form-group',
      onsubmit: async (e) => {
        e.preventDefault();
        const ta = e.currentTarget.elements.body;
        try {
          await api(`/api/news/${newsId}/comments`, { method: 'POST', body: { body: ta.value.trim() } });
          ta.value = '';
          loadComments(newsId, box, 1);
        } catch (err) { showToast(err.message, 'error'); }
      }
    },
      el('textarea', { name: 'body', maxlength: '1000', required: true, placeholder: 'Write a comment...', 'aria-label': 'Comment' }),
      el('button', { class: 'btn btn-primary btn-small', type: 'submit', text: 'Post comment' })
    );
    box.replaceChildren(list, pg, form);
  } catch (err) { box.replaceChildren(el('p', { class: 'error-msg', text: err.message })); }
}

function newsItem(n) {
  const comments = el('div', { hidden: true });
  const toggle = el('button', {
    class: 'btn btn-small', type: 'button', text: `Comments (${n.comment_count})`,
    onclick: () => { comments.hidden = !comments.hidden; if (!comments.hidden) loadComments(n.news_id, comments, 1); }
  });
  return el('article', { class: 'card' },
    el('h3', { text: n.title }),
    el('p', { class: 'event-meta', text: `${n.author} | ${fmtDate(n.created_at)}` }),
    el('p', { class: 'pre', text: n.body }),
    toggle, comments);
}

async function loadNews(page) {
  const box = $('#newsList');
  try {
    const d = await api('/api/news' + qs({ page }));
    box.replaceChildren(...(d.news.length ? d.news.map(newsItem) : [el('p', { class: 'muted', text: 'No news yet.' })]));
    pager($('#newsPager'), d.page, d.totalPages, loadNews);
  } catch (err) { box.replaceChildren(el('p', { class: 'error-msg', text: err.message })); }
}

// ---------- start ----------
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#dirForm').addEventListener('submit', (e) => { e.preventDefault(); dirPage = 1; loadDirectory(); });
if (start(['alumni'])) showTab('directory');
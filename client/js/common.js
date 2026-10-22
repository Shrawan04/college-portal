(function () {
  const API = window.API_BASE || '';
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- safe DOM builder: text is always inserted as text, never as HTML ----------
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function showToast(msg, type = 'success', ms = 3500) {
    const t = el('div', { class: 'toast ' + type, role: 'status', text: msg });
    document.body.append(t);
    setTimeout(() => t.remove(), ms);
  }

  // ---------- session (access token lives in localStorage; refresh token is an httpOnly cookie) ----------
  const session = {
    get token() { return localStorage.getItem('token'); },
    get role() { return localStorage.getItem('role'); },
    get name() { return localStorage.getItem('name'); },
    set(d) {
      localStorage.setItem('token', d.accessToken);
      localStorage.setItem('role', d.role);
      localStorage.setItem('name', d.name);
    },
    clear() { ['token', 'role', 'name'].forEach((k) => localStorage.removeItem(k)); }
  };
  const HOME = { student: 'student-dashboard.html', alumni: 'alumni-dashboard.html', admin: 'admin-dashboard.html' };

  // ---------- fetch with automatic token refresh ----------
  async function raw(path, opts) {
    const headers = { ...(opts.headers || {}) };
    let body = opts.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    if (opts.auth !== false && session.token) headers.Authorization = 'Bearer ' + session.token;
    return fetch(API + path, { method: opts.method || 'GET', headers, body, credentials: 'include' });
  }

  let refreshing = null;               // one refresh at a time, even if several calls fail together
  function refresh() {
    if (!refreshing) {
      refreshing = fetch(API + '/api/auth/refresh', { method: 'POST', credentials: 'include' })
        .then(async (r) => {
          if (!r.ok) throw new Error('refresh failed');
          session.set(await r.json());
        })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function request(path, opts = {}) {
    let res = await raw(path, opts);
    if (res.status === 401 && opts.auth !== false) {
      try {
        await refresh();
        res = await raw(path, opts);        // retry once with the new access token
      } catch {
        session.clear();
        showToast('Session expired. Please log in again.', 'warning');
        setTimeout(() => { location.href = 'login.html'; }, 1200);
        throw new Error('Session expired');
      }
    }
    if (res.status === 429) showToast('Too many requests. Please wait a few minutes.', 'error');
    if (res.status === 403 && opts.auth !== false) showToast('Access denied.', 'error');
    return res;
  }

  async function api(path, opts = {}) {
    const res = await request(path, opts);
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const e = new Error(data.message || 'Request failed');   // never show raw stack traces
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  // ---------- small utilities ----------
  const fmtDate = (s) => {
    if (!s) return '';
    const str = String(s).replace(' ', 'T');
    const d = new Date(str.length === 10 ? str + 'T00:00' : str);
    return isNaN(d) ? String(s) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: str.length === 10 ? undefined : 'short' });
  };
  const assetUrl = (p) => (p ? API + p : '');
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);   // blocks javascript: links
  const initials = (name) => String(name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const badge = (status) => el('span', { class: 'badge badge-' + status, text: status });
  const qs = (o) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== '' && v !== null && v !== undefined) p.set(k, v);
    const s = p.toString();
    return s ? '?' + s : '';
  };
  function pager(box, page, totalPages, go) {
    box.replaceChildren();
    if (totalPages <= 1) return;
    box.append(
      el('button', { class: 'btn btn-small', type: 'button', text: 'Previous', disabled: page <= 1, onclick: () => go(page - 1) }),
      el('span', { text: `Page ${page} of ${totalPages}` }),
      el('button', { class: 'btn btn-small', type: 'button', text: 'Next', disabled: page >= totalPages, onclick: () => go(page + 1) })
    );
  }

  // ---------- page guard and navigation ----------
  // This only improves the user experience. The real access control is on the server.
  function guard(roles) {
    if (!session.token || !session.role) { location.replace('login.html'); return false; }
    if (!roles.includes(session.role)) { location.replace(HOME[session.role] || 'login.html'); return false; }
    return true;
  }
  const NAV = {
    student: [['student-dashboard.html', 'Events'], ['my-registrations.html', 'My Registrations'], ['jobs.html', 'Jobs']],
    alumni: [['alumni-dashboard.html', 'Alumni Portal'], ['jobs.html', 'Jobs']],
    admin: [['admin-dashboard.html', 'Admin Panel'], ['jobs.html', 'Jobs']]
  };
  async function logout() {
    try { await fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch { /* offline */ }
    session.clear();
    location.href = 'login.html';
  }
  function renderNav() {
    const header = $('#site-header');
    if (!header) return;
    const links = el('nav', { class: 'nav-links', id: 'nav-links' });
    for (const [href, label] of NAV[session.role] || []) {
      links.append(el('a', { href, text: label, class: location.pathname.endsWith(href) ? 'active' : '' }));
    }
    links.append(el('span', { class: 'nav-user', text: session.name }), el('button', { type: 'button', text: 'Logout', onclick: logout }));
    const burger = el('button', {
      class: 'burger', type: 'button', 'aria-label': 'Menu', 'aria-expanded': 'false', text: '☰',
      onclick: () => burger.setAttribute('aria-expanded', String(links.classList.toggle('nav-open')))
    });
    header.className = 'site-header';
    header.append(el('div', { class: 'nav-bar' }, el('a', { class: 'brand', href: HOME[session.role] }, 'College Portal'), burger, links));
  }
  function start(roles) {
    if (!guard(roles)) return false;
    renderNav();
    return true;
  }

  window.App = { $, el, api, request, session, HOME, showToast, fmtDate, assetUrl, safeUrl, initials, badge, qs, pager, start, logout };
})();
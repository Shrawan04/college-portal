const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { Parser } = require('json2csv');
const { body, param, query, validationResult } = require('express-validator');
const db = require('../config/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { imageUpload, checkImageSignature } = require('../middleware/upload');
const { sendEmail, esc } = require('../utils/mailer');

const upload = imageUpload('banners');
const like = (s) => `%${String(s).replace(/[\\%_]/g, '\\$&')}%`; // escape LIKE wildcards
const idRule = param('id').isInt({ min: 1 }).withMessage('Invalid id');
const pageRule = query('page').optional().isInt({ min: 1, max: 10000 });
const httpError = (status, message) => Object.assign(new Error(message), { status });

// every route below is admin only
router.use(auth(['admin']));

// ---------- helpers ----------
const toSql = (v) => {            // '2026-11-20T10:00' -> '2026-11-20 10:00:00'
  let s = String(v).replace('T', ' ');
  if (s.length === 16) s += ':00';
  return s.slice(0, 19);
};
const removeFile = (urlOrName, sub) => {
  if (urlOrName) fs.unlink(path.join(__dirname, '..', 'uploads', sub, path.basename(urlOrName)), () => {});
};
function validateAndClean(req, res, next) {      // delete the uploaded banner if the form is invalid
  if (req.file && !validationResult(req).isEmpty()) removeFile(req.file.filename, 'banners');
  validate(req, res, next);
}
const csvSafe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const eventRules = [
  body('title').trim().isLength({ min: 3, max: 200 }).withMessage('Title must be 3-200 characters'),
  body('description').trim().isLength({ min: 10, max: 5000 }).withMessage('Description must be 10-5000 characters'),
  body('event_date').isISO8601().withMessage('Enter a valid event date'),
  body('venue').trim().isLength({ min: 2, max: 200 }).withMessage('Venue must be 2-200 characters'),
  body('capacity').isInt({ min: 1, max: 100000 }).withMessage('Capacity must be 1-100000'),
  body('category').trim().isLength({ min: 2, max: 60 }).withMessage('Category must be 2-60 characters'),
  body('registration_deadline').isISO8601().withMessage('Enter a valid registration deadline')
    .custom((v, { req }) => new Date(v) <= new Date(req.body.event_date))
    .withMessage('Deadline must be on or before the event date')
];

// ---------- Dashboard statistics ----------
router.get('/stats', async (req, res, next) => {
  try {
    const one = async (sql) => (await db.query(sql))[0][0].total;
    const [users, events, registrations, activeAlumni, pendingAlumni] = await Promise.all([
      one('SELECT COUNT(*) AS total FROM users'),
      one('SELECT COUNT(*) AS total FROM events'),
      one("SELECT COUNT(*) AS total FROM event_registrations WHERE status='confirmed'"),
      one('SELECT COUNT(*) AS total FROM alumni_profiles a JOIN users u ON u.user_id=a.user_id WHERE a.is_approved=1 AND u.is_active=1'),
      one('SELECT COUNT(*) AS total FROM alumni_profiles WHERE is_approved=0')
    ]);
    res.json({ success: true, stats: { users, events, registrations, activeAlumni, pendingAlumni } });
  } catch (err) { next(err); }
});

// ---------- Events: list ----------
router.get('/events', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id=e.event_id AND r.status='confirmed')  AS confirmed_count,
              (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id=e.event_id AND r.status='waitlisted') AS waitlist_count
       FROM events e ORDER BY e.event_date DESC`
    );
    res.json({ success: true, events: rows });
  } catch (err) { next(err); }
});

// ---------- Events: create ----------
router.post('/events', upload.single('banner'), checkImageSignature, eventRules, validateAndClean, async (req, res, next) => {
  try {
    const { title, description, event_date, venue, capacity, category, registration_deadline } = req.body;
    const banner = req.file ? `/uploads/banners/${req.file.filename}` : null;
    const [r] = await db.query(
      `INSERT INTO events (title,description,event_date,venue,capacity,organizer_id,category,registration_deadline,banner_url)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [title, description, toSql(event_date), venue, capacity, req.user.id, category, toSql(registration_deadline), banner]
    );
    res.status(201).json({ success: true, message: 'Event created', event_id: r.insertId });
  } catch (err) {
    if (req.file) removeFile(req.file.filename, 'banners');
    next(err);
  }
});

// ---------- Events: update (promotes the waitlist if capacity grows) ----------
router.put('/events/:id', upload.single('banner'), checkImageSignature, [idRule, ...eventRules], validateAndClean, async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  let conn;
  try {
    const { title, description, event_date, venue, capacity, category, registration_deadline } = req.body;
    const cap = parseInt(capacity, 10);
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [evs] = await conn.query('SELECT * FROM events WHERE event_id=? FOR UPDATE', [id]);
    const ev = evs[0];
    if (!ev) throw httpError(404, 'Event not found');

    const [[{ taken }]] = await conn.query(
      "SELECT COUNT(*) AS taken FROM event_registrations WHERE event_id=? AND status='confirmed'", [id]
    );
    if (cap < taken) throw httpError(400, `Capacity cannot be lower than the ${taken} confirmed registrations`);

    const banner = req.file ? `/uploads/banners/${req.file.filename}` : ev.banner_url;
    await conn.query(
      `UPDATE events SET title=?, description=?, event_date=?, venue=?, capacity=?, category=?,
              registration_deadline=?, banner_url=? WHERE event_id=?`,
      [title, description, toSql(event_date), venue, cap, category, toSql(registration_deadline), banner, id]
    );

    let promoted = [];
    if (cap > taken) {                      // new free seats: promote waitlisted students in order
      const [wl] = await conn.query(
        `SELECT r.reg_id, u.name, u.email FROM event_registrations r JOIN users u ON u.user_id = r.user_id
         WHERE r.event_id=? AND r.status='waitlisted' ORDER BY r.registered_at ASC, r.reg_id ASC LIMIT ?`,
        [id, cap - taken]
      );
      if (wl.length) {
        await conn.query("UPDATE event_registrations SET status='confirmed' WHERE reg_id IN (?)", [wl.map((w) => w.reg_id)]);
        promoted = wl;
      }
    }
    await conn.commit();

    if (req.file) removeFile(ev.banner_url, 'banners');   // old banner replaced
    promoted.forEach((p) =>
      sendEmail(p.email, `You are in: ${title}`,
        `<p>Hello ${esc(p.name)}, a seat opened up and your registration for <b>${esc(title)}</b> is now confirmed.</p>`
      ).catch((e) => console.error('Mail error:', e.message))
    );
    res.json({ success: true, message: 'Event updated', promoted: promoted.length });
  } catch (err) {
    if (conn) await conn.rollback();
    if (req.file) removeFile(req.file.filename, 'banners');
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

// ---------- Events: delete ----------
router.delete('/events/:id', [idRule], validate, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT banner_url FROM events WHERE event_id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Event not found' });
    await db.query('DELETE FROM events WHERE event_id=?', [req.params.id]);
    removeFile(rows[0].banner_url, 'banners');
    res.json({ success: true, message: 'Event deleted' });
  } catch (err) { next(err); }
});

// ---------- Registrations for one event ----------
router.get('/events/:id/registrations', [idRule], validate, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT r.reg_id, r.status, r.registered_at, u.name, u.email, u.college_id
       FROM event_registrations r JOIN users u ON u.user_id = r.user_id
       WHERE r.event_id=? ORDER BY FIELD(r.status,'confirmed','waitlisted','cancelled'), r.registered_at`,
      [req.params.id]
    );
    res.json({ success: true, registrations: rows });
  } catch (err) { next(err); }
});

// ---------- CSV export ----------
router.get('/events/:id/export', [idRule], validate, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT u.name, u.email, u.college_id, er.status, er.registered_at
       FROM event_registrations er JOIN users u ON er.user_id = u.user_id
       WHERE er.event_id=? ORDER BY er.registered_at`,
      [req.params.id]
    );
    const safe = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, csvSafe(v)])));
    const parser = new Parser({ fields: ['name', 'email', 'college_id', 'status', 'registered_at'] });
    res.header('Content-Type', 'text/csv');
    res.attachment(`event-${req.params.id}-registrations.csv`);
    res.send(parser.parse(safe));
  } catch (err) { next(err); }
});

// ---------- Bulk email ----------
const notifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many bulk emails. Try again later.', code: 429 }
});
router.post(
  '/events/:id/notify',
  notifyLimiter,
  [
    idRule,
    body('subject').trim().isLength({ min: 3, max: 150 }).withMessage('Subject must be 3-150 characters')
      .matches(/^[^\r\n]+$/).withMessage('Subject must be a single line'),
    body('message').trim().isLength({ min: 5, max: 2000 }).withMessage('Message must be 5-2000 characters')
  ],
  validate,
  async (req, res, next) => {
    try {
      const [ev] = await db.query('SELECT title FROM events WHERE event_id=?', [req.params.id]);
      if (!ev[0]) return res.status(404).json({ success: false, message: 'Event not found' });
      const [people] = await db.query(
        `SELECT u.name, u.email FROM event_registrations r JOIN users u ON u.user_id = r.user_id
         WHERE r.event_id=? AND r.status IN ('confirmed','waitlisted')`,
        [req.params.id]
      );
      const html = (name) =>
        `<p>Hello ${esc(name)},</p><p>${esc(req.body.message).replace(/\n/g, '<br>')}</p><p><i>Event: ${esc(ev[0].title)}</i></p>`;
      let sent = 0, failed = 0;
      for (const p of people) {           // one at a time so the SMTP server is not flooded
        try { await sendEmail(p.email, req.body.subject, html(p.name)); sent++; }
        catch (e) { failed++; console.error('Bulk mail error:', e.message); }
      }
      res.json({ success: true, message: `Sent ${sent} email(s), ${failed} failed`, sent, failed, total: people.length });
    } catch (err) { next(err); }
  }
);

// ---------- Users ----------
router.get(
  '/users',
  [pageRule, query('q').optional().trim().isLength({ max: 100 }), query('role').optional().isIn(['student', 'alumni', 'admin'])],
  validate,
  async (req, res, next) => {
    try {
      const page = parseInt(req.query.page || '1', 10);
      const limit = 15;
      let where = 'WHERE 1=1';
      const params = [];
      if (req.query.q)    { where += ' AND (name LIKE ? OR email LIKE ?)'; params.push(like(req.query.q), like(req.query.q)); }
      if (req.query.role) { where += ' AND role=?'; params.push(req.query.role); }
      const [rows] = await db.query(
        `SELECT user_id, name, email, role, college_id, is_verified, is_active, created_at
         FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
      );
      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM users ${where}`, params);
      res.json({ success: true, page, totalPages: Math.max(1, Math.ceil(total / limit)), users: rows });
    } catch (err) { next(err); }
  }
);

router.put('/users/:id/status', [idRule, body('is_active').isBoolean().toBoolean()], validate, async (req, res, next) => {
  try {
    if (parseInt(req.params.id, 10) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot change your own status' });
    }
    const active = req.body.is_active ? 1 : 0;
    // suspending also deletes the refresh token, so the user cannot renew the session
    const [r] = await db.query(
      'UPDATE users SET is_active=?, refresh_token_hash=IF(?=1, refresh_token_hash, NULL) WHERE user_id=?',
      [active, active, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: active ? 'Account activated' : 'Account suspended' });
  } catch (err) { next(err); }
});

router.put('/users/:id/role', [idRule, body('role').isIn(['student', 'admin']).withMessage('Role must be student or admin')], validate, async (req, res, next) => {
  try {
    if (parseInt(req.params.id, 10) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot change your own role' });
    }
    const [r] = await db.query('UPDATE users SET role=?, refresh_token_hash=NULL WHERE user_id=?', [req.body.role, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'Role updated (applies fully when the user logs in again)' });
  } catch (err) { next(err); }
});

// ---------- Alumni approval ----------
router.get('/alumni', [query('status').optional().isIn(['pending', 'approved', 'all'])], validate, async (req, res, next) => {
  try {
    const filter = { pending: 'WHERE a.is_approved=0', approved: 'WHERE a.is_approved=1', all: '' }[req.query.status || 'pending'];
    const [rows] = await db.query(
      `SELECT a.alumni_id, u.name, u.email, u.college_id, u.is_active, a.graduation_year, a.degree,
              a.company, a.designation, a.is_approved
       FROM alumni_profiles a JOIN users u ON u.user_id = a.user_id ${filter}
       ORDER BY a.alumni_id DESC LIMIT 100`
    );
    res.json({ success: true, alumni: rows });
  } catch (err) { next(err); }
});

router.put('/alumni/:id/approval', [idRule, body('approved').isBoolean().toBoolean()], validate, async (req, res, next) => {
  try {
    const approved = req.body.approved ? 1 : 0;
    const [r] = await db.query('UPDATE alumni_profiles SET is_approved=? WHERE alumni_id=?', [approved, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Alumni profile not found' });
    if (approved) {
      const [u] = await db.query(
        'SELECT u.name, u.email FROM alumni_profiles a JOIN users u ON u.user_id=a.user_id WHERE a.alumni_id=?', [req.params.id]
      );
      if (u[0]) {
        sendEmail(u[0].email, 'Your alumni profile is approved',
          `<p>Hello ${esc(u[0].name)}, your alumni profile is now visible in the directory.</p>`
        ).catch((e) => console.error('Mail error:', e.message));
      }
    }
    res.json({ success: true, message: approved ? 'Alumni approved' : 'Approval revoked' });
  } catch (err) { next(err); }
});

// ---------- News ----------
router.post(
  '/news',
  [body('title').trim().isLength({ min: 3, max: 200 }).withMessage('Title must be 3-200 characters'),
   body('body').trim().isLength({ min: 10, max: 5000 }).withMessage('Article must be 10-5000 characters')],
  validate,
  async (req, res, next) => {
    try {
      await db.query('INSERT INTO news (admin_id,title,body) VALUES (?,?,?)', [req.user.id, req.body.title, req.body.body]);
      res.status(201).json({ success: true, message: 'News published' });
    } catch (err) { next(err); }
  }
);

router.delete('/news/:id', [idRule], validate, async (req, res, next) => {
  try {
    const [r] = await db.query('DELETE FROM news WHERE news_id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'News item not found' });
    res.json({ success: true, message: 'News deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
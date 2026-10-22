const router = require('express').Router();
const { query, param } = require('express-validator');
const db = require('../config/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendEmail, esc } = require('../utils/mailer');

const idRule = param('id').isInt({ min: 1 }).withMessage('Invalid id');

// GET /api/events?category=&sort=asc|desc&page=1
router.get(
  '/',
  auth(),
  [
    query('page').optional().isInt({ min: 1, max: 10000 }),
    query('category').optional().trim().isLength({ max: 60 }),
    query('sort').optional().isIn(['asc', 'desc'])
  ],
  validate,
  async (req, res, next) => {
    try {
      const page = parseInt(req.query.page || '1', 10);
      const limit = 10;
      const offset = (page - 1) * limit;
      const order = req.query.sort === 'desc' ? 'DESC' : 'ASC'; // whitelisted, safe to inline
      const params = [];
      let where = 'WHERE e.event_date >= NOW()';
      if (req.query.category) { where += ' AND e.category = ?'; params.push(req.query.category); }

      const [rows] = await db.query(
        `SELECT e.event_id, e.title, e.event_date, e.venue, e.capacity, e.category,
                e.banner_url, e.registration_deadline,
                (SELECT COUNT(*) FROM event_registrations r
                  WHERE r.event_id = e.event_id AND r.status = 'confirmed') AS confirmed_count
         FROM events e ${where}
         ORDER BY e.event_date ${order}
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM events e ${where}`, params);
      res.json({
        success: true,
        page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        total,
        events: rows.map((e) => ({ ...e, seats_left: Math.max(0, e.capacity - e.confirmed_count) }))
      });
    } catch (err) { next(err); }
  }
);

// GET /api/events/categories
router.get('/categories', auth(), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT DISTINCT category FROM events ORDER BY category');
    res.json({ success: true, categories: rows.map((r) => r.category) });
  } catch (err) { next(err); }
});

// GET /api/events/:id
router.get('/:id', auth(), [idRule], validate, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*, u.name AS organizer_name,
              (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id=e.event_id AND r.status='confirmed')  AS confirmed_count,
              (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id=e.event_id AND r.status='waitlisted') AS waitlist_count,
              (e.registration_deadline < NOW()) AS registration_closed
       FROM events e JOIN users u ON u.user_id = e.organizer_id
       WHERE e.event_id = ?`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Event not found' });
    const [mine] = await db.query(
      'SELECT reg_id, status FROM event_registrations WHERE user_id=? AND event_id=?',
      [req.user.id, req.params.id]
    );
    const e = rows[0];
    res.json({
      success: true,
      event: { ...e, seats_left: Math.max(0, e.capacity - e.confirmed_count), my_registration: mine[0] || null }
    });
  } catch (err) { next(err); }
});

// POST /api/events/:id/register
router.post('/:id/register', auth(['student']), [idRule], validate, async (req, res, next) => {
  const eventId = parseInt(req.params.id, 10);
  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // lock the event row so seat counting is race-free
    const [evRows] = await conn.query(
      'SELECT *, (registration_deadline < NOW()) AS closed, (event_date < NOW()) AS past FROM events WHERE event_id=? FOR UPDATE',
      [eventId]
    );
    const ev = evRows[0];
    if (!ev) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Event not found' }); }
    if (ev.closed || ev.past) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Registration for this event is closed' });
    }

    const [existing] = await conn.query(
      'SELECT reg_id, status FROM event_registrations WHERE user_id=? AND event_id=? FOR UPDATE',
      [req.user.id, eventId]
    );
    if (existing[0] && existing[0].status !== 'cancelled') {
      await conn.rollback();
      return res.status(409).json({ success: false, message: `You are already ${existing[0].status} for this event` });
    }

    const [[{ taken }]] = await conn.query(
      "SELECT COUNT(*) AS taken FROM event_registrations WHERE event_id=? AND status='confirmed'",
      [eventId]
    );
    const status = taken < ev.capacity ? 'confirmed' : 'waitlisted';

    let regId;
    if (existing[0]) {              // re-registering after a cancellation
      regId = existing[0].reg_id;
      await conn.query('UPDATE event_registrations SET status=?, registered_at=NOW() WHERE reg_id=?', [status, regId]);
    } else {
      const [r] = await conn.query(
        'INSERT INTO event_registrations (user_id, event_id, status) VALUES (?,?,?)',
        [req.user.id, eventId, status]
      );
      regId = r.insertId;
    }
    await conn.commit();

    // confirmation email (a mail failure must not undo the registration)
    const [[user]] = await db.query('SELECT name, email FROM users WHERE user_id=?', [req.user.id]);
    sendEmail(
      user.email,
      status === 'confirmed' ? `Registration confirmed: ${ev.title}` : `Waitlisted: ${ev.title}`,
      `<h2>${status === 'confirmed' ? 'You are registered!' : 'You are on the waitlist'}</h2>
       <p>Hello ${esc(user.name)},</p>
       <p><b>${esc(ev.title)}</b><br>Date: ${esc(ev.event_date)}<br>Venue: ${esc(ev.venue)}</p>
       ${status === 'waitlisted' ? '<p>You will be promoted automatically if a seat becomes free.</p>' : ''}`
    ).catch((e) => console.error('Mail error:', e.message));

    res.status(201).json({
      success: true,
      status,
      reg_id: regId,
      message: status === 'confirmed' ? 'Registration confirmed!' : 'Event is full. You have been added to the waitlist.'
    });
  } catch (err) {
    if (conn) await conn.rollback();
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
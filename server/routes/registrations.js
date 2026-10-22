const router = require('express').Router();
const { param } = require('express-validator');
const db = require('../config/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { sendEmail, esc } = require('../utils/mailer');

// GET /api/my-registrations
router.get('/my-registrations', auth(['student']), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT r.reg_id, r.status, r.registered_at,
              e.event_id, e.title, e.event_date, e.venue, e.category, e.banner_url
       FROM event_registrations r JOIN events e ON e.event_id = r.event_id
       WHERE r.user_id = ?
       ORDER BY e.event_date ASC`,
      [req.user.id]
    );
    res.json({ success: true, registrations: rows });
  } catch (err) { next(err); }
});

// DELETE /api/registrations/:id  (cancel + promote first waitlisted user)
router.delete(
  '/registrations/:id',
  auth(['student']),
  [param('id').isInt({ min: 1 })],
  validate,
  async (req, res, next) => {
    let conn;
    try {
      conn = await db.getConnection();
      await conn.beginTransaction();

      // ownership check: a student can only cancel their own registration
      const [regs] = await conn.query(
        'SELECT reg_id, event_id, status FROM event_registrations WHERE reg_id=? AND user_id=?',
        [req.params.id, req.user.id]
      );
      const reg = regs[0];
      if (!reg) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Registration not found' }); }
      if (reg.status === 'cancelled') { await conn.rollback(); return res.status(400).json({ success: false, message: 'Already cancelled' }); }

      await conn.query('SELECT event_id FROM events WHERE event_id=? FOR UPDATE', [reg.event_id]); // serialise per event
      await conn.query("UPDATE event_registrations SET status='cancelled' WHERE reg_id=?", [reg.reg_id]);

      let promoted = null;
      if (reg.status === 'confirmed') {            // a seat was freed
        const [wl] = await conn.query(
          `SELECT r.reg_id, u.name, u.email
           FROM event_registrations r JOIN users u ON u.user_id = r.user_id
           WHERE r.event_id=? AND r.status='waitlisted'
           ORDER BY r.registered_at ASC, r.reg_id ASC LIMIT 1`,
          [reg.event_id]
        );
        if (wl[0]) {
          await conn.query("UPDATE event_registrations SET status='confirmed' WHERE reg_id=?", [wl[0].reg_id]);
          promoted = wl[0];
        }
      }
      await conn.commit();

      if (promoted) {
        const [[ev]] = await db.query('SELECT title, event_date, venue FROM events WHERE event_id=?', [reg.event_id]);
        sendEmail(
          promoted.email,
          `You are in: ${ev.title}`,
          `<h2>Good news, ${esc(promoted.name)}!</h2>
           <p>A seat opened up and your waitlisted registration is now <b>confirmed</b>.</p>
           <p><b>${esc(ev.title)}</b><br>Date: ${esc(ev.event_date)}<br>Venue: ${esc(ev.venue)}</p>`
        ).catch((e) => console.error('Mail error:', e.message));
      }
      res.json({ success: true, message: 'Registration cancelled' });
    } catch (err) {
      if (conn) await conn.rollback();
      next(err);
    } finally {
      if (conn) conn.release();
    }
  }
);

module.exports = router;
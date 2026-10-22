const router = require('express').Router();
const { body, param, query } = require('express-validator');
const db = require('../config/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');

const like = (s) => `%${String(s).replace(/[\\%_]/g, '\\$&')}%`;

// GET /api/jobs : any logged-in user (students included)
router.get(
  '/',
  auth(),
  [query('page').optional().isInt({ min: 1, max: 10000 }), query('q').optional().trim().isLength({ max: 100 })],
  validate,
  async (req, res, next) => {
    try {
      const page = parseInt(req.query.page || '1', 10);
      const limit = 10;
      let where = 'WHERE j.deadline >= CURDATE()';
      const params = [];
      if (req.query.q) {
        where += ' AND (j.title LIKE ? OR j.company LIKE ?)';
        params.push(like(req.query.q), like(req.query.q));
      }
      const [rows] = await db.query(
        `SELECT j.job_id, j.title, j.company, j.location, j.description, j.posted_at, j.deadline,
                u.name AS posted_by, a.user_id AS poster_user_id
         FROM job_posts j
         JOIN alumni_profiles a ON a.alumni_id = j.alumni_id
         JOIN users u ON u.user_id = a.user_id
         ${where} ORDER BY j.posted_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
      );
      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM job_posts j ${where}`, params);
      res.json({ success: true, page, totalPages: Math.max(1, Math.ceil(total / limit)), jobs: rows, me: req.user.id });
    } catch (err) { next(err); }
  }
);

// POST /api/jobs : approved alumni only
router.post(
  '/',
  auth(['alumni']),
  [
    body('title').trim().isLength({ min: 3, max: 200 }),
    body('company').trim().isLength({ min: 2, max: 150 }),
    body('location').trim().isLength({ min: 2, max: 150 }),
    body('description').trim().isLength({ min: 10, max: 5000 }),
    body('deadline').isISO8601({ strict: true }).withMessage('Deadline must be a valid date (YYYY-MM-DD)')
      .custom((v) => new Date(v) >= new Date(new Date().toDateString())).withMessage('Deadline cannot be in the past')
  ],
  validate,
  async (req, res, next) => {
    try {
      const [p] = await db.query('SELECT alumni_id, is_approved FROM alumni_profiles WHERE user_id=?', [req.user.id]);
      if (!p[0]) return res.status(404).json({ success: false, message: 'Alumni profile not found' });
      if (!p[0].is_approved) {
        return res.status(403).json({ success: false, message: 'Your alumni account is awaiting admin approval' });
      }
      const { title, company, location, description, deadline } = req.body;
      await db.query(
        'INSERT INTO job_posts (alumni_id,title,company,location,description,deadline) VALUES (?,?,?,?,?,?)',
        [p[0].alumni_id, title, company, location, description, deadline]
      );
      res.status(201).json({ success: true, message: 'Job posted' });
    } catch (err) { next(err); }
  }
);

// DELETE /api/jobs/:id : owner or admin
router.delete('/:id', auth(['alumni', 'admin']), [param('id').isInt({ min: 1 })], validate, async (req, res, next) => {
  try {
    const sql = req.user.role === 'admin'
      ? ['DELETE FROM job_posts WHERE job_id=?', [req.params.id]]
      : [`DELETE j FROM job_posts j JOIN alumni_profiles a ON a.alumni_id=j.alumni_id
         WHERE j.job_id=? AND a.user_id=?`, [req.params.id, req.user.id]];
    const [r] = await db.query(sql[0], sql[1]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Job not found' });
    res.json({ success: true, message: 'Job deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
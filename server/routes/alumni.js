const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { body, param, query } = require('express-validator');
const db = require('../config/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { imageUpload, checkImageSignature } = require('../middleware/upload');

const upload = imageUpload('profiles');
const like = (s) => `%${String(s).replace(/[\\%_]/g, '\\$&')}%`; // escape LIKE wildcards
const thisYear = new Date().getFullYear();

// ---------- Own profile ----------
router.get('/me', auth(['alumni']), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT u.name, u.email, u.college_id, a.*
       FROM alumni_profiles a JOIN users u ON u.user_id = a.user_id
       WHERE a.user_id = ?`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Profile not found' });
    res.json({ success: true, profile: rows[0] });
  } catch (err) { next(err); }
});

router.put(
  '/me',
  auth(['alumni']),
  [
    body('graduation_year').isInt({ min: 1950, max: thisYear + 6 }),
    body('degree').trim().isLength({ min: 2, max: 100 }),
    body('company').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('designation').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
    body('bio').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }),
    body('linkedin_url').optional({ values: 'falsy' }).trim().isURL({ protocols: ['https'], require_protocol: true })
      .withMessage('LinkedIn URL must start with https://')
  ],
  validate,
  async (req, res, next) => {
    try {
      const { graduation_year, degree, company, designation, bio, linkedin_url } = req.body;
      await db.query(
        `UPDATE alumni_profiles
         SET graduation_year=?, degree=?, company=?, designation=?, bio=?, linkedin_url=?
         WHERE user_id=?`,
        [graduation_year, degree, company || null, designation || null, bio || null, linkedin_url || null, req.user.id]
      );
      res.json({ success: true, message: 'Profile updated' });
    } catch (err) { next(err); }
  }
);

router.put('/me/picture', auth(['alumni']), upload.single('profilePic'), checkImageSignature, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });
    const [rows] = await db.query('SELECT profile_pic_url FROM alumni_profiles WHERE user_id=?', [req.user.id]);
    const url = `/uploads/profiles/${req.file.filename}`;
    await db.query('UPDATE alumni_profiles SET profile_pic_url=? WHERE user_id=?', [url, req.user.id]);
    const old = rows[0] && rows[0].profile_pic_url;
    if (old) fs.unlink(path.join(__dirname, '..', 'uploads', 'profiles', path.basename(old)), () => {});
    res.json({ success: true, profile_pic_url: url });
  } catch (err) { next(err); }
});

// ---------- Directory ----------
router.get(
  '/',
  auth(),
  [
    query('year').optional({ values: 'falsy' }).isInt({ min: 1950, max: thisYear + 6 }),
    query('degree').optional().trim().isLength({ max: 100 }),
    query('company').optional().trim().isLength({ max: 120 }),
    query('q').optional().trim().isLength({ max: 100 }),
    query('page').optional().isInt({ min: 1, max: 10000 })
  ],
  validate,
  async (req, res, next) => {
    try {
      const { year, degree, company, q } = req.query;
      const page = parseInt(req.query.page || '1', 10);
      const limit = 12;
      let where = "WHERE u.role='alumni' AND u.is_active=1 AND a.is_approved=1";
      const params = [];
      if (year)    { where += ' AND a.graduation_year=?'; params.push(year); }
      if (degree)  { where += ' AND a.degree LIKE ?';     params.push(like(degree)); }
      if (company) { where += ' AND a.company LIKE ?';    params.push(like(company)); }
      if (q)       { where += ' AND u.name LIKE ?';       params.push(like(q)); }

      const base = 'FROM alumni_profiles a JOIN users u ON a.user_id = u.user_id ' + where;
      const [rows] = await db.query(
        `SELECT u.user_id, u.name, a.alumni_id, a.graduation_year, a.degree, a.company,
                a.designation, a.linkedin_url, a.bio, a.profile_pic_url
         ${base} ORDER BY a.graduation_year DESC, u.name ASC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
      );
      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${base}`, params);
      res.json({ success: true, page, totalPages: Math.max(1, Math.ceil(total / limit)), alumni: rows });
    } catch (err) { next(err); }
  }
);

// ---------- Connections ----------
router.post('/connect/:userId', auth(['alumni']), [param('userId').isInt({ min: 1 })], validate, async (req, res, next) => {
  try {
    const target = parseInt(req.params.userId, 10);
    if (target === req.user.id) return res.status(400).json({ success: false, message: 'You cannot connect with yourself' });
    const [ok] = await db.query(
      "SELECT u.user_id FROM users u JOIN alumni_profiles a ON a.user_id=u.user_id WHERE u.user_id=? AND u.is_active=1 AND a.is_approved=1",
      [target]
    );
    if (!ok[0]) return res.status(404).json({ success: false, message: 'Alumnus not found' });
    const [dup] = await db.query(
      `SELECT conn_id FROM connections
       WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`,
      [req.user.id, target, target, req.user.id]
    );
    if (dup[0]) return res.status(409).json({ success: false, message: 'A connection or request already exists' });
    await db.query('INSERT INTO connections (requester_id, addressee_id) VALUES (?,?)', [req.user.id, target]);
    res.status(201).json({ success: true, message: 'Connection request sent' });
  } catch (err) { next(err); }
});

router.get('/connections', auth(['alumni']), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT c.conn_id, c.status, c.requester_id, c.addressee_id,
              u.user_id AS other_id, u.name AS other_name,
              a.company, a.designation, a.graduation_year
       FROM connections c
       JOIN users u ON u.user_id = IF(c.requester_id = ?, c.addressee_id, c.requester_id)
       LEFT JOIN alumni_profiles a ON a.user_id = u.user_id
       WHERE (c.requester_id = ? OR c.addressee_id = ?) AND c.status <> 'rejected'
       ORDER BY c.created_at DESC`,
      [req.user.id, req.user.id, req.user.id]
    );
    res.json({
      success: true,
      incoming: rows.filter((r) => r.status === 'pending' && r.addressee_id === req.user.id),
      outgoing: rows.filter((r) => r.status === 'pending' && r.requester_id === req.user.id),
      network:  rows.filter((r) => r.status === 'accepted')
    });
  } catch (err) { next(err); }
});

router.put(
  '/connections/:id',
  auth(['alumni']),
  [param('id').isInt({ min: 1 }), body('status').isIn(['accepted', 'rejected'])],
  validate,
  async (req, res, next) => {
    try {
      const [r] = await db.query(
        "UPDATE connections SET status=? WHERE conn_id=? AND addressee_id=? AND status='pending'",
        [req.body.status, req.params.id, req.user.id]
      );
      if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Request not found' });
      res.json({ success: true, message: `Request ${req.body.status}` });
    } catch (err) { next(err); }
  }
);

module.exports = router;
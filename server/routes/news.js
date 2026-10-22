const router = require('express').Router();
const { body, param, query } = require('express-validator');
const db = require('../config/db');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');

const pageRule = query('page').optional().isInt({ min: 1, max: 10000 });

// GET /api/news
router.get('/', auth(), [pageRule], validate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = 10;
    const [rows] = await db.query(
      `SELECT n.news_id, n.title, n.body, n.created_at, u.name AS author,
              (SELECT COUNT(*) FROM comments c WHERE c.news_id = n.news_id) AS comment_count
       FROM news n JOIN users u ON u.user_id = n.admin_id
       ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
      [limit, (page - 1) * limit]
    );
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM news');
    res.json({ success: true, page, totalPages: Math.max(1, Math.ceil(total / limit)), news: rows });
  } catch (err) { next(err); }
});

// GET /api/news/:id/comments?page=1  (10 per page)
router.get('/:id/comments', auth(), [param('id').isInt({ min: 1 }), pageRule], validate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = 10;
    const [rows] = await db.query(
      `SELECT c.comment_id, c.body, c.created_at, u.name AS author
       FROM comments c JOIN users u ON u.user_id = c.user_id
       WHERE c.news_id=? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [req.params.id, limit, (page - 1) * limit]
    );
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM comments WHERE news_id=?', [req.params.id]);
    res.json({ success: true, page, totalPages: Math.max(1, Math.ceil(total / limit)), comments: rows });
  } catch (err) { next(err); }
});

// POST /api/news/:id/comments : alumni (and admin)
router.post(
  '/:id/comments',
  auth(['alumni', 'admin']),
  [param('id').isInt({ min: 1 }), body('body').trim().isLength({ min: 1, max: 1000 }).withMessage('Comment must be 1-1000 characters')],
  validate,
  async (req, res, next) => {
    try {
      const [n] = await db.query('SELECT news_id FROM news WHERE news_id=?', [req.params.id]);
      if (!n[0]) return res.status(404).json({ success: false, message: 'News item not found' });
      await db.query('INSERT INTO comments (news_id,user_id,body) VALUES (?,?,?)', [req.params.id, req.user.id, req.body.body]);
      res.status(201).json({ success: true, message: 'Comment added' });
    } catch (err) { next(err); }
  }
);

module.exports = router;
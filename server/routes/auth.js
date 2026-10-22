const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const db = require('../config/db');
const validate = require('../middleware/validate');
const { sendEmail, esc } = require('../utils/mailer');

const isProd = process.env.NODE_ENV === 'production';
const CLIENT = process.env.CLIENT_URL.split(',')[0].trim();
const SERVER = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10); // equalises timing for unknown emails

const cookieOptions = {
  httpOnly: true,                                   // not readable by JavaScript
  secure: isProd,                                   // HTTPS only in production
  sameSite: process.env.COOKIE_SAMESITE || 'strict',
  path: '/api/auth',                                // sent only to auth routes
  maxAge: 7 * 24 * 60 * 60 * 1000
};

// ---------- Rate limiters ----------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,                     // only failed logins count
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.', code: 429 }
});
const mailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many email requests. Try again later.', code: 429 }
});

// ---------- Validators ----------
const emailRule = body('email').isEmail().withMessage('Enter a valid email').normalizeEmail();
const passwordRule = body('password')
  .isLength({ min: 8, max: 72 }).withMessage('Password must be 8-72 characters')
  .matches(/[A-Z]/).withMessage('Password needs an uppercase letter')
  .matches(/\d/).withMessage('Password needs a number');
const thisYear = new Date().getFullYear();

const registerRules = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  emailRule,
  passwordRule,
  body('confirm_password').custom((v, { req }) => v === req.body.password).withMessage('Passwords do not match'),
  body('role').isIn(['student', 'alumni']).withMessage('Role must be student or alumni'),
  body('college_id').trim().matches(/^[A-Za-z0-9\-\/]{1,50}$/).withMessage('College ID may contain letters, numbers, - and /'),
  // alumni-only fields
  body('graduation_year').if(body('role').equals('alumni'))
    .isInt({ min: 1950, max: thisYear + 6 }).withMessage('Enter a valid graduation year'),
  body('degree').if(body('role').equals('alumni'))
    .trim().isLength({ min: 2, max: 100 }).withMessage('Degree is required'),
  body('company').if(body('role').equals('alumni')).optional({ values: 'falsy' })
    .trim().isLength({ max: 120 }),
  body('designation').if(body('role').equals('alumni')).optional({ values: 'falsy' })
    .trim().isLength({ max: 120 }),
  body('linkedin_url').if(body('role').equals('alumni')).optional({ values: 'falsy' })
    .trim().isURL({ protocols: ['https'], require_protocol: true }).withMessage('LinkedIn URL must start with https://')
];

// ---------- Helpers ----------
async function sendVerification(name, email) {
  const token = jwt.sign({ email, purpose: 'verify' }, process.env.JWT_SECRET, { expiresIn: '24h' });
  const link = `${SERVER}/api/auth/verify/${token}`;
  await sendEmail(
    email,
    'Verify your College Portal account',
    `<h2>Welcome, ${esc(name)}!</h2>
     <p>Click the button below to verify your email address.</p>
     <p><a href="${link}" style="background:#1a73e8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Verify Email</a></p>
     <p>This link expires in 24 hours.</p>`
  );
}

function issueSession(user, res) {
  const accessToken = jwt.sign(
    { id: user.user_id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  const refreshToken = jwt.sign({ id: user.user_id }, process.env.REFRESH_SECRET, { expiresIn: '7d' });
  res.cookie('refreshToken', refreshToken, cookieOptions);
  return { accessToken, refreshToken };
}

// ---------- POST /api/auth/register ----------
router.post('/register', registerRules, validate, async (req, res, next) => {
  const { name, email, password, role, college_id } = req.body;
  let conn;
  try {
    const [existing] = await db.query('SELECT user_id FROM users WHERE email=?', [email]);
    if (existing.length) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }
    const hash = await bcrypt.hash(password, 10);

    conn = await db.getConnection();
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO users (name,email,password_hash,role,college_id) VALUES (?,?,?,?,?)',
      [name, email, hash, role, college_id]
    );
    if (role === 'alumni') {
      const { graduation_year, degree, company, designation, linkedin_url } = req.body;
      await conn.query(
        `INSERT INTO alumni_profiles (user_id,graduation_year,degree,company,designation,linkedin_url)
         VALUES (?,?,?,?,?,?)`,
        [result.insertId, graduation_year, degree, company || null, designation || null, linkedin_url || null]
      );
    }
    await conn.commit();

    try {
      await sendVerification(name, email);
    } catch (mailErr) {
      console.error('Verification email failed:', mailErr.message);
      return res.status(201).json({
        success: true,
        message: 'Account created, but the email could not be sent. Use "Resend verification email".'
      });
    }
    res.status(201).json({ success: true, message: 'Registration successful. Check your email to verify.' });
  } catch (err) {
    if (conn) await conn.rollback();
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

// ---------- GET /api/auth/verify/:token ----------
router.get('/verify/:token', async (req, res) => {
  try {
    const decoded = jwt.verify(req.params.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.purpose !== 'verify') throw new Error('wrong purpose');
    await db.query('UPDATE users SET is_verified=1 WHERE email=?', [decoded.email]);
    res.redirect(`${CLIENT}/login.html?verified=true`);
  } catch {
    res.redirect(`${CLIENT}/login.html?verified=false`);
  }
});

// ---------- POST /api/auth/resend-verification ----------
router.post('/resend-verification', mailLimiter, [emailRule], validate, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT name,email,is_verified FROM users WHERE email=?', [req.body.email]);
    if (rows[0] && !rows[0].is_verified) {
      await sendVerification(rows[0].name, rows[0].email).catch((e) => console.error(e.message));
    }
    // same answer whether or not the account exists (prevents email enumeration)
    res.json({ success: true, message: 'If the account exists and is unverified, a new email has been sent.' });
  } catch (err) { next(err); }
});

// ---------- POST /api/auth/login ----------
router.post(
  '/login',
  loginLimiter,
  [emailRule, body('password').isString().isLength({ min: 1, max: 72 })],
  validate,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
      const user = rows[0];
      const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !ok) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }
      if (!user.is_verified) {
        return res.status(403).json({ success: false, message: 'Please verify your email first' });
      }
      if (!user.is_active) {
        return res.status(403).json({ success: false, message: 'Account suspended. Contact admin.' });
      }
      const { accessToken, refreshToken } = issueSession(user, res);
      await db.query('UPDATE users SET refresh_token_hash=? WHERE user_id=?', [sha256(refreshToken), user.user_id]);
      res.json({ success: true, accessToken, role: user.role, name: user.name });
    } catch (err) { next(err); }
  }
);

// ---------- POST /api/auth/refresh ----------
router.post('/refresh', async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ success: false, message: 'No refresh token' });
  try {
    const { id } = jwt.verify(token, process.env.REFRESH_SECRET, { algorithms: ['HS256'] });
    const [rows] = await db.query(
      'SELECT user_id,name,role FROM users WHERE user_id=? AND refresh_token_hash=? AND is_active=1',
      [id, sha256(token)]
    );
    if (!rows[0]) {
      res.clearCookie('refreshToken', { path: cookieOptions.path });
      return res.status(403).json({ success: false, message: 'Refresh token revoked' });
    }
    const accessToken = jwt.sign(
      { id: rows[0].user_id, role: rows[0].role, name: rows[0].name },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
    res.json({ success: true, accessToken, role: rows[0].role, name: rows[0].name });
  } catch {
    res.status(403).json({ success: false, message: 'Invalid refresh token' });
  }
});

// ---------- POST /api/auth/logout ----------
router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies.refreshToken;
    if (token) await db.query('UPDATE users SET refresh_token_hash=NULL WHERE refresh_token_hash=?', [sha256(token)]);
    res.clearCookie('refreshToken', { path: cookieOptions.path });
    res.json({ success: true, message: 'Logged out' });
  } catch (err) { next(err); }
});

// ---------- POST /api/auth/forgot-password ----------
router.post('/forgot-password', mailLimiter, [emailRule], validate, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT user_id,name,email,password_hash FROM users WHERE email=? AND is_verified=1', [req.body.email]);
    const user = rows[0];
    if (user) {
      // signed with secret + current password hash: the link dies as soon as the password changes
      const token = jwt.sign({ id: user.user_id, purpose: 'reset' }, process.env.JWT_SECRET + user.password_hash, { expiresIn: '1h' });
      const link = `${CLIENT}/reset-password.html?id=${user.user_id}&token=${token}`;
      await sendEmail(
        user.email,
        'Reset your College Portal password',
        `<p>Hello ${esc(user.name)},</p>
         <p><a href="${link}">Click here to reset your password</a>. This link is valid for 1 hour.</p>
         <p>If you did not ask for this, ignore this email.</p>`
      ).catch((e) => console.error(e.message));
    }
    res.json({ success: true, message: 'If the email is registered, a reset link has been sent.' });
  } catch (err) { next(err); }
});

// ---------- POST /api/auth/reset-password ----------
router.post(
  '/reset-password',
  [body('id').isInt({ min: 1 }), body('token').isString().isLength({ min: 20, max: 1000 }), passwordRule],
  validate,
  async (req, res, next) => {
    try {
      const { id, token, password } = req.body;
      const [rows] = await db.query('SELECT user_id,password_hash FROM users WHERE user_id=?', [id]);
      const user = rows[0];
      if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired link' });
      try {
        const d = jwt.verify(token, process.env.JWT_SECRET + user.password_hash, { algorithms: ['HS256'] });
        if (d.purpose !== 'reset' || d.id !== user.user_id) throw new Error('bad token');
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid or expired link' });
      }
      const hash = await bcrypt.hash(password, 10);
      // new password + revoke all sessions
      await db.query('UPDATE users SET password_hash=?, refresh_token_hash=NULL WHERE user_id=?', [hash, user.user_id]);
      res.json({ success: true, message: 'Password updated. You can now log in.' });
    } catch (err) { next(err); }
  }
);

module.exports = router;
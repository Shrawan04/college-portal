require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const db = require('./config/db');

// Fail fast if secrets are missing or weak
for (const key of ['JWT_SECRET', 'REFRESH_SECRET', 'CLIENT_URL', 'DB_HOST', 'DB_USER', 'DB_NAME']) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (process.env.JWT_SECRET.length < 32 || process.env.REFRESH_SECRET.length < 32) {
  console.error('JWT_SECRET and REFRESH_SECRET must be at least 32 characters');
  process.exit(1);
}

const app = express();
const isProd = process.env.NODE_ENV === 'production';
if (isProd) app.set('trust proxy', 1); // Render/Railway/Heroku sit behind a proxy

// ---- Security middleware ----
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const allowedOrigins = process.env.CLIENT_URL.split(',').map((s) => s.trim());
app.use(
  cors({
    origin(origin, cb) {
      // no Origin header = same-origin request or a non-browser client
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      const err = new Error('Origin not allowed by CORS');
      err.status = 403;
      cb(err);
    },
    credentials: true
  })
);

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Global rate limit: 100 requests / 15 min / IP
app.use(
  '/api/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.', code: 429 }
  })
);

// ---- Static files ----
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { index: false, dotfiles: 'deny' }));
app.use(express.static(path.join(__dirname, '..', 'client'))); // lets the whole app run from port 5000 too

// ---- Routes ----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api', require('./routes/registrations'));
app.use('/api/alumni', require('./routes/alumni'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/news', require('./routes/news'));
app.use('/api/admin', require('./routes/admin'));

// ---- 404 ----
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// ---- Global error handler ----
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err.stack || err);
  let status = err.status || 500;
  let message = err.message;
  if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = 'File too large (max 2 MB)'; }
  if (err.name === 'MulterError' && status === 500) status = 400;
  if (status >= 500 && isProd) message = 'Internal Server Error'; // never leak internals
  res.status(status).json({ success: false, message, code: status });
});

// ---- Start ----
const PORT = process.env.PORT || 5000;
(async () => {
  try {
    await db.query('SELECT 1');
    console.log('MySQL connected');
  } catch (e) {
    console.error('MySQL connection failed:', e.message);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
})();
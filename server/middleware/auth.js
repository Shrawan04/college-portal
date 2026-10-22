const jwt = require('jsonwebtoken');

module.exports = (roles = []) => (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.purpose) throw new Error('wrong token type'); // email/reset tokens are not login tokens
    if (roles.length && !roles.includes(decoded.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    req.user = decoded; // { id, role, name }
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    res.status(401).json({ success: false, message: msg });
  }
};
// Use http://localhost:3000 (not 127.0.0.1) so CORS and cookies match the .env settings
window.API_BASE = location.port === '3000' ? 'http://localhost:5000' : '';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const db = require('../config/db');

(async () => {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.log('Usage: npm run create-admin -- "Full Name" admin@college.edu "StrongPass1"');
    process.exit(1);
  }
  if (!/^(?=.*[A-Z])(?=.*\d).{8,72}$/.test(password)) {
    console.log('Password needs 8-72 chars, one uppercase letter and one number');
    process.exit(1);
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (name,email,password_hash,role,college_id,is_verified) VALUES (?,?,?,'admin','ADMIN',1)",
      [name, email.toLowerCase(), hash]
    );
    console.log('Admin created:', email);
  } catch (e) {
    console.log('Failed:', e.code === 'ER_DUP_ENTRY' ? 'email already exists' : e.message);
  }
  process.exit(0);
})();
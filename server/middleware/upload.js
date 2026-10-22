const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function imageUpload(subdir) {
  const dir = path.join(__dirname, '..', 'uploads', subdir);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, dir),
      filename: (req, file, cb) =>
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${EXT[file.mimetype]}`)
    }),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      if (EXT[file.mimetype]) return cb(null, true);
      const err = new Error('Only JPG, PNG or WEBP images are allowed');
      err.status = 400;
      cb(err);
    }
  });
}

// Run after upload.single(): verifies the real file signature
function checkImageSignature(req, res, next) {
  if (!req.file) return next();
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(req.file.path, 'r');
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isWebp = buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  if (isJpg || isPng || isWebp) return next();
  fs.unlink(req.file.path, () => {});
  return res.status(400).json({ success: false, message: 'File content is not a valid image' });
}

module.exports = { imageUpload, checkImageSignature };
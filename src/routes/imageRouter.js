const express = require('express');
const router = express.Router();
const imageController = require('../controllers/imageController');
const imageMiddleware = require('../middlewares/uploadMiddleware');
const multer = require('multer');

// Set up multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory
const upload = multer({ storage: storage });

router.post('/', upload.single('image'), imageMiddleware.uploadAndCompressImage,imageController.uploadImage);
router.get('/url',imageController.getSignedUrl);
// Keep after /url so it isn't captured by the :key param.
// Wildcard, not ':key': keys are now `<folder>/<uuid>`, and a plain `:key`
// only matches a single path segment so foldered keys would 404.
router.get('/:key(*)', imageController.getImage);

module.exports = router;

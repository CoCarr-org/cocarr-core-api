const imageService = require('../services/imageService');

const uploadImage = async (req, res) => {
  try {
    const result = await imageService.uploadImage(req);

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json(error);
  }
};

const getSignedUrl = async (req, res) => {
  try {
    const result = await imageService.getSignedUrl(req);

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json(error);
  }
};

// Streams a stored image from the (private) bucket so clients can display it
// via the API without the bucket needing to be public.
const getImage = async (req, res) => {
  try {
    const { key } = req.params;
    const object = await imageService.getObject(key);

    res.setHeader('Content-Type', object.ContentType || 'image/jpeg');
    if (object.ContentLength) res.setHeader('Content-Length', object.ContentLength);
    // Keys are UUIDs and content never changes, so cache aggressively.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    object.Body.on('error', () => res.destroy());
    object.Body.pipe(res);
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: 'Image not found' });
    }
    console.error('Error streaming image:', error);
    return res.status(500).json({ error: 'Could not load image' });
  }
};

module.exports = {
  uploadImage,
  getSignedUrl,
  getImage
};

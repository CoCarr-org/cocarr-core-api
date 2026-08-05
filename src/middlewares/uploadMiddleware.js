// const imagemin = require('imagemin');
// const imageminJpegtran = require('imagemin-jpegtran');
// const imageminPngquant = require('imagemin-pngquant');
// const sizeOf = require('image-size');



// // Define a function to generate a random name for the uploaded file
// const generateRandomName = () => {
//   return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
// };

// // Define a middleware function to handle the image upload and compression
// const uploadAndCompressImage = async (req, res, next) => {
//   try {
//     const file = req.file.buffer;
//     const dimensions = sizeOf(file);

//     // Extract file extension from the image buffer
//     const fileExtension = dimensions.type ? `.${dimensions.type}` : '';

//     const randomName = generateRandomName() + fileExtension;

//     // Check if the image size is greater than 250KB
//     if (file.length > 250 * 1024) {
//       // Compress the image
//       const compressedBuffer = await imagemin.buffer(file, {
//         plugins: [
//           imageminJpegtran(),
//           imageminPngquant({ quality: [0.6, 0.8] }),
//         ],
//       });

//       // Attach the compressed image buffer to the request
//       req.compressedImageBuffer = compressedBuffer;
//       req.isCompressed = true;
//     } else {
//       req.compressedImageBuffer = file;
//       req.isCompressed = false;
//     }

//     // Attach other details to the request
//     req.imagePath = `uploads/${randomName}`;
//     req.imageName = `${randomName}`;

//     next(); // Continue to the next middleware or route handler
//   } catch (error) {
//     console.error('Error processing image:', error);
//     res.status(500).json({ error: 'Internal Server Error' });
//   }
// };

// module.exports = {
//     uploadAndCompressImage,
//   };

const sharp = require('sharp');

const generateRandomName = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const uploadAndCompressImage = async (req, res, next) => {
  try {
    const file = req.file.buffer;
    const dimensions = await sharp(file).metadata();

    // Extract file extension from the image buffer
    const fileExtension = dimensions.format ? `.${dimensions.format}` : '';

    const randomName = generateRandomName() + fileExtension;

    let compressedBuffer = file;

    // Check if the image size is greater than 250KB
    if (file.length > 250 * 1024) {
      // Compress the image
      compressedBuffer = await sharp(file)
        .resize({ fit: 'inside', width: 800 }) // Resize image if needed
        .toBuffer();
    }

    // Attach the compressed image buffer to the request
    req.compressedImageBuffer = compressedBuffer;
    req.isCompressed = compressedBuffer !== file;

    // Attach other details to the request
    req.imagePath = `uploads/${randomName}`;
    req.imageName = `${randomName}`;

    next(); // Continue to the next middleware or route handler
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};


module.exports ={uploadAndCompressImage};
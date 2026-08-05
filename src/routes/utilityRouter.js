const express = require('express');
const router = express.Router();
const UtilityController = require('../controllers/utilityController');


router.get('/autocomplete', UtilityController.autocomplete);
router.get('/get-place', UtilityController.getPlaceName);
router.post('/validate-place', UtilityController.validatePlace);
router.post('/validate-geo', UtilityController.validatePlaceByLatLong);
module.exports = router;

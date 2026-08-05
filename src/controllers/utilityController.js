const { CustomError } = require('../middlewares/error');
const utilityService = require('../services/utilityService');



async function autocomplete(req, res) {
    try {
        const {search,cityId} = req.query;
        const result = await utilityService.autocomplete(search,cityId);
        res.json(result);
    } catch (error) {
        if(error instanceof CustomError) {
            res.status(500).json({ error: error.message });
          } else {
            res.status(500).json({ error: 'Internal Server Error' });
          }
    }
}


async function getPlaceName(req, res) {
    try {
        const {lat, long} = req.query;
        const result = await utilityService.getPlaceName(lat, long);
        res.json(result);
    } catch (error) {
        if(error instanceof CustomError) {
            res.status(500).json({ error: error.message });
          } else {
            res.status(500).json({ error: 'Internal Server Error' });
          }
    }
}


async function validatePlace(req, res) {
    const {placeId,cityId} = req.query;
    const result = await utilityService.validatePlace(placeId,cityId);
    res.json(result);
}


async function validatePlaceByLatLong(req, res) {
    try {
        const {lat, lng, cityId} = req.query;
        const result = await utilityService.validatePlaceByLatLong(lat, lng, cityId);
        res.json(result);
} catch (error) {
    if(error instanceof CustomError) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal Server Error' });
      }
}
}

module.exports = {
    autocomplete,
    getPlaceName,
    validatePlace,
    validatePlaceByLatLong,

}
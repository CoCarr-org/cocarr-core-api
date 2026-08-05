const { default: axios } = require("axios");
const { CustomError } = require("../middlewares/error");
const City = require("../models/city");

async function autocomplete(query, cityId = null) {
    try {
        let cities = await City.findAll({ where: { active: true } });

        if (!query) throw new CustomError('Query is required', 400);

        let locationBias = null;
        let totalLat = 0;
        let totalLng = 0;
        let maxRadius = 0;

        cities.forEach(city => {
            const { lat, lng, radius = 10000 } = city;
            totalLat += parseFloat(lat);
            totalLng += parseFloat(lng);
            if (radius > maxRadius) {
                maxRadius = radius;
            }
            if (cityId && cityId == city.id) {
                locationBias = `circle:${radius}@${lat},${lng}`;
            }
        });

        const avgLat = totalLat / cities.length;
        const avgLng = totalLng / cities.length;
        const locationRestriction = `circle:${maxRadius}@${avgLat},${avgLng}`;

        const response = await axios.get(
            `https://maps.googleapis.com/maps/api/place/autocomplete/json`,
            {
                params: {
                    input: query,
                    key: process.env.GOOGLE_API_KEY,
                    type: 'address',
                    components: 'country:IN',
                    language: 'en',
                    radius: 30000,
                    // strictbounds: true,
                    locationbias: locationBias,
                    // locationrestriction: locationRestriction
                },
            }
        );
        return response.data.predictions
    } catch (error) {
        console.error(error);
        throw new CustomError('Failed to fetch places', 400);
    }
}

async function validatePlace(placeId,cityId=null) {
    try {

      if(!placeId) throw new CustomError('Place ID is required',400);
      if(!cityId) throw new CustomError('City ID is required',400);

      let isPlaceValid = false;
      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/place/details/json`,
        {
          params: {
            place_id: placeId,
            key: process.env.GOOGLE_API_KEY,
            language: 'en',
          },
        }
      );
      const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // Radius of the earth in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c; // Distance in km
        return d;
      }
      let cities = await City.findAll({ where: { active: true } });

        let isCityChanged = false;
        let selectedCityId = null;
        let changedCity = null;

        const selectedCity = cities.find(city => city.id === cityId);
        if (selectedCity) {
            const { lat, lng, radius = 20 } = selectedCity;
            const distance = getDistanceFromLatLonInKm(lat, lng, response.data.result.geometry.location.lat, response.data.result.geometry.location.lng);
            if (distance > radius) {
                for (const city of cities) {
                    const { lat: cityLat, lng: cityLng, radius: cityRadius = 20 } = city;
                    const cityDistance = getDistanceFromLatLonInKm(cityLat, cityLng, response.data.result.geometry.location.lat, response.data.result.geometry.location.lng);
                    if (cityDistance <= cityRadius) {
                        isCityChanged = true;
                        selectedCityId = city.id;
                        changedCity = city;
                        isPlaceValid = true;
                        break;
                    }
                }
                if (!isCityChanged) {
                    isPlaceValid = false;
                }
            } else {
                selectedCityId = cityId;
                isPlaceValid = true;
            }
        } else {
            throw new CustomError('City not found',400);
        }

        if (isCityChanged) {
            response.data.result.isCityChanged = true;
            // response.data.result.cityId = selectedCityId;
        }
        return {info:response.data.result,city:isCityChanged ? changedCity : selectedCity,isCityChanged:isCityChanged,isPlaceValid:isPlaceValid};
    } catch (error) {

        throw new CustomError('Failed to fetch place details',400);
    }
}


async function validatePlaceByLatLong(lat, lng, cityId = null) {
  try {
    if (lat === undefined || lng === undefined) throw new CustomError('Latitude and Longitude are required', 400);
    if (!cityId) throw new CustomError('City ID is required', 400);

    let isPlaceValid = false;
    const response = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json`,
      {
        params: {
          latlng: `${lat},${lng}`,
          key: process.env.GOOGLE_API_KEY,
          language: 'en',
        },
      }
    );

    const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
      const R = 6371; // Radius of the earth in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const d = R * c; // Distance in km
      return d;
    };

    let cities = await City.findAll({ where: { active: true } });

    let isCityChanged = false;
    let selectedCityId = null;
    let changedCity = null;

    const selectedCity = cities.find(city => city.id === cityId);
    if (selectedCity) {
      const { lat: cityLat, lng: cityLng, radius = 20 } = selectedCity;
      const distance = getDistanceFromLatLonInKm(cityLat, cityLng, lat, lng);
      if (distance > radius) {
        for (const city of cities) {
          const { lat: cityLat, lng: cityLng, radius: cityRadius = 20 } = city;
          const cityDistance = getDistanceFromLatLonInKm(cityLat, cityLng, lat, lng);
          if (cityDistance <= cityRadius) {
            isCityChanged = true;
            selectedCityId = city.id;
            changedCity = city;
            isPlaceValid = true;
            break;
          }
        }
        if (!isCityChanged) {
          isPlaceValid = false;
        }
      } else {
        selectedCityId = cityId;
        isPlaceValid = true;
      }
    } else {
      throw new CustomError('City not found', 400);
    }

    return { info: response.data.results[0], city: isCityChanged ? changedCity : selectedCity, isCityChanged: isCityChanged, isPlaceValid: isPlaceValid };
  } catch (error) {
    throw new CustomError('Failed to fetch place details', 400);
  }
}



async function getPlaceName(lat, long) {
    try {
        const response = await axios.get(
          `https://maps.googleapis.com/maps/api/geocode/json`,
          {
            params: {
              latlng: `${lat},${long}`,
              key: process.env.GOOGLE_API_KEY,
              language: 'en',
            },
          }
        );
        if (response.data.status === 'OK' && response.data.results.length > 0) {
            return response.data.results[0].formatted_address;
        } else {
            throw new CustomError('No results found',400);
        }
      } catch (error) {
        console.error(error);
        throw new CustomError('Failed to fetch place name',400);
      }
}


module.exports = {
    autocomplete,
    getPlaceName,
    validatePlace,
    validatePlaceByLatLong
}
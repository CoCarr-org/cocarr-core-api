const { CustomError } = require("../middlewares/error");
const moment = require('moment')

function calculateAge(birthDate) {
    // Parse the birthDate string into a Date object
    const dob = new Date(birthDate);
    
    // Get the current date
    const currentDate = new Date();
    
    // Calculate the difference in milliseconds between the current date and the birthDate
    const diffMs = currentDate - dob;
    
    // Convert the difference in milliseconds to years
    const ageDate = new Date(diffMs); // Epoch reference
    const age = Math.abs(ageDate.getUTCFullYear() - 1970);
    
    return age;
}

function convertFromUnixTimestamp(unixTimestamp) {
    const dateObject = new Date(unixTimestamp * 1000);
  return dateObject;
  }

  function convertToUnixTimestamp(dateObject) {
    const unixTimestamp = Math.floor(dateObject.getTime() / 1000);
    return unixTimestamp;
  }

  async function calculateRefund(startTime, amount,deposit) {
    const currentTime = new Date();
    const timeDifference = (currentTime - startTime) / (1000 * 60 * 60); // Difference in hours
  
    let refundAmounts = [];
    if (timeDifference >= 24) {
      refundAmounts.push({ hours: 24, refundAmount: amount });
    } else if (timeDifference >= 12) {
      refundAmounts.push({ hours: 12, refundAmount: amount * 0.5 });
    } else {
      refundAmounts.push({ hours: 0, refundAmount: 0 });
    }
    
    return refundAmounts+deposit;
  }
  

  function checkTimeGaps(startTime, endTime) {
    // Get the current time rounded to the nearest hour
    const currentTime = moment().startOf('hour');
    console.log('Current Time:', currentTime.format('HH:mm'));

    // Convert startTime from UNIX timestamp to a Moment object
    const startMoment = moment.unix(startTime);

    // Calculate the time difference between the current time and the start time
    const timeDifferenceCurrentStart = startMoment.diff(currentTime, 'hours', true); // Difference in hours
    console.log('Time Difference between Current Time and Start Time:', timeDifferenceCurrentStart);

    // Calculate the time difference between the start time and end time
    const endMoment = moment.unix(endTime);
    const timeDifferenceStartEnd = endMoment.diff(startMoment, 'hours', true); // Difference in hours

    // Check if there is a 3-hour gap from the current time and a 12-hour gap between the start time and end time
    if (timeDifferenceCurrentStart < 3) {
        throw new CustomError('Pickup time should be at least 3 hours from now.', 400, 'MINIMUM_START_TIME');
    }
    if (timeDifferenceStartEnd < 12) {
        throw new CustomError('Ride duration should be at least 12 hours.', 400, 'INVALID_RIDE_DURATION');
    }

    console.log('Time Difference between Start Time and End Time:', timeDifferenceStartEnd);

    // Return the result
    return true;
}

function findItemByType(settings,type) {
  return settings.find(item => item.type === type);
}

function getHoursDifference(startDate, endDate) {
  // Calculate the difference in milliseconds
  const timeDifference = endDate.getTime() - startDate.getTime();

  // Convert milliseconds to hours
  const hoursDifference = timeDifference / (1000 * 60 * 60);

  return hoursDifference;
}

function formatDateTime(inputDateTime, dateFormat = 'long', timeFormat = 'numeric') {
  const date = new Date(inputDateTime);

  // Format the date and time
  const formattedDate = date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: dateFormat,
      year: timeFormat,
  });
  
  let formattedTime = date.toLocaleTimeString('en-GB', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
  });

  // Handle case where hour is 0 and not 12
  if (date.getHours() === 0 && date.getHours() !== 12) {
      formattedTime = formattedTime.replace(/^0/, '12');
  }

  // Concatenate the formatted date and time
  const formattedDateTime = `${formattedDate} ${formattedTime}`;

  return formattedDateTime;
}



module.exports={calculateAge,convertFromUnixTimestamp,convertToUnixTimestamp,calculateRefund,checkTimeGaps,findItemByType,getHoursDifference,formatDateTime}
const adminMessaging = require("../helper/adminMessaging");
const Booking = require("../models/booking");
const FcmToken = require("../models/fcmTokens");
const Host = require("../models/host");
const User = require("../models/user");
const Vehicle = require("../models/vehicle");

const sendBookingConfirmationNotification = async ({bookingId,hostId,vehicleId,userId}) => 
    {
    
        try 
        {
            let booking = await Booking.findOne({where:{bookingId:bookingId}});
            let vehicle = await Vehicle.findByPk(booking.vehicleId);
            let user = await User.findByPk(booking.userId);
            let host;
            if(vehicle.hostId) host = await Host.findByPk(vehicle.hostId);
            // Retrieve FCM tokens for the user
            const userFcmTokens = await FcmToken.findAll({ where: { userId: user.id } });
            const hostFcmTokens = host ? await FcmToken.findAll({ where: { userId: host.userId } }) : [];
    
            // Prepare notification messages
            const userMessages = userFcmTokens.map(token => ({
                token: token.token,
                notification: {
                    title: 'Booking Confirmation',
                    body: `Your booking with ID ${bookingId} has been confirmed.`
                },
                data: {
                    bookingId: bookingId.toString(),
                    vehicleName: vehicle.name,
                    screen:'BookingDetailsScreen',
                    vehicleId: vehicle.id.toString()
                }
            }));
    
            const hostMessages = hostFcmTokens.map(token => ({
                token: token.token,
                notification: {
                    title: 'New Booking Alert',
                    body: `A new booking  has been made for your vehicle ${vehicle.vehicleName}.`
                },
                data: {
                    bookingId: booking.id.toString(),
                    vehicleId: vehicle.id.toString(),
                    screen:'HostBookingInfo',
                    vehicleName: vehicle.vehicleName ? vehicle.vehicleName : 'Not Set'
                }
            }));
    
            // Send notifications to user devices
            // for (const message of userMessages) {
            //     try {
            //         const response = await adminMessaging.send(message);
            //         console.log('User notification sent successfully:', response);
            //     } catch (error) {
            //         console.log('Error sending user notification:', error);
            //     }
            // }
    
            // Send notifications to host devices
            for (const message of hostMessages) {
                try {
                    const response = await adminMessaging.send(message);
                    console.log('Host notification sent successfully:', response);
                } catch (error) {
                    console.log('Error sending host notification:', error);
                }
            }
            return {message:'Notification sent successfully',status:'SUCCESS'};
        } catch (error) {
            throw new CustomError(error.message,400);    
        }
    }


    const sendBookingStartNotification = async ({bookingId}) => {

        try 
        {
            let booking = await Booking.findOne({where:{bookingId:bookingId}});
            let vehicle = await Vehicle.findByPk(booking.vehicleId);
            let user = await User.findByPk(booking.userId);

            const userFcmTokens = await FcmToken.findAll({ where: { userId: user.id } });
    
            // Prepare notification messages
            const userMessages = userFcmTokens.map(token => ({
                token: token.token,
                notification: {
                    title: 'Booking Confirmation',
                    body: `Your booking with ID ${bookingId} has been confirmed.`
                },
                data: {
                    bookingId: booking.id.toString(),
                    vehicleName: vehicle.vehicleName,
                    screen:'RideInfo',
                    vehicleId: vehicle.id.toString()
                }
            }));

            for (const message of userMessages) {
                const response = await adminMessaging.send(message);
                console.log('User notification sent successfully:', response);
            }

        } catch (error) 
        {
            console.log('error in sendBookingStartNotification',error);
            throw new CustomError(error.message,400);    
        }
    }



module.exports.sendBookingConfirmationNotification = sendBookingConfirmationNotification;
module.exports.sendBookingStartNotification = sendBookingStartNotification;
module.exports.loadNotificationListeners = (emitter) => {
    emitter.on('bookingConfirmed', sendBookingConfirmationNotification);
    emitter.on('bookingStarted', sendBookingStartNotification);
}
const FcmToken = require('../models/fcmTokens');
const { CustomError } = require("../middlewares/error");
const User = require("../models/user");
// const admin = require('firebase-admin');
const adminMessaging  = require('../helper/adminMessaging');
const Booking = require('../models/booking');
const { Op } = require('sequelize');

const MAX_DEVICES = 5; // Limit per user

const saveFcmToken = async (data, userId) => {
    const transaction = await FcmToken.sequelize.transaction();
    try {
        const { token, device } = data;

        if (!token) throw new CustomError('Token is required', 400, 'FAILED_TO_UPDATE');

        const user = await User.findOne({ where: { id: userId } });

        if (!user) {
            throw new CustomError('User not found', 404, 'FAILED_TO_UPDATE');
        }

        // Check if the token already exists for the user
        const existingToken = await FcmToken.findOne({
            where: { userId: userId, token: token },
            transaction
        });

        if (existingToken) {
            await transaction.commit();
            return { message: "Token already exists", status: 'SUCCESS' };
        }

        // Retrieve all tokens for the user
        const fcmTokens = await FcmToken.findAll({ 
            where: { userId: userId },
            order: [['updatedAt', 'ASC']],
            transaction
        });

        // Check if the limit is exceeded
        if (fcmTokens.length >= MAX_DEVICES) {
            const oldestToken = fcmTokens[0];
            await FcmToken.destroy({ where: { id: oldestToken.id }, transaction });
        }

        // Add the new token
        await FcmToken.create({ userId, token, device, updatedAt: new Date() }, { transaction });

        await transaction.commit();
        return { message: "Token stored successfully", status: 'SUCCESS' };
    } catch (error) {
        await transaction.rollback();
        console.log(error);
        throw new CustomError({ message: error.message, status: 'FAILED TO UPDATE' });
    }
};




const sendNotification = async (data, userIds) => {
    const users = await User.findAll({ where: { id: { [Op.in]: userIds } } });
    if (!users) {
        throw new CustomError('User not found', 404, 'FAILED_TO_UPDATE');
    }
    const fcmTokens = await FcmToken.findAll();

    if (fcmTokens.length > 0) {
    

    const messages = fcmTokens.map(token => ({
        token: token.token,
        notification: {
            title: data.title,
            body: data.body
        },
        data: data.payload
    }));

    try {
        const response = await adminMessaging.send(messages[0]);
        console.log('Notification sent successfully:', response);
    } catch (error) {
        console.log('Error sending notification:', error);
        // throw new CustomError('Failed to send notification', 500, 'FAILED_TO_UPDATE');
    }
}
}

module.exports = {saveFcmToken,sendNotification}
const FcmToken = require('../models/fcmTokens');
const FcmService = require('../services/fcmService');

const saveFcmToken = async (req,res)=>{
    try
    {
        let response = await FcmService.saveFcmToken(req.body,req.userId);
        res.status(200).json(response);
    }
    catch(error)
    {
        console.log(error);
        res.status(500).json(error);
    }
}
module.exports = {saveFcmToken}
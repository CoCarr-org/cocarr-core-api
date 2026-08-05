const express = require('express');
const router = express.Router();
const protectionPlanController = require('../controllers/protectionplanController');
const { authenticateAdmin } = require('../middlewares/authMiddleware');

router.get('',authenticateAdmin, protectionPlanController.getAllProtectionPlans);
router.get('/active', protectionPlanController.getActiveProtectionPlan);
router.post('', protectionPlanController.createProtectionPlan);
router.put('/:id', protectionPlanController.updateProtectionPlan);
router.delete('/:id', protectionPlanController.deleteProtectionPlan);

module.exports = router;

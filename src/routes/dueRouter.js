const express = require('express');
const router = express.Router();
const dueController = require('../controllers/dueController');
const { authenticateUser, authenticateAdmin } = require('../middlewares/authMiddleware');
router.get('/user',authenticateUser, dueController.getDueByUser);
router.get('/',authenticateAdmin, dueController.getAllDues);
router.get('/:id',authenticateAdmin, dueController.getDueById);
router.post('/confirm',authenticateUser, dueController.confirmDue);
router.post('/cancel/:id',authenticateAdmin,dueController.cancelDue)
router.put('/:id',dueController.updateDue)
router.post('/',authenticateAdmin, dueController.createDue);
router.post('/initiate/:id',authenticateUser, dueController.initiateDue);
router.delete('/',authenticateAdmin, dueController.deleteDue);

module.exports = router;

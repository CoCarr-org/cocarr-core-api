const membershipTypeService = require('../services/membershipTypeService');


  async function updateMembership(req, res) {
    const transactionData = req.body;
    try {
      const newTransaction = await membershipTypeService.updateMembership(transactionData);
      res.status(201).json(newTransaction);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }


  async function getMembershipInfo(req, res) {
    try {
      const membershipInfo = await membershipTypeService.getMembershipInfo();
      res.status(200).json(membershipInfo);
    } catch (error) {
        console.log(error)
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

async function getAllMembership(req, res) {
  try {
    const {sort,offset,limit,filter,search} = req.query;
    const membership = await membershipTypeService.getAllMembership({sort,offset,limit,filter,search});
    res.status(200).json(membership);
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports = {updateMembership,getMembershipInfo,getAllMembership}

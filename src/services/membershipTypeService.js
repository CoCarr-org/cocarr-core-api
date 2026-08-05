// membershipService.js
const MembershipType = require('../models/membershiptype');

const validateMembershipData = (membershipData) => {
  let { membershipName, membershipAmount, membershipOfferAmount, membershipRideOffer, membershipOfferMax, status } = membershipData;

  // Check if all required fields are present
  if (!membershipName || !membershipAmount || typeof parseFloat(membershipAmount) !== 'number' || isNaN(parseFloat(membershipAmount))) {
    throw new Error('Invalid membership data: membershipName and membershipAmount are required and must be numbers.');
  }

  if(isNaN(parseFloat(membershipOfferAmount))) membershipOfferAmount = null; 
  if(isNaN(parseFloat(membershipOfferMax))) membershipOfferMax = null; 
  if(isNaN(parseFloat(membershipRideOffer))) membershipRideOffer = null; 

  // Validate other fields as needed

  return {
    membershipName,
    membershipAmount,
    membershipOfferAmount,
    membershipRideOffer,
    membershipOfferMax,
    status
  };
};

// Service function to update or create the membership details
const updateMembership = async (membershipData) => {
  try {
    const validatedData = validateMembershipData(membershipData);

    // Retrieve the existing membership record
    let existingMembership = await MembershipType.findOne();

    // If membership doesn't exist, create a new one
    if (!existingMembership) {
      existingMembership = await MembershipType.create(validatedData);
      return existingMembership;
    }
    // Update the membership details
    Object.assign(existingMembership, validatedData);

    // Save the updated membership record
    await existingMembership.save();

    return existingMembership;
  } catch (error) {
    throw error;
  }
};

const getMembershipInfo = async () => {
  try {

    // Retrieve the existing membership record
    let existingMembership = await MembershipType.findOne({where:{status:1}});

    return existingMembership;
  } catch (error) {
    throw error;
  }
};

const getAllMembership = async ({sort='',offset=0,limit=10,filter,search}) => {
  try {
    let order;
    if(sort) {
      if (sort.startsWith('-')) {
        order = [[sort.substring(1), 'DESC']];
      } else {
        order = [[sort, 'ASC']];
      }
    }
    const {count,rows} = await MembershipType.findAndCountAll({where:filter,order:order,offset:parseInt(offset),limit:parseInt(limit),search:search});
    return {totalCount:count,data:rows};
  } catch (error) {
    throw error;
  }
}
// Seeds one membership type if none exists.
//
// Config, like the protection plan, and nothing else creates it. Unlike the
// protection plan this is not a hard blocker — booking works without it — but
// the Membership screens on web and mobile render an empty list until a type
// exists, which reads as a broken page rather than an unconfigured one.
//
// Placeholder amounts in rupees; an admin edits these in Configurations →
// Membership Types.
async function addDefaultMembershipType() {
  const existing = await MembershipType.findOne();
  if (existing) return existing;

  return MembershipType.create({
    membershipName: 'Cocarr Premium',
    membershipAmount: 2999,
    membershipOfferAmount: 1999,
    // Percentage off each ride, capped by membershipOfferMax.
    membershipRideOffer: 10,
    membershipOfferMax: 1000,
    status: true,
  });
}

module.exports = {updateMembership,getMembershipInfo,getAllMembership,addDefaultMembershipType}

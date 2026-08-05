const { CustomError } = require('../middlewares/error');
const RazorpayInstance = require('../helper/payment');

/**
 * Creates a Razorpay linked account with Route configuration
 * 
 * This function follows the complete Razorpay Route setup flow:
 * 1. Creates a Linked Account - Main account for the host/vendor
 * 2. Creates a Stakeholder - Represents the beneficial owner
 * 3. Creates Product Configuration - Enables Route product
 * 4. Updates Product Configuration - Adds bank settlement details
 * 
 * The bank account number is sent to Razorpay but NOT stored in our database.
 * Only the last 4 digits are stored locally for reference.
 * 
 * @param {Object} hostData - Host information (id, userId, email, contactNumber, etc.)
 * @param {Object} bankData - Bank account details from KYC verification
 * @param {string} accountNumber - Full bank account number (sent to Razorpay only)
 * @param {string} ifscCode - IFSC code
 * @returns {Object} - Contains linkedAccountId, stakeholderId, productConfigId, status
 */
const createRazorpayLinkedAccount = async (hostData, bankData, accountNumber, ifscCode) => {
  try {
    // Step 1: Create Linked Account
    // Extract the 6 digit pincode from bankData.address if available
    let extractedPincode = null;
    if (bankData.ifsc_details.address) {
      const match = bankData.ifsc_details.address.match(/\b\d{6}\b/);
      if (match && match[0]) {
        extractedPincode = match[0];
      }
    }

    // Handle street1/street2 max 100 character logic
    let addressRaw = bankData.ifsc_details.address || 'Not provided';
    let street1, street2;
    if (addressRaw.length > 100) {
      street1 = addressRaw.slice(0, 100);
      street2 = addressRaw.slice(100); // Remainder goes to street2
    } else {
      street1 = addressRaw;
      street2 = 'Not provided';
    }

    // Generate a random 16 digit code
    function generate16DigitCode() {
      let result = '';
      for (let i = 0; i < 16; i++) {
        result += Math.floor(Math.random() * 10).toString();
      }
      return result;
    }
    const randomCode = generate16DigitCode();

    const linkedAccountData = {
      email: hostData.email,
      phone: hostData.contactNumber,
      type: 'route',
      reference_id: `${randomCode}`,
      legal_business_name: bankData.name_at_bank,
      business_type: 'individual',
      contact_name: hostData.legal_business_name,
      profile: {
        category: 'transport',
        subcategory: 'automobile_rentals',
        addresses: {
          registered: {
            street1: street1,
            street2: street2,
            city: bankData.city,
            state: bankData.ifsc_details.state,
            postal_code: extractedPincode || bankData.ifsc_details.postal_code,
            country: 'IN'
          }
        }
      },
      legal_info: {
        pan: hostData.panNumber || 'AVOJB1111K'
        // gst: hostData.gstNumber || 'AVOJB1111K'
      },
      notes: {
        hostId: hostData.id,
        userId: hostData.userId
      }
    };

    let linkedAccount;
    try {
      linkedAccount = await RazorpayInstance.accounts.create(linkedAccountData);
      console.log('Linked account created:', linkedAccount.id);
    } catch (error) {
      console.error('Razorpay linked account creation error:', error);
      throw new CustomError('Failed to create Razorpay linked account. Please try again.', 500);
    }

    // Step 2: Create Stakeholder
    const stakeholderData = {
      name: bankData.name_at_bank,
      email: hostData.email,
      // addresses: {
      //   residential: {
      //     street: street1,
      //     // street2: street2,
      //     city: bankData.city || 'Not provided',
      //     state: bankData.ifsc_details.state,
      //     postal_code: extractedPincode || bankData.ifsc_details.postal_code,
      //     country: 'IN'
      //   }
      // },
      // kyc: {
      //   pan: hostData.panNumber || 'AVOJB1111K'
      //   // gst: hostData.gstNumber || 'AVOJB1111K'
      // },
      notes: {
        hostId: hostData.id
      }
    };

    let stakeholder;
    try {
      stakeholder = await RazorpayInstance.stakeholders.create(linkedAccount.id, stakeholderData);
      console.log('Stakeholder created:', stakeholder.id);
    } catch (error) {
      console.error('Razorpay stakeholder creation error:', error);
      throw new CustomError('Failed to create stakeholder account. Please try again.', 500);
    }

    // Step 3: Create Product Configuration for Route
    const productConfigData = {
      product_name: 'route',
      tnc_accepted: true
    };

    let productConfig;
    try {
      productConfig = await RazorpayInstance.products.requestProductConfiguration(linkedAccount.id, productConfigData);
      console.log('Product configuration created:', productConfig.id);
    } catch (error) {
      console.error('Razorpay product configuration error:', error);
      throw new CustomError('Failed to create product configuration. Please try again.', 500);
    }

    // Step 4: Update Product Configuration with bank details
    const productUpdateData = {
      settlements: {
        account_number: accountNumber,
        ifsc_code: ifscCode,
        beneficiary_name: bankData.name_at_bank
      },
      tnc_accepted: true
    };

    try {
      await RazorpayInstance.products.edit(linkedAccount.id, productConfig.id, productUpdateData);
      console.log('Product configuration updated with bank details');
    } catch (error) {
      console.error('Razorpay product update error:', error);
      throw new CustomError('Failed to update product configuration with bank details. Please try again.', 500);
    }

    return {
      linkedAccountId: linkedAccount.id,
      stakeholderId: stakeholder.id,
      productConfigId: productConfig.id,
      status: linkedAccount.status
    };
  } catch (error) {
    console.error('Error in createRazorpayLinkedAccount:', error);
    throw error;
  }
};

module.exports = {
  createRazorpayLinkedAccount
};


const { SendGrid } = require("../helper/sendgrid");

async function sendBookingEmail(to,templateId, dynamicTemplateData) {
  // const templateId = '';
    const msg = {
      to: to,
      from: {
        email: 'no-reply@cocarr.com',
        name: 'Cocarr'
      },
      templateId: templateId,
      dynamic_template_data: dynamicTemplateData,
    };
  
    try {
      await SendGrid.send(msg);
      console.log('Email sent successfully');
    } catch (error) {
      console.error('Error sending email:', error);
      if (error.response) {
        console.error(error.response.body);
      }
    }
  }
  

  module.exports = {sendBookingEmail}
// Campaign email: plain subject + HTML, no SendGrid dynamic template.
// sendBookingEmail above is template-based and can't carry free-form content.
// Throws on failure so the campaign sender can count it as failed — unlike
// sendBookingEmail, which deliberately swallows errors so a booking still
// succeeds if its confirmation email doesn't.
async function sendCampaignEmail(to, subject, html) {
  const { SendGrid } = require('../helper/sendgrid');
  if (!process.env.SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY is not configured');

  await SendGrid.send({
    to,
    from: { email: 'no-reply@cocarr.com', name: 'Cocarr' },
    subject,
    html,
  });
}

module.exports.sendCampaignEmail = sendCampaignEmail;

// Seed definitions for the Settings screens that need free-form config.
// Rows are created lazily on first read of a group, so a new key added here
// shows up without a migration.
const PLATFORM_SETTING_DEFAULTS = {
  general: [
    { key: 'appName', label: 'Application name', value: 'COCARR', valueType: 'text' },
    { key: 'supportEmail', label: 'Support email', value: '', valueType: 'text' },
    { key: 'supportPhone', label: 'Support phone', value: '', valueType: 'text' },
    { key: 'timezone', label: 'Time zone', value: 'Asia/Kolkata', valueType: 'text' },
    { key: 'currency', label: 'Currency', value: 'INR', valueType: 'text' },
  ],
  business: [
    { key: 'legalName', label: 'Registered company name', value: '', valueType: 'text' },
    { key: 'gstin', label: 'GSTIN', value: '', valueType: 'text' },
    { key: 'cin', label: 'CIN', value: '', valueType: 'text' },
    { key: 'registeredAddress', label: 'Registered address', value: '', valueType: 'textarea' },
    { key: 'supportHours', label: 'Support hours', value: '9am - 9pm IST', valueType: 'text' },
  ],
  payments: [
    { key: 'gateway', label: 'Active gateway', value: 'razorpay', valueType: 'text', description: 'Credentials live in env vars, not here.' },
    { key: 'settlementCycleDays', label: 'Host settlement cycle (days)', value: '7', valueType: 'number' },
    { key: 'minPayoutAmount', label: 'Minimum payout amount', value: '500', valueType: 'number' },
    { key: 'autoRefundCancellations', label: 'Auto-refund cancellations', value: 'false', valueType: 'boolean' },
  ],
  notifications: [
    { key: 'emailEnabled', label: 'Email notifications enabled', value: 'true', valueType: 'boolean' },
    { key: 'smsEnabled', label: 'SMS notifications enabled', value: 'false', valueType: 'boolean' },
    { key: 'pushEnabled', label: 'Push notifications enabled', value: 'true', valueType: 'boolean' },
    { key: 'fromEmail', label: 'From email address', value: '', valueType: 'text' },
  ],
  storage: [
    { key: 'maxUploadMb', label: 'Max upload size (MB)', value: '10', valueType: 'number' },
    { key: 'allowedTypes', label: 'Allowed file types', value: 'jpg,jpeg,png,pdf', valueType: 'text' },
    { key: 'retentionDays', label: 'Document retention (days)', value: '365', valueType: 'number' },
  ],
  tax: [
    { key: 'gstPercent', label: 'GST (%)', value: '18', valueType: 'number' },
    { key: 'gstin', label: 'Platform GSTIN', value: '', valueType: 'text' },
    { key: 'tdsPercent', label: 'TDS on host payouts (%)', value: '1', valueType: 'number' },
    { key: 'invoicePrefix', label: 'Invoice number prefix', value: 'CC-', valueType: 'text' },
    { key: 'pricesIncludeTax', label: 'Displayed prices include tax', value: 'true', valueType: 'boolean' },
  ],
  maps: [
    { key: 'provider', label: 'Maps provider', value: 'google', valueType: 'text', description: 'API key lives in GOOGLE_API_KEY, not here.' },
    { key: 'defaultLat', label: 'Default map latitude', value: '17.3850', valueType: 'text' },
    { key: 'defaultLng', label: 'Default map longitude', value: '78.4867', valueType: 'text' },
    { key: 'searchRadiusKm', label: 'Default search radius (km)', value: '20', valueType: 'number' },
  ],
  maintenance: [
    { key: 'enabled', label: 'Maintenance mode enabled', value: 'false', valueType: 'boolean', description: 'No client reads this yet — enabling it does not take the apps offline.' },
    { key: 'message', label: 'Maintenance banner message', value: 'We are performing scheduled maintenance. Please check back shortly.', valueType: 'textarea' },
    { key: 'endsAt', label: 'Expected end (ISO date)', value: '', valueType: 'text' },
  ],
};

module.exports = { PLATFORM_SETTING_DEFAULTS };

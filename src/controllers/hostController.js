const hostService = require('../services/hostService');

const createHost = async (req, res) => {
  try {
    const host = await hostService.createHost(req.body);
    res.status(201).json(host);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getAllHosts = async (req, res) => {
  try {
    const {sort,offset,limit,filter,search} = req.query
    const hosts = await hostService.getAllHosts({sort,offset,limit,filter,search});
    res.status(200).json(hosts);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const checkHost = async (req, res) => {
  try {
    const host = await hostService.checkHost(req.body);
    res.status(200).json(host);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getHost = async (req, res) => {
  try {
    const host = await hostService.getHostById(req.params.id);
    if (!host) return res.status(404).json({ message: 'Host not found' });
    res.json(host);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getHostPayoutBankAccount = async (req, res) => {
  try {
    const account = await hostService.getHostPayoutBankAccount(req.body.userId);
    res.json(account);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const createHostPayoutBankAccount = async (req, res) => {
  try {
    const account = await hostService.createHostPayoutBankAccount(req.body.userId,req.body);
    res.json(account);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getHostBookings = async (req, res) => {
  try {
    const {vehicleId,limit,sortBy,status,offset} = req.query
    const bookings = await hostService.getHostBookings({userId:req.body.userId,vehicleId,limit,sortBy,status,offset});
    res.json(bookings);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const startBooking = async (req, res) => {
  try {
    const booking = await hostService.startBooking(req.params.id, req.body);
    res.status(200).json(booking);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const endBooking = async (req, res) => {
  try {
    const booking = await hostService.endBooking(req.params.id, req.body);
    res.status(200).json(booking);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const createHostReview = async (req, res) => {
  try {
    const hostReview = await hostService.createHostReview(req.params.id, req.body);
    res.status(200).json(hostReview);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const cancelBooking = async (req, res) => {
  try {
    const booking = await hostService.cancelBooking(req.params.id, req.body);
    res.status(200).json(booking);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getHostBookingById = async (req, res) => {
  try {
    const booking = await hostService.getHostBookingById(req.params.id);
    res.json(booking);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Verifies a registration number against the RC records before the host
// creates the car, so the owner/vehicle details can be confirmed up front.
const verifyVehicle = async (req, res) => {
  try {
    const result = await hostService.verifyVehicleNumber({ vehicleNumber: req.body.vehicleNumber });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
};

// Vehicle onboarding step 1 — RC card image → OCR → RC lookup. Returns the
// details used to pre-fill step 2 (multipart upload, field name "rc").
const onboardVehicleFromRc = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'RC image is required' });
    const result = await hostService.onboardVehicleFromRc({
      userId: req.body.userId,
      fileBuffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
};

// Single-shot listing from the wizard's review step — nothing is written until
// the host confirms.
const createVehicleListing = async (req, res) => {
  try {
    const vehicle = await hostService.createVehicleListing(req.body);
    res.status(201).json(vehicle);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
};

const createVehicle = async (req, res) => {
  try {
    const vehicle = await hostService.createVehicle(req.body);
    res.status(201).json(vehicle);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const updateVehicle = async (req, res) => {
  try {
    const vehicle = await hostService.updateVehicle({vehicleId:req.params.id,userId:req.body.userId,data:req.body});
    res.status(200).json(vehicle);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getMyVehicles = async (req, res) => {
  try {
    const vehicles = await hostService.getMyVehicles(req.body.userId);
    res.json(vehicles);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getMyVehicleById = async (req, res) => {
  try {
    const vehicle = await hostService.getMyVehicleById({userId:req.body.userId,vehicleId:req.params.id});
    res.json(vehicle);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getSchedules = async (req, res) => {
  try {
    const {vehicleId,sort,offset,limit,status} = req.query
    const availability = await hostService.getSchedules({userId:req.body.userId,vehicleId,sort,offset,limit,status});
    res.json(availability);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getScheduleById = async (req, res) => {
  try {
    const schedule = await hostService.getScheduleById(req.params.id);
    res.json(schedule);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const createSchedule = async (req, res) => {
  try {
    const schedule = await hostService.createSchedule(req.body);
    res.status(201).json(schedule);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const createScheduleBlock = async (req, res) => {
  try {
    const scheduleBlock = await hostService.createScheduleBlock(req.body);
    res.status(201).json(scheduleBlock);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const deleteScheduleBlock = async (req, res) => {
  try {
    await hostService.deleteScheduleBlock(req.params.id);
    res.status(200).json({ message: 'Schedule block deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const deleteSchedule = async (req, res) => {
  try {
    await hostService.deleteSchedule(req.params.id);
    res.status(200).json({ message: 'Schedule deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getHostCommissions = async (req, res) => {
  try {
    const commissions = await hostService.getHostCommissions(req.body.userId);
    res.json(commissions);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getActiveHostCommission = async (req, res) => {
  try {
    const commission = await hostService.getActiveHostCommission(req.body.userId);
    res.json(commission);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const addHostCommission = async (req, res) => {
  try {
    const commission = await hostService.addHostCommission(req.body.userId, req.body);
    res.status(201).json(commission);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const updateHostCommission = async (req, res) => {
  try {
    const commission = await hostService.updateHostCommission(req.params.id, req.body, req.body.userId);
    res.json(commission);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  createHost,
  checkHost,
  getHost,
  getAllHosts,
  getHostPayoutBankAccount,
  createHostPayoutBankAccount,
  getHostBookings,
  startBooking,
  cancelBooking,
  createHostReview,
  endBooking,
  createVehicle,
  createVehicleListing,
  onboardVehicleFromRc,
  verifyVehicle,
  updateVehicle,
  getMyVehicles,
  getMyVehicleById,
  getSchedules,
  getScheduleById,
  createSchedule,
  createScheduleBlock,
  getHostBookingById,
  deleteScheduleBlock,
  deleteSchedule,
  getHostCommissions,
  getActiveHostCommission,
  addHostCommission,
  updateHostCommission
}
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const MatchingService = require('./services/MatchingService');
const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const User = require('./models/User');
const Driver = require('./models/Driver');
const Ride = require('./models/Ride');
const Pool = require('./models/Pool');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('🍃 Connected to MongoDB'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Security Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Driver locations cache for real-time tracking
let driverLocations = {};

// Initialize matching service
const matchingService = new MatchingService();

// Helper functions
const generateId = () => Math.random().toString(36).substr(2, 9);
const generateToken = (userId) => 'token_' + userId;

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }
  
  // In production, verify JWT token
  const userId = token.replace('token_', '');
  req.userId = userId;
  next();
};

// Routes

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

// User Authentication
app.post('/api/v1/auth/register', [
  body('name').notEmpty().trim(),
  body('phone').isMobilePhone(),
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('gender').isIn(['male', 'female', 'other'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    }
    
    const { name, phone, email, password, gender } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ phone }, { email }] });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'User already exists' });
    }
    
    const user = new User({
      name,
      phone,
      email,
      gender,
      rating: 5.0
    });
    
    await user.save();
    const token = generateToken(user._id);
    
    res.status(201).json({
      success: true,
      data: { user, token },
      message: 'User registered successfully'
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// Simple login with name only (for testing)
app.post('/api/v1/auth/login', [
  body('name').notEmpty().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    
    const { name } = req.body;
    
    // Find existing user or create new one
    let user = await User.findOne({ name });
    
    if (!user) {
      user = new User({
        name,
        phone: '+91' + Math.floor(Math.random() * 9000000000 + 1000000000),
        email: name.toLowerCase().replace(/\s+/g, '') + '@test.com',
        gender: 'other',
        rating: 5.0
      });
      await user.save();
    }
    
    const token = generateToken(user._id);
    
    res.json({
      success: true,
      data: { user, token },
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// Ride Management
app.post('/api/v1/rides', authenticateToken, [
  body('pickup_location.name').notEmpty(),
  body('pickup_location.latitude').isFloat(),
  body('pickup_location.longitude').isFloat(),
  body('destination_location.name').notEmpty(),
  body('destination_location.latitude').isFloat(),
  body('destination_location.longitude').isFloat(),
  body('departure_time').notEmpty(),
  body('estimated_fare').isInt({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Validation failed' });
    }
    
    const {
      pickup_location,
      destination_location,
      departure_time,
      estimated_fare,
      allow_pooling,
      female_only,
      passenger_count = 1
    } = req.body;
    
    const ride = new Ride({
      user_id: req.userId,
      pickup_location,
      destination_location,
      departure_time,
      estimated_fare,
      allow_pooling: allow_pooling || false,
      female_only: female_only || false,
      passenger_count,
      status: 'PENDING',
      driver: null,
      pool_passengers: []
    });
    
    await ride.save();
  
  // Use matching service to find and assign driver
  setTimeout(async () => {
    try {
      // Get available drivers
      const availableDrivers = await Driver.find({ status: 'online', current_ride: null });
      
      if (availableDrivers.length === 0) {
        ride.status = 'NO_DRIVERS_AVAILABLE';
        await ride.save();
        io.emit('ride_update', { ride_id: ride._id, ride });
        return;
      }
      
      // Assign optimal driver
      const assignment = await matchingService.assignOptimalDriver(ride, availableDrivers);
      
      if (assignment) {
        const driver = {
          id: assignment.driver.id,
          name: assignment.driver.name,
          phone: assignment.driver.phone || '+91 9876543210',
          rating: assignment.driver.rating,
          vehicle: assignment.driver.vehicle,
          current_location: assignment.driver.location
        };
        
        ride.driver = driver;
        ride.status = 'DRIVER_ASSIGNED';
        ride.estimated_arrival = assignment.estimatedArrival;
        
        // Store driver location for tracking
        driverLocations[driver.id] = {
          latitude: driver.current_location.latitude,
          longitude: driver.current_location.longitude,
          lastUpdated: new Date().toISOString(),
          bearing: 0,
          status: 'en_route'
        };
        
        // Mark driver as busy
        await Driver.findByIdAndUpdate(driver.id, { current_ride: ride._id });
        await ride.save();
        
        // Emit real-time update
        io.emit('ride_update', { ride_id: ride._id, ride });
      }
    } catch (error) {
      console.error('Error assigning driver:', error);
      ride.status = 'NO_DRIVERS_AVAILABLE';
      await ride.save();
      io.emit('ride_update', { ride_id: ride._id, ride });
    }
  }, 2000);
  
    res.status(201).json({
      success: true,
      data: ride,
      message: 'Ride booked successfully'
    });
  } catch (error) {
    console.error('Error creating ride:', error);
    res.status(500).json({ success: false, error: 'Failed to create ride' });
  }
});

app.get('/api/v1/rides/:rideId', authenticateToken, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.rideId);
    
    if (!ride) {
      return res.status(404).json({ success: false, error: 'Ride not found' });
    }
    
    if (ride.user_id.toString() !== req.userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    res.json({
      success: true,
      data: ride
    });
  } catch (error) {
    console.error('Error fetching ride:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch ride' });
  }
});

// Pool Management
app.get('/api/v1/pools/available', authenticateToken, async (req, res) => {
  const { pickup_lat, pickup_lng, destination_lat, destination_lng, departure_time } = req.query;
  
  try {
    // Create ride request object for matching
    const rideRequest = {
      user_id: req.userId,
      user_gender: 'male', // Get from user profile
      pickup_location: {
        latitude: parseFloat(pickup_lat),
        longitude: parseFloat(pickup_lng),
        name: 'User Location'
      },
      destination_location: {
        latitude: parseFloat(destination_lat),
        longitude: parseFloat(destination_lng),
        name: 'User Destination'
      },
      departure_time,
      estimated_fare: 300, // Calculate based on distance
      female_only: false // Get from request
    };
    
    // Get existing rides that allow pooling
    const existingRides = await Ride.find({
      allow_pooling: true,
      status: 'DRIVER_ASSIGNED',
      driver: { $ne: null },
      $expr: { $lt: [{ $size: { $ifNull: ['$pool_passengers', []] } }, 3] }
    });
    
    // Find compatible pools using matching service
    const availablePools = await matchingService.findAvailablePools(rideRequest, existingRides);
    
    // Return actual available pools only
    
    res.json({
      success: true,
      data: availablePools,
      message: `Found ${availablePools.length} compatible pools`,
      metadata: {
        searchRadius: '10 km',
        maxDetour: '5 km',
        totalRidesChecked: existingRides.length
      }
    });
    
  } catch (error) {
    console.error('Error finding available pools:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to find available pools',
      message: error.message
    });
  }
});

app.post('/api/v1/pools/:poolId/join', authenticateToken, async (req, res) => {
  const { poolId } = req.params;
  const { pickup_location, destination_location, departure_time } = req.body;
  
  const joinRequest = {
    requestId: generateId(),
    poolId,
    userId: req.userId,
    pickup_location,
    destination_location,
    departure_time,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };
  
  try {
    // Store the request for driver to respond
    const poolRequest = new Pool(joinRequest);
    await poolRequest.save();
    
    // Emit to driver for real-time response
    io.emit('pool_request', joinRequest);
    
    res.json({
      success: true,
      data: joinRequest,
      message: 'Pool join request sent'
    });
  } catch (error) {
    console.error('Error creating pool request:', error);
    res.status(500).json({ success: false, error: 'Failed to create pool request' });
  }
});

// Driver Location Tracking
app.get('/api/v1/rides/:rideId/driver-location', authenticateToken, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.rideId);
    
    if (!ride || !ride.driver) {
      return res.status(404).json({ success: false, error: 'Driver location not available' });
    }
  
  let location = driverLocations[ride.driver.id];
  
  if (location) {
    // Simulate movement
    location.latitude += (Math.random() - 0.5) * 0.001;
    location.longitude += (Math.random() - 0.5) * 0.001;
    location.lastUpdated = new Date().toISOString();
    location.bearing = Math.random() * 360;
  }
  
    res.json({
      success: true,
      data: location || {
        latitude: ride.pickup_location.latitude + (Math.random() - 0.5) * 0.01,
        longitude: ride.pickup_location.longitude + (Math.random() - 0.5) * 0.01,
        lastUpdated: new Date().toISOString(),
        bearing: 0,
        status: 'en_route'
      }
    });
  } catch (error) {
    console.error('Error fetching driver location:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch driver location' });
  }
});

// Driver APIs (for driver app)
app.put('/api/v1/drivers/status', authenticateToken, async (req, res) => {
  try {
    const { status, latitude, longitude } = req.body;
    
    const driver = await Driver.findById(req.userId);
    if (!driver) {
      return res.status(404).json({ success: false, error: 'Driver not found' });
    }
    
    driver.status = status;
    driver.location = { latitude, longitude, lastUpdated: new Date() };
    await driver.save();
    
    res.json({
      success: true,
      data: driver,
      message: `Driver status updated to ${status}`
    });
  } catch (error) {
    console.error('Error updating driver status:', error);
    res.status(500).json({ success: false, error: 'Failed to update driver status' });
  }
});

// WebSocket for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join_ride', (rideId) => {
    socket.join(rideId);
    console.log(`Client joined ride: ${rideId}`);
  });
  
  socket.on('driver_location_update', (data) => {
    const { rideId, latitude, longitude, bearing } = data;
    
    // Broadcast to all passengers in this ride
    socket.to(rideId).emit('driver_location', {
      latitude,
      longitude,
      bearing,
      timestamp: new Date().toISOString()
    });
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

const PORT = process.env.PORT || 8080;

http.listen(PORT, () => {
  console.log(`🚗 PoolRide Backend Server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/v1/health`);
  console.log(`📚 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
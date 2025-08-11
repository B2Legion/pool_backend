const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  vehicle: {
    make: String,
    model: String,
    year: Number,
    plateNumber: String,
    color: String
  },
  rating: {
    type: Number,
    default: 5.0,
    min: 1,
    max: 5
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'busy'],
    default: 'offline'
  },
  location: {
    latitude: Number,
    longitude: Number,
    lastUpdated: Date
  },
  current_ride: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Driver', driverSchema);
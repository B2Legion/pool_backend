const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  pickup_location: {
    name: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true }
  },
  destination_location: {
    name: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true }
  },
  departure_time: {
    type: String,
    required: true
  },
  estimated_fare: {
    type: Number,
    required: true
  },
  allow_pooling: {
    type: Boolean,
    default: false
  },
  female_only: {
    type: Boolean,
    default: false
  },
  passenger_count: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: ['PENDING', 'DRIVER_ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_DRIVERS_AVAILABLE'],
    default: 'PENDING'
  },
  driver: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
    name: String,
    phone: String,
    rating: Number,
    vehicle: {
      make: String,
      model: String,
      plateNumber: String,
      color: String
    },
    current_location: {
      latitude: Number,
      longitude: Number
    }
  },
  pool_passengers: [{
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    pickup_location: {
      name: String,
      latitude: Number,
      longitude: Number
    },
    destination_location: {
      name: String,
      latitude: Number,
      longitude: Number
    },
    status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED'], default: 'PENDING' }
  }],
  estimated_arrival: Date,
  created_at: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Ride', rideSchema);
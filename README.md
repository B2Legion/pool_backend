# PoolRide Backend API

Node.js backend for the PoolRide carpooling application.

## Features

- User authentication and management
- Driver registration and status management  
- Ride booking and matching
- Pool ride requests and management
- Real-time location tracking
- WebSocket support for live updates

## Environment Variables

Create a `.env` file with the following variables:

```env
MONGODB_URI=your_mongodb_connection_string
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
JWT_SECRET=your_jwt_secret_key
NODE_ENV=production
PORT=8080
```

## Railway Deployment

1. Connect your GitHub repository to Railway
2. Set the following environment variables in Railway:
   - `MONGODB_URI` - Your MongoDB connection string (use Railway's MongoDB addon)
   - `GOOGLE_MAPS_API_KEY` - Your Google Maps API key
   - `JWT_SECRET` - A secure random string for JWT signing
   - `NODE_ENV=production`

3. Railway will automatically deploy from your `main` branch

## API Endpoints

### Authentication
- `POST /api/v1/auth/login` - User/Driver login
- `POST /api/v1/auth/register` - User registration

### Driver Management
- `POST /api/v1/drivers/register` - Driver registration
- `GET /api/v1/drivers/profile` - Get driver profile
- `PUT /api/v1/drivers/status` - Update driver status and location

### Ride Management
- `POST /api/v1/rides` - Book a new ride
- `GET /api/v1/rides/pending` - Get pending rides (for drivers)
- `PUT /api/v1/rides/:id/accept` - Accept a ride (driver)
- `PUT /api/v1/rides/:id/reject` - Reject a ride (driver)
- `PUT /api/v1/rides/:id/start` - Start a ride (driver)
- `PUT /api/v1/rides/:id/complete` - Complete a ride (driver)

### Pool Management
- `GET /api/v1/pools/available` - Get available pools
- `POST /api/v1/pools/:id/join` - Join a pool
- `GET /api/v1/pools/requests` - Get pool requests (driver)
- `PUT /api/v1/pools/requests/:id/accept` - Accept pool request (driver)
- `PUT /api/v1/pools/requests/:id/reject` - Reject pool request (driver)

## Security Features

- JWT token authentication
- Request validation with express-validator
- Rate limiting
- CORS enabled
- Helmet for security headers
- Environment variable protection

## Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in your values
4. Start the server: `npm start`

The server will run on http://localhost:8080

## Health Check

`GET /api/v1/health` - Returns server status
const axios = require('axios');

class MatchingService {
    constructor() {
        this.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
        this.MAX_DETOUR_DISTANCE_KM = 5; // Maximum detour allowed
        this.MAX_DETOUR_TIME_MINUTES = 15; // Maximum additional time
        this.MAX_PICKUP_DISTANCE_KM = 3; // Maximum distance to pickup new passenger
        this.MAX_POOL_SIZE = 4; // Maximum passengers per ride
    }

    /**
     * Find available pools for a new ride request
     * @param {Object} rideRequest - New ride request details
     * @param {Array} existingRides - Current active rides allowing pooling
     * @returns {Array} - Sorted list of compatible pool options
     */
    async findAvailablePools(rideRequest, existingRides) {
        const compatiblePools = [];
        
        for (const existingRide of existingRides) {
            // Skip if not allowing pooling or pool is full
            if (!existingRide.allow_pooling || 
                (existingRide.pool_passengers && existingRide.pool_passengers.length >= this.MAX_POOL_SIZE - 1)) {
                continue;
            }

            // Skip if gender preference doesn't match
            if (existingRide.female_only && rideRequest.user_gender !== 'female') {
                continue;
            }
            if (rideRequest.female_only && existingRide.user_gender !== 'female') {
                continue;
            }

            // Calculate route compatibility
            const compatibility = await this.calculateRouteCompatibility(
                rideRequest,
                existingRide
            );

            if (compatibility.isCompatible) {
                compatiblePools.push({
                    poolId: existingRide.ride_id,
                    driverId: existingRide.driver.id,
                    driverName: existingRide.driver.name,
                    driverRating: existingRide.driver.rating,
                    vehicle: existingRide.driver.vehicle,
                    currentPickup: existingRide.pickup_location,
                    currentDestination: existingRide.destination_location,
                    currentPassenger: existingRide.user_name,
                    fareShare: this.calculateFareShare(rideRequest, existingRide, compatibility),
                    estimatedPickupTime: compatibility.pickupTime,
                    route: compatibility.routeDescription,
                    detourDistance: compatibility.detourDistance,
                    detourTime: compatibility.detourTime,
                    compatibilityScore: compatibility.score,
                    savings: compatibility.savings
                });
            }
        }

        // Sort by compatibility score (best matches first)
        return compatiblePools.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
    }

    /**
     * Calculate if two rides are compatible for pooling
     */
    async calculateRouteCompatibility(newRide, existingRide) {
        try {
            // Get route details from Google Maps
            const originalRoute = await this.getRouteDetails(
                existingRide.pickup_location,
                existingRide.destination_location
            );

            // Calculate route with new passenger pickups/drops
            const pooledRoute = await this.getOptimalPoolRoute(newRide, existingRide);

            const detourDistance = pooledRoute.distance - originalRoute.distance;
            const detourTime = pooledRoute.duration - originalRoute.duration;
            
            // Check if within acceptable limits
            const isCompatible = 
                detourDistance <= this.MAX_DETOUR_DISTANCE_KM &&
                detourTime <= this.MAX_DETOUR_TIME_MINUTES &&
                pooledRoute.pickupDistance <= this.MAX_PICKUP_DISTANCE_KM;

            // Calculate compatibility score (0-100)
            const score = this.calculateCompatibilityScore(
                detourDistance,
                detourTime,
                pooledRoute.pickupDistance,
                originalRoute,
                pooledRoute
            );

            return {
                isCompatible,
                detourDistance: Math.round(detourDistance * 100) / 100,
                detourTime: Math.round(detourTime),
                pickupTime: `${Math.round(pooledRoute.pickupTime)} mins`,
                routeDescription: pooledRoute.description,
                score,
                savings: this.calculateSavings(newRide.estimated_fare, existingRide.estimated_fare)
            };

        } catch (error) {
            console.error('Error calculating route compatibility:', error);
            return { isCompatible: false, score: 0 };
        }
    }

    /**
     * Get optimal route for pooled ride
     */
    async getOptimalPoolRoute(newRide, existingRide) {
        // Define all waypoints
        const waypoints = [
            { location: existingRide.pickup_location, type: 'pickup', passenger: 'existing' },
            { location: newRide.pickup_location, type: 'pickup', passenger: 'new' },
            { location: existingRide.destination_location, type: 'drop', passenger: 'existing' },
            { location: newRide.destination_location, type: 'drop', passenger: 'new' }
        ];

        // Find optimal order (minimize total distance)
        const optimalOrder = await this.findOptimalWaypointOrder(waypoints);
        
        if (!optimalOrder) {
            return null;
        }
        
        // Calculate route with optimal order
        const totalDistance = this.calculateTotalRouteDistance(optimalOrder);
        const totalDuration = totalDistance * 2; // 2 minutes per km estimate
        
        return {
            distance: totalDistance,
            duration: totalDuration,
            pickupDistance: this.calculateDistance(
                existingRide.pickup_location,
                newRide.pickup_location
            ),
            pickupTime: 10, // Estimate pickup time
            description: this.generateRouteDescription(optimalOrder),
            waypoints: optimalOrder
        };
    }

    /**
     * Find optimal order of waypoints to minimize travel time
     */
    async findOptimalWaypointOrder(waypoints) {
        // For simplicity, we'll use a heuristic approach
        // In production, you might want to use a more sophisticated algorithm
        
        const pickup1 = waypoints.find(w => w.passenger === 'existing' && w.type === 'pickup');
        const pickup2 = waypoints.find(w => w.passenger === 'new' && w.type === 'pickup');
        const drop1 = waypoints.find(w => w.passenger === 'existing' && w.type === 'drop');
        const drop2 = waypoints.find(w => w.passenger === 'new' && w.type === 'drop');

        // Calculate distances between points
        const distanceToNewPickup = this.calculateDistance(pickup1.location, pickup2.location);
        const distanceBetweenDrops = this.calculateDistance(drop1.location, drop2.location);

        // Determine optimal order based on geography
        let optimalOrder;
        
        if (distanceToNewPickup < 2) { // If pickups are close
            if (distanceBetweenDrops < 2) { // If drops are also close
                optimalOrder = [pickup1, pickup2, drop1, drop2]; // Sequential
            } else {
                optimalOrder = [pickup1, pickup2, drop2, drop1]; // Drop new passenger first if closer
            }
        } else {
            // Check if new pickup is on the way
            const routeDistance = this.calculateDistance(pickup1.location, drop1.location);
            const detourDistance = this.calculateDistance(pickup1.location, pickup2.location) + 
                                 this.calculateDistance(pickup2.location, drop1.location);
            
            if (detourDistance - routeDistance < 1) { // Minimal detour
                optimalOrder = [pickup1, pickup2, drop1, drop2];
            } else {
                return null; // Not compatible
            }
        }

        return optimalOrder;
    }

    /**
     * Calculate total distance for a route with waypoints
     */
    calculateTotalRouteDistance(waypoints) {
        let totalDistance = 0;
        for (let i = 0; i < waypoints.length - 1; i++) {
            totalDistance += this.calculateDistance(waypoints[i].location, waypoints[i + 1].location);
        }
        return totalDistance;
    }

    /**
     * Calculate distance between two points using Haversine formula
     */
    calculateDistance(point1, point2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRadians(point2.latitude - point1.latitude);
        const dLon = this.toRadians(point2.longitude - point1.longitude);
        const lat1 = this.toRadians(point1.latitude);
        const lat2 = this.toRadians(point2.latitude);

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        
        return R * c; // Distance in km
    }

    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Get route details from Google Maps API
     */
    async getRouteDetails(origin, destination) {
        try {
            if (this.GOOGLE_MAPS_API_KEY && this.GOOGLE_MAPS_API_KEY.length > 0) {
                const response = await axios.get(
                    'https://maps.googleapis.com/maps/api/directions/json',
                    {
                        params: {
                            origin: `${origin.latitude},${origin.longitude}`,
                            destination: `${destination.latitude},${destination.longitude}`,
                            key: this.GOOGLE_MAPS_API_KEY,
                            traffic_model: 'best_guess',
                            departure_time: 'now'
                        }
                    }
                );

                if (response.data.routes && response.data.routes.length > 0) {
                    const route = response.data.routes[0];
                    const leg = route.legs[0];
                    
                    return {
                        distance: leg.distance.value / 1000, // Convert to km
                        duration: leg.duration.value / 60, // Convert to minutes
                        distanceText: leg.distance.text,
                        durationText: leg.duration.text
                    };
                }
            }
        } catch (error) {
            console.error('Google Maps API error:', error);
        }

        // Fallback to Haversine distance if API fails or no API key
        const distance = this.calculateDistance(origin, destination);
        return {
            distance,
            duration: distance * 2, // Rough estimate: 2 minutes per km in city traffic
            distanceText: `${distance.toFixed(1)} km`,
            durationText: `${Math.round(distance * 2)} mins`
        };
    }

    /**
     * Calculate compatibility score (0-100)
     */
    calculateCompatibilityScore(detourDistance, detourTime, pickupDistance, originalRoute, pooledRoute) {
        let score = 100;

        // Penalize detours
        score -= (detourDistance / this.MAX_DETOUR_DISTANCE_KM) * 40;
        score -= (detourTime / this.MAX_DETOUR_TIME_MINUTES) * 30;
        score -= (pickupDistance / this.MAX_PICKUP_DISTANCE_KM) * 20;

        // Bonus for efficiency
        const efficiencyBonus = Math.max(0, 10 - (pooledRoute.distance / originalRoute.distance - 1) * 50);
        score += efficiencyBonus;

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    /**
     * Calculate fare share for pooled ride
     */
    calculateFareShare(newRide, existingRide, compatibility) {
        const baseFare = newRide.estimated_fare;
        const poolDiscount = 0.25; // 25% discount for pooling
        const detourPenalty = compatibility.detourDistance * 10; // ₹10 per km detour
        
        const finalFare = Math.round(baseFare * (1 - poolDiscount) + detourPenalty);
        return Math.max(finalFare, baseFare * 0.6); // Minimum 40% discount
    }

    /**
     * Calculate savings from pooling
     */
    calculateSavings(newRideFare, existingRideFare) {
        const averageFare = (newRideFare + existingRideFare) / 2;
        const pooledFare = averageFare * 0.75; // 25% discount
        return Math.round(averageFare - pooledFare);
    }

    /**
     * Generate human-readable route description
     */
    generateRouteDescription(waypoints) {
        const locations = waypoints.map(w => w.location.name);
        return `Via ${locations.slice(1, -1).join(', ')}`;
    }

    /**
     * Match drivers with ride requests
     */
    async findAvailableDrivers(rideRequest, availableDrivers) {
        const nearbyDrivers = [];

        for (const driver of availableDrivers) {
            if (driver.status !== 'online' || driver.current_ride) continue;

            const distance = this.calculateDistance(
                rideRequest.pickup_location,
                driver.location
            );

            if (distance <= 10) { // Within 10km
                nearbyDrivers.push({
                    ...driver,
                    distanceToPickup: distance,
                    estimatedArrival: Math.round(distance * 3) // 3 minutes per km
                });
            }
        }

        // Sort by distance (closest first)
        return nearbyDrivers.sort((a, b) => a.distanceToPickup - b.distanceToPickup);
    }

    /**
     * Assign driver to ride using optimal matching
     */
    async assignOptimalDriver(rideRequest, availableDrivers) {
        const nearbyDrivers = await this.findAvailableDrivers(rideRequest, availableDrivers);
        
        if (nearbyDrivers.length === 0) {
            return null;
        }

        // For now, assign the closest driver
        // In production, you might consider driver rating, acceptance rate, etc.
        const selectedDriver = nearbyDrivers[0];
        
        return {
            driver: selectedDriver,
            estimatedArrival: `${selectedDriver.estimatedArrival} minutes`,
            distance: `${selectedDriver.distanceToPickup.toFixed(1)} km away`
        };
    }
}

module.exports = MatchingService;
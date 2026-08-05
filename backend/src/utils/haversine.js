/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in meters
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c); // Distance in meters, rounded
};

/**
 * Validate if employee is within allowed radius of ATM
 * @param {number} employeeLat
 * @param {number} employeeLon
 * @param {number} atmLat
 * @param {number} atmLon
 * @param {number} maxRadius - Max allowed distance in meters (default: 20)
 * @returns {{isValid: boolean, distance: number}}
 */
export const validateGpsProximity = (
  employeeLat,
  employeeLon,
  atmLat,
  atmLon,
  maxRadius = 20,
) => {
  const distance = calculateDistance(employeeLat, employeeLon, atmLat, atmLon);
  return {
    isValid: distance <= maxRadius,
    distance,
  };
};

import { REGION_COORDINATES } from "./constants";

// Default coordinates (Atlantic Ocean) for unknown regions
const DEFAULT_COORDINATES = { latitude: 0, longitude: 0 };

/**
 * Look up approximate coordinates for a country/region name.
 * Uses a static lookup table — no external API call.
 */
export function getCoordinates(country: string): {
  latitude: number;
  longitude: number;
} {
  return REGION_COORDINATES[country] ?? DEFAULT_COORDINATES;
}

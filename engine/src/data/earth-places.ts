/**
 * Places on Earth, for reading a time zone against the country it belongs to.
 *
 * Asked for as a learning tool: spin the Earth, see which countries are in night, then check
 * the zone against the place. That needs two things the app did not have together. The civil
 * offset comes from the platform's IANA database, which is the only honest source for a rule
 * that is political and changes by decree. Where the Sun actually is comes from the engine.
 * This table is what joins them: a recognisable place, its zone, and where it sits.
 *
 * The coordinates are to a hundredth of a degree, which is about a kilometre, and they are
 * used only to work out how high the Sun is. That is a question whose answer changes over
 * hundreds of kilometres, so the precision is far beyond what it is asked to carry.
 *
 * Chosen to cover every offset in use rather than the largest cities, because the point is the
 * span. The half-hour and three-quarter-hour zones are in deliberately: Kathmandu at UTC+5:45
 * is the kind of fact that makes a child ask why, and the answer is that a time zone is a
 * decision rather than a measurement.
 */

export interface EarthPlace {
  /** IANA zone identifier. The platform resolves the offset, including summer time. */
  readonly zone: string;
  readonly city: string;
  readonly country: string;
  /** Degrees north, negative south. */
  readonly latitudeDeg: number;
  /** Degrees east, negative west. */
  readonly longitudeDeg: number;
}

export const EARTH_PLACES: readonly EarthPlace[] = [
  { zone: "Pacific/Midway", city: "Midway", country: "US Minor Outlying Islands", latitudeDeg: 28.21, longitudeDeg: -177.38 },
  { zone: "Pacific/Honolulu", city: "Honolulu", country: "United States", latitudeDeg: 21.31, longitudeDeg: -157.86 },
  { zone: "America/Anchorage", city: "Anchorage", country: "United States", latitudeDeg: 61.22, longitudeDeg: -149.90 },
  { zone: "America/Los_Angeles", city: "Los Angeles", country: "United States", latitudeDeg: 34.05, longitudeDeg: -118.24 },
  { zone: "America/Denver", city: "Denver", country: "United States", latitudeDeg: 39.74, longitudeDeg: -104.99 },
  { zone: "America/Mexico_City", city: "Mexico City", country: "Mexico", latitudeDeg: 19.43, longitudeDeg: -99.13 },
  { zone: "America/Chicago", city: "Chicago", country: "United States", latitudeDeg: 41.88, longitudeDeg: -87.63 },
  { zone: "America/New_York", city: "New York", country: "United States", latitudeDeg: 40.71, longitudeDeg: -74.01 },
  { zone: "America/Toronto", city: "Toronto", country: "Canada", latitudeDeg: 43.65, longitudeDeg: -79.38 },
  { zone: "America/Bogota", city: "Bogotá", country: "Colombia", latitudeDeg: 4.71, longitudeDeg: -74.07 },
  { zone: "America/Halifax", city: "Halifax", country: "Canada", latitudeDeg: 44.65, longitudeDeg: -63.58 },
  { zone: "America/Santiago", city: "Santiago", country: "Chile", latitudeDeg: -33.45, longitudeDeg: -70.67 },
  { zone: "America/Sao_Paulo", city: "São Paulo", country: "Brazil", latitudeDeg: -23.55, longitudeDeg: -46.63 },
  { zone: "America/Argentina/Buenos_Aires", city: "Buenos Aires", country: "Argentina", latitudeDeg: -34.60, longitudeDeg: -58.38 },
  { zone: "Atlantic/South_Georgia", city: "Grytviken", country: "South Georgia", latitudeDeg: -54.28, longitudeDeg: -36.51 },
  { zone: "Atlantic/Azores", city: "Ponta Delgada", country: "Portugal", latitudeDeg: 37.74, longitudeDeg: -25.68 },
  { zone: "Atlantic/Reykjavik", city: "Reykjavík", country: "Iceland", latitudeDeg: 64.15, longitudeDeg: -21.94 },
  { zone: "Europe/London", city: "London", country: "United Kingdom", latitudeDeg: 51.51, longitudeDeg: -0.13 },
  { zone: "Africa/Accra", city: "Accra", country: "Ghana", latitudeDeg: 5.60, longitudeDeg: -0.19 },
  { zone: "Europe/Paris", city: "Paris", country: "France", latitudeDeg: 48.86, longitudeDeg: 2.35 },
  { zone: "Europe/Madrid", city: "Madrid", country: "Spain", latitudeDeg: 40.42, longitudeDeg: -3.70 },
  { zone: "Africa/Lagos", city: "Lagos", country: "Nigeria", latitudeDeg: 6.52, longitudeDeg: 3.38 },
  { zone: "Europe/Athens", city: "Athens", country: "Greece", latitudeDeg: 37.98, longitudeDeg: 23.73 },
  { zone: "Africa/Cairo", city: "Cairo", country: "Egypt", latitudeDeg: 30.04, longitudeDeg: 31.24 },
  { zone: "Africa/Johannesburg", city: "Johannesburg", country: "South Africa", latitudeDeg: -26.20, longitudeDeg: 28.05 },
  { zone: "Europe/Moscow", city: "Moscow", country: "Russia", latitudeDeg: 55.76, longitudeDeg: 37.62 },
  { zone: "Africa/Nairobi", city: "Nairobi", country: "Kenya", latitudeDeg: -1.29, longitudeDeg: 36.82 },
  { zone: "Asia/Tehran", city: "Tehran", country: "Iran", latitudeDeg: 35.69, longitudeDeg: 51.39 },
  { zone: "Asia/Dubai", city: "Dubai", country: "United Arab Emirates", latitudeDeg: 25.20, longitudeDeg: 55.27 },
  { zone: "Asia/Kabul", city: "Kabul", country: "Afghanistan", latitudeDeg: 34.56, longitudeDeg: 69.21 },
  { zone: "Asia/Karachi", city: "Karachi", country: "Pakistan", latitudeDeg: 24.86, longitudeDeg: 67.01 },
  { zone: "Asia/Kolkata", city: "Delhi", country: "India", latitudeDeg: 28.61, longitudeDeg: 77.21 },
  { zone: "Asia/Kathmandu", city: "Kathmandu", country: "Nepal", latitudeDeg: 27.72, longitudeDeg: 85.32 },
  { zone: "Asia/Dhaka", city: "Dhaka", country: "Bangladesh", latitudeDeg: 23.81, longitudeDeg: 90.41 },
  { zone: "Asia/Yangon", city: "Yangon", country: "Myanmar", latitudeDeg: 16.87, longitudeDeg: 96.20 },
  { zone: "Asia/Bangkok", city: "Bangkok", country: "Thailand", latitudeDeg: 13.76, longitudeDeg: 100.50 },
  { zone: "Asia/Jakarta", city: "Jakarta", country: "Indonesia", latitudeDeg: -6.21, longitudeDeg: 106.85 },
  { zone: "Asia/Shanghai", city: "Beijing", country: "China", latitudeDeg: 39.90, longitudeDeg: 116.41 },
  { zone: "Asia/Singapore", city: "Singapore", country: "Singapore", latitudeDeg: 1.35, longitudeDeg: 103.82 },
  { zone: "Australia/Perth", city: "Perth", country: "Australia", latitudeDeg: -31.95, longitudeDeg: 115.86 },
  { zone: "Asia/Tokyo", city: "Tokyo", country: "Japan", latitudeDeg: 35.68, longitudeDeg: 139.69 },
  { zone: "Asia/Seoul", city: "Seoul", country: "South Korea", latitudeDeg: 37.57, longitudeDeg: 126.98 },
  { zone: "Australia/Adelaide", city: "Adelaide", country: "Australia", latitudeDeg: -34.93, longitudeDeg: 138.60 },
  { zone: "Australia/Sydney", city: "Sydney", country: "Australia", latitudeDeg: -33.87, longitudeDeg: 151.21 },
  { zone: "Pacific/Noumea", city: "Nouméa", country: "New Caledonia", latitudeDeg: -22.28, longitudeDeg: 166.46 },
  { zone: "Pacific/Auckland", city: "Auckland", country: "New Zealand", latitudeDeg: -36.85, longitudeDeg: 174.76 },
  { zone: "Pacific/Apia", city: "Apia", country: "Samoa", latitudeDeg: -13.83, longitudeDeg: -171.77 },
  { zone: "Pacific/Kiritimati", city: "Kiritimati", country: "Kiribati", latitudeDeg: 1.87, longitudeDeg: -157.43 },
  { zone: "Antarctica/McMurdo", city: "McMurdo Station", country: "Antarctica", latitudeDeg: -77.85, longitudeDeg: 166.67 },
];

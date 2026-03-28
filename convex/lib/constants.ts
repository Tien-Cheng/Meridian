// Region coordinates for map markers (approximate country centroids)
export const REGION_COORDINATES: Record<
  string,
  { latitude: number; longitude: number }
> = {
  Germany: { latitude: 51.1657, longitude: 10.4515 },
  France: { latitude: 46.6034, longitude: 1.8883 },
  Singapore: { latitude: 1.3521, longitude: 103.8198 },
  "United Kingdom": { latitude: 55.3781, longitude: -3.436 },
  "United States": { latitude: 37.0902, longitude: -95.7129 },
  Japan: { latitude: 36.2048, longitude: 138.2529 },
  Australia: { latitude: -25.2744, longitude: 133.7751 },
  "South Korea": { latitude: 35.9078, longitude: 127.7669 },
  Thailand: { latitude: 15.87, longitude: 100.9925 },
  Malaysia: { latitude: 4.2105, longitude: 101.9758 },
  Indonesia: { latitude: -0.7893, longitude: 113.9213 },
  Philippines: { latitude: 12.8797, longitude: 121.774 },
  Italy: { latitude: 41.8719, longitude: 12.5674 },
  Spain: { latitude: 40.4637, longitude: -3.7492 },
  Netherlands: { latitude: 52.1326, longitude: 5.2913 },
  Canada: { latitude: 56.1304, longitude: -106.3468 },
  China: { latitude: 35.8617, longitude: 104.1954 },
  "Hong Kong": { latitude: 22.3193, longitude: 114.1694 },
  Taiwan: { latitude: 23.6978, longitude: 120.9605 },
  India: { latitude: 20.5937, longitude: 78.9629 },
};

// Known marketplace URLs
export const MARKETPLACE_URLS: Record<string, string> = {
  "amazon.de": "https://www.amazon.de",
  "amazon.fr": "https://www.amazon.fr",
  "amazon.co.uk": "https://www.amazon.co.uk",
  "amazon.com": "https://www.amazon.com",
  "amazon.co.jp": "https://www.amazon.co.jp",
  "amazon.sg": "https://www.amazon.sg",
  "lazada.sg": "https://www.lazada.sg",
  "lazada.co.th": "https://www.lazada.co.th",
  "lazada.com.my": "https://www.lazada.com.my",
  "shopee.sg": "https://shopee.sg",
  "shopee.co.th": "https://shopee.co.th",
  "shopee.com.my": "https://shopee.com.my",
  "ebay.com": "https://www.ebay.com",
  "ebay.de": "https://www.ebay.de",
  "ebay.co.uk": "https://www.ebay.co.uk",
};

// TinyFish API endpoint
export const TINYFISH_API_URL =
  "https://agent.tinyfish.ai/v1/automation/run-sse";

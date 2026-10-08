const BANGALORE_NAMES = new Set([
  "bangalore",
  "bengaluru",
  "bengalooru",
]);

/** Approximate Greater Bangalore bounding box */
const BOUNDS = {
  minLat: 12.7,
  maxLat: 13.25,
  minLon: 77.35,
  maxLon: 77.85,
};

function isLocalIp(ip) {
  if (!ip) return true;
  const clean = ip.replace("::ffff:", "");
  return (
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean === "localhost" ||
    clean.startsWith("192.168.") ||
    clean.startsWith("10.") ||
    clean.startsWith("172.16.") ||
    clean.startsWith("172.17.") ||
    clean.startsWith("172.18.") ||
    clean.startsWith("172.19.") ||
    clean.startsWith("172.2") ||
    clean.startsWith("172.3")
  );
}

function getClientIp(reqOrSocket) {
  if (reqOrSocket.headers) {
    const xf = reqOrSocket.headers["x-forwarded-for"];
    if (typeof xf === "string" && xf.length) {
      return xf.split(",")[0].trim();
    }
    return reqOrSocket.ip || reqOrSocket.socket?.remoteAddress || "";
  }

  const xf = reqOrSocket.handshake?.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) {
    return xf.split(",")[0].trim();
  }
  return reqOrSocket.handshake?.address || "";
}

function cityLooksLikeBangalore(city = "", region = "") {
  const c = city.toLowerCase().trim();
  const r = region.toLowerCase().trim();
  if (BANGALORE_NAMES.has(c)) return true;
  if (c.includes("bangalore") || c.includes("bengaluru")) return true;
  // Some ISPs report metro area under Karnataka with nearby town names — keep strict on city.
  if (BANGALORE_NAMES.has(r)) return true;
  return false;
}

function coordsInBangalore(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return false;
  return (
    lat >= BOUNDS.minLat &&
    lat <= BOUNDS.maxLat &&
    lon >= BOUNDS.minLon &&
    lon <= BOUNDS.maxLon
  );
}

async function lookupIp(ip) {
  const clean = (ip || "").replace("::ffff:", "");
  if (!clean || isLocalIp(clean)) {
    return { ok: true, local: true, city: "Local", region: "", country: "" };
  }

  const url = `http://ip-api.com/json/${encodeURIComponent(
    clean
  )}?fields=status,message,country,regionName,city,lat,lon,query`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`geo http ${res.status}`);
  const data = await res.json();
  if (data.status !== "success") {
    throw new Error(data.message || "geo lookup failed");
  }
  return {
    ok: true,
    local: false,
    city: data.city || "",
    region: data.regionName || "",
    country: data.country || "",
    lat: data.lat,
    lon: data.lon,
    ip: data.query,
  };
}

async function checkBangaloreAccess(ip, coords) {
  // Optional GPS override from client (harder to fake than raw "I'm in BLR" claim alone).
  if (coords && coordsInBangalore(coords.lat, coords.lon)) {
    return {
      allowed: true,
      reason: "coords",
      city: "Bengaluru",
      region: "Karnataka",
    };
  }

  const info = await lookupIp(ip);
  if (info.local) {
    return {
      allowed: true,
      reason: "local",
      city: "Local",
      region: "",
    };
  }

  const byCity = cityLooksLikeBangalore(info.city, info.region);
  const byCoords = coordsInBangalore(info.lat, info.lon);

  if (byCity || byCoords) {
    return {
      allowed: true,
      reason: byCity ? "city" : "ip-coords",
      city: info.city,
      region: info.region,
    };
  }

  return {
    allowed: false,
    reason: "outside",
    city: info.city,
    region: info.region,
    country: info.country,
  };
}

function restrictionEnabled() {
  if (process.env.BANGALORE_ONLY === "0" || process.env.BANGALORE_ONLY === "false") {
    return false;
  }
  if (process.env.BANGALORE_ONLY === "1" || process.env.BANGALORE_ONLY === "true") {
    return true;
  }
  // Default: on in production, off in local dev
  return process.env.NODE_ENV === "production";
}

module.exports = {
  getClientIp,
  checkBangaloreAccess,
  restrictionEnabled,
  isLocalIp,
};

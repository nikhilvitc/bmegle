const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const {
  getClientIp,
  checkBangaloreAccess,
  restrictionEnabled,
} = require("./geo");

const app = express();
const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 3001;

app.set("trust proxy", 1);
app.use(
  cors({
    origin: isProd ? false : true,
  })
);
app.use(express.json({ limit: "4kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "bmegle" });
});

app.get("/api/location", async (req, res) => {
  try {
    if (!restrictionEnabled()) {
      return res.json({
        allowed: true,
        restricted: false,
        city: "Anywhere",
        message: "Location restriction is off.",
      });
    }

    const ip = getClientIp(req);
    const result = await checkBangaloreAccess(ip);
    res.json({
      allowed: result.allowed,
      restricted: true,
      city: result.city || "",
      region: result.region || "",
      message: result.allowed
        ? "Bengaluru access confirmed."
        : "bmegle is only available in Bengaluru (Bangalore) right now.",
    });
  } catch (err) {
    console.error("location check failed", err.message);
    // Fail closed in production so outsiders aren't waved through on API errors.
    res.status(200).json({
      allowed: !isProd,
      restricted: restrictionEnabled(),
      city: "",
      message: isProd
        ? "Could not verify your location. Try again from Bengaluru."
        : "Location check failed; allowing in development.",
    });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: isProd
    ? { origin: false }
    : { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

/** @type {string[]} */
let waitingQueue = [];
/** @type {Map<string, string>} */
const partners = new Map();
/** @type {Map<string, boolean>} */
const allowedSockets = new Map();

function getPartner(id) {
  return partners.get(id) || null;
}

function pairUsers(a, b) {
  partners.set(a, b);
  partners.set(b, a);
  io.to(a).emit("matched", { partnerId: b, role: "caller" });
  io.to(b).emit("matched", { partnerId: a, role: "callee" });
}

function unpair(id) {
  const partner = partners.get(id);
  partners.delete(id);
  if (partner) {
    partners.delete(partner);
    return partner;
  }
  return null;
}

function removeFromQueue(id) {
  waitingQueue = waitingQueue.filter((x) => x !== id);
}

function tryMatch(socketId) {
  removeFromQueue(socketId);
  while (waitingQueue.length > 0) {
    const other = waitingQueue.shift();
    if (other === socketId) continue;
    if (!io.sockets.sockets.has(other)) continue;
    if (partners.has(other)) continue;
    if (restrictionEnabled() && allowedSockets.get(other) === false) continue;
    pairUsers(socketId, other);
    return;
  }
  waitingQueue.push(socketId);
  io.to(socketId).emit("searching");
}

async function ensureAllowed(socket, coords) {
  if (!restrictionEnabled()) {
    allowedSockets.set(socket.id, true);
    return true;
  }
  if (allowedSockets.get(socket.id) === true && !coords) return true;

  const ip = getClientIp(socket);
  try {
    const result = await checkBangaloreAccess(ip, coords);
    allowedSockets.set(socket.id, result.allowed);
    if (!result.allowed) {
      socket.emit("location-blocked", {
        message: "bmegle is only available in Bengaluru (Bangalore).",
        city: result.city || "",
      });
    }
    return result.allowed;
  } catch (err) {
    console.error("socket geo failed", err.message);
    const allow = !isProd;
    allowedSockets.set(socket.id, allow);
    if (!allow) {
      socket.emit("location-blocked", {
        message: "Could not verify your location. Try again from Bengaluru.",
      });
    }
    return allow;
  }
}

io.on("connection", (socket) => {
  socket.emit("online", { count: io.engine.clientsCount });
  io.emit("online", { count: io.engine.clientsCount });

  // Warm the geo check early.
  ensureAllowed(socket).catch(() => {});

  socket.on("find", async (payload) => {
    if (partners.has(socket.id)) return;
    const coords =
      payload &&
      typeof payload.lat === "number" &&
      typeof payload.lon === "number"
        ? { lat: payload.lat, lon: payload.lon }
        : null;
    const ok = await ensureAllowed(socket, coords);
    if (!ok) return;
    tryMatch(socket.id);
  });

  socket.on("next", async () => {
    const partner = unpair(socket.id);
    if (partner) {
      io.to(partner).emit("partner-left");
    }
    removeFromQueue(socket.id);
    const ok = await ensureAllowed(socket);
    if (!ok) return;
    tryMatch(socket.id);
  });

  socket.on("stop", () => {
    const partner = unpair(socket.id);
    if (partner) {
      io.to(partner).emit("partner-left");
    }
    removeFromQueue(socket.id);
    socket.emit("stopped");
  });

  socket.on("signal", ({ description, candidate }) => {
    const partner = getPartner(socket.id);
    if (!partner) return;
    io.to(partner).emit("signal", { description, candidate });
  });

  socket.on("chat", (message) => {
    const partner = getPartner(socket.id);
    if (!partner) return;

    const raw =
      typeof message === "string"
        ? message
        : typeof message?.text === "string"
          ? message.text
          : "";
    const text = raw.trim().slice(0, 500);
    if (!text) return;

    // Deliver only to the partner; sender adds their own message in the UI.
    io.to(partner).emit("chat", { text, from: "stranger" });
  });

  socket.on("disconnect", () => {
    const partner = unpair(socket.id);
    if (partner) {
      io.to(partner).emit("partner-left");
    }
    removeFromQueue(socket.id);
    allowedSockets.delete(socket.id);
    io.emit("online", { count: Math.max(0, io.engine.clientsCount) });
  });
});

if (isProd) {
  const dist = path.join(__dirname, "../client/dist");
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/socket.io")) return next();
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(dist, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `bmegle listening on :${PORT} (${isProd ? "production" : "dev"}; bangaloreOnly=${restrictionEnabled()})`
  );
});

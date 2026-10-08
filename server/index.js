const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 3001;

app.set("trust proxy", 1);
app.use(
  cors({
    origin: isProd ? false : true,
  })
);

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "bmegle" });
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
    pairUsers(socketId, other);
    return;
  }
  waitingQueue.push(socketId);
  io.to(socketId).emit("searching");
}

io.on("connection", (socket) => {
  socket.emit("online", { count: io.engine.clientsCount });
  io.emit("online", { count: io.engine.clientsCount });

  socket.on("find", () => {
    if (partners.has(socket.id)) return;
    tryMatch(socket.id);
  });

  socket.on("next", () => {
    const partner = unpair(socket.id);
    if (partner) {
      io.to(partner).emit("partner-left");
    }
    removeFromQueue(socket.id);
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
    if (!partner || typeof message !== "string") return;
    const text = message.trim().slice(0, 500);
    if (!text) return;
    io.to(partner).emit("chat", { text, from: "stranger" });
    socket.emit("chat", { text, from: "you" });
  });

  socket.on("disconnect", () => {
    const partner = unpair(socket.id);
    if (partner) {
      io.to(partner).emit("partner-left");
    }
    removeFromQueue(socket.id);
    io.emit("online", { count: Math.max(0, io.engine.clientsCount) });
  });
});

if (isProd) {
  const dist = path.join(__dirname, "../client/dist");
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/socket.io")) return next();
    res.sendFile(path.join(dist, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`bmegle listening on :${PORT} (${isProd ? "production" : "dev"})`);
});

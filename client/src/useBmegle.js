import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

function getIceServers() {
  return {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:openrelay.metered.ca:80" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
  };
}

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.PROD ? undefined : "http://localhost:3001");

function pushMessage(setMessages, from, text) {
  setMessages((prev) => [
    ...prev,
    { id: crypto.randomUUID(), from, text },
  ]);
}

export function useBmegle() {
  const [status, setStatus] = useState("idle");
  const [messages, setMessages] = useState([]);
  const [online, setOnline] = useState(0);
  const [error, setError] = useState(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [locationBlocked, setLocationBlocked] = useState(false);
  const [paired, setPaired] = useState(false);

  const socketRef = useRef(null);
  const coordsRef = useRef(null);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roleRef = useRef(null);
  const makingOfferRef = useRef(false);
  const pairedRef = useRef(false);

  const setPairedState = useCallback((value) => {
    pairedRef.current = value;
    setPaired(value);
  }, []);

  const cleanupPeer = useCallback(() => {
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        /* ignore */
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onnegotiationneeded = null;
      pcRef.current.ondatachannel = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    roleRef.current = null;
    makingOfferRef.current = false;
  }, []);

  const attachLocalPreview = useCallback(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, []);

  const ensureMedia = useCallback(async () => {
    if (localStreamRef.current) {
      attachLocalPreview();
      return localStreamRef.current;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      localStreamRef.current = stream;
      setMediaReady(true);
      setError(null);
      attachLocalPreview();
      return stream;
    } catch {
      setError(
        "Camera/mic access is required. Allow permissions and try again."
      );
      throw new Error("media-denied");
    }
  }, [attachLocalPreview]);

  const wireDataChannel = useCallback((channel) => {
    dcRef.current = channel;
    channel.binaryType = "arraybuffer";

    channel.onmessage = (event) => {
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : null;
        if (data?.type === "chat" && typeof data.text === "string") {
          const text = data.text.trim().slice(0, 500);
          if (text) pushMessage(setMessages, "stranger", text);
        }
      } catch (e) {
        console.error("datachannel message error", e);
      }
    };
  }, []);

  const createPeer = useCallback(
    async (role) => {
      cleanupPeer();
      roleRef.current = role;
      const stream = await ensureMedia();
      const pc = new RTCPeerConnection(getIceServers());
      pcRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      if (role === "caller") {
        wireDataChannel(pc.createDataChannel("chat", { ordered: true }));
      } else {
        pc.ondatachannel = (event) => {
          if (event.channel.label === "chat") {
            wireDataChannel(event.channel);
          }
        };
      }

      pc.onicecandidate = ({ candidate }) => {
        if (candidate && socketRef.current) {
          socketRef.current.emit("signal", { candidate });
        }
      };

      pc.ontrack = ({ streams }) => {
        if (remoteVideoRef.current && streams[0]) {
          remoteVideoRef.current.srcObject = streams[0];
        }
        setStatus("connected");
      };

      pc.onnegotiationneeded = async () => {
        try {
          if (roleRef.current !== "caller") return;
          makingOfferRef.current = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socketRef.current?.emit("signal", {
            description: pc.localDescription,
          });
        } catch (e) {
          console.error(e);
        } finally {
          makingOfferRef.current = false;
        }
      };

      return pc;
    },
    [cleanupPeer, ensureMedia, wireDataChannel]
  );

  const createPeerRef = useRef(createPeer);
  const cleanupPeerRef = useRef(cleanupPeer);
  const setPairedStateRef = useRef(setPairedState);
  createPeerRef.current = createPeer;
  cleanupPeerRef.current = cleanupPeer;
  setPairedStateRef.current = setPairedState;

  useEffect(() => {
    const socket = io(SOCKET_URL, { autoConnect: true });
    socketRef.current = socket;

    socket.on("online", ({ count }) => setOnline(count));

    socket.on("searching", () => {
      setPairedStateRef.current(false);
      setStatus("searching");
      setMessages([]);
    });

    socket.on("matched", async ({ role }) => {
      setPairedStateRef.current(true);
      setStatus("connecting");
      setMessages([
        {
          id: crypto.randomUUID(),
          from: "system",
          text: "You're connected. Say hi.",
        },
      ]);
      try {
        await createPeerRef.current(role);
      } catch (e) {
        console.error(e);
      }
    });

    socket.on("signal", async ({ description, candidate }) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        if (description) {
          const offerCollision =
            description.type === "offer" &&
            (makingOfferRef.current || pc.signalingState !== "stable");

          if (offerCollision && roleRef.current === "caller") return;

          await pc.setRemoteDescription(description);
          if (description.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("signal", { description: pc.localDescription });
          }
        } else if (candidate) {
          try {
            await pc.addIceCandidate(candidate);
          } catch {
            /* ignore late candidates */
          }
        }
      } catch (e) {
        console.error("signal error", e);
      }
    });

    socket.on("chat", (payload) => {
      const text =
        typeof payload === "string"
          ? payload
          : typeof payload?.text === "string"
            ? payload.text
            : "";
      const from = payload?.from === "you" ? "you" : "stranger";
      const cleaned = text.trim();
      if (!cleaned) return;
      // Own messages are added optimistically; ignore server echo if present.
      if (from === "you") return;
      pushMessage(setMessages, "stranger", cleaned);
    });

    socket.on("partner-left", () => {
      cleanupPeerRef.current();
      setPairedStateRef.current(false);
      setStatus("idle");
      pushMessage(setMessages, "system", "Stranger disconnected.");
    });

    socket.on("stopped", () => {
      cleanupPeerRef.current();
      setPairedStateRef.current(false);
      setStatus("idle");
    });

    socket.on("location-blocked", ({ message }) => {
      setLocationBlocked(true);
      setPairedStateRef.current(false);
      setStatus("idle");
      setError(message || "bmegle is only available in Bengaluru.");
      cleanupPeerRef.current();
    });

    return () => {
      socket.disconnect();
      cleanupPeerRef.current();
    };
  }, []);

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    attachLocalPreview();
  }, [attachLocalPreview, mediaReady, status]);

  const start = useCallback(async () => {
    try {
      await ensureMedia();
      setPairedState(false);
      socketRef.current?.emit("find", coordsRef.current || undefined);
      setStatus("searching");
      setMessages([]);
    } catch {
      /* error already set */
    }
  }, [ensureMedia, setPairedState]);

  const next = useCallback(() => {
    cleanupPeer();
    setPairedState(false);
    setMessages([]);
    setStatus("searching");
    socketRef.current?.emit("next");
  }, [cleanupPeer, setPairedState]);

  const setCoords = useCallback((lat, lon) => {
    if (typeof lat === "number" && typeof lon === "number") {
      coordsRef.current = { lat, lon };
    }
  }, []);

  const stop = useCallback(() => {
    cleanupPeer();
    setPairedState(false);
    socketRef.current?.emit("stop");
    setStatus("idle");
  }, [cleanupPeer, setPairedState]);

  const sendChat = useCallback((text) => {
    const trimmed = text.trim().slice(0, 500);
    if (!trimmed || !pairedRef.current) return;

    pushMessage(setMessages, "you", trimmed);

    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      try {
        dc.send(JSON.stringify({ type: "chat", text: trimmed }));
        return;
      } catch (e) {
        console.error("datachannel send failed", e);
      }
    }

    socketRef.current?.emit("chat", trimmed);
  }, []);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, []);

  const toggleCam = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  }, []);

  return {
    status,
    messages,
    online,
    error,
    mediaReady,
    micOn,
    camOn,
    locationBlocked,
    paired,
    localVideoRef,
    remoteVideoRef,
    start,
    next,
    stop,
    sendChat,
    toggleMic,
    toggleCam,
    setCoords,
    ensureMedia,
  };
}

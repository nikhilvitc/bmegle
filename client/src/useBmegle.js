import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

function getIceServers() {
  // Public TURN helps users behind strict NATs/firewalls connect in production.
  // Replace with your own Metered/Twilio TURN credentials for scale.
  return {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      {
        urls: "stun:openrelay.metered.ca:80",
      },
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

// Same-origin in production (served by Express). Dev hits local signaling server.
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.PROD ? undefined : "http://localhost:3001");

export function useBmegle() {
  const [status, setStatus] = useState("idle");
  const [messages, setMessages] = useState([]);
  const [online, setOnline] = useState(0);
  const [error, setError] = useState(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roleRef = useRef(null);
  const makingOfferRef = useRef(false);

  const cleanupPeer = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onnegotiationneeded = null;
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
    [cleanupPeer, ensureMedia]
  );

  const createPeerRef = useRef(createPeer);
  const cleanupPeerRef = useRef(cleanupPeer);
  createPeerRef.current = createPeer;
  cleanupPeerRef.current = cleanupPeer;

  useEffect(() => {
    const socket = io(SOCKET_URL, { autoConnect: true });
    socketRef.current = socket;

    socket.on("online", ({ count }) => setOnline(count));

    socket.on("searching", () => {
      setStatus("searching");
      setMessages([]);
    });

    socket.on("matched", async ({ role }) => {
      setStatus("connecting");
      setMessages([
        {
          id: crypto.randomUUID(),
          from: "system",
          text: "Connected. You’re chatting with a stranger.",
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

    socket.on("chat", ({ text, from }) => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), from, text },
      ]);
    });

    socket.on("partner-left", () => {
      cleanupPeerRef.current();
      setStatus("idle");
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          from: "system",
          text: "The other person left the call.",
        },
      ]);
    });

    socket.on("stopped", () => {
      cleanupPeerRef.current();
      setStatus("idle");
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
      socketRef.current?.emit("find");
      setStatus("searching");
      setMessages([]);
    } catch {
      /* error already set */
    }
  }, [ensureMedia]);

  const next = useCallback(() => {
    cleanupPeer();
    setMessages([]);
    setStatus("searching");
    socketRef.current?.emit("next");
  }, [cleanupPeer]);

  const stop = useCallback(() => {
    cleanupPeer();
    socketRef.current?.emit("stop");
    setStatus("idle");
  }, [cleanupPeer]);

  const sendChat = useCallback((text) => {
    const trimmed = text.trim();
    if (!trimmed || !socketRef.current) return;
    socketRef.current.emit("chat", trimmed);
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
    localVideoRef,
    remoteVideoRef,
    start,
    next,
    stop,
    sendChat,
    toggleMic,
    toggleCam,
    ensureMedia,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

function getPeerConfig() {
  return {
    bundlePolicy: "max-bundle",
    iceCandidatePoolSize: 2,
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
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
  const [moderationBlocked, setModerationBlocked] = useState(false);
  const [paired, setPaired] = useState(false);
  const [mode, setMode] = useState("video"); // text | video
  const [canReport, setCanReport] = useState(false);

  const socketRef = useRef(null);
  const coordsRef = useRef(null);
  const modeRef = useRef("video");
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roleRef = useRef(null);
  const makingOfferRef = useRef(false);
  const pairedRef = useRef(false);
  const pendingSignalsRef = useRef([]);
  const pendingCandidatesRef = useRef([]);
  const pendingAnswerRef = useRef(null);
  const connectTimerRef = useRef(null);
  const iceRestartedRef = useRef(false);
  const markVideoLiveRef = useRef(() => {});
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  const setPairedState = useCallback((value) => {
    pairedRef.current = value;
    setPaired(value);
  }, []);

  const setModeState = useCallback((value) => {
    const next = value === "text" ? "text" : "video";
    modeRef.current = next;
    setMode(next);
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
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    roleRef.current = null;
    makingOfferRef.current = false;
    pendingSignalsRef.current = [];
    pendingCandidatesRef.current = [];
    pendingAnswerRef.current = null;
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    iceRestartedRef.current = false;
    setPlaybackBlocked(false);
  }, []);

  const stopMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setMediaReady(false);
  }, []);

  const attachLocalPreview = useCallback(() => {
    const el = localVideoRef.current;
    const stream = localStreamRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play?.().catch(() => {});
  }, []);

  const playRemote = useCallback(() => {
    const el = remoteVideoRef.current;
    if (!el || !el.srcObject) return;

    const start = (muted) => {
      el.muted = muted;
      const result = el.play();
      if (!result || typeof result.then !== "function") {
        setPlaybackBlocked(false);
        return;
      }
      result
        .then(() => setPlaybackBlocked(muted))
        .catch(() => {
          if (!muted) start(true);
          else setPlaybackBlocked(true);
        });
    };

    start(false);
  }, []);

  const markVideoLive = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    setStatus("connected");
    setError(null);
    playRemote();
    setMessages((prev) =>
      prev.map((m) =>
        m.text === "You're paired. Video is connecting."
          ? { ...m, text: "You're connected. Say hi." }
          : m
      )
    );
  }, [playRemote]);

  const resumeRemote = useCallback(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    el.muted = false;
    const result = el.play();
    if (!result || typeof result.then !== "function") {
      setPlaybackBlocked(false);
      return;
    }
    result
      .then(() => setPlaybackBlocked(false))
      .catch(() => {
        el.muted = true;
        el.play?.()
          .then(() => setPlaybackBlocked(true))
          .catch(() => setPlaybackBlocked(true));
      });
  }, []);

  const showRemoteStream = useCallback((el, stream, track) => {
    if (!el || !stream) return;
    el.playsInline = true;
    el.autoplay = true;
    // Phones often receive audio first. Resetting srcObject is what makes
    // the later video track actually paint.
    el.srcObject = null;
    el.srcObject = stream;
    if (track?.kind === "video") {
      const show = () => markVideoLiveRef.current();
      track.onunmute = show;
      if (!track.muted) show();
    }
    playRemote();
  }, [playRemote]);

  const attachRemoteTrack = useCallback(
    (track, inboundStream) => {
      const el = remoteVideoRef.current;
      if (!el || !track) return;
      if (inboundStream) {
        showRemoteStream(el, inboundStream, track);
        return;
      }
      let stream = el.srcObject;
      if (!(stream instanceof MediaStream)) {
        stream = new MediaStream();
      }
      if (!stream.getTracks().some((item) => item.id === track.id)) {
        stream.addTrack(track);
      }
      showRemoteStream(el, stream, track);
    },
    [showRemoteStream]
  );

  const ensureMedia = useCallback(async () => {
    if (localStreamRef.current) {
      attachLocalPreview();
      return localStreamRef.current;
    }
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: true,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
      }
      localStreamRef.current = stream;
      setMediaReady(true);
      setError(null);
      attachLocalPreview();
      return stream;
    } catch {
      setError(
        "Camera/mic access is required for video chat. Allow permissions and try again."
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

  const applySignal = useCallback(async (pc, { description, candidate }) => {
    if (!pc || pc.connectionState === "closed") return;

    if (description) {
      const offerCollision =
        description.type === "offer" &&
        (makingOfferRef.current || pc.signalingState !== "stable");

      if (offerCollision && roleRef.current === "caller") return;

      if (description.type === "answer" && pc.signalingState !== "have-local-offer") {
        pendingAnswerRef.current = description;
        return;
      }

      await pc.setRemoteDescription(description);
      const queued = pendingCandidatesRef.current.splice(0);
      for (const item of queued) {
        try {
          await pc.addIceCandidate(item);
        } catch {
          /* ignore late candidates */
        }
      }
      if (description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current?.emit("signal", { description: pc.localDescription });
      }
      return;
    }

    if (!candidate) return;
    if (!pc.remoteDescription) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      /* ignore late candidates */
    }
  }, []);

  const createPeer = useCallback(
    async (role) => {
      const earlySignals = pendingSignalsRef.current.splice(0);
      cleanupPeer();
      pendingSignalsRef.current = earlySignals;
      roleRef.current = role;
      const stream = await ensureMedia();
      const pc = new RTCPeerConnection(getPeerConfig());

      pc.onicecandidate = ({ candidate }) => {
        if (candidate && socketRef.current) {
          socketRef.current.emit("signal", { candidate });
        }
      };

      pc.ontrack = (event) => {
        attachRemoteTrack(event.track, event.streams?.[0]);
        const ice = pc.iceConnectionState;
        const linked =
          ice === "connected" ||
          ice === "completed" ||
          pc.connectionState === "connected";
        if (event.track.kind === "video" && (linked || !event.track.muted)) {
          markVideoLive();
        }
      };

      const noteLink = () => {
        if (pcRef.current !== pc) return;
        const ice = pc.iceConnectionState;
        const linked =
          ice === "connected" ||
          ice === "completed" ||
          pc.connectionState === "connected";
        const stream = remoteVideoRef.current?.srcObject;
        const hasVideo =
          stream instanceof MediaStream && stream.getVideoTracks().length > 0;
        if (linked && hasVideo) markVideoLive();
      };

      pc.oniceconnectionstatechange = noteLink;

      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return;
        noteLink();
        if (pc.connectionState !== "failed" && pc.iceConnectionState !== "failed") {
          return;
        }
        if (!iceRestartedRef.current && roleRef.current === "caller") {
          iceRestartedRef.current = true;
          try {
            pc.restartIce();
          } catch (e) {
            console.error(e);
          }
          return;
        }
        setStatus("connecting");
        setError("Video didn't connect. Hit Next to try someone else.");
      };

      const sendOffer = async () => {
        if (roleRef.current !== "caller" || makingOfferRef.current) return;
        if (pc.signalingState !== "stable") return;
        makingOfferRef.current = true;
        try {
          const offer = await pc.createOffer();
          if (pcRef.current !== pc || pc.signalingState !== "stable") return;
          await pc.setLocalDescription(offer);
          socketRef.current?.emit("signal", {
            description: pc.localDescription,
          });
          const earlyAnswer = pendingAnswerRef.current;
          if (earlyAnswer) {
            pendingAnswerRef.current = null;
            await applySignal(pc, { description: earlyAnswer });
          }
        } catch (e) {
          console.error(e);
        } finally {
          makingOfferRef.current = false;
        }
      };

      pc.onnegotiationneeded = () => {
        sendOffer();
      };

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

      pcRef.current = pc;

      const queued = pendingSignalsRef.current.splice(0);
      for (const msg of queued) {
        try {
          await applySignal(pc, msg);
        } catch (e) {
          console.error("signal error", e);
        }
      }

      if (role === "caller" && !pc.localDescription) {
        await sendOffer();
      }

      connectTimerRef.current = setTimeout(() => {
        if (pcRef.current !== pc) return;
        const ice = pc.iceConnectionState;
        if (
          ice === "connected" ||
          ice === "completed" ||
          pc.connectionState === "connected"
        ) {
          markVideoLive();
          return;
        }
        setError("Video didn't connect. Hit Next to try someone else.");
      }, 15000);

      return pc;
    },
    [applySignal, attachRemoteTrack, cleanupPeer, ensureMedia, markVideoLive, wireDataChannel]
  );

  const createPeerRef = useRef(createPeer);
  const cleanupPeerRef = useRef(cleanupPeer);
  const applySignalRef = useRef(applySignal);
  const setPairedStateRef = useRef(setPairedState);
  const setModeStateRef = useRef(setModeState);
  createPeerRef.current = createPeer;
  cleanupPeerRef.current = cleanupPeer;
  applySignalRef.current = applySignal;
  markVideoLiveRef.current = markVideoLive;
  setPairedStateRef.current = setPairedState;
  setModeStateRef.current = setModeState;

  useEffect(() => {
    const socket = io(SOCKET_URL, { autoConnect: true });
    socketRef.current = socket;

    socket.on("online", ({ count }) => setOnline(count));

    socket.on("searching", (payload) => {
      setPairedStateRef.current(false);
      setCanReport(false);
      if (payload?.mode) setModeStateRef.current(payload.mode);
      setStatus("searching");
      setMessages([]);
    });

    socket.on("matched", async ({ role, mode: matchedMode }) => {
      const nextMode = matchedMode === "text" ? "text" : "video";
      setModeStateRef.current(nextMode);
      setPairedStateRef.current(true);
      setCanReport(true);
      setMessages([
        {
          id: crypto.randomUUID(),
          from: "system",
          text:
            nextMode === "text"
              ? "You're connected with a stranger. Say hi."
              : "You're paired. Video is connecting.",
        },
      ]);

      if (nextMode === "text") {
        cleanupPeerRef.current();
        setStatus("connected");
        return;
      }

      setStatus("connecting");
      try {
        await createPeerRef.current(role);
      } catch (e) {
        console.error(e);
      }
    });

    socket.on("signal", async (message) => {
      if (modeRef.current === "text") return;
      const pc = pcRef.current;
      if (!pc) {
        pendingSignalsRef.current.push(message);
        return;
      }
      try {
        await applySignalRef.current(pc, message);
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
      if (!cleaned || from === "you") return;
      pushMessage(setMessages, "stranger", cleaned);
    });

    socket.on("partner-left", () => {
      cleanupPeerRef.current();
      setPairedStateRef.current(false);
      setCanReport(false);
      setStatus("idle");
      pushMessage(setMessages, "system", "Stranger disconnected.");
    });

    socket.on("stopped", () => {
      cleanupPeerRef.current();
      setPairedStateRef.current(false);
      setCanReport(false);
      setStatus("idle");
    });

    socket.on("report-ok", () => {
      cleanupPeerRef.current();
      setPairedStateRef.current(false);
      setCanReport(false);
      setStatus("searching");
      setMessages([
        {
          id: crypto.randomUUID(),
          from: "system",
          text: "Reported. Looking for someone else…",
        },
      ]);
    });

    socket.on("report-error", ({ error: code }) => {
      if (code === "cooldown") {
        setError("Wait a moment before reporting again.");
      } else if (code === "already-reported") {
        setError("You already reported this stranger.");
      } else if (code === "no-partner") {
        setError("No stranger to report.");
      }
    });

    socket.on("location-blocked", ({ message }) => {
      setLocationBlocked(true);
      setPairedStateRef.current(false);
      setCanReport(false);
      setStatus("idle");
      setError(message || "bmegle is only available in Bengaluru.");
      cleanupPeerRef.current();
    });

    socket.on("moderation-blocked", ({ message }) => {
      setModerationBlocked(true);
      setPairedStateRef.current(false);
      setCanReport(false);
      setStatus("idle");
      setError(message || "Temporarily unavailable. Try again later.");
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

  const start = useCallback(
    async (nextMode = "video") => {
      const modeToUse = nextMode === "text" ? "text" : "video";
      try {
        setModeState(modeToUse);
        setPairedState(false);
        setError(null);

        if (modeToUse === "video") {
          await ensureMedia();
        } else {
          cleanupPeer();
          stopMedia();
        }

        const payload = {
          mode: modeToUse,
          ...(coordsRef.current || {}),
        };
        socketRef.current?.emit("find", payload);
        setStatus("searching");
        setMessages([]);
      } catch {
        /* error already set for video */
      }
    },
    [cleanupPeer, ensureMedia, setModeState, setPairedState, stopMedia]
  );

  const next = useCallback(() => {
    cleanupPeer();
    setPairedState(false);
    setMessages([]);
    setStatus("searching");
    socketRef.current?.emit("next", { mode: modeRef.current });
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

    // Text mode always uses the socket. Video prefers datachannel when open.
    if (modeRef.current === "video") {
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") {
        try {
          dc.send(JSON.stringify({ type: "chat", text: trimmed }));
          return;
        } catch (e) {
          console.error("datachannel send failed", e);
        }
      }
    }

    socketRef.current?.emit("chat", trimmed);
  }, []);

  const report = useCallback((reason) => {
    if (!pairedRef.current || !socketRef.current) return;
    setCanReport(false);
    socketRef.current.emit("report", { reason });
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
    moderationBlocked,
    paired,
    canReport,
    mode,
    localVideoRef,
    remoteVideoRef,
    start,
    next,
    stop,
    sendChat,
    report,
    toggleMic,
    toggleCam,
    setCoords,
    ensureMedia,
    playbackBlocked,
    resumeRemote,
  };
}

import { useEffect, useRef, useState } from "react";
import { useBmegle } from "./useBmegle";

const REPORT_REASONS = [
  { id: "inappropriate", label: "Inappropriate" },
  { id: "spam", label: "Spam" },
  { id: "harassment", label: "Harassment" },
  { id: "underage", label: "Underage" },
  { id: "other", label: "Other" },
];

function statusLabel(status, mode) {
  switch (status) {
    case "searching":
      return mode === "text" ? "Looking for a chat…" : "Looking for someone…";
    case "connecting":
      return "Connecting…";
    case "connected":
      return mode === "text" ? "Chatting" : "Connected";
    default:
      return "Stopped";
  }
}

function IconMic({ on }) {
  return on ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 9v2a3 3 0 0 0 5.12 2.12M15 9.5V6a3 3 0 0 0-5.65-1.4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M19 11a7 7 0 0 1-10.5 6.06M5 11a7 7 0 0 0 .5 2.6M12 18v3M4 4l16 16"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCam({ on }) {
  return on ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3"
        y="7"
        width="13"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M16 10.5 21 8v8l-5-2.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7.5A2 2 0 0 1 5 5.5h7.5M16 10.5 21 8v8l-3.2-1.6M3 3l18 18M4 17.5h9a2 2 0 0 0 2-2V11"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function App() {
  const {
    status,
    messages,
    online,
    error,
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
  } = useBmegle();

  const [draft, setDraft] = useState("");
  const [started, setStarted] = useState(false);
  const [geoStatus, setGeoStatus] = useState("checking");
  const [geoMessage, setGeoMessage] = useState("");
  const [showReportReasons, setShowReportReasons] = useState(false);
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const canChat = paired;
  const blocked =
    geoStatus === "blocked" || locationBlocked || moderationBlocked;
  const isText = mode === "text";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (started && isText && canChat) {
      chatInputRef.current?.focus();
    }
  }, [started, isText, canChat, paired]);

  useEffect(() => {
    if (!paired) setShowReportReasons(false);
  }, [paired]);

  useEffect(() => {
    let cancelled = false;

    async function checkLocation() {
      try {
        const res = await fetch("/api/location");
        const data = await res.json();
        if (cancelled) return;

        if (data.allowed) {
          setGeoStatus("allowed");
          setGeoMessage("");
          return;
        }

        if (!navigator.geolocation) {
          setGeoStatus("blocked");
          setGeoMessage(data.message || "bmegle is only available in Bengaluru.");
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return;
            const { latitude, longitude } = pos.coords;
            setCoords(latitude, longitude);
            const inBlr =
              latitude >= 12.7 &&
              latitude <= 13.25 &&
              longitude >= 77.35 &&
              longitude <= 77.85;
            if (inBlr) {
              setGeoStatus("allowed");
              setGeoMessage("");
            } else {
              setGeoStatus("blocked");
              setGeoMessage("bmegle is only available in Bengaluru.");
            }
          },
          () => {
            if (cancelled) return;
            setGeoStatus("blocked");
            setGeoMessage(data.message || "bmegle is only available in Bengaluru.");
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
      } catch {
        if (!cancelled) {
          setGeoStatus("allowed");
          setGeoMessage("");
        }
      }
    }

    checkLocation();
    return () => {
      cancelled = true;
    };
  }, [setCoords]);

  const handleStart = async (nextMode) => {
    if (blocked || geoStatus === "checking") return;
    setStarted(true);
    await start(nextMode);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    sendChat(draft);
    setDraft("");
  };

  const handleStop = () => {
    stop();
    setShowReportReasons(false);
    setStarted(false);
  };

  const handleReport = (reasonId) => {
    report(reasonId);
    setShowReportReasons(false);
  };

  return (
    <div className={`app ${started ? "app--session" : "app--home"}`}>
      {!started ? (
        <main className="home">
          <header className="home__header">
            <img
              src="/logo.png"
              alt="bmegle"
              className="home__logo"
              width="160"
              height="160"
            />
            <p className="home__tag">Talk to strangers!</p>
          </header>

          <section className="home__panel">
            <div className="home__hero">
              <img
                src="/hero.jpg"
                alt="bmegle"
                className="home__hero-img"
                width="1400"
                height="788"
              />
            </div>

            <div className="home__body">
              <p className="home__copy">
                <strong>bmegle</strong> is a simple way to meet people in
                Bengaluru. Pick text chat (no camera) or video chat. You’re
                randomly paired one-on-one. Stop or skip whenever you want.
              </p>

              <p className="home__age">
                <strong>18+ only.</strong> By starting, you confirm you are 18 or
                older. Bengaluru only.
              </p>

              {blocked && (
                <p className="home__blocked">
                  {geoMessage || "bmegle is only available in Bengaluru."}
                </p>
              )}

              <div className="home__start">
                <p className="home__start-label">Start chatting:</p>
                <div className="home__actions">
                  <button
                    type="button"
                    className="btn-mode btn-mode--text"
                    onClick={() => handleStart("text")}
                    disabled={blocked || geoStatus === "checking"}
                  >
                    {geoStatus === "checking" ? "Checking…" : "Text"}
                  </button>
                  <button
                    type="button"
                    className="btn-mode btn-mode--video"
                    onClick={() => handleStart("video")}
                    disabled={blocked || geoStatus === "checking"}
                  >
                    {geoStatus === "checking" ? "Checking…" : "Video"}
                  </button>
                </div>
                <p className="home__online">{online} online</p>
              </div>

              {error && <p className="home__error">{error}</p>}
            </div>
          </section>

          <footer className="home__footer">
            <p>© {new Date().getFullYear()} bmegle</p>
          </footer>
        </main>
      ) : (
        <main className={`session ${isText ? "session--text" : ""}`}>
          <header className="session__header">
            <img
              src="/logo.png"
              alt="bmegle"
              className="logo logo--nav"
              width="120"
              height="120"
            />
            <p className="session__status">{statusLabel(status, mode)}</p>
            <span className="session__mode">{isText ? "Text" : "Video"}</span>
            <span className="session__online">{online} online</span>
          </header>

          <div className="session__body">
            {!isText && (
              <section className="stage" aria-label="Video">
                <div className="stage__remote">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className={status === "connected" ? "is-live" : ""}
                  />
                  {status !== "connected" && (
                    <div className="stage__empty">
                      <p>{statusLabel(status, mode)}</p>
                    </div>
                  )}
                  {status === "connected" && (
                    <span className="stage__label">Stranger</span>
                  )}
                </div>

                <div className={`stage__self ${camOn ? "" : "is-off"}`}>
                  <video ref={localVideoRef} autoPlay playsInline muted />
                  {!camOn && <span className="stage__self-off">Camera off</span>}
                  <span className="stage__label stage__label--self">You</span>
                </div>
              </section>
            )}

            <aside className="chat" aria-label="Chat">
              {isText && (
                <div className="chat__banner">
                  {status === "searching"
                    ? "Finding a stranger to text…"
                    : paired
                      ? "Text chat with a stranger"
                      : "Stranger left — hit New"}
                </div>
              )}

              <div className="chat__log">
                {messages.length === 0 && (
                  <p className="chat__empty">
                    {isText
                      ? "Messages will show up here."
                      : "Chat will show up here."}
                  </p>
                )}
                {messages.map((m) => (
                  <p key={m.id} className={`msg msg--${m.from}`}>
                    {m.from === "you" && <strong>You: </strong>}
                    {m.from === "stranger" && <strong>Stranger: </strong>}
                    {m.text}
                  </p>
                ))}
                <div ref={chatEndRef} />
              </div>

              <form className="chat__composer" onSubmit={handleSend}>
                <input
                  ref={chatInputRef}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={canChat ? "Type here…" : "Waiting for a match…"}
                  disabled={!canChat}
                  maxLength={500}
                  autoComplete="off"
                />
                <button type="submit" disabled={!draft.trim() || !canChat}>
                  Send
                </button>
              </form>
            </aside>
          </div>

          {showReportReasons && paired && (
            <div className="report-panel" role="group" aria-label="Report reason">
              <p className="report-panel__title">Why report?</p>
              <div className="report-panel__reasons">
                {REPORT_REASONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="report-panel__btn"
                    onClick={() => handleReport(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="report-panel__cancel"
                onClick={() => setShowReportReasons(false)}
              >
                Cancel
              </button>
            </div>
          )}

          <footer className="dock">
            {!isText && (
              <>
                <button
                  type="button"
                  className={`dock__btn ${micOn ? "" : "is-off"}`}
                  onClick={toggleMic}
                  aria-label={micOn ? "Mute" : "Unmute"}
                >
                  <IconMic on={micOn} />
                </button>
                <button
                  type="button"
                  className={`dock__btn ${camOn ? "" : "is-off"}`}
                  onClick={toggleCam}
                  aria-label={camOn ? "Camera off" : "Camera on"}
                >
                  <IconCam on={camOn} />
                </button>
              </>
            )}

            <button
              type="button"
              className="dock__btn dock__btn--report"
              onClick={() => setShowReportReasons(true)}
              disabled={!canReport || !paired}
            >
              Report
            </button>

            {(status === "connected" || status === "connecting" || paired) && (
              <button
                type="button"
                className="dock__btn dock__btn--main"
                onClick={next}
              >
                Next
              </button>
            )}
            {status === "searching" && !paired && (
              <button
                type="button"
                className="dock__btn dock__btn--main"
                disabled
              >
                Looking…
              </button>
            )}
            {status === "idle" && !paired && (
              <button
                type="button"
                className="dock__btn dock__btn--main"
                onClick={() => start(mode)}
              >
                New
              </button>
            )}
            <button
              type="button"
              className="dock__btn dock__btn--stop"
              onClick={handleStop}
            >
              Stop
            </button>
          </footer>

          {error && <p className="session__error">{error}</p>}
        </main>
      )}
    </div>
  );
}

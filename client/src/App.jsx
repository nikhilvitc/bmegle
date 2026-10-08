import { useEffect, useRef, useState } from "react";
import { useBmegle } from "./useBmegle";

function statusLabel(status) {
  switch (status) {
    case "searching":
      return "Finding a match";
    case "connecting":
      return "Establishing connection";
    case "connected":
      return "Connected";
    default:
      return "Not in a call";
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

function IconSend() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRun() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.18)" />
      <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="#fff" />
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
    localVideoRef,
    remoteVideoRef,
    start,
    next,
    stop,
    sendChat,
    toggleMic,
    toggleCam,
  } = useBmegle();

  const [draft, setDraft] = useState("");
  const [started, setStarted] = useState(false);
  const [interestInput, setInterestInput] = useState("");
  const [interests, setInterests] = useState([]);
  const chatEndRef = useRef(null);
  const canChat = status === "connected" || status === "connecting";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addInterest = (raw) => {
    const tag = raw.trim().toLowerCase().replace(/[^a-z0-9+\-#\s]/g, "");
    if (!tag || interests.includes(tag) || interests.length >= 10) return;
    setInterests((prev) => [...prev, tag]);
  };

  const handleInterestKey = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addInterest(interestInput);
      setInterestInput("");
    }
  };

  const handleStart = async () => {
    setStarted(true);
    await start();
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    sendChat(draft);
    setDraft("");
  };

  const handleStop = () => {
    stop();
    setStarted(false);
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
                alt="bmegle global video chat — connect with strangers worldwide"
                className="home__hero-img"
                width="1400"
                height="788"
              />
            </div>

            <h2 className="home__subhead">
              Your trusted choice for safe, fast &amp; anonymous random video chat
            </h2>

            <p className="home__note">
              You don’t need an app to use bmegle on your phone or tablet! The
              website works great on mobile.
            </p>

            <h3 className="home__headline">Meet strangers with your interests!</h3>

            <div className="interests">
              <div className="interests__tags">
                {interests.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="interests__tag"
                    onClick={() =>
                      setInterests((prev) => prev.filter((t) => t !== tag))
                    }
                    title="Remove"
                  >
                    {tag} ×
                  </button>
                ))}
                <input
                  className="interests__input"
                  value={interestInput}
                  onChange={(e) => setInterestInput(e.target.value)}
                  onKeyDown={handleInterestKey}
                  onBlur={() => {
                    if (interestInput.trim()) {
                      addInterest(interestInput);
                      setInterestInput("");
                    }
                  }}
                  placeholder={
                    interests.length
                      ? "Add another interest…"
                      : "Add your interests (optional)"
                  }
                />
              </div>
              <p className="interests__hint">
                Press Enter after each interest. Leave empty for a fully random
                match.
              </p>
            </div>

            <p className="home__copy">
              <strong>bmegle</strong> is a fun way to meet new people. You’re
              paired randomly with another person for one-on-one video and chat.
              Add interests if you want a better chance of matching with someone
              who picked some of the same ones. Chats are anonymous unless you
              share who you are (not recommended), and you can stop anytime.
              Video chat requires camera and microphone access. Users are solely
              responsible for their behavior while using bmegle.
            </p>

            <p className="home__age">
              <strong>YOU MUST BE 18 OR OLDER TO USE BMEGLE.</strong> By starting,
              you confirm you are 18+ and will keep conversations respectful.
            </p>

            <div className="home__alert">
              <span>Video is monitored. Keep it clean</span>
              <span className="home__alert-icon" aria-hidden>
                !
              </span>
            </div>

            <p className="home__copy home__copy--small">
              Leave bmegle and visit an adult site instead if that’s what you’re
              looking for, and you are 18 or older.
            </p>

            <div className="home__start">
              <p className="home__start-label">Start chatting:</p>
              <button
                type="button"
                className="btn-video"
                onClick={handleStart}
              >
                <IconRun />
                <span>Video</span>
              </button>
              <p className="home__online">
                <span className="home__online-dot" />
                {online} online now
              </p>
            </div>

            {error && <p className="home__error">{error}</p>}
          </section>

          <footer className="home__footer">
            <p>© {new Date().getFullYear()} bmegle · Peer-to-peer video · We don’t record your calls</p>
          </footer>
        </main>
      ) : (
        <main className="session">
          <div className="atmosphere" aria-hidden>
            <div className="atmosphere__wash" />
            <div className="atmosphere__glow atmosphere__glow--a" />
            <div className="atmosphere__glow atmosphere__glow--b" />
          </div>

          <header className="session__header">
            <div className="session__brand">
              <h1 className="brand brand--nav">
                <img
                  src="/logo.png"
                  alt="bmegle"
                  className="logo logo--nav"
                  width="160"
                  height="160"
                />
              </h1>
            </div>

            <div className={`status-chip status-chip--${status}`}>
              <span className="status-chip__dot" />
              {statusLabel(status)}
            </div>

            <span className="presence presence--quiet">
              <span className="presence__dot" />
              {online} online
            </span>
          </header>

          <div className="session__body">
            <section className="stage" aria-label="Video call">
              <div className="stage__remote">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className={status === "connected" ? "is-live" : ""}
                />
                {status !== "connected" && (
                  <div className="stage__empty">
                    <div className="spinner" aria-hidden />
                    <p className="stage__empty-title">{statusLabel(status)}</p>
                    <p className="stage__empty-sub">
                      {status === "searching"
                        ? "You’ll be paired as soon as someone else is available."
                        : status === "connecting"
                          ? "Setting up a secure peer connection…"
                          : "Press Find to start matching."}
                    </p>
                  </div>
                )}
                {status === "connected" && (
                  <span className="stage__badge">Stranger</span>
                )}
              </div>

              <div className={`stage__self ${camOn ? "" : "is-off"}`}>
                <video ref={localVideoRef} autoPlay playsInline muted />
                {!camOn && <span className="stage__self-off">Camera off</span>}
                <span className="stage__badge stage__badge--self">You</span>
              </div>
            </section>

            <aside className="chat" aria-label="Chat">
              <div className="chat__head">
                <h2>Chat</h2>
                <span>{canChat ? "Live" : "Idle"}</span>
              </div>

              <div className="chat__log">
                {messages.length === 0 && (
                  <p className="chat__empty">
                    Messages with your match will appear here.
                  </p>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`msg msg--${m.from}`}>
                    {m.from !== "system" && (
                      <span className="msg__who">
                        {m.from === "you" ? "You" : "Stranger"}
                      </span>
                    )}
                    <p className="msg__text">{m.text}</p>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <form className="chat__composer" onSubmit={handleSend}>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={canChat ? "Write a message…" : "Connect to chat"}
                  disabled={!canChat}
                  maxLength={500}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className="btn btn--icon"
                  disabled={!draft.trim() || !canChat}
                  aria-label="Send message"
                >
                  <IconSend />
                </button>
              </form>
            </aside>
          </div>

          <footer className="dock">
            <div className="dock__cluster">
              <button
                type="button"
                className={`btn btn--tool ${micOn ? "" : "is-muted"}`}
                onClick={toggleMic}
                aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                title={micOn ? "Mute" : "Unmute"}
              >
                <IconMic on={micOn} />
              </button>
              <button
                type="button"
                className={`btn btn--tool ${camOn ? "" : "is-muted"}`}
                onClick={toggleCam}
                aria-label={camOn ? "Turn camera off" : "Turn camera on"}
                title={camOn ? "Camera off" : "Camera on"}
              >
                <IconCam on={camOn} />
              </button>
            </div>

            <div className="dock__cluster dock__cluster--main">
              {(status === "connected" || status === "connecting") && (
                <button type="button" className="btn btn--primary" onClick={next}>
                  Next
                </button>
              )}
              {status === "searching" && (
                <button type="button" className="btn btn--primary" disabled>
                  Searching…
                </button>
              )}
              {status === "idle" && (
                <button type="button" className="btn btn--primary" onClick={start}>
                  Find someone
                </button>
              )}
              <button type="button" className="btn btn--danger" onClick={handleStop}>
                Stop
              </button>
            </div>
          </footer>

          {error && <p className="banner banner--error banner--float">{error}</p>}
        </main>
      )}
    </div>
  );
}

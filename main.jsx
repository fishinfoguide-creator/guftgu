import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./storage-firebase.js"; // sets up window.storage backed by real Firebase
import Guftgu from "./App.jsx";

// ---------- Splash screen (app khulte hi kuch second ke liye dikhta hai) ----------
function Splash({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1300);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0b141a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
      }}
    >
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 24,
          background: "linear-gradient(135deg,#10b981,#059669)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 10px 40px rgba(16,185,129,0.35)",
          animation: "guftgu-pop 0.5s ease-out",
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0b141a" strokeWidth="2.2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </div>
      <h1 style={{ fontFamily: "'Georgia', serif", fontSize: 28, margin: 0, letterSpacing: 0.5, color: "#e9edef" }}>
        گفتگو <span style={{ opacity: 0.6, fontSize: 16, fontFamily: "Inter, sans-serif" }}>Guftgu</span>
      </h1>
      <style>{`
        @keyframes guftgu-pop {
          0% { transform: scale(0.7); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function Root() {
  const [showSplash, setShowSplash] = useState(true);
  return showSplash ? <Splash onDone={() => setShowSplash(false)} /> : <Guftgu />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

// ---------- App ko "installable" banane ke liye service worker register karein ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

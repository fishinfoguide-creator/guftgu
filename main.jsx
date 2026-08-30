import React from "react";
import ReactDOM from "react-dom/client";
import "./storage-firebase.js"; // sets up window.storage backed by real Firebase
import Guftgu from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Guftgu />
  </React.StrictMode>
);

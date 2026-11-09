import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/fonts.css";
import "./styles/global.css";

// A macOS window with an overlay title bar has traffic lights in the top left.
if (/Mac/i.test(navigator.userAgent)) {
  document.documentElement.classList.add("is-macos");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

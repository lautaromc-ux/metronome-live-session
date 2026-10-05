import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const canRegisterServiceWorker =
  "serviceWorker" in navigator &&
  window.location.protocol === "https:" &&
  !["localhost", "127.0.0.1"].includes(window.location.hostname);

if (canRegisterServiceWorker) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js");
  });
}

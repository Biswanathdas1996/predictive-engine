import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (import.meta.env.DEV) {
  window.addEventListener("error", (ev) => {
    console.error("[window error]", ev.error ?? ev.message, ev.filename, ev.lineno);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    console.error("[unhandled rejection]", ev.reason);
  });
}

createRoot(document.getElementById("root")!).render(<App />);

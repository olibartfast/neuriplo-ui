import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

// Asserting the element exists would hand createRoot a null and fail somewhere
// inside React; saying which element is missing names the actual problem.
const container = document.getElementById("root");
if (!container) {
  throw new Error("index.html has no #root element for the UI to mount into.");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

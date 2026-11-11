import React from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "./PopupApp.jsx";
import "./tags.css";
import "./popup.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>,
);

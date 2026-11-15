import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useStore } from "./store";
import "./styles.css";
import "./styles3d.css";

if ((import.meta as any).env?.DEV) {
  (window as any).__blouckStore = useStore;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

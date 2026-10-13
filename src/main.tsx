import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Hud } from "./features/Performance";
import "./App.css";
import "@fontsource-variable/outfit";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).get("hud") === "1" ? (
      <Hud />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);

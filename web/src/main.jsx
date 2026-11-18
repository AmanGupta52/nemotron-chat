import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App.jsx";
import "./App.css";
import { AuthProvider } from "./auth/AuthContext.jsx";
import { IS_NATIVE } from "./auth/api.js";

// The packaged mobile app serves files locally, so it uses hash URLs (#/chat) that never need a server fallback.
const Router = IS_NATIVE ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Router>
  </React.StrictMode>
);

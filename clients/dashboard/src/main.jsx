import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { LiveStreamProvider } from "./context/LiveStreamContext.jsx";
import "./styles/base.css";
import "./styles/admin.css";
import "./styles/manager.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <LiveStreamProvider>
          <App />
        </LiveStreamProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

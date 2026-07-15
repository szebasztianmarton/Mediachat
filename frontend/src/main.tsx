import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { ToastProvider } from "./components/Toast";
import { applyStoredTheme } from "./utils/theme";
import { I18nProvider } from "./i18n";

applyStoredTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// PWA service worker — CSAK production buildben. Dev módban a SW a Vite által
// kiszolgált modulokat cache-first szolgálná ki, ami verzió-eltérést és üres
// oldalt okoz (a régi cache-elt modul nem passzol a friss HTML-hez). Ezért dev
// alatt nem regisztrálunk, sőt aktívan leszedjük az esetleg korábban beragadt
// service workert és ürítjük a cache-t, hogy a fejlesztői oldal helyreálljon.
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline mód nem kritikus */
      });
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
    if ("caches" in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }
}

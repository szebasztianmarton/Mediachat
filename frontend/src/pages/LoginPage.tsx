import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ApiUser } from "../types";
import { api, ApiError } from "../utils/api";
import { setAuth } from "../utils/auth";
import { logger } from "../utils/logger";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<{ token: string; user: ApiUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setAuth({
        token: data.token,
        userId: data.user.id,
        username: data.user.username ?? data.user.display_name,
        role: data.user.role,
      });
      logger.success("auth", `Bejelentkezés sikeres: ${data.user.username} (${data.user.role})`);
      navigate(data.user.role === "admin" ? "/dashboard" : "/chat");
    } catch (err) {
      logger.warn("auth", `Sikertelen belépési kísérlet: ${username || "(üres)"}`);
      setError(
        err instanceof ApiError && err.status === 401
          ? "Helytelen felhasználónév vagy jelszó."
          : "A szerver nem érhető el. Ellenőrizd, hogy a backend fut-e."
      );
      setPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F9F9F9", padding: 16 }}
      className="[data-theme=dark]:bg-[#09090b]"
    >
      <div style={{ width: "100%", maxWidth: 380 }}>

        {/* Logo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
          <div
            style={{
              width: 48,
              height: 48,
              background: "#000000",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <svg width="24" height="24" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3" />
            </svg>
          </div>
          <h1
            style={{
              fontFamily: "'EB Garamond', Georgia, serif",
              fontSize: 24,
              fontWeight: 600,
              color: "#000000",
              letterSpacing: "-0.01em",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            Media Assistant
          </h1>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Sonarr · Radarr · Ollama integráció
          </p>
        </div>

        {/* Card */}
        <div
          className="card"
          style={{ padding: 28, borderRadius: 12 }}
        >
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "#000000",
              margin: "0 0 20px",
              letterSpacing: "-0.02em",
            }}
          >
            Bejelentkezés
          </h2>

          <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Username */}
            <div>
              <label
                htmlFor="username"
                style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#333333", marginBottom: 6 }}
              >
                Felhasználónév
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input"
                placeholder="pl. admin"
                autoComplete="username"
                required
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#333333", marginBottom: 6 }}
              >
                Jelszó
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="password"
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  style={{ paddingRight: 38 }}
                  placeholder="Írd be a jelszót..."
                  autoComplete="current-password"
                  required
                  aria-describedby={error ? "login-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((p) => !p)}
                  aria-label={showPass ? "Elrejtés" : "Megjelenítés"}
                  style={{
                    position: "absolute",
                    inset: 0,
                    left: "auto",
                    right: 0,
                    width: 36,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#9ca3af",
                  }}
                >
                  {showPass ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>

              {error && (
                <p
                  id="login-error"
                  role="alert"
                  style={{
                    marginTop: 8,
                    fontSize: 12.5,
                    color: "#dc2626",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="btn btn-primary"
              style={{ width: "100%", height: 38, fontSize: 14, marginTop: 4, justifyContent: "center" }}
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Belépés...
                </>
              ) : (
                "Bejelentkezés"
              )}
            </button>
          </form>

          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px solid #F0F0F0",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 12, color: "#9ca3af" }}>
              Alapértelmezett: <code style={{ fontFamily: "monospace", color: "#333333", background: "#F0F0F0", padding: "1px 5px", borderRadius: 4 }}>admin / media2024</code>
            </p>
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
              (ADMIN_USERNAME / ADMIN_PASSWORD env-változóval módosítható)
            </p>
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 20 }}>
          Sonarr &amp; Radarr automatikus letöltő platform
        </p>
      </div>
    </div>
  );
}

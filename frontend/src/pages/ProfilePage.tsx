import { useCallback, useEffect, useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../utils/api";
import { getAuth } from "../utils/auth";
import { useToast } from "../components/Toast";

interface PasskeyEntry {
  id: string;
  name: string;
  created_at: string;
}

interface SessionEntry {
  id: string;
  platform: string;
  created_at: string;
  last_seen_at: string;
  is_current: boolean;
}

export default function ProfilePage() {
  const toast = useToast();
  const auth = getAuth();
  const [passkeys, setPasskeys] = useState<PasskeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const supported = browserSupportsWebAuthn();

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadPasskeys = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ credentials: PasskeyEntry[] }>("/api/auth/webauthn/credentials");
      setPasskeys(data.credentials ?? []);
    } catch {
      setPasskeys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await api<{ sessions: SessionEntry[] }>("/api/auth/sessions");
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => { loadPasskeys(); }, [loadPasskeys]);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function revokeSession(id: string) {
    setRevoking(id);
    try {
      await api(`/api/auth/sessions/${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success("Munkamenet kijelentkeztetve.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "A kijelentkeztetés nem sikerült.");
    } finally {
      setRevoking(null);
    }
  }

  function formatWhen(iso: string): string {
    return new Date(iso).toLocaleString("hu-HU", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  async function registerPasskey() {
    setRegistering(true);
    try {
      const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>(
        "/api/auth/webauthn/register/begin", { method: "POST" }
      );
      const credential = await startRegistration({ optionsJSON });
      const name = window.prompt("Nevezd el ezt a passkey-t (pl. eszköz/böngésző neve):", "Passkey") || "Passkey";
      await api("/api/auth/webauthn/register/finish", {
        method: "POST",
        body: JSON.stringify({ credential, name }),
      });
      toast.success("Passkey sikeresen regisztrálva.");
      loadPasskeys();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // A felhasználó megszakította a böngésző dialógusát — nincs teendő.
      } else {
        toast.error(err instanceof ApiError ? err.message : "A passkey regisztráció nem sikerült.");
      }
    } finally {
      setRegistering(false);
    }
  }

  async function deletePasskey(id: string) {
    if (!window.confirm("Biztosan törlöd ezt a passkey-t?")) return;
    setDeleting(id);
    try {
      await api(`/api/auth/webauthn/credentials/${id}`, { method: "DELETE" });
      setPasskeys((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "A törlés nem sikerült.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <AppShell>
      <div className="page-topbar">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Fiókom
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: 24 }}>
        <div style={{ maxWidth: 640 }}>
          <div className="card mb-4" style={{ padding: "14px 18px" }}>
            <h2 className="text-sm font-semibold text-gray-900">Felhasználó</h2>
            <p className="text-sm text-gray-600 mt-1">{auth?.username}</p>
            <p className="text-xs text-gray-400 mt-0.5">{auth?.role === "admin" ? "Admin" : "Felhasználó"}</p>
          </div>

          <div className="card overflow-hidden mb-4">
            <div className="card-header">
              <div>
                <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>Aktív munkamenetek</h2>
                <p className="text-xs text-gray-500 mt-1" style={{ lineHeight: 1.6, maxWidth: 460 }}>
                  Azok az eszközök/böngészők, ahol jelenleg be vagy jelentkezve. Egy nem ismerős bejegyzést
                  bármikor kijelentkeztethetsz innen.
                </p>
              </div>
            </div>
            {sessionsLoading ? (
              <div style={{ padding: "32px 20px", textAlign: "center" }}>
                <p className="text-sm text-gray-400">Betöltés...</p>
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center" }}>
                <p className="text-sm text-gray-400">Nincs aktív munkamenet.</p>
              </div>
            ) : (
              sessions.map((s, idx) => (
                <div key={s.id} style={{ padding: "10px 20px", borderTop: idx > 0 ? "1px solid var(--border-2)" : "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div className="text-sm text-gray-800" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {s.platform}
                      {s.is_current && <span className="badge badge-green">Ez az eszköz</span>}
                    </div>
                    <div className="text-xs text-gray-400">
                      Utolsó aktivitás: {formatWhen(s.last_seen_at)} · Bejelentkezve: {formatWhen(s.created_at)}
                    </div>
                  </div>
                  {!s.is_current && (
                    <button
                      onClick={() => revokeSession(s.id)}
                      disabled={revoking === s.id}
                      className="btn btn-secondary btn-sm"
                    >
                      {revoking === s.id ? "Kijelentkeztetés..." : "Kijelentkeztetés"}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="card-header">
              <div>
                <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>Passkey-k</h2>
                <p className="text-xs text-gray-500 mt-1" style={{ lineHeight: 1.6, maxWidth: 460 }}>
                  Jelszó nélkül, az eszközöd beépített hitelesítőjével (ujjlenyomat, arcfelismerés,
                  biztonsági kulcs) is bejelentkezhetsz, ha regisztrálsz egy passkey-t.
                </p>
              </div>
              {supported && (
                <button onClick={registerPasskey} disabled={registering} className="btn btn-primary btn-sm shrink-0">
                  {registering ? "Regisztráció..." : "Új passkey hozzáadása"}
                </button>
              )}
            </div>
            {!supported ? (
              <div style={{ padding: "32px 20px", textAlign: "center" }}>
                <p className="text-sm text-gray-400">Ez a böngésző nem támogatja a passkey-eket.</p>
              </div>
            ) : loading ? (
              <div style={{ padding: "32px 20px", textAlign: "center" }}>
                <p className="text-sm text-gray-400">Betöltés...</p>
              </div>
            ) : passkeys.length === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center" }}>
                <p className="text-sm text-gray-400">Még nincs regisztrált passkey.</p>
              </div>
            ) : (
              passkeys.map((p, idx) => (
                <div key={p.id} style={{ padding: "10px 20px", borderTop: idx > 0 ? "1px solid var(--border-2)" : "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div className="text-sm text-gray-800">{p.name}</div>
                    <div className="text-xs text-gray-400">
                      {new Date(p.created_at).toLocaleString("hu-HU", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <button
                    onClick={() => deletePasskey(p.id)}
                    disabled={deleting === p.id}
                    className="btn btn-secondary btn-sm"
                  >
                    {deleting === p.id ? "Törlés..." : "Törlés"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

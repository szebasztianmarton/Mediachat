import { useState, useEffect, useCallback } from "react";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../utils/api";
import { getAuth } from "../utils/auth";
import { logger } from "../utils/logger";
import type { ApiUser, UserRole } from "../types";

const roleLabel: Record<UserRole, string> = {
  admin: "Admin",
  user: "Felhasználó",
};

const roleBadge: Record<UserRole, string> = {
  admin: "badge badge-purple",
  user:  "badge badge-blue",
};

export default function UsersPage() {
  const currentUserId = getAuth()?.userId ?? null;
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({ username: "", password: "", role: "user" as UserRole });
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newPass, setNewPass] = useState("");
  const [showPass, setShowPass] = useState<Record<string, boolean>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ users: ApiUser[] }>("/api/users");
      setUsers(data.users);
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "A felhasználók betöltése nem sikerült.");
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.username.trim()) { setFormError("A felhasználónév nem lehet üres."); return; }
    if (form.password.length < 4) { setFormError("A jelszó legalább 4 karakter legyen."); return; }
    try {
      await api<ApiUser>("/api/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "A létrehozás nem sikerült.");
      return;
    }
    logger.success("users", `Új felhasználó létrehozva: ${form.username} (${form.role})`);
    setForm({ username: "", password: "", role: "user" });
    setFormSuccess("Felhasználó sikeresen létrehozva!");
    setTimeout(() => setFormSuccess(""), 3000);
    setAddingUser(false);
    reload();
  }

  async function handleDelete(user: ApiUser) {
    if (deleteConfirm !== user.id) {
      setDeleteConfirm(user.id);
      setTimeout(() => setDeleteConfirm(null), 3000);
      return;
    }
    try {
      await api(`/api/users/${user.id}`, { method: "DELETE" });
      logger.warn("users", `Felhasználó törölve: ${user.username}`);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "A törlés nem sikerült.");
    }
    setDeleteConfirm(null);
    reload();
  }

  async function handlePasswordSave(user: ApiUser) {
    if (newPass.length < 4) return;
    try {
      await api(`/api/users/${user.id}/password`, {
        method: "PUT",
        body: JSON.stringify({ password: newPass }),
      });
      logger.success("users", `Jelszó megváltoztatva: ${user.username}`);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "A jelszócsere nem sikerült.");
    }
    setEditingId(null);
    setNewPass("");
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("hu-HU", { year: "numeric", month: "short", day: "numeric" });
    } catch { return iso; }
  }

  return (
    <AppShell>
      {/* Top bar */}
      <div className="page-topbar">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Felhasználók
          </h1>
        </div>
        <button
          onClick={() => { setAddingUser((v) => !v); setFormError(""); }}
          className="btn btn-primary btn-sm"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Felhasználó hozzáadása
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: 24 }}>

        {loadError && (
          <div className="card mb-6" style={{ padding: "12px 16px", borderColor: "#D8D8D8", background: "#F5F5F5" }}>
            <p className="text-xs text-gray-700">{loadError}</p>
          </div>
        )}

        {/* Add user form */}
        {addingUser && (
          <div className="card overflow-hidden mb-6">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>
                Új felhasználó hozzáadása
              </h2>
              <button
                type="button"
                onClick={() => setAddingUser(false)}
                className="btn btn-ghost btn-sm"
                style={{ padding: "0 8px" }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleAdd} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Felhasználónév</label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    placeholder="pl. alice"
                    className="input"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Jelszó</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    className="input"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Szerepkör</label>
                  <div style={{ display: "flex", border: "1px solid #E0E0E0", borderRadius: 6, overflow: "hidden" }}>
                    {(["user", "admin"] as UserRole[]).map((r, i) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, role: r }))}
                        style={{
                          flex: 1,
                          padding: "7px 0",
                          fontSize: 12.5,
                          fontWeight: 500,
                          cursor: "pointer",
                          border: "none",
                          borderLeft: i > 0 ? "1px solid #E0E0E0" : "none",
                          background: form.role === r ? "#000000" : "#fff",
                          color: form.role === r ? "#fff" : "#6b7280",
                          transition: "none",
                          fontFamily: "inherit",
                        }}
                      >
                        {roleLabel[r]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {formError && (
                <p className="text-xs text-red-600 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  {formError}
                </p>
              )}

              {formSuccess && (
                <p className="text-xs text-gray-600 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                  {formSuccess}
                </p>
              )}

              <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
                <button type="submit" className="btn btn-primary btn-sm">Létrehozás</button>
                <button type="button" onClick={() => setAddingUser(false)} className="btn btn-secondary btn-sm">Mégse</button>
              </div>
            </form>
          </div>
        )}

        {/* User list */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>
              Felhasználók listája
            </h2>
            <span className="badge badge-gray">{users.length} felhasználó</span>
          </div>

          {users.length === 0 ? (
            <div style={{ padding: "48px 20px", textAlign: "center" }}>
              <p className="text-sm text-gray-400">Nincs felhasználó</p>
            </div>
          ) : (
            <div>
              {users.map((user, idx) => (
                <div
                  key={user.id}
                  style={{
                    padding: "14px 20px",
                    borderTop: idx > 0 ? "1px solid #E8E8E8" : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                    {/* Left */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 999,
                          background: "#F0F0F0",
                          border: "1px solid #E0E0E0",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#000000",
                        }}
                      >
                        {(user.username ?? user.display_name)[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>
                            {user.username ?? user.display_name}
                          </span>
                          {user.id === currentUserId && (
                            <span className="badge badge-gray" style={{ fontSize: 10 }}>te</span>
                          )}
                          <span className={roleBadge[user.role]}>
                            {roleLabel[user.role]}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Létrehozva: {formatDate(user.created_at)} · ID: <code style={{ fontFamily: "monospace", fontSize: 11 }}>{user.id.slice(0, 8)}</code>
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => { setEditingId(editingId === user.id ? null : user.id); setNewPass(""); }}
                        className="btn btn-secondary btn-sm"
                      >
                        Jelszó
                      </button>
                      <button
                        onClick={() => handleDelete(user)}
                        disabled={user.id === currentUserId}
                        className={`btn btn-sm ${deleteConfirm === user.id ? "btn-danger" : "btn-secondary"}`}
                      >
                        {deleteConfirm === user.id ? "Biztos?" : "Törlés"}
                      </button>
                    </div>
                  </div>

                  {/* Inline password edit */}
                  {editingId === user.id && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
                          <input
                            type={showPass[user.id] ? "text" : "password"}
                            value={newPass}
                            onChange={(e) => setNewPass(e.target.value)}
                            placeholder="Új jelszó (min. 4 karakter)..."
                            className="input"
                            style={{ paddingRight: 36 }}
                            autoComplete="new-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPass((s) => ({ ...s, [user.id]: !s[user.id] }))}
                            style={{
                              position: "absolute", inset: 0, left: "auto", right: 0,
                              width: 34, display: "flex", alignItems: "center", justifyContent: "center",
                              background: "none", border: "none", cursor: "pointer", color: "#9ca3af",
                            }}
                            aria-label={showPass[user.id] ? "Elrejtés" : "Megjelenítés"}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                        </div>
                        <button
                          onClick={() => handlePasswordSave(user)}
                          disabled={newPass.length < 4}
                          className="btn btn-primary btn-sm"
                        >
                          Mentés
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="btn btn-secondary btn-sm"
                        >
                          Mégse
                        </button>
                      </div>
                      {user.id === currentUserId && (
                        <p className="text-xs text-gray-400 mt-1.5">
                          A saját jelszavad módosítása után újra be kell jelentkezned.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          A felhasználók a szerveren tárolódnak, hash-elt jelszóval.
        </p>
      </div>
    </AppShell>
  );
}

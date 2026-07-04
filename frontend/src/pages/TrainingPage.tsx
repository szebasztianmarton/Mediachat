import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { AUTH_KEY } from "../types";
import { logger } from "../utils/logger";

interface FileMeta {
  name: string;
  stem: string;
  size: number;
}

const SYSTEM_FILE = "_system.txt";

function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n+/g, "</p><p>")
    .replace(/^(?!<[hul]|<\/[hul])(.+)$/gm, (m) =>
      m.startsWith("<") ? m : `<p>${m}</p>`
    );
}

export default function TrainingPage() {
  const navigate = useNavigate();

  const [files, setFiles] = useState<FileMeta[]>([]);
  const [hasSystem, setHasSystem] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(true);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const auth = localStorage.getItem(AUTH_KEY);
    if (!auth) navigate("/login", { replace: true });
  }, [navigate]);

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/training/files");
      if (!res.ok) return;
      const data = await res.json();
      setFiles(data.files ?? []);
      setHasSystem(data.has_system_prompt ?? false);
    } catch {
      logger.error("training", "Nem sikerült betölteni a fájllistát");
    }
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const loadFile = useCallback(async (name: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/training/files/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setContent(data.content ?? "");
      setSelected(name);
      setSaved(true);
      setPreview(false);
    } catch {
      setError("Nem sikerült betölteni a fájlt.");
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/training/files/${encodeURIComponent(selected)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(true);
      await loadFiles();
      logger.success("training", `Mentve: ${selected}`);
    } catch {
      setError("Mentés sikertelen.");
    } finally {
      setLoading(false);
    }
  }, [selected, content, loadFiles]);

  const deleteFile = useCallback(async (name: string) => {
    if (!confirm(`Törli: ${name}?`)) return;
    try {
      const res = await fetch(`/api/training/files/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      if (selected === name) { setSelected(null); setContent(""); }
      await loadFiles();
      logger.info("training", `Törölve: ${name}`);
    } catch {
      setError("Törlés sikertelen.");
    }
  }, [selected, loadFiles]);

  const createFile = useCallback(async () => {
    const raw = newName.trim();
    if (!raw) return;
    const fname = raw.endsWith(".md") ? raw : `${raw}.md`;
    if (!/^[a-zA-Z0-9_-]+\.md$/.test(fname)) {
      setError("Csak betűk, számok, - és _ megengedett a fájlnévben.");
      return;
    }
    setError("");
    try {
      await fetch(`/api/training/files/${encodeURIComponent(fname)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `# ${raw}\n\n` }),
      });
      await loadFiles();
      await loadFile(fname);
      setNewName("");
      setShowNew(false);
    } catch {
      setError("Nem sikerült létrehozni a fájlt.");
    }
  }, [newName, loadFiles, loadFile]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [save]);

  const isSystem = selected === SYSTEM_FILE;
  const fileSize = (bytes: number) =>
    bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

  return (
    <AppShell>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* File list sidebar */}
        <aside
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: "1px solid #E0E0E0",
            background: "#F5F5F5",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Sidebar header */}
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid #E0E0E0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span className="text-xs font-semibold text-gray-500" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Tudásbázis
            </span>
            <button
              onClick={() => setShowNew((v) => !v)}
              title="Új fájl"
              className="btn btn-ghost btn-sm"
              style={{ padding: "2px 6px" }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>

          {/* New file input */}
          {showNew && (
            <div style={{ padding: "8px 12px", borderBottom: "1px solid #E0E0E0", background: "#F0F0F0" }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createFile();
                  if (e.key === "Escape") { setShowNew(false); setNewName(""); }
                }}
                placeholder="fajlnev.md"
                className="input"
                style={{ fontSize: 12, padding: "5px 8px" }}
              />
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                <button onClick={createFile} className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: "center", fontSize: 11 }}>Létrehoz</button>
                <button onClick={() => { setShowNew(false); setNewName(""); }} className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: "center", fontSize: 11 }}>Mégse</button>
              </div>
            </div>
          )}

          {/* File list */}
          <div style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
            {/* System prompt */}
            <button
              onClick={() => loadFile(SYSTEM_FILE)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                background: selected === SYSTEM_FILE ? "#E8E8E8" : "transparent",
                borderRight: selected === SYSTEM_FILE ? "2px solid #000000" : "2px solid transparent",
                border: "none",
                transition: "none",
              }}
              onMouseEnter={(e) => { if (selected !== SYSTEM_FILE) e.currentTarget.style.background = "#E8E8E8"; }}
              onMouseLeave={(e) => { if (selected !== SYSTEM_FILE) e.currentTarget.style.background = "transparent"; }}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke={selected === SYSTEM_FILE ? "#000000" : "#9ca3af"} strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.28c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div style={{ minWidth: 0 }}>
                <p className="text-xs font-medium truncate" style={{ color: selected === SYSTEM_FILE ? "#000000" : "#333333" }}>
                  Rendszer prompt
                </p>
                <p className="text-[10px] text-gray-400">{hasSystem ? "Beállítva" : "Alapértelmezett"}</p>
              </div>
            </button>

            <div style={{ padding: "8px 12px 4px" }}>
              <p className="text-[10px] text-gray-400 uppercase font-medium" style={{ letterSpacing: "0.06em" }}>Markdown fájlok</p>
            </div>

            {files.length === 0 && (
              <p className="text-xs text-gray-400 italic" style={{ padding: "6px 12px" }}>
                Nincs fájl — hozz létre egyet
              </p>
            )}

            {files.map((f) => (
              <div
                key={f.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 12px",
                  cursor: "pointer",
                  background: selected === f.name ? "#E8E8E8" : "transparent",
                  borderRight: selected === f.name ? "2px solid #000000" : "2px solid transparent",
                  transition: "none",
                }}
                onClick={() => loadFile(f.name)}
                onMouseEnter={(e) => { if (selected !== f.name) e.currentTarget.style.background = "#E8E8E8"; }}
                onMouseLeave={(e) => { if (selected !== f.name) e.currentTarget.style.background = "transparent"; }}
              >
                <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="text-xs truncate" style={{ color: selected === f.name ? "#000000" : "#333333" }}>{f.stem}</p>
                  <p className="text-[10px] text-gray-400">{fileSize(f.size)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteFile(f.name); }}
                  className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100"
                  style={{ padding: "2px 4px", color: "#888888" }}
                  title="Törlés"
                  onMouseEnter={(e) => e.currentTarget.style.opacity = "1"}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <div style={{ padding: "10px 12px", borderTop: "1px solid #E0E0E0" }}>
            <p className="text-[10px] text-gray-400 leading-tight">
              A mentett fájlok tartalmát minden chat üzenet elé injektálja a modell kontextusába.
            </p>
          </div>
        </aside>

        {/* Editor area */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {selected ? (
            <>
              {/* Editor toolbar */}
              <div
                style={{
                  flexShrink: 0,
                  padding: "10px 16px",
                  borderBottom: "1px solid #E0E0E0",
                  background: "#FAFAFA",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="text-sm font-medium text-gray-700 truncate">
                    {isSystem ? "Rendszer prompt (_system.txt)" : selected}
                  </span>
                  {!saved && (
                    <span className="badge badge-red" style={{ fontSize: 10 }}>Nem mentett</span>
                  )}
                  {loading && (
                    <svg className="w-3.5 h-3.5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {!isSystem && (
                    <button
                      onClick={() => setPreview((v) => !v)}
                      className={`btn btn-sm ${preview ? "btn-primary" : "btn-secondary"}`}
                    >
                      {preview ? "Szerkesztés" : "Preview"}
                    </button>
                  )}
                  <button
                    onClick={save}
                    disabled={loading || saved}
                    className="btn btn-primary btn-sm"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Mentés
                    <span className="text-[10px] opacity-60">Ctrl+S</span>
                  </button>
                </div>
              </div>

              {error && (
                <div style={{ margin: "12px 16px 0", padding: "8px 12px", background: "#F5F5F5", border: "1px solid #D8D8D8", borderRadius: 6 }}>
                  <p className="text-xs text-gray-600">{error}</p>
                </div>
              )}

              {/* Editor / Preview */}
              <div style={{ flex: 1, overflow: "hidden" }}>
                {preview && !isSystem ? (
                  <div
                    className="prose prose-sm max-w-none"
                    style={{ height: "100%", overflowY: "auto", padding: "24px 32px", fontFamily: "Georgia, serif", color: "#000000" }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
                  />
                ) : (
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => { setContent(e.target.value); setSaved(false); }}
                    style={{
                      width: "100%",
                      height: "100%",
                      resize: "none",
                      padding: 24,
                      background: "#fff",
                      color: "#000000",
                      fontSize: 13,
                      lineHeight: 1.7,
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      border: 0,
                      outline: "none",
                    }}
                    placeholder={
                      isSystem
                        ? "Írd le a rendszer viselkedését, személyiségét, szabályait...\n\nPl: Te egy média asszisztens vagy. Segítesz filmeket és sorozatokat keresni..."
                        : "# Fejléc\n\nMarkdown szöveg...\n\n- Felsorolás 1\n- Felsorolás 2\n\n**Fontos:** valami"
                    }
                    spellCheck={false}
                  />
                )}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, textAlign: "center", padding: "32px" }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 999,
                  background: "#F0F0F0",
                  border: "1px solid #E0E0E0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Válassz egy fájlt a szerkesztéshez</p>
                <p className="text-xs text-gray-400 mt-1">vagy hozz létre újat a + gombbal</p>
              </div>
              <div className="card" style={{ maxWidth: 320, padding: "12px 16px" }}>
                <p className="text-xs text-gray-500 leading-relaxed">
                  <span className="font-semibold text-gray-700">Hogyan működik?</span><br />
                  Minden mentett fájl tartalma bekerül a chat kontextusába — a modell úgy válaszol, mintha "megtanulta" volna.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}

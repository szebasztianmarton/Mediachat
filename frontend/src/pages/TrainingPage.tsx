import { useState, useEffect, useCallback, useRef } from "react";
import AppShell from "../components/AppShell";
import SettingsNav from "../components/SettingsNav";
import { api, ApiError } from "../utils/api";
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
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [hasSystem, setHasSystem] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(true);
  const [viewMode, setViewMode] = useState<"edit" | "split" | "preview">("edit");
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Markdown formázás beszúrása a kijelölés köré (Notion-szerű toolbar)
  const insertFormat = useCallback((prefix: string, suffix: string, placeholder = "szöveg") => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    setContent((prev) => {
      const selectedText = prev.slice(start, end) || placeholder;
      return prev.slice(0, start) + prefix + selectedText + suffix + prev.slice(end);
    });
    setSaved(false);
    requestAnimationFrame(() => {
      ta.focus();
      const selectedLen = (end - start) || placeholder.length;
      ta.setSelectionRange(start + prefix.length, start + prefix.length + selectedLen);
    });
  }, []);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // ugyanaz a fájl újra kiválasztható legyen
    if (!file) return;
    const base = file.name.replace(/\.(md|txt|markdown)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
    if (!base) {
      setError("A fájlnévből nem képezhető érvényes név (csak betű, szám, - és _).");
      return;
    }
    const fname = `${base}.md`;
    setError("");
    try {
      const text = await file.text();
      await api(`/api/training/files/${encodeURIComponent(fname)}`, {
        method: "PUT",
        body: JSON.stringify({ content: text }),
      });
      await loadFilesRef.current?.();
      await loadFileRef.current?.(fname);
      logger.success("training", `Feltöltve: ${fname}`);
    } catch (err) {
      setError(err instanceof ApiError ? `Feltöltés sikertelen: ${err.message}` : "Feltöltés sikertelen.");
    }
  }, []);

  // ref-ek a feltöltéshez, hogy ne kelljen a useCallback függőségi láncot bővíteni
  const loadFilesRef = useRef<(() => Promise<void>) | null>(null);
  const loadFileRef = useRef<((name: string) => Promise<void>) | null>(null);

  const loadFiles = useCallback(async () => {
    try {
      const data = await api<{ files?: FileMeta[]; has_system_prompt?: boolean }>("/api/training/files");
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
      const data = await api<{ content?: string }>(`/api/training/files/${encodeURIComponent(name)}`);
      setContent(data.content ?? "");
      setSelected(name);
      setSaved(true);
      if (name === SYSTEM_FILE) setViewMode("edit");
    } catch {
      setError("Nem sikerült betölteni a fájlt.");
    } finally {
      setLoading(false);
    }
  }, []);

  loadFilesRef.current = loadFiles;
  loadFileRef.current = loadFile;

  const save = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      await api(`/api/training/files/${encodeURIComponent(selected)}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
      setSaved(true);
      await loadFiles();
      logger.success("training", `Mentve: ${selected}`);
    } catch (err) {
      setError(err instanceof ApiError ? `Mentés sikertelen: ${err.message}` : "Mentés sikertelen.");
    } finally {
      setLoading(false);
    }
  }, [selected, content, loadFiles]);

  const deleteFile = useCallback(async (name: string) => {
    if (!confirm(`Törli: ${name}?`)) return;
    try {
      await api(`/api/training/files/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (selected === name) { setSelected(null); setContent(""); }
      await loadFiles();
      logger.info("training", `Törölve: ${name}`);
    } catch (err) {
      setError(err instanceof ApiError ? `Törlés sikertelen: ${err.message}` : "Törlés sikertelen.");
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
      await api(`/api/training/files/${encodeURIComponent(fname)}`, {
        method: "PUT",
        body: JSON.stringify({ content: `# ${raw}\n\n` }),
      });
      await loadFiles();
      await loadFile(fname);
      setNewName("");
      setShowNew(false);
    } catch (err) {
      setError(err instanceof ApiError ? `Nem sikerült létrehozni: ${err.message}` : "Nem sikerült létrehozni a fájlt.");
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
      <SettingsNav />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* File list sidebar */}
        <aside
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            background: "var(--surface-2)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Sidebar header */}
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span className="text-xs font-semibold text-gray-500" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Tudásbázis
            </span>
            <div style={{ display: "flex", gap: 2 }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Markdown fájl feltöltése"
                className="btn btn-ghost btn-sm"
                style={{ padding: "2px 6px" }}
                aria-label="Markdown fájl feltöltése"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </button>
              <button
                onClick={() => setShowNew((v) => !v)}
                title="Új fájl"
                className="btn btn-ghost btn-sm"
                style={{ padding: "2px 6px" }}
                aria-label="Új fájl létrehozása"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.markdown"
              onChange={handleUpload}
              style={{ display: "none" }}
              aria-hidden="true"
            />
          </div>

          {/* New file input */}
          {showNew && (
            <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
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
                background: selected === SYSTEM_FILE ? "var(--surface-3)" : "transparent",
                borderRight: selected === SYSTEM_FILE ? "2px solid var(--ink)" : "2px solid transparent",
                border: "none",
                transition: "none",
              }}
              onMouseEnter={(e) => { if (selected !== SYSTEM_FILE) e.currentTarget.style.background = "var(--surface-3)"; }}
              onMouseLeave={(e) => { if (selected !== SYSTEM_FILE) e.currentTarget.style.background = "transparent"; }}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke={selected === SYSTEM_FILE ? "var(--ink)" : "var(--ink-3)"} strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.28c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div style={{ minWidth: 0 }}>
                <p className="text-xs font-medium truncate" style={{ color: selected === SYSTEM_FILE ? "var(--ink)" : "var(--ink-2)" }}>
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
                  background: selected === f.name ? "var(--surface-3)" : "transparent",
                  borderRight: selected === f.name ? "2px solid var(--ink)" : "2px solid transparent",
                  transition: "none",
                }}
                onClick={() => loadFile(f.name)}
                onMouseEnter={(e) => { if (selected !== f.name) e.currentTarget.style.background = "var(--surface-3)"; }}
                onMouseLeave={(e) => { if (selected !== f.name) e.currentTarget.style.background = "transparent"; }}
              >
                <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="text-xs truncate" style={{ color: selected === f.name ? "var(--ink)" : "var(--ink-2)" }}>{f.stem}</p>
                  <p className="text-[10px] text-gray-400">{fileSize(f.size)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteFile(f.name); }}
                  className="btn btn-ghost btn-sm"
                  style={{ padding: "2px 4px", color: "var(--ink-3)" }}
                  title="Törlés"
                  aria-label={`${f.stem} törlése`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
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
                  borderBottom: "1px solid var(--border)",
                  background: "var(--surface-2)",
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
                    <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                      {([["edit", "Szerkesztés"], ["split", "Osztott"], ["preview", "Előnézet"]] as const).map(([mode, label], i) => (
                        <button
                          key={mode}
                          onClick={() => setViewMode(mode)}
                          style={{
                            padding: "5px 10px",
                            fontSize: 11.5,
                            fontWeight: 500,
                            cursor: "pointer",
                            border: "none",
                            borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                            background: viewMode === mode ? "var(--primary-bg)" : "var(--surface)",
                            color: viewMode === mode ? "var(--primary-ink)" : "var(--ink-3)",
                            fontFamily: "inherit",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setShowHelp((v) => !v)}
                    className={`btn btn-sm ${showHelp ? "btn-primary" : "btn-ghost"}`}
                    title="Hogyan működik a tanítás?"
                    aria-label="Súgó"
                    style={{ padding: "0 8px" }}
                  >
                    ?
                  </button>
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

              {/* Formázó toolbar (Notion-szerű gyorsgombok) */}
              {viewMode !== "preview" && (
                <div
                  style={{
                    flexShrink: 0,
                    padding: "6px 16px",
                    borderBottom: "1px solid var(--border-2)",
                    background: "var(--surface)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                  role="toolbar"
                  aria-label="Markdown formázás"
                >
                  <button onClick={() => insertFormat("**", "**")} className="btn btn-ghost btn-sm" title="Félkövér" style={{ fontWeight: 700, padding: "0 8px" }}>B</button>
                  <button onClick={() => insertFormat("*", "*")} className="btn btn-ghost btn-sm" title="Dőlt" style={{ fontStyle: "italic", padding: "0 8px" }}>I</button>
                  <button onClick={() => insertFormat("\n## ", "\n", "Címsor")} className="btn btn-ghost btn-sm" title="Címsor" style={{ padding: "0 8px" }}>H2</button>
                  <button onClick={() => insertFormat("\n- ", "", "listaelem")} className="btn btn-ghost btn-sm" title="Felsorolás" style={{ padding: "0 8px" }}>≔</button>
                  <button onClick={() => insertFormat("`", "`", "kód")} className="btn btn-ghost btn-sm" title="Kód" style={{ fontFamily: "monospace", padding: "0 8px" }}>{"</>"}</button>
                </div>
              )}

              {/* Súgó panel */}
              {showHelp && (
                <div style={{ margin: "12px 16px 0", padding: "12px 16px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
                  <p className="text-xs font-semibold text-gray-800" style={{ marginBottom: 6 }}>Hogyan működik a tanítás?</p>
                  <ul className="text-xs text-gray-600" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                    <li><strong>Rendszer prompt</strong> — a modell alapszemélyisége és szabályai; ez adja a válaszok hangnemét.</li>
                    <li><strong>Markdown fájlok</strong> — tudásbázis: minden mentett fájl tartalma bekerül a chat kontextusába, a modell úgy válaszol, mintha ismerné.</li>
                    <li><strong>Feltöltés</strong> — kész .md fájlokat a bal oldali ⬆ gombbal tölthetsz fel; a törlés a fájl melletti ✕.</li>
                    <li><strong>Szerkesztés</strong> — a felső gombokkal formázhatsz (félkövér, címsor, lista); az Osztott nézetben élőben látod az eredményt. Mentés: Ctrl+S.</li>
                    <li>Rövid, tényszerű fájlok működnek a legjobban — a túl hosszú kontextus lassítja a választ.</li>
                  </ul>
                </div>
              )}

              {error && (
                <div style={{ margin: "12px 16px 0", padding: "8px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6 }}>
                  <p className="text-xs text-gray-600">{error}</p>
                </div>
              )}

              {/* Editor / Split / Preview */}
              <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
                {(viewMode !== "preview" || isSystem) && (
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => { setContent(e.target.value); setSaved(false); }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: "100%",
                      resize: "none",
                      padding: 24,
                      background: "var(--surface)",
                      color: "var(--ink)",
                      fontSize: 13,
                      lineHeight: 1.7,
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      border: 0,
                      borderRight: viewMode === "split" && !isSystem ? "1px solid var(--border)" : "none",
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
                {viewMode !== "edit" && !isSystem && (
                  <div
                    className="prose prose-sm max-w-none"
                    style={{ flex: 1, minWidth: 0, height: "100%", overflowY: "auto", padding: "24px 32px", fontFamily: "Georgia, serif", color: "var(--ink)", background: "var(--surface-2)" }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
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
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
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

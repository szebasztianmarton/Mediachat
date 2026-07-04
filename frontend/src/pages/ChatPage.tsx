import { useState, useRef, useEffect, useCallback } from "react";
import AppShell from "../components/AppShell";
import type { ServiceStatus } from "../types";
import { api, ApiError } from "../utils/api";
import { clearAuth, getAuth } from "../utils/auth";
import { logger } from "../utils/logger";

// Egyedi üzenet-ID-k — a Date.now() önmagában ütközhet gyors üzeneteknél.
let msgSeq = 0;
const nextMsgId = (prefix: string) => `${prefix}-${++msgSeq}-${Date.now()}`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface MediaResult {
  result_id: string;
  title: string;
  year?: number;
  overview: string;
  poster_url?: string;
  media_type: "movie" | "series";
  external_id: number;
  tmdb_id?: number;
  title_slug?: string;
  match_score: number;
}

interface AddedInfo {
  title: string;
  media_type: string;
  quality_note?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  timestamp: Date;
  action?: "search" | "add" | "chat";
  results?: MediaResult[];
  added?: AddedInfo;
}

// ── Inline search result card ─────────────────────────────────────────────────

type AddState = "idle" | "adding" | "added" | "error";

function InlineResultCard({
  result,
  onAdd,
}: {
  result: MediaResult;
  onAdd: (result: MediaResult) => Promise<void>;
}) {
  const [state, setState] = useState<AddState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleAdd() {
    setState("adding");
    setErrorMsg(null);
    try {
      await onAdd(result);
      setState("added");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Ismeretlen hiba");
    }
  }

  const isMovie = result.media_type === "movie";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        marginTop: 10,
        padding: "12px 14px",
        background: "#F5F5F5",
        border: "1px solid #E8E8E8",
        borderRadius: 10,
      }}
    >
      {/* Poster */}
      <div
        style={{
          width: 40,
          height: 56,
          background: "#e5e7eb",
          borderRadius: 6,
          flexShrink: 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {result.poster_url ? (
          <img src={result.poster_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span className="text-sm font-semibold text-gray-900" style={{ letterSpacing: "-0.01em" }}>{result.title}</span>
              {result.year && <span className="text-xs text-gray-400">{result.year}</span>}
              <span
                className="badge"
                style={{
                  background: "#F0F0F0",
                  color: "#000000",
                  borderColor: "transparent",
                  flexShrink: 0,
                }}
              >
                {isMovie ? "Film" : "Sorozat"}
              </span>
            </div>
            {result.overview && (
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{result.overview}</p>
            )}
          </div>

          <button
            onClick={handleAdd}
            disabled={state !== "idle"}
            className={`btn btn-sm shrink-0 ${
              state === "added"
                ? "btn-secondary"
                : state === "error"
                ? "btn-danger"
                : state === "adding"
                ? "btn-secondary"
                : "btn-primary"
            }`}
            style={state === "added" ? { color: "#000000", borderColor: "#E0E0E0" } : {}}
          >
            {state === "idle" && (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Hozzáad
              </>
            )}
            {state === "adding" && (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Hozzáad...
              </>
            )}
            {state === "added" && (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" />
                </svg>
                Hozzáadva
              </>
            )}
            {state === "error" && "Hiba"}
          </button>
        </div>

        {state === "error" && errorMsg && (
          <p className="text-xs text-red-600 mt-1.5">{errorMsg}</p>
        )}
      </div>
    </div>
  );
}

// ── Added success card ────────────────────────────────────────────────────────

function AddedSuccessCard({ added }: { added: AddedInfo }) {
  const dest = added.media_type === "series" ? "Sonarr" : "Radarr";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 10,
        padding: "10px 14px",
        background: "#F0F0F0",
        border: "1px solid #E0E0E0",
        borderRadius: 8,
      }}
    >
      <svg className="w-4 h-4 text-gray-700 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" />
      </svg>
      <div>
        <p className="text-xs font-semibold text-gray-800">„{added.title}" hozzáadva {dest}hoz</p>
        {added.quality_note && <p className="text-xs text-gray-600">{added.quality_note}</p>}
      </div>
    </div>
  );
}

// ── Welcome message ───────────────────────────────────────────────────────────

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Üdvözöllek! Media Assistant vagyok. Írj be egy film vagy sorozat nevét és megkeresem, vagy add hozzá közvetlenül: „add Breaking Bad”. Általános kérdésekre is válaszolok.",
  timestamp: new Date(),
};

// ── ChatPage ──────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<ServiceStatus>("checking");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;
    api<{ ollama?: boolean }>("/health")
      .then((d) => {
        if (cancelled) return;
        const ok = !!d.ollama;
        setOllamaStatus(ok ? "online" : "offline");
        logger.info("service", `Ollama állapot: ${ok ? "online" : "offline"}`);
      })
      .catch(() => { if (!cancelled) setOllamaStatus("offline"); });
    return () => { cancelled = true; };
  }, []);

  const handleAddMedia = useCallback(async (result: MediaResult) => {
    const data = await api<{ message?: string; job_id?: string | null }>("/api/add", {
      method: "POST",
      body: JSON.stringify({
        media_type: result.media_type,
        external_id: result.external_id,
        title: result.title,
        tmdb_id: result.tmdb_id ?? null,
        async_job: true,
      }),
    });

    if (data.job_id) {
      // A hozzáadás a háttérben fut — pollozzuk a job státuszát (max ~2 perc).
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const job = await api<{ status: string; message: string }>(`/api/jobs/${data.job_id}`);
        if (job.status === "completed") {
          logger.success("chat", job.message || `${result.title} hozzáadva`);
          return;
        }
        if (job.status === "failed") {
          throw new Error(job.message || "A hozzáadás nem sikerült.");
        }
      }
      throw new Error("Időtúllépés: a hozzáadás túl sokáig tart.");
    }
    logger.success("chat", data.message || `${result.title} hozzáadva`);
  }, []);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: nextMsgId("user"),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    // A textarea magassága visszaáll küldés után (a handleInput csak gépeléskor fut).
    if (inputRef.current) inputRef.current.style.height = "auto";
    setLoading(true);
    logger.info("chat", `Üzenet: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`);

    const aiId = nextMsgId("ai");
    let started = false;
    const ensureAiMessage = () => {
      if (started) return;
      started = true;
      setLoading(false); // az első tokentől a növekvő üzenet a visszajelzés
      setMessages((prev) => [
        ...prev,
        { id: aiId, role: "assistant", content: "", timestamp: new Date(), action: "chat" },
      ]);
    };

    try {
      const auth = getAuth();
      const res = await fetch("/api/chat/agent/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth?.token ? { "X-Session-Token": auth.token } : {}),
        },
        body: JSON.stringify({ message: text }),
      });

      if (res.status === 401) {
        clearAuth();
        window.location.href = "/login";
        return;
      }
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new ApiError(body.detail || `HTTP ${res.status}`, res.status);
      }

      // SSE stream feldolgozása — a chat válasz tokenenként érkezik.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let action: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const rawEvent of events) {
          const line = rawEvent.trim();
          if (!line.startsWith("data:")) continue;
          let event: {
            type: string;
            content?: string;
            message?: string;
            payload?: { action: string; message: string; results?: MediaResult[]; added?: AddedInfo };
          };
          try {
            event = JSON.parse(line.slice(5));
          } catch {
            continue;
          }

          if (event.type === "token" && event.content) {
            ensureAiMessage();
            setMessages((prev) =>
              prev.map((m) => (m.id === aiId ? { ...m, content: m.content + event.content } : m))
            );
          } else if (event.type === "result" && event.payload) {
            const p = event.payload;
            action = p.action;
            ensureAiMessage();
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiId
                  ? {
                      ...m,
                      content: p.message ?? "Sajnos üres választ kaptam.",
                      action: p.action as ChatMessage["action"],
                      results: p.results ?? undefined,
                      added: p.added ?? undefined,
                    }
                  : m
              )
            );
          } else if (event.type === "error") {
            ensureAiMessage();
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiId ? { ...m, role: "error" as const, content: event.message ?? "Hiba történt." } : m
              )
            );
          }
        }
      }

      // Ha a stream tokenek nélkül zárult (üres LLM válasz), ne maradjon üres buborék.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiId && m.role === "assistant" && m.content === "" && !m.results && !m.added
            ? { ...m, content: "Sajnos üres választ kaptam." }
            : m
        )
      );
      logger.success("chat", `Válasz kész (${action ?? "chat"})`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Ismeretlen hiba";
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== aiId || m.content !== ""),
        {
          id: nextMsgId("err"),
          role: "error",
          content: err instanceof ApiError
            ? `Hiba: ${err.message}`
            : "A backend nem érhető el. Ellenőrizd, hogy a szerver fut-e.",
          timestamp: new Date(),
        },
      ]);
      logger.error("chat", "Agent API hiba", detail);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
  }

  return (
    <AppShell>
      {/* Top bar */}
      <div className="page-topbar">
        <div className="flex-1 flex items-center gap-3">
          <h1 className="text-base font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
            Chat
          </h1>
          <span
            className="badge"
            style={{
              background: ollamaStatus === "online" ? "#F0F0F0" : ollamaStatus === "offline" ? "#EBEBEB" : "#F5F5F5",
              color: "#000000",
              borderColor: "#E0E0E0",
            }}
          >
            <span
              className="dot"
              style={{
                background: ollamaStatus === "online" ? "#000000" : ollamaStatus === "offline" ? "#888888" : "#AAAAAA",
                animation: ollamaStatus === "checking" ? "dot-pulse 1.5s ease-in-out infinite" : "none",
              }}
            />
            Ollama {ollamaStatus === "online" ? "Online" : ollamaStatus === "offline" ? "Offline" : "..."}
          </span>
          {ollamaStatus === "offline" && (
            <span className="text-xs text-gray-400 hidden sm:block">
              · Keresés és hozzáadás elérhető, AI chat korlátozott
            </span>
          )}
        </div>
      </div>

      {/* Messages + Input area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ maxWidth: 768, margin: "0 auto", padding: "24px 24px 8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  {/* AI / Error avatar */}
                  {msg.role !== "user" && (
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 999,
                        background: msg.role === "error" ? "#F0F0F0" : "#F5F5F5",
                        border: `1px solid ${msg.role === "error" ? "#E0E0E0" : "#D8D8D8"}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {msg.role === "error" ? (
                        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                      ) : msg.action === "add" ? (
                        <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : msg.action === "search" ? (
                        <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0016.803 15.803z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                      )}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      maxWidth: "82%",
                      alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      className={
                        msg.role === "user"
                          ? "chat-user"
                          : msg.role === "error"
                          ? "chat-error"
                          : "chat-ai"
                      }
                      style={{ whiteSpace: "pre-wrap" }}
                    >
                      {msg.content}

                      {/* Search results */}
                      {msg.results && msg.results.length > 0 && (
                        <div>
                          {msg.results.map((result) => (
                            <InlineResultCard key={result.result_id} result={result} onAdd={handleAddMedia} />
                          ))}
                        </div>
                      )}

                      {msg.action === "search" && msg.results && msg.results.length === 0 && (
                        <p className="text-xs text-gray-400 mt-2 italic">Próbálj más kulcsszóval keresni.</p>
                      )}

                      {msg.action === "add" && msg.added && (
                        <AddedSuccessCard added={msg.added} />
                      )}
                    </div>

                    <span style={{ fontSize: 11, color: "#9ca3af", padding: "0 2px" }}>
                      {msg.timestamp.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              ))}

              {/* Loading indicator */}
              {loading && (
                <div style={{ display: "flex", gap: 12, justifyContent: "flex-start" }}>
                  <div
                    style={{
                      width: 32, height: 32, borderRadius: 999,
                      background: "#F5F5F5", border: "1px solid #D8D8D8",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2,
                    }}
                  >
                    <svg className="w-4 h-4 text-gray-700 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                  <div className="chat-ai" style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center", height: 20 }}>
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          style={{
                            width: 6, height: 6, borderRadius: 3,
                            background: "#9ca3af",
                            animation: "bounce 1s ease-in-out infinite",
                            animationDelay: `${delay}ms`,
                            display: "inline-block",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
          </div>
        </div>

        {/* Input area */}
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid #D8D8D8",
            background: "#FAFAFA",
            padding: "12px 24px 16px",
          }}
        >
          <div style={{ maxWidth: 768, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder='Pl. "Cyberpunk Street sorozat" vagy "add Breaking Bad"...'
                className="textarea"
                style={{ flex: 1, minHeight: 40, maxHeight: 128 }}
                rows={1}
                disabled={loading}
                aria-label="Üzenet beviteli mező"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="btn btn-primary"
                style={{ height: 40, paddingLeft: 16, paddingRight: 16, flexShrink: 0 }}
                aria-label="Üzenet küldése"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Küld
              </button>
            </div>
            <p style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
              Enter küld · Shift+Enter új sor · Írj film/sorozat nevet a kereséshez
            </p>
          </div>
        </div>

      </div>
    </AppShell>
  );
}

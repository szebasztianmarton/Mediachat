import { Component } from "react";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#F9F9F9",
            padding: 24,
          }}
        >
          <div className="card" style={{ maxWidth: 420, padding: 28, textAlign: "center" }}>
            <h1
              style={{
                fontFamily: "'EB Garamond', Georgia, serif",
                fontSize: 22,
                color: "#000000",
                margin: "0 0 8px",
              }}
            >
              Hiba történt
            </h1>
            <p style={{ fontSize: 13, color: "#666666", margin: "0 0 12px" }}>
              Váratlan hiba lépett fel a felület megjelenítése közben.
            </p>
            <p
              style={{
                fontSize: 11,
                color: "#999999",
                fontFamily: "monospace",
                margin: "0 0 20px",
                wordBreak: "break-word",
              }}
            >
              {this.state.error.message}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                this.setState({ error: null });
                window.location.href = "/";
              }}
            >
              Vissza a kezdőlapra
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

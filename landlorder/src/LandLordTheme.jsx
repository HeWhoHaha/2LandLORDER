import { useState } from "react";

const tokens = {
  light: {
    "--color-bg": "#F9FAFB",
    "--color-surface": "#FFFFFF",
    "--color-surface-raised": "#F3F4F6",
    "--color-text": "#0F172A",
    "--color-text-muted": "#6B7280",
    "--color-border": "#E5E7EB",
    "--color-primary": "#16A34A",
    "--color-primary-hover": "#15803D",
    "--color-primary-subtle": "#DCFCE7",
    "--color-accent": "#D97706",
    "--color-accent-hover": "#B45309",
    "--color-accent-subtle": "#FEF3C7",
    "--color-danger": "#DC2626",
    "--color-danger-hover": "#B91C1C",
    "--color-danger-subtle": "#FEE2E2",
    "--color-nav-bg": "#0F172A",
    "--color-nav-text": "#D97706",
  },
  dark: {
    "--color-bg": "#0F172A",
    "--color-surface": "#1E293B",
    "--color-surface-raised": "#273548",
    "--color-text": "#F9FAFB",
    "--color-text-muted": "#94A3B8",
    "--color-border": "#334155",
    "--color-primary": "#16A34A",
    "--color-primary-hover": "#22C55E",
    "--color-primary-subtle": "#14532D",
    "--color-accent": "#D97706",
    "--color-accent-hover": "#F59E0B",
    "--color-accent-subtle": "#451A03",
    "--color-danger": "#DC2626",
    "--color-danger-hover": "#EF4444",
    "--color-danger-subtle": "#450A0A",
    "--color-nav-bg": "#0A1120",
    "--color-nav-text": "#D97706",
  },
};

function cssVarStyle(mode) {
  return Object.entries(tokens[mode])
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");
}

export default function LandLordTheme() {
  const [mode, setMode] = useState("dark");
  const t = tokens[mode];

  const css = `
    .ll-root {
      ${Object.entries(t).map(([k, v]) => `${k}: ${v};`).join("\n      ")}
      background: var(--color-bg);
      color: var(--color-text);
      font-family: 'Inter', system-ui, sans-serif;
      min-height: 100vh;
      transition: background 0.25s, color 0.25s;
    }
    .ll-nav {
      background: var(--color-nav-bg);
      padding: 0 24px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid var(--color-accent);
    }
    .ll-logo {
      font-weight: 800;
      font-size: 20px;
      letter-spacing: -0.5px;
      color: var(--color-accent);
    }
    .ll-logo span { color: #F9FAFB; font-weight: 400; }
    .ll-nav-links {
      display: flex;
      gap: 24px;
      align-items: center;
    }
    .ll-nav-link {
      color: var(--color-nav-text);
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      opacity: 0.85;
      cursor: pointer;
    }
    .ll-nav-link:hover { opacity: 1; }
    .ll-main { padding: 32px 24px; max-width: 900px; margin: 0 auto; }
    .ll-section { margin-bottom: 40px; }
    .ll-section-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--color-accent);
      margin-bottom: 16px;
    }
    .ll-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .ll-card-raised {
      background: var(--color-surface-raised);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .ll-heading {
      font-size: 22px;
      font-weight: 800;
      color: var(--color-text);
      margin-bottom: 6px;
    }
    .ll-subtext {
      font-size: 14px;
      color: var(--color-text-muted);
      margin-bottom: 20px;
      line-height: 1.6;
    }
    .ll-btn {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      border: none;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      letter-spacing: 0.3px;
    }
    .ll-btn:active { transform: scale(0.97); }
    .ll-btn-primary {
      background: var(--color-primary);
      color: #fff;
    }
    .ll-btn-primary:hover { background: var(--color-primary-hover); }
    .ll-btn-accent {
      background: var(--color-accent);
      color: #fff;
    }
    .ll-btn-accent:hover { background: var(--color-accent-hover); }
    .ll-btn-danger {
      background: var(--color-danger);
      color: #fff;
    }
    .ll-btn-danger:hover { background: var(--color-danger-hover); }
    .ll-btn-outline {
      background: transparent;
      color: var(--color-text);
      border: 1.5px solid var(--color-border);
    }
    .ll-btn-outline:hover { border-color: var(--color-accent); color: var(--color-accent); }
    .ll-btn-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .ll-stars { color: var(--color-accent); font-size: 18px; letter-spacing: 2px; }
    .ll-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .ll-badge-green {
      background: var(--color-primary-subtle);
      color: var(--color-primary);
    }
    .ll-badge-red {
      background: var(--color-danger-subtle);
      color: var(--color-danger);
    }
    .ll-badge-gold {
      background: var(--color-accent-subtle);
      color: var(--color-accent);
    }
    .ll-alert {
      padding: 14px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 12px;
      border-left: 4px solid;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .ll-alert-success {
      background: var(--color-primary-subtle);
      color: var(--color-primary);
      border-color: var(--color-primary);
    }
    .ll-alert-danger {
      background: var(--color-danger-subtle);
      color: var(--color-danger);
      border-color: var(--color-danger);
    }
    .ll-alert-warning {
      background: var(--color-accent-subtle);
      color: var(--color-accent);
      border-color: var(--color-accent);
    }
    .ll-input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1.5px solid var(--color-border);
      background: var(--color-bg);
      color: var(--color-text);
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
    }
    .ll-input:focus { border-color: var(--color-primary); }
    .ll-input::placeholder { color: var(--color-text-muted); }
    .ll-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text-muted);
      margin-bottom: 6px;
      display: block;
    }
    .ll-form-group { margin-bottom: 16px; }
    .ll-divider {
      border: none;
      border-top: 1px solid var(--color-border);
      margin: 24px 0;
    }
    .ll-star-row { display: flex; gap: 4px; align-items: center; }
    .ll-rating-bar { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
    .ll-bar-track {
      flex: 1;
      height: 8px;
      background: var(--color-border);
      border-radius: 99px;
      overflow: hidden;
    }
    .ll-bar-fill {
      height: 100%;
      border-radius: 99px;
      background: var(--color-accent);
    }
    .ll-bar-label { font-size: 12px; color: var(--color-text-muted); width: 80px; }
    .ll-bar-pct { font-size: 12px; color: var(--color-text-muted); width: 36px; text-align: right; }
    .ll-toggle-wrapper {
      position: fixed;
      top: 16px;
      right: 24px;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ll-toggle {
      background: var(--color-surface);
      border: 1.5px solid var(--color-border);
      border-radius: 999px;
      padding: 6px 16px;
      font-size: 13px;
      font-weight: 700;
      color: var(--color-text);
      cursor: pointer;
    }
    .ll-swatch-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .ll-swatch {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .ll-swatch-circle {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      border: 2px solid var(--color-border);
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    }
    .ll-swatch-name { font-size: 11px; color: var(--color-text-muted); font-weight: 600; text-align: center; }
    .ll-swatch-hex { font-size: 10px; color: var(--color-text-muted); font-family: monospace; }
    .ll-review-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 12px;
    }
    .ll-reviewer { font-weight: 700; font-size: 14px; color: var(--color-text); }
    .ll-review-meta { font-size: 12px; color: var(--color-text-muted); margin-bottom: 8px; }
    .ll-review-body { font-size: 14px; color: var(--color-text); line-height: 1.6; }
    .ll-accent-bar {
      height: 3px;
      background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-accent) 50%, var(--color-danger) 100%);
      border-radius: 2px;
      margin-bottom: 24px;
    }
  `;

  const swatches = [
    { name: "Green", hex: "#16A34A", label: "Primary Actions" },
    { name: "Red", hex: "#DC2626", label: "Danger / Alerts" },
    { name: "Gold", hex: "#D97706", label: "Brand Accent" },
    { name: "White", hex: "#F9FAFB", label: "Surfaces" },
    { name: "Near Black", hex: "#0F172A", label: "Nav / Dark BG" },
  ];

  return (
    <>
      <style>{css}</style>
      <div className="ll-root">
        {/* Mode Toggle */}
        <div className="ll-toggle-wrapper">
          <button
            className="ll-toggle"
            onClick={() => setMode(mode === "dark" ? "light" : "dark")}
            style={{
              background: tokens[mode]["--color-surface"],
              color: tokens[mode]["--color-text"],
              border: `1.5px solid ${tokens[mode]["--color-border"]}`,
            }}
          >
            {mode === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>

        {/* Nav */}
        <nav className="ll-nav">
          <div className="ll-logo">
            Land<span>Lord</span>er
          </div>
          <div className="ll-nav-links">
            <span className="ll-nav-link">Search</span>
            <span className="ll-nav-link">Reviews</span>
            <span className="ll-nav-link">Sign In</span>
            <button
              className="ll-btn ll-btn-primary"
              style={{ padding: "7px 16px", fontSize: "13px" }}
            >
              Get Started
            </button>
          </div>
        </nav>

        <div className="ll-main">
          <div className="ll-accent-bar" />

          {/* Palette Swatches */}
          <div className="ll-section">
            <div className="ll-section-label">Color Palette</div>
            <div className="ll-card">
              <div className="ll-swatch-row">
                {swatches.map((s) => (
                  <div className="ll-swatch" key={s.name}>
                    <div
                      className="ll-swatch-circle"
                      style={{ background: s.hex }}
                    />
                    <div className="ll-swatch-name">{s.name}</div>
                    <div className="ll-swatch-hex">{s.hex}</div>
                    <div className="ll-swatch-name" style={{ opacity: 0.7 }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="ll-section">
            <div className="ll-section-label">Buttons</div>
            <div className="ll-card">
              <div className="ll-btn-row">
                <button className="ll-btn ll-btn-primary">Submit Review</button>
                <button className="ll-btn ll-btn-accent">Search Landlord</button>
                <button className="ll-btn ll-btn-danger">Flag Listing</button>
                <button className="ll-btn ll-btn-outline">Cancel</button>
              </div>
            </div>
          </div>

          {/* Alerts */}
          <div className="ll-section">
            <div className="ll-section-label">Alerts & Status</div>
            <div className="ll-card">
              <div className="ll-alert ll-alert-success">
                <span>✅</span> Review submitted successfully.
              </div>
              <div className="ll-alert ll-alert-danger">
                <span>🚫</span> Landlord has unresolved complaints on file.
              </div>
              <div className="ll-alert ll-alert-warning">
                <span>⚠️</span> Annual listing limit reached. Upgrade to add more.
              </div>
            </div>
          </div>

          {/* Badges */}
          <div className="ll-section">
            <div className="ll-section-label">Badges</div>
            <div className="ll-card">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span className="ll-badge ll-badge-green">✓ Verified Tenant</span>
                <span className="ll-badge ll-badge-gold">⭐ Landlord Pro</span>
                <span className="ll-badge ll-badge-red">⚠ Flagged</span>
                <span className="ll-badge ll-badge-green">In-State Landlord</span>
                <span className="ll-badge ll-badge-gold">Enterprise</span>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="ll-section">
            <div className="ll-section-label">Search / Form</div>
            <div className="ll-card">
              <div className="ll-form-group">
                <label className="ll-label">Landlord Name or Address</label>
                <input
                  className="ll-input"
                  placeholder="e.g. John Smith or 123 Main St, Columbus OH"
                />
              </div>
              <div className="ll-form-group">
                <label className="ll-label">City</label>
                <input className="ll-input" placeholder="Columbus" />
              </div>
              <button className="ll-btn ll-btn-accent" style={{ width: "100%" }}>
                🔍 Search LandLorder
              </button>
            </div>
          </div>

          {/* Sample Review Card */}
          <div className="ll-section">
            <div className="ll-section-label">Sample Landlord Profile</div>
            <div className="ll-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <div className="ll-heading">Midtown Property Group</div>
                  <div className="ll-subtext" style={{ marginBottom: 8 }}>
                    1423 Broad St, Columbus, OH 43215
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="ll-badge ll-badge-gold">⭐ Landlord Pro</span>
                    <span className="ll-badge ll-badge-green">In-State Landlord</span>
                    <span className="ll-badge ll-badge-green">✓ Verified</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: 40,
                      fontWeight: 800,
                      color: tokens[mode]["--color-accent"],
                      lineHeight: 1,
                    }}
                  >
                    4.1
                  </div>
                  <div className="ll-stars">★★★★☆</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: tokens[mode]["--color-text-muted"],
                    }}
                  >
                    38 reviews
                  </div>
                </div>
              </div>

              <hr className="ll-divider" />

              {/* Rating Bars */}
              <div style={{ marginBottom: 20 }}>
                {[
                  { label: "Maintenance", pct: 82 },
                  { label: "Communication", pct: 74 },
                  { label: "Fairness", pct: 68 },
                  { label: "Cleanliness", pct: 90 },
                ].map((r) => (
                  <div className="ll-rating-bar" key={r.label}>
                    <div className="ll-bar-label">{r.label}</div>
                    <div className="ll-bar-track">
                      <div
                        className="ll-bar-fill"
                        style={{ width: `${r.pct}%` }}
                      />
                    </div>
                    <div className="ll-bar-pct">{r.pct}%</div>
                  </div>
                ))}
              </div>

              <div className="ll-btn-row">
                <button className="ll-btn ll-btn-primary">Write a Review</button>
                <button className="ll-btn ll-btn-outline">View BBB Profile</button>
                <button className="ll-btn ll-btn-danger">Flag</button>
              </div>
            </div>

            {/* Review */}
            <div className="ll-review-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <div className="ll-reviewer">TenantVoice_Mia</div>
                <span className="ll-badge ll-badge-green">✓ Verified Tenant</span>
              </div>
              <div className="ll-review-meta">
                <span className="ll-stars" style={{ fontSize: 14 }}>
                  ★★★★☆
                </span>{" "}
                · 2 weeks ago · Columbus, OH
              </div>
              <div className="ll-review-body">
                Maintenance always responded within 24 hours and the property was
                well-kept. Lease terms were straightforward with no hidden fees.
                Would rent again.
              </div>
            </div>
          </div>

          {/* CSS Export */}
          <div className="ll-section">
            <div className="ll-section-label">CSS Variables — Copy Into App.jsx / index.css</div>
            <div
              className="ll-card"
              style={{ fontFamily: "monospace", fontSize: 12 }}
            >
              <pre
                style={{
                  color: tokens[mode]["--color-text"],
                  overflowX: "auto",
                  margin: 0,
                  lineHeight: 1.7,
                }}
              >
{`:root {
  --color-bg: #F9FAFB;
  --color-surface: #FFFFFF;
  --color-surface-raised: #F3F4F6;
  --color-text: #0F172A;
  --color-text-muted: #6B7280;
  --color-border: #E5E7EB;
  --color-primary: #16A34A;
  --color-primary-hover: #15803D;
  --color-primary-subtle: #DCFCE7;
  --color-accent: #D97706;
  --color-accent-hover: #B45309;
  --color-accent-subtle: #FEF3C7;
  --color-danger: #DC2626;
  --color-danger-hover: #B91C1C;
  --color-danger-subtle: #FEE2E2;
  --color-nav-bg: #0F172A;
  --color-nav-text: #D97706;
}

[data-theme="dark"] {
  --color-bg: #0F172A;
  --color-surface: #1E293B;
  --color-surface-raised: #273548;
  --color-text: #F9FAFB;
  --color-text-muted: #94A3B8;
  --color-border: #334155;
  --color-primary: #16A34A;
  --color-primary-hover: #22C55E;
  --color-primary-subtle: #14532D;
  --color-accent: #D97706;
  --color-accent-hover: #F59E0B;
  --color-accent-subtle: #451A03;
  --color-danger: #DC2626;
  --color-danger-hover: #EF4444;
  --color-danger-subtle: #450A0A;
  --color-nav-bg: #0A1120;
  --color-nav-text: #D97706;
}`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

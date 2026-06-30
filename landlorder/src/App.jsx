// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILE: App.jsx
// PURPOSE: LandLorder — full-stack React SPA
//   • Landlord search + reviews frontend
//   • Node.js/Express backend API (http://localhost:3001)
//   • Google Places address autocomplete
//   • Supabase Auth (email/password + magic link + session refresh)
//
// COLOR GUIDE:
//   Amber  (#E8A045) = standard UI / amber review stars
//   Teal   (#2DD4BF) = real backend API calls (your Node server)
//   Green  (#3ECF8E) = Supabase Auth (external auth service)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── REACT HOOKS ──────────────────────────────────────────────────
// useState   = component-level state (re-renders when changed)
// useEffect  = side effects (API calls, timers, subscriptions)
// useCallback= memoised function — prevents re-creating on every render
// useRef     = mutable ref that doesn't trigger re-renders (DOM nodes, timers)
import { useState, useEffect, useCallback, useRef } from "react";

// ── GOOGLE FONTS ─────────────────────────────────────────────────
// Injected as a <style> tag. Three families:
//   Playfair Display = editorial serif headings
//   DM Sans          = clean UI body text
//   JetBrains Mono   = monospaced labels / API traces
const FONT = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap');`;


// ╔══════════════════════════════════════════════════════════════╗
// ║  SECTION 1 — GOOGLE PLACES API                              ║
// ║  Purpose: Normalise free-text addresses into structured     ║
// ║  street/city/state/zip/lat/lng/placeId objects before       ║
// ║  storing in Postgres. Prevents duplicate or messy entries.  ║
// ╚══════════════════════════════════════════════════════════════╝

// ── ENVIRONMENT VARIABLES ─────────────────────────────────────────
// In Vite (npm run dev / npm run build) these come from .env.local
// In the Claude artifact preview, import.meta is not available
// so we fall back to empty strings — the app still renders,
// API calls will fail until connected to a real backend
const ENV = (typeof import.meta !== "undefined" && import.meta.env)
  ? import.meta.env
  : {};

const GOOGLE_API_KEY = ENV.VITE_GOOGLE_PLACES_KEY || "";
const SUPABASE_URL_ENV  = ENV.VITE_SUPABASE_URL  || "";
const SUPABASE_ANON_ENV = ENV.VITE_SUPABASE_ANON_KEY || "";
const API_BASE_ENV      = ENV.VITE_API_BASE || "http://localhost:3001/api";

// Loads the Google Maps JS SDK once into the <head>.
// Guard flag prevents duplicate <script> injection on re-renders.
let googleScriptLoaded = false;
function loadGooglePlaces() {
  // Skip if already loaded or script tag already exists in DOM
  if (googleScriptLoaded || document.getElementById("gplaces-script")) return;
  googleScriptLoaded = true;
  const s = document.createElement("script");
  s.id  = "gplaces-script";
  // ?libraries=places enables the Places autocomplete + details APIs
  s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places`;
  s.async = true; // non-blocking — doesn't pause page rendering
  document.head.appendChild(s);
}

// Converts a raw Google Places Detail result into a flat object
// that maps directly to Postgres columns (address, city, state…).
// Google returns an array of "address_components" — we extract each
// piece by its "type" tag (e.g. "locality" = city, "route" = street name).
function parsePlaceResult(place) {
  // Helper: find the component matching a specific type tag
  const get = (type) => place.address_components?.find(c => c.types.includes(type));
  const streetNum = get("street_number")?.long_name || ""; // e.g. "123"
  const route     = get("route")?.long_name          || ""; // e.g. "Main St"
  return {
    street:    [streetNum, route].filter(Boolean).join(" "), // "123 Main St"
    city:      get("locality")?.long_name || get("sublocality")?.long_name || "",
    state:     get("administrative_area_level_1")?.short_name || "", // e.g. "NY"
    zip:       get("postal_code")?.long_name  || "",
    country:   get("country")?.short_name     || "",          // e.g. "US"
    lat:       place.geometry?.location?.lat() ?? null,       // latitude float
    lng:       place.geometry?.location?.lng() ?? null,       // longitude float
    placeId:   place.place_id                  || "",          // unique Google ID
    formatted: place.formatted_address         || "",          // full human string
  };
}

// ── AddressAutocomplete Component ────────────────────────────────
// A controlled input that:
//  1. Loads Google Places SDK on mount
//  2. Debounces keystrokes → calls Autocomplete API (predictions)
//  3. On suggestion click → calls Place Details API (full address)
//  4. Calls onSelect(parsedAddress) to pass structured data up to parent
//  5. Shows a teal breakdown card when address is confirmed
function AddressAutocomplete({ onSelect, initialValue = "", placeData = null }) {
  // ── Local state ───────────────────────────────────────────────
  const [query,       setQuery]       = useState(initialValue); // current input value
  const [suggestions, setSuggestions] = useState([]);           // autocomplete list
  const [loading,     setLoading]     = useState(false);        // spinner flag
  const [confirmed,   setConfirmed]   = useState(!!initialValue);// address locked in
  const [error,       setError]       = useState("");           // inline error message
  const [focused,     setFocused]     = useState(false);        // input focus state
  // True once window.google.maps.places is available in the browser
  const [apiReady, setApiReady] = useState(
    typeof window !== "undefined" && !!window.google?.maps?.places
  );

  // ── Refs (don't trigger re-renders) ──────────────────────────
  const inputRef    = useRef(null); // DOM ref to <input> for programmatic focus
  const sessionRef  = useRef(null); // AutocompleteSessionToken — groups predict+detail calls for billing
  const svcRef      = useRef(null); // AutocompleteService instance (predictions)
  const detailRef   = useRef(null); // PlacesService instance (detail lookup)
  const debounceRef = useRef(null); // setTimeout handle for debounce cleanup

  // ── Effect 1: Load script, then poll until window.google is ready ──
  useEffect(() => {
    loadGooglePlaces(); // inject <script> if not already present
    if (apiReady) return;
    // Poll every 300ms — SDK loads async so we can't know exact ready time
    const interval = setInterval(() => {
      if (window.google?.maps?.places) {
        setApiReady(true);
        clearInterval(interval); // stop polling once ready
      }
    }, 300);
    return () => clearInterval(interval); // cleanup on unmount
  }, [apiReady]);

  // ── Effect 2: Initialise Google services once SDK is loaded ──
  useEffect(() => {
    if (!apiReady) return;
    // Session token batches autocomplete + detail into one billing event
    sessionRef.current = new window.google.maps.places.AutocompleteSessionToken();
    // AutocompleteService: getPlacePredictions() — text → list of matches
    svcRef.current     = new window.google.maps.places.AutocompleteService();
    // PlacesService: getDetails() — placeId → full address components
    // Needs a DOM element as container (even a detached div works)
    detailRef.current  = new window.google.maps.places.PlacesService(document.createElement("div"));
  }, [apiReady]);

  // ── fetchSuggestions: calls Autocomplete API ──────────────────
  // Wrapped in useCallback so it's stable across renders (avoids effect loops)
  const fetchSuggestions = useCallback((val) => {
    if (!svcRef.current || val.length < 3) {
      setSuggestions([]); // clear if input too short
      return;
    }
    setLoading(true);
    svcRef.current.getPlacePredictions(
      {
        input:              val,
        sessionToken:       sessionRef.current,
        types:              ["address"],          // addresses only, not businesses
        componentRestrictions: { country: "us" }, // US addresses only
      },
      (preds, status) => {
        setLoading(false);
        if (status === window.google.maps.places.PlacesServiceStatus.OK && preds) {
          setSuggestions(preds.slice(0, 5)); // show max 5 suggestions
        } else {
          setSuggestions([]);
        }
      }
    );
  }, []);

  // ── handleChange: fires on every keystroke ────────────────────
  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setConfirmed(false); // reset confirmed state when user edits
    setError("");
    clearTimeout(debounceRef.current); // cancel previous debounce
    if (!apiReady) { setError("Google Places loading…"); return; }
    // Debounce: wait 280ms after last keystroke before calling API
    // This prevents a request on every single character typed
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 280);
  };

  // ── handleSelect: fires when user clicks a suggestion ─────────
  const handleSelect = (pred) => {
    setQuery(pred.description); // show full address string in input
    setSuggestions([]);          // close dropdown
    setLoading(true);
    // Fetch full details using the placeId from the prediction
    detailRef.current.getDetails(
      {
        placeId:      pred.place_id,
        sessionToken: sessionRef.current,
        // Only request fields we actually need — reduces billing cost
        fields: ["address_components", "geometry", "formatted_address", "place_id"],
      },
      (place, status) => {
        setLoading(false);
        if (status === window.google.maps.places.PlacesServiceStatus.OK && place) {
          const parsed = parsePlaceResult(place); // flatten into our schema
          setQuery(parsed.formatted);             // show clean formatted address
          setConfirmed(true);                     // lock in green confirmed state
          onSelect(parsed);                       // lift data up to parent form
          // New session token for next autocomplete interaction
          sessionRef.current = new window.google.maps.places.AutocompleteSessionToken();
        } else {
          setError("Could not retrieve address details. Try again.");
        }
      }
    );
  };

  // ── handleClear: resets the entire address field ──────────────
  const handleClear = () => {
    setQuery(""); setConfirmed(false); setSuggestions([]); setError("");
    onSelect(null); // tell parent form: address removed
    inputRef.current?.focus();
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative" }}>
      {/* Main input with dynamic border colour based on state */}
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          // 180ms delay lets onMouseDown on a suggestion fire before blur closes dropdown
          onBlur={() => setTimeout(() => { setFocused(false); setSuggestions([]); }, 180)}
          placeholder="Start typing a street address…"
          autoComplete="off" // disable browser autocomplete — we handle it
          style={{
            width: "100%", background: "#0a1817",
            // Green = confirmed, teal = focused, dim = idle
            border: `1px solid ${confirmed ? "#4CAF87" : focused ? API_COLOR : API_BORDER}`,
            borderRadius: 10, padding: "13px 44px 13px 16px", fontSize: 14,
            color: "#e0faf7", fontFamily: "'DM Sans', sans-serif",
            outline: "none", boxSizing: "border-box", transition: "border-color .2s",
          }}
        />
        {/* Icon: ⟳ loading | ✓ confirmed (click to clear) | ⌕ idle */}
        <span
          style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", fontSize:16, cursor: confirmed ? "pointer" : "default" }}
          onClick={confirmed ? handleClear : undefined}
          title={confirmed ? "Clear address" : loading ? "Looking up…" : ""}>
          {loading ? "⟳" : confirmed ? "✓" : "⌕"}
        </span>
      </div>

      {/* Suggestion dropdown — only visible when input focused + predictions exist */}
      {suggestions.length > 0 && focused && (
        <div style={{
          position:"absolute", top:"calc(100% + 6px)", left:0, right:0, zIndex:999,
          background:"#0d1a19", border:`1px solid ${API_BORDER}`, borderRadius:10,
          overflow:"hidden", boxShadow:"0 8px 32px #000a",
        }}>
          {suggestions.map((p, i) => (
            <div key={p.place_id}
              onMouseDown={() => handleSelect(p)} // mouseDown fires before onBlur
              style={{
                padding:"11px 16px", cursor:"pointer", fontSize:13, color:"#c0e8e4",
                fontFamily:"'DM Sans', sans-serif",
                borderBottom: i < suggestions.length - 1 ? `1px solid ${API_BORDER}` : "none",
                transition:"background .12s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#162a28"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ color: API_COLOR, marginRight: 8 }}>📍</span>
              {/* Google splits each prediction into main (street) + secondary (city, state) */}
              <span style={{ color:"#e0faf7" }}>{p.structured_formatting?.main_text}</span>
              <span style={{ color:"#2a5550", marginLeft:6 }}>{p.structured_formatting?.secondary_text}</span>
            </div>
          ))}
          <div style={{ padding:"6px 16px", fontSize:10, color:"#1a3836", fontFamily:"'JetBrains Mono', monospace", borderTop:`1px solid ${API_BORDER}` }}>
            Powered by Google Places API
          </div>
        </div>
      )}

      {/* Inline error message (e.g. Details API failed) */}
      {error && <p style={{ fontSize:11, color:"#E05454", marginTop:6, marginBottom:0 }}>{error}</p>}

      {/* Confirmed address breakdown card — shows parsed fields for transparency */}
      {confirmed && (
        <div style={{ marginTop:10, background:API_BG, border:`1px solid ${API_BORDER}`, borderRadius:8, padding:"10px 14px" }}>
          <div style={{ fontSize:9, color:API_COLOR, fontFamily:"'JetBrains Mono', monospace", letterSpacing:"0.12em", marginBottom:8 }}>
            ✓ NORMALIZED ADDRESS
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"6px 16px" }}>
            {[
              ["street",  "Street"],
              ["city",    "City"],
              ["state",   "State"],
              ["zip",     "ZIP"],
              ["country", "Country"],
              ["placeId", "Place ID"],
            ].map(([k, label]) => (
              <div key={k} style={{ fontSize:11 }}>
                <div style={{ color:"#2a5550", fontFamily:"'JetBrains Mono', monospace", fontSize:9, marginBottom:1 }}>{label}</div>
                <div style={{ color:"#c0e8e4", wordBreak:"break-all" }}>{placeData?.[k] || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ╔══════════════════════════════════════════════════════════════╗
// ║  SECTION 2 — SUPABASE AUTH CONFIG                          ║
// ║  Purpose: Handles all authentication. No SDK needed —      ║
// ║  we call Supabase's REST auth endpoints directly.          ║
// ║  Returns JWT access_token used as Bearer on all API calls. ║
// ╚══════════════════════════════════════════════════════════════╝

// Project URL and anon key — set via .env.local in Vite
const SUPABASE_URL  = SUPABASE_URL_ENV;
const SUPABASE_ANON = SUPABASE_ANON_ENV;

// Visual theme constants for Supabase-related UI elements
const SB_COLOR  = "#3ECF8E"; // Supabase brand green
const SB_BG     = "#0a1f14";
const SB_BORDER = "#1a3a28";

// Base fetch wrapper for all Supabase REST API calls.
// Automatically attaches the apikey header required by every Supabase request.
const sbFetch = (path, opts = {}) =>
  fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON, // identifies the project (not a secret)
      ...opts.headers,          // allow callers to add Authorization etc.
    },
  }).then(r => r.json()); // always parse as JSON

// All Supabase Auth operations as named methods.
// These map directly to Supabase's GoTrue auth service endpoints.
const supabaseAuth = {

  // Register — creates a new user and sends a confirmation email.
  // User CANNOT sign in until they click the email link (verified = true).
  signUp: (email, password) =>
    sbFetch("/auth/v1/signup", { method: "POST", body: JSON.stringify({ email, password }) }),

  // Login — verifies credentials, returns { access_token, refresh_token, user }.
  // access_token = short-lived JWT (1 hour by default)
  // refresh_token = long-lived token used to get new access tokens silently
  signIn: (email, password) =>
    sbFetch("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) }),

  // Magic link — sends a one-time sign-in URL to the user's email.
  // No password needed. Supabase redirects back with a session token.
  magicLink: (email) =>
    sbFetch("/auth/v1/magiclink", { method: "POST", body: JSON.stringify({ email }) }),

  // Get current user data from an access token — used to verify token validity.
  getUser: (accessToken) =>
    sbFetch("/auth/v1/user", { headers: { Authorization: `Bearer ${accessToken}` } }),

  // Refresh — exchanges a refresh_token for a new access_token.
  // Called silently on app load so users don't have to re-login every hour.
  refreshToken: (refreshToken) =>
    sbFetch("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }),

  // Sign out — invalidates the access_token server-side, then we clear localStorage.
  signOut: (accessToken) =>
    sbFetch("/auth/v1/logout", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }),
};

// ── Supabase session persistence helpers ─────────────────────────
// Session is stored as JSON in localStorage so users stay logged in
// across page refreshes. Key: "ll_sb_session"
const SB_SESSION_KEY = "ll_sb_session";
const getSbSession   = () => { try { const v = localStorage.getItem(SB_SESSION_KEY); return v ? JSON.parse(v) : null; } catch { return null; } };
const saveSbSession  = (s) => { try { localStorage.setItem(SB_SESSION_KEY, JSON.stringify(s)); } catch {} };
const clearSbSession = ()  => { try { localStorage.removeItem(SB_SESSION_KEY); } catch {} };


// ╔══════════════════════════════════════════════════════════════╗
// ║  SECTION 3 — BACKEND API CONFIG (Node.js / Express)        ║
// ║  Purpose: All review/landlord data is stored in Postgres    ║
// ║  via your Node server. Supabase access_token is passed as  ║
// ║  Bearer so the server can verify the user is authenticated. ║
// ╚══════════════════════════════════════════════════════════════╝

// Backend API base URL — from .env.local in Vite, fallback for preview
const API_BASE  = API_BASE_ENV;
const API_COLOR = "#2DD4BF"; // teal — marks all elements that call this server
const API_BG    = "#0d1f1e";
const API_BORDER= "#1a3836";

// ── Token accessor (reads from Supabase session) ──────────────
// The Supabase access_token becomes the Bearer token on every
// request to your Node backend — backend verifies it via Supabase's
// JWT public key or calls supabaseAuth.getUser() to validate.
const getToken   = () => getSbSession()?.access_token ?? null;
const clearToken = () => clearSbSession(); // alias — clears whole session

// ── apiFetch: base wrapper for all backend API calls ─────────
// Automatically injects Content-Type and Authorization headers.
// Throws on non-2xx responses so callers can use try/catch.
async function apiFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      // Only attach Authorization if user is logged in
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  const data = await res.json();
  // Treat any non-2xx status as an error — surface server's error message
  if (!res.ok) throw new Error(data.error || "API error");
  return data;
}

// ── Named API methods ─────────────────────────────────────────
// Each method maps to one backend route. Keeping them here makes
// it easy to trace which component calls which endpoint.
const api = {
  searchLandlords: (q)      => apiFetch(`/landlords?search=${encodeURIComponent(q)}`),       // GET  /landlords?search=
  getLandlord:     (id)     => apiFetch(`/landlords/${id}`),                                  // GET  /landlords/:id
  getReviews:      (id)     => apiFetch(`/landlords/${id}/reviews`),                          // GET  /landlords/:id/reviews
  addLandlord:     (body)   => apiFetch("/landlords", { method:"POST", body:JSON.stringify(body) }),       // POST /landlords (auth required)
  submitReview:    (id,body)=> apiFetch(`/landlords/${id}/reviews`, { method:"POST", body:JSON.stringify(body) }), // POST (auth required)
  flagReview:      (id)     => apiFetch(`/reviews/${id}/flag`, { method:"POST" }),            // POST /reviews/:id/flag (auth required)
  // Auth is handled entirely by Supabase — see supabaseAuth above
};


// ╔══════════════════════════════════════════════════════════════╗
// ║  SECTION 4 — ANNUAL LISTING LIMIT                          ║
// ║  Purpose: Limit each user to adding 1 landlord/property     ║
// ║  per calendar year to prevent spam listings. Enforced       ║
// ║  client-side via localStorage timestamp.                    ║
// ╚══════════════════════════════════════════════════════════════╝

const STORAGE_KEY    = "landlorder_last_added";
// Read ISO timestamp from localStorage → parse as Date
const getLastAdded   = () => { try { const v = localStorage.getItem(STORAGE_KEY); return v ? new Date(v) : null; } catch { return null; } };
// Write current timestamp (called after successful submission)
const saveLastAdded  = ()  => { try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch {} };
// Returns true if user hasn't added anything this calendar year
const canAddThisYear = ()  => { const l = getLastAdded(); return !l || l.getFullYear() < new Date().getFullYear(); };
// How many days until Jan 1 next year (shown to locked-out users)
const daysUntilNewYear=()  => { const n = new Date(); return Math.ceil((new Date(n.getFullYear()+1,0,1) - n) / 864e5); };


// ╔══════════════════════════════════════════════════════════════╗
// ║  SECTION 5 — REUSABLE UI COMPONENTS                        ║
// ╚══════════════════════════════════════════════════════════════╝

// ── StarRating ───────────────────────────────────────────────────
// Renders 5 clickable stars (amber). Supports both interactive
// (onChange provided) and read-only (no onChange) modes.
// hover state creates a "fill up to cursor" preview effect.
const StarRating = ({ value, onChange, size = 20 }) => {
  const [hover, setHover] = useState(0); // which star is hovered (1–5, or 0 = none)
  return (
    <div style={{ display:"flex", gap:4 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i}
          onClick={() => onChange?.(i)}            // optional chaining — safe if read-only
          onMouseEnter={() => onChange && setHover(i)}
          onMouseLeave={() => onChange && setHover(0)}
          style={{ fontSize:size, cursor:onChange?"pointer":"default",
            color: i <= (hover || value) ? "#E8A045" : "#2a2a2a", // amber filled, dark empty
            transition:"color .15s", userSelect:"none" }}>★</span>
      ))}
    </div>
  );
};

// ── RatingBar ─────────────────────────────────────────────────────
// Horizontal progress bar showing a category rating (e.g. communication: 3.7/5).
// Gradient fill animates in with a CSS transition.
const RatingBar = ({ label, value }) => (
  <div style={{ marginBottom:8 }}>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
      <span style={{ fontSize:11, color:"#888", textTransform:"uppercase", letterSpacing:"0.08em" }}>{label}</span>
      <span style={{ fontSize:11, color:"#E8A045", fontWeight:500 }}>{value}/5</span>
    </div>
    <div style={{ height:3, background:"#1a1a1a", borderRadius:2, overflow:"hidden" }}>
      {/* Width is a percentage of 5 — e.g. 3.7/5 = 74% */}
      <div style={{ height:"100%", width:`${(value/5)*100}%`, background:"linear-gradient(90deg,#E8A045,#F2C175)", borderRadius:2, transition:"width .6s cubic-bezier(.16,1,.3,1)" }} />
    </div>
  </div>
);

// ── ApiBadge ──────────────────────────────────────────────────────
// Teal pill badge with a pulsing dot. Placed next to any UI element
// that makes a real backend API call — helps identify live data.
const ApiBadge = ({ label = "LIVE API" }) => (
  <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:9,
    fontFamily:"'JetBrains Mono', monospace", letterSpacing:"0.12em",
    color:API_COLOR, background:API_BG, border:`1px solid ${API_BORDER}`,
    borderRadius:5, padding:"2px 7px" }}>
    {/* Glowing dot indicator */}
    <span style={{ width:5, height:5, borderRadius:"50%", background:API_COLOR, display:"inline-block", boxShadow:`0 0 5px ${API_COLOR}` }} />
    {label}
  </span>
);

// ── ApiInput ──────────────────────────────────────────────────────
// Teal-themed text input for forms that send data to the backend.
// Border glows teal on focus to indicate "this field hits the API".
const ApiInput = ({ style={}, ...props }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input {...props}
      onFocus={e => { setFocused(true);  props.onFocus?.(e); }}
      onBlur={e  => { setFocused(false); props.onBlur?.(e);  }}
      style={{ width:"100%", background:"#0a1817",
        border:`1px solid ${focused ? API_COLOR : API_BORDER}`,
        borderRadius:10, padding:"13px 16px", fontSize:14, color:"#e0faf7",
        fontFamily:"'DM Sans', sans-serif", outline:"none",
        boxSizing:"border-box", transition:"border-color .2s", ...style }} />
  );
};

// ── ApiTextarea ───────────────────────────────────────────────────
// Same as ApiInput but multi-line. Used for review text field.
const ApiTextarea = ({ style={}, ...props }) => {
  const [focused, setFocused] = useState(false);
  return (
    <textarea {...props}
      onFocus={e => { setFocused(true);  props.onFocus?.(e); }}
      onBlur={e  => { setFocused(false); props.onBlur?.(e);  }}
      style={{ width:"100%", background:"#0a1817",
        border:`1px solid ${focused ? API_COLOR : API_BORDER}`,
        borderRadius:10, padding:"14px 16px", fontSize:14, color:"#e0faf7",
        fontFamily:"'DM Sans', sans-serif", resize:"vertical", outline:"none",
        minHeight:100, boxSizing:"border-box", lineHeight:1.6,
        transition:"border-color .2s", ...style }} />
  );
};

// ── SbInput ───────────────────────────────────────────────────────
// Supabase green-themed input. Used exclusively on the Auth screen.
// sbStyles is a function (focused) => styleObject passed from parent.
const SbInput = ({ sbStyles, style={}, ...props }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input {...props}
      onFocus={e => { setFocused(true);  props.onFocus?.(e); }}
      onBlur={e  => { setFocused(false); props.onBlur?.(e);  }}
      style={{ ...(sbStyles ? sbStyles(focused) : {}), ...style }} />
  );
};


// ╔══════════════════════════════════════════════════════════════╗
// ║  SECTION 6 — DATA NORMALIZERS                              ║
// ║  Purpose: Backend returns raw DB column names (snake_case). ║
// ║  These functions reshape raw API responses into the shape   ║
// ║  the UI components expect (camelCase, computed fields).     ║
// ╚══════════════════════════════════════════════════════════════╝

// Color-code a rating number for display
const getRatingColor = (r) => r >= 4 ? "#4CAF87" : r >= 3 ? "#E8A045" : "#E05454";
const getRatingLabel = (r) => r >= 4 ? "Good"    : r >= 3 ? "Mixed"   : "Poor";

// Normalise a raw review row from Postgres into UI-ready shape.
// Hides user email if anonymous — maps snake_case → camelCase.
const normalizeReview = (r) => ({
  id:   r.id,
  // If anonymous: show "Anonymous", else show username part of email
  user: r.anonymous ? "Anonymous" : (r.user_email ? r.user_email.split("@")[0] : "Tenant"),
  date: new Date(r.created_at).toLocaleDateString("en-US", { month:"short", year:"numeric" }),
  rating: r.rating,
  text:   r.text,
  categories: {
    communication: r.communication || r.rating, // fallback to overall rating if null
    maintenance:   r.maintenance   || r.rating,
    fairness:      r.fairness      || r.rating,
  },
});

// Normalise a raw landlord row from Postgres into UI-ready shape.
// Joins address components, parses float avg_rating.
const normalizeLandlord = (l) => ({
  id:          l.id,
  name:        l.name,
  company:     l.company || "Independent",
  // Concatenate address fields into a readable string
  address:     [l.address, l.city, l.state].filter(Boolean).join(", "),
  avgRating:   parseFloat(l.avg_rating) || 0,  // DB stores as NUMERIC — parse to float
  reviewCount: l.review_count || 0,
  tags:        [],   // tags are derived/user-added — placeholder for now
  reviews:     [],   // reviews fetched separately via getReviews()
});


// ╔══════════════════════════════════════════════════════════════╗
// ║  SECTION 7 — MAIN APP COMPONENT                            ║
// ║  Purpose: Root component. Manages all global state,         ║
// ║  view routing (home/detail/write/addLandlord/auth),         ║
// ║  and all async API calls.                                   ║
// ╚══════════════════════════════════════════════════════════════╝
export default function App() {

  // ── View router ───────────────────────────────────────────────
  // Single-page routing — one state variable controls which screen renders.
  // Possible values: "home" | "detail" | "write" | "addLandlord" | "auth"
  const [view,      setView]      = useState("home");
  const [landlords, setLandlords] = useState([]);     // list of landlords shown on home
  const [selected,  setSelected]  = useState(null);   // landlord currently in detail view
  const [reviews,   setReviews]   = useState([]);     // reviews for selected landlord
  const [search,    setSearch]    = useState("");      // search input value
  const [mounted,   setMounted]   = useState(false);  // triggers CSS entrance animations

  // ── Auth state ────────────────────────────────────────────────
  const [user,      setUser]      = useState(null);               // { id, email } from Supabase
  const [sbSession, setSbSession] = useState(getSbSession);       // full session object from localStorage
  // Derived: token extracted from session — used as Bearer header
  const token = sbSession?.access_token ?? null;

  // ── Loading & error flags ─────────────────────────────────────
  const [loadingList,   setLoadingList]   = useState(false); // home list loading
  const [loadingDetail, setLoadingDetail] = useState(false); // detail + reviews loading
  const [apiError,      setApiError]      = useState("");    // global error banner

  // ── Form state ────────────────────────────────────────────────
  // reviewForm: tracks the write-review form inputs
  const [reviewForm,   setReviewForm]   = useState({ rating:0, text:"", communication:0, maintenance:0, fairness:0, anonymous:true });
  // landlordForm: tracks the add-landlord form inputs
  const [landlordForm, setLandlordForm] = useState({ name:"", company:"", address:"", city:"", state:"", type:"landlord", hasPropertyManager:null, landlordInState:null, propertyManagerName:"" });
  // authForm: tracks email/password/mode for the auth screen
  const [authForm,     setAuthForm]     = useState({ email:"", password:"", mode:"login", magicMode:false });

  // ── Submission flags ──────────────────────────────────────────
  const [submitted,         setSubmitted]         = useState(false); // review submitted → show ✓
  const [landlordSubmitted, setLandlordSubmitted] = useState(false); // landlord added → show ✓
  const [authError,         setAuthError]         = useState("");    // auth-specific errors
  const [authLoading,       setAuthLoading]       = useState(false); // spinner on auth button
  const [verificationSent,  setVerificationSent]  = useState(false); // email sent screen
  // Normalized place data from Google Places (replaces manual address fields)
  const [landlordFormPlaceData, setLandlordFormPlaceData] = useState(null);

  // ── Annual listing limit ──────────────────────────────────────
  // Frozen in useState so it doesn't re-evaluate mid-session
  const [addAllowed] = useState(canAddThisYear);
  const [lastAdded]  = useState(getLastAdded);

  // ── Mount animation trigger ───────────────────────────────────
  // Set to true on first render — CSS transitions use this to slide elements in
  useEffect(() => { setMounted(true); }, []);


  // ╔════════════════════════════════════════════════════════════╗
  // ║  SECTION 8 — DATA FETCHING FUNCTIONS                     ║
  // ╚════════════════════════════════════════════════════════════╝

  // ── fetchLandlords: GET /api/landlords?search= ────────────────
  // Called on search input change (debounced). Updates the home list.
  const fetchLandlords = useCallback(async (q = "") => {
    setLoadingList(true);
    setApiError("");
    try {
      const data = await api.searchLandlords(q);
      setLandlords(data.map(normalizeLandlord)); // normalise each DB row
    } catch (e) {
      setApiError(e.message);
    } finally {
      setLoadingList(false); // always clear spinner even on error
    }
  }, []);

  // Auto-fetch when search changes. 300ms debounce reduces API calls while typing.
  useEffect(() => {
    const t = setTimeout(() => fetchLandlords(search), 300);
    return () => clearTimeout(t); // cancel if search changes before 300ms
  }, [search, fetchLandlords]);

  // ── openDetail: GET landlord + reviews in parallel ─────────────
  // Navigates to detail view and fetches fresh data concurrently.
  const openDetail = async (l) => {
    setSelected(l);     // show cached card data immediately while loading
    setView("detail");
    setReviews([]);     // clear previous landlord's reviews
    setLoadingDetail(true);
    try {
      // Fetch reviews and landlord info in parallel (Promise.all would be ideal too)
      const data  = await api.getReviews(l.id);
      setReviews(data.map(normalizeReview));
      // Re-fetch landlord to get latest avg_rating (may have changed since list load)
      const fresh = await api.getLandlord(l.id);
      setSelected(normalizeLandlord(fresh));
    } catch (e) {
      setApiError(e.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  // ── goHome: reset detail state and return to search ───────────
  const goHome = () => { setView("home"); setSelected(null); setReviews([]); setApiError(""); };

  // ── submitReview: POST /api/landlords/:id/reviews ─────────────
  // Requires auth (redirects to auth view if no token).
  // After success: re-fetches reviews + landlord to update the UI live.
  const submitReview = async () => {
    if (!reviewForm.rating || !reviewForm.text.trim()) return; // guard: require rating + text
    if (!token) { setView("auth"); return; }                    // guard: require login
    try {
      await api.submitReview(selected.id, {
        rating:        reviewForm.rating,
        text:          reviewForm.text,
        // Fall back to overall rating if category not set
        communication: reviewForm.communication || reviewForm.rating,
        maintenance:   reviewForm.maintenance   || reviewForm.rating,
        fairness:      reviewForm.fairness      || reviewForm.rating,
        anonymous:     reviewForm.anonymous,
      });
      setSubmitted(true); // show ✓ confirmation for 1.6s
      setTimeout(async () => {
        // Refresh both reviews list and landlord avg after post
        const [freshReviews, freshLandlord] = await Promise.all([
          api.getReviews(selected.id),
          api.getLandlord(selected.id),
        ]);
        setReviews(freshReviews.map(normalizeReview));
        setSelected(normalizeLandlord(freshLandlord));
        setSubmitted(false);
        setView("detail"); // navigate back to detail
      }, 1600);
    } catch (e) {
      setApiError(e.message);
    }
  };

  // ── submitLandlord: POST /api/landlords ───────────────────────
  // Uses normalized place data from Google Places (not manual text fields).
  // Saves last-added timestamp to enforce the annual limit.
  const submitLandlord = async () => {
    if (!landlordForm.name.trim() || !landlordFormPlaceData?.street) return; // guard: require name + verified address
    if (!token) { setView("auth"); return; }
    try {
      await api.addLandlord({
        name:                  landlordForm.name.trim(),
        company:               landlordForm.company.trim() || null,
        // All address fields come from parsePlaceResult (Google normalized)
        address:               landlordFormPlaceData.street,
        city:                  landlordFormPlaceData.city      || null,
        state:                 landlordFormPlaceData.state     || null,
        zip:                   landlordFormPlaceData.zip       || null,
        country:               landlordFormPlaceData.country   || null,
        place_id:              landlordFormPlaceData.placeId   || null, // for dedup
        lat:                   landlordFormPlaceData.lat       ?? null,
        lng:                   landlordFormPlaceData.lng       ?? null,
        formatted_address:     landlordFormPlaceData.formatted || null,
        // Extra fields added in previous session
        has_property_manager:  landlordForm.hasPropertyManager,
        property_manager_name: landlordForm.propertyManagerName.trim() || null,
        landlord_in_state:     landlordForm.landlordInState,
      });
      saveLastAdded();           // lock out until next calendar year
      setLandlordSubmitted(true);
      setTimeout(() => { goHome(); setLandlordSubmitted(false); }, 2000);
    } catch (e) {
      setApiError(e.message);
    }
  };


  // ╔════════════════════════════════════════════════════════════╗
  // ║  SECTION 9 — SUPABASE SESSION MANAGEMENT                 ║
  // ╚════════════════════════════════════════════════════════════╝

  // ── Session restore + token refresh on app load ───────────────
  // Runs once on mount. Reads session from localStorage, hydrates
  // the user state, then silently exchanges the refresh_token for
  // a new access_token so the user doesn't need to re-login.
  useEffect(() => {
    const session = getSbSession();
    if (!session) return; // not logged in — nothing to restore
    setUser(session.user ?? null); // immediately set user from cached data
    if (session.refresh_token) {
      supabaseAuth.refreshToken(session.refresh_token)
        .then(data => {
          if (data.access_token) {
            // Build updated session with new tokens
            const next = {
              ...session,
              access_token:  data.access_token,
              refresh_token: data.refresh_token,
            };
            saveSbSession(next);  // persist updated tokens
            setSbSession(next);   // update React state
            setUser(data.user ?? session.user);
          }
          // If refresh fails (e.g. token expired): silently keep old session.
          // User will get an error next time they try an auth-required action.
        })
        .catch(() => {}); // suppress — user can manually re-login if needed
    }
  }, []); // empty deps = runs once on mount only

  // ── handleAuth: unified handler for login / register / magic link ──
  const handleAuth = async () => {
    setAuthLoading(true);
    setAuthError("");
    setVerificationSent(false);
    try {
      // ── Branch 1: Magic link (passwordless) ──────────────────
      if (authForm.magicMode) {
        const data = await supabaseAuth.magicLink(authForm.email);
        if (data.error) throw new Error(data.error.message || data.msg || "Magic link failed");
        setVerificationSent("magic"); // show "check inbox" screen
        return; // don't fall through to login logic
      }

      // ── Branch 2: Registration ────────────────────────────────
      if (authForm.mode === "register") {
        const data = await supabaseAuth.signUp(authForm.email, authForm.password);
        if (data.error) throw new Error(data.error.message || "Registration failed");
        // User exists but email_confirmed_at is null — they must click the link
        setVerificationSent("email"); // show "check inbox" screen
        return;
      }

      // ── Branch 3: Login ───────────────────────────────────────
      const data = await supabaseAuth.signIn(authForm.email, authForm.password);
      if (data.error) {
        // Surface a friendlier message for the "email not confirmed" case
        if (data.error.message?.toLowerCase().includes("confirm")) {
          throw new Error("Please confirm your email before signing in. Check your inbox.");
        }
        throw new Error(data.error.message || "Login failed");
      }
      if (!data.access_token) throw new Error("No session returned. Check your credentials.");

      // Build and persist the session object
      const session = {
        access_token:  data.access_token,  // JWT — expires in ~1 hour
        refresh_token: data.refresh_token, // long-lived — used to get new access tokens
        user:          data.user,
      };
      saveSbSession(session); // write to localStorage for persistence
      setSbSession(session);  // update React state (triggers re-render)
      setUser(data.user);
      goHome(); // navigate back to the screen the user came from

    } catch (e) {
      setAuthError(e.message); // show error below the form
    } finally {
      setAuthLoading(false); // always clear spinner
    }
  };

  // ── logout: invalidate server-side + clear local storage ──────
  const logout = async () => {
    // Best-effort server-side invalidation (ignore errors)
    if (token) { try { await supabaseAuth.signOut(token); } catch {} }
    clearSbSession();  // remove from localStorage
    setSbSession(null); // update React state
    setUser(null);
  };


  // ╔════════════════════════════════════════════════════════════╗
  // ║  SECTION 10 — STYLE DEFINITIONS                          ║
  // ║  All inline styles as a plain object. Defined inside the  ║
  // ║  component so they can reference state (e.g. mounted).    ║
  // ╚════════════════════════════════════════════════════════════╝
  const S = {
    app:            { minHeight:"100vh", background:"#0d0d0d", color:"#f0ece4", fontFamily:"'DM Sans', sans-serif" },
    header:         { borderBottom:"1px solid #1e1e1e", padding:"16px 28px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:"#0d0d0d", zIndex:100, gap:12 },
    logo:           { fontFamily:"'Playfair Display', serif", fontSize:21, fontWeight:900, letterSpacing:"-0.02em", color:"#f0ece4", cursor:"pointer" },
    logoAccent:     { color:"#E8A045" },
    container:      { maxWidth:760, margin:"0 auto", padding:"36px 24px" },
    // hero fades + slides up once mounted = true
    hero:           { textAlign:"center", marginBottom:52, opacity:mounted?1:0, transform:mounted?"translateY(0)":"translateY(16px)", transition:"all .7s cubic-bezier(.16,1,.3,1)" },
    heroTitle:      { fontFamily:"'Playfair Display', serif", fontSize:"clamp(34px,6vw,60px)", fontWeight:900, lineHeight:1.05, letterSpacing:"-0.03em", marginBottom:14 },
    heroSub:        { fontSize:15, color:"#888", fontWeight:300, marginBottom:32 },
    searchRow:      { display:"flex", gap:8, maxWidth:520, margin:"0 auto" },
    searchInput:    { flex:1, background:"#161616", border:"1px solid #2a2a2a", borderRadius:12, padding:"13px 18px", fontSize:15, color:"#f0ece4", outline:"none", fontFamily:"'DM Sans', sans-serif", boxSizing:"border-box", transition:"border-color .2s" },
    addBtn:         { background:API_COLOR, color:"#0a1817", border:"none", borderRadius:12, padding:"13px 16px", fontSize:13, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", fontFamily:"'DM Sans', sans-serif" },
    addBtnDisabled: { background:"#1e1e1e", color:"#444", border:"1px solid #2a2a2a", borderRadius:12, padding:"13px 16px", fontSize:13, cursor:"not-allowed", whiteSpace:"nowrap", fontFamily:"'DM Sans', sans-serif" },
    sectionLabel:   { fontSize:11, color:"#555", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:14, fontWeight:500 },
    card:           { background:"#111", border:"1px solid #1e1e1e", borderRadius:16, padding:"22px 26px", marginBottom:10, cursor:"pointer", transition:"border-color .2s, background .2s", display:"flex", gap:18, alignItems:"flex-start" },
    cardBadge:      { width:46, height:46, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Playfair Display', serif", fontSize:17, fontWeight:900, flexShrink:0 },
    cardMeta:       { flex:1, minWidth:0 },
    cardName:       { fontSize:16, fontWeight:500, marginBottom:2, letterSpacing:"-0.01em" },
    cardSub:        { fontSize:13, color:"#666", marginBottom:8 },
    tag:            { display:"inline-block", fontSize:11, padding:"3px 8px", borderRadius:6, background:"#1a1a1a", color:"#888", marginRight:6, border:"1px solid #222" },
    cardRight:      { textAlign:"right", flexShrink:0 },
    bigRating:      { fontFamily:"'Playfair Display', serif", fontSize:26, fontWeight:900, lineHeight:1 },
    reviewCount:    { fontSize:12, color:"#555", marginTop:2 },
    backBtn:        { background:"none", border:"none", color:"#666", fontSize:13, cursor:"pointer", padding:0, display:"flex", alignItems:"center", gap:6, marginBottom:28, fontFamily:"'DM Sans', sans-serif" },
    detailHeader:   { display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28, gap:16 },
    detailName:     { fontFamily:"'Playfair Display', serif", fontSize:32, fontWeight:900, letterSpacing:"-0.02em", lineHeight:1.1, marginBottom:4 },
    detailCompany:  { fontSize:14, color:"#666" },
    scoreBox:       { background:"#111", border:"1px solid #1e1e1e", borderRadius:16, padding:"18px 22px", textAlign:"center", minWidth:110 },
    scoreNum:       { fontFamily:"'Playfair Display', serif", fontSize:44, fontWeight:900, lineHeight:1 },
    scoreSub:       { fontSize:12, color:"#555", marginTop:4 },
    writeBtn:       { background:"#E8A045", color:"#0d0d0d", border:"none", borderRadius:10, padding:"11px 22px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans', sans-serif" },
    reviewCard:     { background:"#111", border:"1px solid #1e1e1e", borderRadius:12, padding:"18px 22px", marginBottom:10 },
    reviewTop:      { display:"flex", justifyContent:"space-between", marginBottom:8, alignItems:"flex-start" },
    reviewUser:     { fontSize:13, fontWeight:500, color:"#ccc" },
    reviewDate:     { fontSize:12, color:"#555" },
    reviewText:     { fontSize:14, color:"#aaa", lineHeight:1.6, marginBottom:10 },
    formLabel:      { fontSize:12, color:"#666", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8, display:"block" },
    apiFormLabel:   { fontSize:12, color:API_COLOR, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8, display:"block", fontFamily:"'JetBrains Mono', monospace" },
    formSection:    { marginBottom:26 },
    // submitBtn and apiSubmitBtn are functions — they take `ok` (boolean) and return style
    submitBtn:      (ok) => ({ background:ok?"#E8A045":"#1e1e1e", color:ok?"#0d0d0d":"#555", border:"none", borderRadius:10, padding:"13px 28px", fontSize:15, fontWeight:500, cursor:ok?"pointer":"not-allowed", fontFamily:"'DM Sans', sans-serif", transition:"all .2s", width:"100%" }),
    apiSubmitBtn:   (ok) => ({ background:ok?API_COLOR:"#1a2f2d", color:ok?"#0a1817":"#2a5550", border:`1px solid ${ok?API_COLOR:API_BORDER}`, borderRadius:10, padding:"13px 28px", fontSize:15, fontWeight:700, cursor:ok?"pointer":"not-allowed", fontFamily:"'DM Sans', sans-serif", transition:"all .2s", width:"100%", letterSpacing:"0.02em" }),
    successMsg:     { textAlign:"center", padding:40, fontFamily:"'Playfair Display', serif", fontSize:26 },
    apiSection:     { background:API_BG, border:`1px solid ${API_BORDER}`, borderRadius:14, padding:"20px 22px", marginBottom:22 },
    apiSectionTitle:{ fontSize:10, color:API_COLOR, letterSpacing:"0.18em", fontFamily:"'JetBrains Mono', monospace", marginBottom:14, display:"flex", alignItems:"center", gap:8 },
    errorBox:       { background:"#1f0f0f", border:"1px solid #4a1a1a", borderRadius:10, padding:"12px 16px", marginBottom:20, fontSize:13, color:"#E05454" },
    // CSS animation spinner (used during API calls)
    spinner:        { display:"inline-block", width:14, height:14, border:`2px solid ${API_COLOR}33`, borderTopColor:API_COLOR, borderRadius:"50%", animation:"spin .7s linear infinite" },
    quotaBanner:    (used) => ({ display:"flex", alignItems:"flex-start", gap:12, background:used?"#1a0f0f":"#0f1a10", border:`1px solid ${used?"#4a1a1a":"#1a4a20"}`, borderRadius:10, padding:"12px 16px", marginBottom:24 }),
    typeBtn:        (a) => ({ flex:1, padding:10, borderRadius:8, border:`1px solid ${a?API_COLOR:API_BORDER}`, background:a?API_COLOR+"18":"#0a1817", color:a?API_COLOR:"#2a5550", fontSize:13, fontWeight:a?600:400, cursor:"pointer", fontFamily:"'DM Sans', sans-serif", transition:"all .15s" }),
    // Supabase green variants (used only on auth screen)
    sbSection:      { background:SB_BG, border:`1px solid ${SB_BORDER}`, borderRadius:14, padding:"20px 22px", marginBottom:22 },
    sbSectionTitle: { fontSize:10, color:SB_COLOR, letterSpacing:"0.18em", fontFamily:"'JetBrains Mono', monospace", marginBottom:14, display:"flex", alignItems:"center", gap:8 },
    sbSubmitBtn:    (ok) => ({ background:ok?SB_COLOR:"#0f1f18", color:ok?"#0a1f14":"#1a4a30", border:`1px solid ${ok?SB_COLOR:SB_BORDER}`, borderRadius:10, padding:"13px 28px", fontSize:15, fontWeight:700, cursor:ok?"pointer":"not-allowed", fontFamily:"'DM Sans', sans-serif", transition:"all .2s", width:"100%", letterSpacing:"0.02em" }),
    sbModeBtn:      (a) => ({ flex:1, padding:10, borderRadius:8, border:`1px solid ${a?SB_COLOR:SB_BORDER}`, background:a?SB_COLOR+"18":"#0a1f14", color:a?SB_COLOR:"#1a5a38", fontSize:13, fontWeight:a?600:400, cursor:"pointer", fontFamily:"'DM Sans', sans-serif", transition:"all .15s" }),
    sbInput:        (focused) => ({ width:"100%", background:"#081510", border:`1px solid ${focused?SB_COLOR:SB_BORDER}`, borderRadius:10, padding:"13px 16px", fontSize:14, color:"#d0f5e8", fontFamily:"'DM Sans', sans-serif", outline:"none", boxSizing:"border-box", transition:"border-color .2s" }),
    verifyBox:      { background:"#0a1f14", border:`1px solid ${SB_COLOR}55`, borderRadius:14, padding:"28px 24px", textAlign:"center" },
  };


  // ╔════════════════════════════════════════════════════════════╗
  // ║  SECTION 11 — RENDER / JSX                               ║
  // ║  The app renders ONE view at a time, controlled by the    ║
  // ║  `view` state variable. All views share the header.       ║
  // ╚════════════════════════════════════════════════════════════╝
  return (
    <>
      {/* Inject fonts + keyframe animation for spinner */}
      <style>{FONT}{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={S.app}>

        {/* ── HEADER ─────────────────────────────────────────────
            Sticky top bar. Shows:
            - Logo (click = goHome)
            - API base URL badge (teal) for debug visibility
            - Auth state: logged in = email + VERIFIED badge + sign out
                          logged out = "Sign In" button (Supabase green)
        */}
        <header style={S.header}>
          <div style={S.logo} onClick={goHome}>Land<span style={S.logoAccent}>Lorder</span></div>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {/* Shows current API_BASE — useful for spotting wrong env */}
            <ApiBadge label={`${API_BASE}`} />
            {user ? (
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                {/* Supabase verified user indicator */}
                <span style={{ fontSize:11, color:"#3a6a50", fontFamily:"'JetBrains Mono', monospace" }}>
                  <span style={{ color:SB_COLOR, marginRight:4 }}>✓</span>{user.email}
                </span>
                <span style={{ fontSize:9, color:SB_COLOR, background:SB_BG, border:`1px solid ${SB_BORDER}`, borderRadius:4, padding:"2px 6px", fontFamily:"'JetBrains Mono', monospace", letterSpacing:"0.1em" }}>VERIFIED</span>
                <button onClick={logout} style={{ background:"none", border:`1px solid ${SB_BORDER}`, borderRadius:8, color:"#3a6a50", fontSize:12, padding:"5px 10px", cursor:"pointer", fontFamily:"'DM Sans', sans-serif" }}>Sign out</button>
              </div>
            ) : (
              <button onClick={() => setView("auth")} style={{ background:"none", border:`1px solid ${SB_BORDER}`, borderRadius:8, color:SB_COLOR, fontSize:12, padding:"6px 12px", cursor:"pointer", fontFamily:"'JetBrains Mono', monospace" }}>Sign In</button>
            )}
          </div>
        </header>

        <div style={S.container}>
          {/* Global error banner — shown when any API call fails */}
          {apiError && (
            <div style={S.errorBox}>
              ⚠ {apiError}
              <button onClick={() => setApiError("")} style={{ background:"none", border:"none", color:"#E05454", cursor:"pointer", float:"right" }}>✕</button>
            </div>
          )}


          {/* ── VIEW: HOME ──────────────────────────────────────────
              Shows search bar, results list, + Add button.
              - search state → debounced fetch → landlords state
              - Each card click → openDetail()
              - Add button disabled if annual limit reached
          */}
          {view === "home" && (
            <>
              {/* Hero section — fades in via mounted opacity/transform transition */}
              <div style={S.hero}>
                <h1 style={S.heroTitle}>Know your<br /><span style={{ color:"#E8A045" }}>landlord</span><br />before you sign.</h1>
                <p style={S.heroSub}>Real reviews from real tenants. Find out what others won't tell you.</p>
                <div style={S.searchRow}>
                  {/* Controlled input — onChange updates `search` state → triggers useEffect debounce */}
                  <input style={S.searchInput} placeholder="Search by name, address, or company…"
                    value={search} onChange={e => setSearch(e.target.value)}
                    onFocus={e => e.target.style.borderColor = "#E8A045"}
                    onBlur={e  => e.target.style.borderColor = "#2a2a2a"} />
                  {/* Add button: teal if allowed, grey + disabled if annual limit hit */}
                  <button
                    style={addAllowed ? S.addBtn : S.addBtnDisabled}
                    onClick={addAllowed ? () => {
                      // Reset form + place data before opening add screen
                      setLandlordForm({ name:"", company:"", address:"", city:"", state:"", type:"landlord", hasPropertyManager:null, landlordInState:null, propertyManagerName:"" });
                      setLandlordFormPlaceData(null);
                      setLandlordSubmitted(false);
                      setView("addLandlord");
                    } : undefined}
                    title={!addAllowed ? `Annual limit reached — available in ${daysUntilNewYear()} days` : "Add landlord"}>
                    + Add
                  </button>
                </div>
                {/* API trace — shows exact query being sent */}
                <div style={{ marginTop:10, display:"flex", justifyContent:"center", gap:8, alignItems:"center" }}>
                  {loadingList
                    ? <><span style={S.spinner} /><span style={{ fontSize:11, color:API_COLOR, fontFamily:"'JetBrains Mono', monospace" }}>Fetching from API…</span></>
                    : <span style={{ fontSize:11, color:"#2a4a46", fontFamily:"'JetBrains Mono', monospace" }}>GET {API_BASE}/landlords?search="{search}"</span>
                  }
                </div>
                {/* Annual limit notice */}
                {!addAllowed && <p style={{ fontSize:12, color:"#555", marginTop:6 }}>Annual listing used · renews in {daysUntilNewYear()} days</p>}
              </div>

              {/* Result count + LIVE DATA badge */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <div style={S.sectionLabel}>{landlords.length} landlord{landlords.length !== 1 ? "s" : ""}</div>
                <ApiBadge label="LIVE DATA" />
              </div>

              {/* Empty state */}
              {landlords.length === 0 && !loadingList && (
                <div style={{ color:"#555", textAlign:"center", padding:"48px 0", fontSize:14 }}>
                  {search ? "No landlords found." : "No landlords yet — be the first to add one."}
                </div>
              )}

              {/* Landlord cards — staggered entrance animation via transition-delay */}
              {landlords.map((l, i) => (
                <div key={l.id}
                  style={{ ...S.card, opacity:mounted?1:0, transform:mounted?"translateY(0)":"translateY(12px)", transition:`all .5s cubic-bezier(.16,1,.3,1) ${i*.07}s` }}
                  onClick={() => openDetail(l)}
                  onMouseEnter={e => { e.currentTarget.style.borderColor="#333"; e.currentTarget.style.background="#141414"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor="#1e1e1e"; e.currentTarget.style.background="#111"; }}>
                  {/* Initials badge — colored by rating (green/amber/red) */}
                  <div style={{ ...S.cardBadge, background:getRatingColor(l.avgRating)+"18", color:getRatingColor(l.avgRating) }}>
                    {l.name.split(" ").map(n=>n[0]).join("").slice(0,2)}
                  </div>
                  <div style={S.cardMeta}>
                    <div style={S.cardName}>{l.name}</div>
                    <div style={S.cardSub}>{l.company} · {l.address}</div>
                    <div>{l.tags.map(t=><span key={t} style={S.tag}>{t}</span>)}</div>
                  </div>
                  {/* Rating display — "—" if no reviews yet */}
                  <div style={S.cardRight}>
                    <div style={{ ...S.bigRating, color:l.avgRating?getRatingColor(l.avgRating):"#333" }}>{l.avgRating||"—"}</div>
                    {l.avgRating>0 && <div style={{ marginTop:3 }}><StarRating value={Math.round(l.avgRating)} size={12} /></div>}
                    <div style={S.reviewCount}>{l.reviewCount} reviews</div>
                  </div>
                </div>
              ))}
            </>
          )}


          {/* ── VIEW: DETAIL ──────────────────────────────────────────
              Shows landlord profile, category breakdown, and review list.
              Also shows the exact API endpoints being called (debug trace).
          */}
          {view === "detail" && selected && (
            <>
              <button style={S.backBtn} onClick={goHome}>← Back</button>

              {/* API trace bar — shows which endpoints are being called */}
              <div style={{ ...S.apiSection, marginBottom:20, padding:"10px 16px" }}>
                <div style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:10, color:API_COLOR, display:"flex", gap:16, flexWrap:"wrap" }}>
                  <span style={{ color:"#2a5550" }}>GET</span>
                  <span>{API_BASE}/landlords/{selected.id}</span>
                  <span style={{ color:"#2a5550" }}>·</span>
                  <span>GET {API_BASE}/landlords/{selected.id}/reviews</span>
                  {loadingDetail && <span style={S.spinner} />}
                </div>
              </div>

              {/* Landlord header: name/company/address on left, score box on right */}
              <div style={S.detailHeader}>
                <div>
                  <div style={S.detailName}>{selected.name}</div>
                  <div style={S.detailCompany}>{selected.company}</div>
                  <div style={{ fontSize:13, color:"#555", marginTop:4 }}>{selected.address}</div>
                </div>
                <div style={S.scoreBox}>
                  <div style={{ ...S.scoreNum, color:selected.avgRating?getRatingColor(selected.avgRating):"#333" }}>{selected.avgRating||"—"}</div>
                  {selected.avgRating>0 && <StarRating value={Math.round(selected.avgRating)} size={13} />}
                  <div style={S.scoreSub}>{selected.reviewCount} reviews</div>
                  {selected.avgRating>0 && <div style={{ marginTop:5, fontSize:11, fontWeight:600, color:getRatingColor(selected.avgRating) }}>{getRatingLabel(selected.avgRating)}</div>}
                </div>
              </div>

              {/* Category breakdown: calculates avg per category across all reviews */}
              {reviews.length > 0 && (
                <div style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:16, padding:"18px 22px", marginBottom:22 }}>
                  <div style={{ ...S.sectionLabel, marginBottom:14 }}>Category breakdown</div>
                  {["communication","maintenance","fairness"].map(cat => {
                    // Reduce reviews to average per category — fallback to overall rating
                    const avg = reviews.reduce((s,r) => s+(r.categories[cat]||r.rating),0)/reviews.length;
                    return <RatingBar key={cat} label={cat} value={Math.round(avg*10)/10} />;
                  })}
                </div>
              )}

              {/* Reviews header row */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={S.sectionLabel}>Tenant reviews</div>
                  <ApiBadge label="LIVE" />
                </div>
                <button style={S.writeBtn} onClick={() => {
                  setReviewForm({ rating:0, text:"", communication:0, maintenance:0, fairness:0, anonymous:true });
                  setView("write");
                }}>Write a Review</button>
              </div>

              {loadingDetail && <div style={{ color:"#555", textAlign:"center", padding:"32px 0", fontSize:13 }}>Loading reviews…</div>}
              {!loadingDetail && reviews.length === 0 && <div style={{ color:"#444", textAlign:"center", padding:"36px 0", fontSize:14 }}>No reviews yet. Be the first.</div>}

              {/* Individual review cards */}
              {reviews.map(r => (
                <div key={r.id} style={S.reviewCard}>
                  <div style={S.reviewTop}>
                    <div>
                      <div style={S.reviewUser}>{r.user}</div>
                      <div style={S.reviewDate}>{r.date}</div>
                    </div>
                    <StarRating value={r.rating} size={14} />
                  </div>
                  <div style={S.reviewText}>{r.text}</div>
                  <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
                    {/* Category sub-scores */}
                    {Object.entries(r.categories).map(([k,v]) => (
                      <div key={k} style={{ fontSize:11, color:"#555" }}>{k}: <span style={{ color:"#E8A045" }}>{v}</span></div>
                    ))}
                    {/* Flag button — POST /reviews/:id/flag (fire-and-forget) */}
                    <button onClick={() => api.flagReview(r.id).catch(()=>{})}
                      style={{ marginLeft:"auto", background:"none", border:"none", color:"#333", fontSize:11, cursor:"pointer", fontFamily:"'DM Sans', sans-serif" }}>
                      ⚑ Flag
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}


          {/* ── VIEW: WRITE REVIEW ────────────────────────────────────
              Star rating + text + optional category ratings.
              Requires auth — shows login prompt if no token.
              POST /api/landlords/:id/reviews with Supabase Bearer token.
          */}
          {view === "write" && selected && (
            <>
              <button style={S.backBtn} onClick={() => setView("detail")}>← Back to {selected.name}</button>
              <h2 style={{ fontFamily:"'Playfair Display', serif", fontSize:27, fontWeight:900, marginBottom:5, letterSpacing:"-0.02em" }}>Review {selected.name}</h2>
              <p style={{ fontSize:14, color:"#555", marginBottom:28 }}>{selected.company} · {selected.address}</p>

              {/* Auth gate — shown if user is not logged in */}
              {!token && (
                <div style={{ ...S.apiSection, marginBottom:24 }}>
                  <div style={S.apiSectionTitle}><ApiBadge /> Auth Required</div>
                  <p style={{ fontSize:13, color:"#5a8a84", margin:"0 0 12px" }}>You need to be logged in to post a review.</p>
                  <button onClick={() => setView("auth")} style={{ ...S.apiSubmitBtn(true), width:"auto", padding:"10px 22px", fontSize:13 }}>Login / Register →</button>
                </div>
              )}

              {/* Success state — shown briefly after submission */}
              {submitted
                ? <div style={{ ...S.successMsg, color:API_COLOR }}>✓ Review posted to API!</div>
                : (
                <>
                  {/* Overall star rating — required field */}
                  <div style={S.formSection}>
                    <label style={S.formLabel}>Overall rating *</label>
                    <StarRating value={reviewForm.rating} onChange={v=>setReviewForm(f=>({...f,rating:v}))} size={30} />
                  </div>
                  {/* Review text — required, sent to POST /reviews */}
                  <div style={S.formSection}>
                    <label style={S.apiFormLabel}>Your experience * <ApiBadge label="POST /reviews" /></label>
                    <ApiTextarea placeholder="Share what it was like renting from this landlord…"
                      value={reviewForm.text} onChange={e=>setReviewForm(f=>({...f,text:e.target.value}))} />
                  </div>
                  {/* Per-category ratings — optional, fallback to overall rating if 0 */}
                  <div style={S.formSection}>
                    <label style={S.formLabel}>Rate by category (optional)</label>
                    <div style={{ display:"grid", gap:14 }}>
                      {["communication","maintenance","fairness"].map(cat=>(
                        <div key={cat} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <span style={{ fontSize:13, color:"#888", textTransform:"capitalize" }}>{cat}</span>
                          <StarRating value={reviewForm[cat]} onChange={v=>setReviewForm(f=>({...f,[cat]:v}))} size={18} />
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Anonymous toggle — controls whether user_email is exposed in response */}
                  <div style={{ ...S.formSection, display:"flex", alignItems:"center", gap:10 }}>
                    <input type="checkbox" id="anon" checked={reviewForm.anonymous}
                      onChange={e=>setReviewForm(f=>({...f,anonymous:e.target.checked}))}
                      style={{ accentColor:API_COLOR, width:16, height:16, cursor:"pointer" }} />
                    <label htmlFor="anon" style={{ fontSize:13, color:"#666", cursor:"pointer" }}>Post anonymously</label>
                  </div>
                  {apiError && <div style={S.errorBox}>{apiError}</div>}
                  {/* Submit button — teal if logged in + form valid, redirect to auth if not */}
                  <button style={S.apiSubmitBtn(!!token && reviewForm.rating && reviewForm.text.trim())}
                    onClick={token ? submitReview : () => setView("auth")}>
                    {token ? "Submit Review" : "Login to Submit"}
                  </button>
                </>
              )}
            </>
          )}


          {/* ── VIEW: ADD LANDLORD ────────────────────────────────────
              Form to add a new landlord/property to the database.
              Uses Google Places autocomplete for address.
              Requires auth + annual limit check.
          */}
          {view === "addLandlord" && (
            <>
              <button style={S.backBtn} onClick={goHome}>← Back</button>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6 }}>
                <h2 style={{ fontFamily:"'Playfair Display', serif", fontSize:27, fontWeight:900, letterSpacing:"-0.02em", margin:0 }}>Add a Landlord or Property</h2>
                <ApiBadge label="POST /landlords" />
              </div>
              <p style={{ fontSize:14, color:"#555", marginBottom:24 }}>Help other tenants by listing a landlord not yet on LandLorder.</p>

              {/* API endpoint callout — debug info */}
              <div style={S.apiSection}>
                <div style={S.apiSectionTitle}><ApiBadge /> API Endpoint</div>
                <code style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:11, color:API_COLOR, display:"block" }}>
                  POST {API_BASE}/landlords<br />
                  Authorization: Bearer &lt;token&gt;
                </code>
              </div>

              {/* Annual limit banner */}
              <div style={S.quotaBanner(false)}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:"#4CAF87", flexShrink:0, marginTop:4 }} />
                <div style={{ fontSize:13, color:"#888" }}>
                  <strong style={{ color:"#ccc" }}>Annual listing available</strong> — 1 per year to keep listings trustworthy.
                  {lastAdded && <span style={{ color:"#555" }}> Last added {lastAdded.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}.</span>}
                </div>
              </div>

              {/* Auth gate */}
              {!token && (
                <div style={{ ...S.errorBox, color:API_COLOR, background:API_BG, borderColor:API_BORDER, marginBottom:20 }}>
                  You must be logged in to add a listing.{" "}
                  <button onClick={()=>setView("auth")} style={{ background:"none", border:"none", color:API_COLOR, cursor:"pointer", fontWeight:600, textDecoration:"underline" }}>Login →</button>
                </div>
              )}

              {/* Success state */}
              {landlordSubmitted
                ? <div style={{ ...S.successMsg, color:API_COLOR }}>✓ Landlord saved to database!</div>
                : (
                <>
                  {/* Landlord vs Property toggle */}
                  <div style={S.formSection}>
                    <label style={S.formLabel}>Listing type</label>
                    <div style={{ display:"flex", gap:8 }}>
                      {["landlord","property"].map(t=>(
                        <button key={t} style={S.typeBtn(landlordForm.type===t)}
                          onClick={()=>setLandlordForm(f=>({...f,type:t}))}>
                          {t==="landlord"?"👤 Landlord / Person":"🏠 Property / Building"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Name — required */}
                  <div style={S.formSection}>
                    <label style={S.apiFormLabel}>{landlordForm.type==="landlord"?"Landlord name":"Property name"} *</label>
                    <ApiInput placeholder={landlordForm.type==="landlord"?"e.g. Jane Smith":"e.g. Riverside Apartments"}
                      value={landlordForm.name} onChange={e=>setLandlordForm(f=>({...f,name:e.target.value}))} />
                  </div>

                  {/* Company — optional */}
                  <div style={S.formSection}>
                    <label style={S.apiFormLabel}>Company / Management (optional)</label>
                    <ApiInput placeholder="e.g. Voss Properties LLC"
                      value={landlordForm.company} onChange={e=>setLandlordForm(f=>({...f,company:e.target.value}))} />
                  </div>

                  {/* Address — Google Places autocomplete.
                      onSelect receives parsePlaceResult output → stored in landlordFormPlaceData
                      and also written into landlordForm for display/fallback */}
                  <div style={S.formSection}>
                    <label style={S.apiFormLabel}>
                      Street address * <ApiBadge label="Google Places API" />
                    </label>
                    <AddressAutocomplete
                      placeData={landlordFormPlaceData}
                      onSelect={(parsed) => {
                        setLandlordFormPlaceData(parsed); // store full normalized object
                        if (parsed) setLandlordForm(f => ({ ...f, address:parsed.street, city:parsed.city, state:parsed.state }));
                      }}
                    />
                  </div>

                  {/* Landlord in-state toggle — 3-way: yes / no / unknown */}
                  <div style={S.formSection}>
                    <label style={S.apiFormLabel}>Is the landlord based in-state?</label>
                    <div style={{ display:"flex", gap:8 }}>
                      {[["yes","✓ Yes, in-state"],["no","✗ No, out-of-state"],["unknown","? Unknown"]].map(([val, label]) => (
                        <button key={val}
                          style={{ flex:1, padding:"10px 8px", borderRadius:8, fontSize:12,
                            fontWeight: landlordForm.landlordInState===val ? 600 : 400,
                            cursor:"pointer", fontFamily:"'DM Sans', sans-serif", transition:"all .15s",
                            border:`1px solid ${landlordForm.landlordInState===val ? API_COLOR : API_BORDER}`,
                            background: landlordForm.landlordInState===val ? API_COLOR+"18" : "#0a1817",
                            color: landlordForm.landlordInState===val ? API_COLOR : "#2a5550" }}
                          onClick={() => setLandlordForm(f=>({...f,landlordInState:val}))}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <p style={{ fontSize:11, color:"#2a4a46", marginTop:7, marginBottom:0, fontFamily:"'JetBrains Mono', monospace" }}>
                      Out-of-state landlords may be harder to contact for repairs or legal matters.
                    </p>
                  </div>

                  {/* Property manager toggle — shows name input if "yes" selected */}
                  <div style={S.formSection}>
                    <label style={S.apiFormLabel}>Is there a property manager?</label>
                    <div style={{ display:"flex", gap:8, marginBottom:10 }}>
                      {[["yes","✓ Yes"],["no","✗ No"],["unknown","? Unknown"]].map(([val, label]) => (
                        <button key={val}
                          style={{ flex:1, padding:"10px 8px", borderRadius:8, fontSize:12,
                            fontWeight: landlordForm.hasPropertyManager===val ? 600 : 400,
                            cursor:"pointer", fontFamily:"'DM Sans', sans-serif", transition:"all .15s",
                            border:`1px solid ${landlordForm.hasPropertyManager===val ? API_COLOR : API_BORDER}`,
                            background: landlordForm.hasPropertyManager===val ? API_COLOR+"18" : "#0a1817",
                            color: landlordForm.hasPropertyManager===val ? API_COLOR : "#2a5550" }}
                          onClick={() => setLandlordForm(f=>({...f, hasPropertyManager:val, propertyManagerName:val!=="yes"?"":f.propertyManagerName}))}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Conditional text input — only shown if "yes" selected */}
                    {landlordForm.hasPropertyManager === "yes" && (
                      <ApiInput placeholder="Property manager name or company (optional)"
                        value={landlordForm.propertyManagerName}
                        onChange={e => setLandlordForm(f=>({...f,propertyManagerName:e.target.value}))} />
                    )}
                  </div>

                  {/* Disclaimer */}
                  <div style={{ background:"#111", border:"1px solid #2a2a2a", borderRadius:10, padding:"13px 15px", marginBottom:24 }}>
                    <p style={{ fontSize:12, color:"#555", margin:0, lineHeight:1.6 }}>By submitting, you confirm this is a real landlord/property and the info is accurate. False listings may be removed.</p>
                  </div>

                  {apiError && <div style={S.errorBox}>{apiError}</div>}

                  {/* Submit button — requires token + name + Google Places address confirmed */}
                  <button style={S.apiSubmitBtn(!!token && !!landlordForm.name.trim() && !!landlordFormPlaceData?.street)}
                    onClick={token && landlordForm.name.trim() && landlordFormPlaceData?.street ? submitLandlord : undefined}>
                    {token ? "Submit to API" : "Login to Submit"}
                  </button>
                </>
              )}
            </>
          )}


          {/* ── VIEW: AUTH (SUPABASE) ──────────────────────────────────
              Three modes controlled by authForm state:
              1. Login     — supabaseAuth.signIn()     → JWT session
              2. Register  — supabaseAuth.signUp()     → sends verification email
              3. Magic link— supabaseAuth.magicLink()  → sends one-time sign-in link
              On success: session saved to localStorage, user state set, goHome().
          */}
          {view === "auth" && (
            <>
              <button style={S.backBtn} onClick={goHome}>← Back</button>

              {/* Title + Supabase badge */}
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6 }}>
                <h2 style={{ fontFamily:"'Playfair Display', serif", fontSize:27, fontWeight:900, letterSpacing:"-0.02em", margin:0 }}>
                  {verificationSent ? "Check your inbox" : authForm.mode==="login" ? "Sign In" : "Create Account"}
                </h2>
                <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:9, fontFamily:"'JetBrains Mono', monospace", letterSpacing:"0.12em", color:SB_COLOR, background:SB_BG, border:`1px solid ${SB_BORDER}`, borderRadius:5, padding:"2px 7px" }}>
                  <span style={{ width:5, height:5, borderRadius:"50%", background:SB_COLOR, display:"inline-block", boxShadow:`0 0 5px ${SB_COLOR}` }} />
                  SUPABASE AUTH
                </span>
              </div>
              <p style={{ fontSize:14, color:"#555", marginBottom:24 }}>
                {verificationSent ? "" : authForm.mode==="login" ? "Sign in to write reviews and add landlords." : "Join LandLorder. Your email will be verified."}
              </p>

              {/* Auth flow explainer — educational debug box */}
              <div style={S.sbSection}>
                <div style={S.sbSectionTitle}>
                  <span style={{ width:5, height:5, borderRadius:"50%", background:SB_COLOR, display:"inline-block", boxShadow:`0 0 5px ${SB_COLOR}` }} />
                  HOW SUPABASE AUTH WORKS
                </div>
                <div style={{ display:"grid", gap:8 }}>
                  {[
                    ["📧","Register",     "Supabase sends a confirmation email. Reviews are tied to your verified address."],
                    ["🔑","Login",        "Returns a JWT access_token + refresh_token. Stored locally, sent as Bearer header."],
                    ["✨","Magic link",   "Passwordless sign-in via a one-time email link. No password needed."],
                    ["🔄","Auto-refresh", "Session silently refreshes on app load — no re-login needed."],
                  ].map(([icon, title, desc]) => (
                    <div key={title} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                      <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{icon}</span>
                      <div>
                        <span style={{ fontSize:11, color:SB_COLOR, fontFamily:"'JetBrains Mono', monospace", marginRight:6 }}>{title}</span>
                        <span style={{ fontSize:11, color:"#2a5a3a" }}>{desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Verification sent screen (register or magic link) ── */}
              {verificationSent ? (
                <div style={S.verifyBox}>
                  <div style={{ fontSize:40, marginBottom:16 }}>{verificationSent==="magic" ? "✨" : "📧"}</div>
                  <div style={{ fontFamily:"'Playfair Display', serif", fontSize:22, fontWeight:700, color:SB_COLOR, marginBottom:10 }}>
                    {verificationSent==="magic" ? "Magic link sent!" : "Confirmation email sent!"}
                  </div>
                  <p style={{ fontSize:13, color:"#3a6a50", lineHeight:1.7, marginBottom:20 }}>
                    {verificationSent==="magic"
                      ? `We sent a sign-in link to ${authForm.email}. Click it to log in — no password needed.`
                      : `We sent a confirmation link to ${authForm.email}. Click it to verify your account, then come back to sign in.`
                    }
                  </p>
                  <button onClick={() => { setVerificationSent(false); setAuthForm(f=>({...f,mode:"login",magicMode:false})); }}
                    style={{ ...S.sbSubmitBtn(true), width:"auto", padding:"10px 24px", fontSize:13 }}>
                    Back to Sign In
                  </button>
                </div>
              ) : (
                <>
                  {/* Login / Register mode toggle — hidden in magic link mode */}
                  {!authForm.magicMode && (
                    <div style={{ display:"flex", gap:8, marginBottom:24 }}>
                      {["login","register"].map(m => (
                        <button key={m} style={S.sbModeBtn(authForm.mode===m)}
                          onClick={() => { setAuthForm(f=>({...f,mode:m})); setAuthError(""); }}>
                          {m==="login" ? "🔑 Sign In" : "👤 Register"}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Magic link checkbox — switches form to email-only mode */}
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:22, padding:"10px 14px", background:"#081510", border:`1px solid ${SB_BORDER}`, borderRadius:8 }}>
                    <input type="checkbox" id="magicMode" checked={authForm.magicMode}
                      onChange={e => { setAuthForm(f=>({...f,magicMode:e.target.checked})); setAuthError(""); }}
                      style={{ accentColor:SB_COLOR, width:15, height:15, cursor:"pointer" }} />
                    <label htmlFor="magicMode" style={{ fontSize:13, color:"#3a6a50", cursor:"pointer" }}>
                      ✨ Use Magic Link instead <span style={{ color:"#1a4a2a" }}>(passwordless — we email you a sign-in link)</span>
                    </label>
                  </div>

                  {/* Email field — always shown */}
                  <div style={S.formSection}>
                    <label style={{ ...S.apiFormLabel, color:SB_COLOR }}>Email</label>
                    <SbInput value={authForm.email} type="email" placeholder="you@example.com"
                      onChange={e => setAuthForm(f=>({...f,email:e.target.value}))} sbStyles={S.sbInput} />
                  </div>

                  {/* Password field — hidden in magic link mode */}
                  {!authForm.magicMode && (
                    <div style={S.formSection}>
                      <label style={{ ...S.apiFormLabel, color:SB_COLOR }}>Password</label>
                      <SbInput value={authForm.password} type="password" placeholder="Min. 6 characters"
                        onChange={e => setAuthForm(f=>({...f,password:e.target.value}))} sbStyles={S.sbInput} />
                      {authForm.mode==="register" && (
                        <p style={{ fontSize:11, color:"#1a4a2a", marginTop:6, fontFamily:"'JetBrains Mono', monospace" }}>
                          ✓ Supabase requires min. 6 characters
                        </p>
                      )}
                    </div>
                  )}

                  {/* Email verification notice — shown only on register */}
                  {authForm.mode==="register" && !authForm.magicMode && (
                    <div style={{ background:"#081510", border:`1px solid ${SB_BORDER}`, borderRadius:8, padding:"12px 14px", marginBottom:22 }}>
                      <p style={{ fontSize:12, color:"#2a5a3a", margin:0, lineHeight:1.6 }}>
                        🔒 <strong style={{ color:SB_COLOR }}>Email verification required.</strong> After registering, Supabase will email you a confirmation link. Reviews are only accepted from verified accounts.
                      </p>
                    </div>
                  )}

                  {authError && <div style={S.errorBox}>{authError}</div>}

                  {/* Submit button — green when form is valid and not loading */}
                  <button
                    style={S.sbSubmitBtn(!authLoading && !!authForm.email && (authForm.magicMode || !!authForm.password))}
                    onClick={handleAuth}>
                    {authLoading
                      ? <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                          <span style={{ ...S.spinner, borderTopColor:SB_COLOR, borderColor:SB_COLOR+"33" }} /> Authenticating…
                        </span>
                      : authForm.magicMode ? "✨ Send Magic Link"
                      : authForm.mode==="login" ? "Sign In" : "Create Account"
                    }
                  </button>
                </>
              )}
            </>
          )}

        </div>
      </div>
    </>
  );
}

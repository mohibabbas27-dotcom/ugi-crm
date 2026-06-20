import { useState, useEffect } from "react";

function fixPhone(raw) {
  if (!raw) return "";
  let p = raw.toString().trim().replace(/\D/g, "");
  if (p.startsWith("0")) p = "92" + p.slice(1);
  if (p.startsWith("3")) p = "92" + p;
  return p.length >= 10 && p.length <= 13 ? p : "";
}

function processStudentCSV(text, unit) {
  const lines = text.split("\n").filter(Boolean);
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  const results = [];
  const seen = new Set();
  const nameIdx = headers.indexOf("name");
  const mobileIdx = headers.indexOf("mobile");
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const rawName = cols[nameIdx]?.trim() || "";
    const rawPhone = cols[mobileIdx]?.trim() || "";
    const mobile = fixPhone(rawPhone);
    if (!mobile || seen.has(mobile)) continue;
    seen.add(mobile);
    const parts = rawName.trim().split(" ");
    const campus = parts[0] || "";
    const name = parts.slice(1).join(" ") || rawName;
    results.push({ name, mobile, label: rawName, type: "Student", campus, unit, designation: "", source: "student" });
  }
  return results;
}

function parseHRName(fullName) {
  if (!fullName) return { unit: "", type: "", designation: "", name: "" };
  const trimmed = fullName.trim();
  const prefixMatch = trimmed.match(/^(UGI|Unit\s*\d+)\s*\((T|NT)\)\s*/i);
  let unit = "", type = "", remainder = trimmed;
  if (prefixMatch) {
    const rawUnit = prefixMatch[1].trim();
    unit = rawUnit.toLowerCase() === "ugi" ? "UGI" : rawUnit.replace(/unit\s*/i, "Unit ");
    type = prefixMatch[2].toUpperCase();
    remainder = trimmed.slice(prefixMatch[0].length).trim();
  }
  const dashIdx = remainder.indexOf("-");
  let designation = "", name = remainder;
  if (dashIdx !== -1) {
    designation = remainder.slice(0, dashIdx).trim();
    name = remainder.slice(dashIdx + 1).trim();
  }
  return { unit, type, designation, name };
}

function processHRCSV(text) {
  const lines = text.split("\n").filter(Boolean);
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  const results = [];
  const seen = new Set();
  const nameIdx = headers.findIndex(h => h === "name");
  const phoneIdx = headers.findIndex(h => h === "phone" || h === "mobile");
  if (nameIdx === -1 || phoneIdx === -1) {
    alert(`HR CSV mein "Name" aur "Phone" columns hone chahiye.\nMile: ${headers.join(", ")}`);
    return [];
  }
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const rawName = cols[nameIdx]?.trim() || "";
    const rawPhone = cols[phoneIdx]?.trim() || "";
    const mobile = fixPhone(rawPhone);
    if (!mobile || seen.has(mobile)) continue;
    seen.add(mobile);
    const { unit, type, designation, name } = parseHRName(rawName);
    results.push({ name, mobile, label: rawName, type: type || "T", unit, designation, campus: "", source: "hr" });
  }
  return results;
}

const typeColor = (type) => {
  if (type === "T")   return { bg: "#dbeafe", color: "#1d4ed8" };
  if (type === "NT")  return { bg: "#fef3c7", color: "#92400e" };
  if (type === "TLM") return { bg: "#fce7f3", color: "#9d174d" };
  return                     { bg: "#d1fae5", color: "#065f46" };
};

const unitColor = (unit) => {
  if (unit === "UGI")    return { bg: "#ede9fe", color: "#5b21b6" };
  if (unit === "Unit 1") return { bg: "#dcfce7", color: "#166534" };
  if (unit === "Unit 2") return { bg: "#ffedd5", color: "#9a3412" };
  return                        { bg: "#f3f4f6", color: "#6b7280" };
};

const UNITS = ["UGI", "Unit 1", "Unit 2"];
const UNIT_KEYS = { "UGI": "ugi", "Unit 1": "unit1", "Unit 2": "unit2" };
const UNIT_EMOJI = { "UGI": "🏛️", "Unit 1": "1️⃣", "Unit 2": "2️⃣" };
const defaultWaAll = { ugi: { status: "disconnected", qr: null }, unit1: { status: "disconnected", qr: null }, unit2: { status: "disconnected", qr: null } };
const API_BASE = "https://ugi-crm-production.up.railway.app";
const AUTH_TOKEN_KEY = "ugi_crm_jwt";

export default function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem(AUTH_TOKEN_KEY) || "");
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [importMode, setImportMode] = useState("student");
  const [studentUnit, setStudentUnit] = useState("UGI");
  const [preview, setPreview] = useState([]);
  const [allRows, setAllRows] = useState([]);
  const [msg, setMsg] = useState("");
  const [contacts, setContacts] = useState([]);
  const [filter, setFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({});
  const [activeTab, setActiveTab] = useState("import");
  const [waAll, setWaAll] = useState(defaultWaAll);
  const [blastUnit, setBlastUnit] = useState("UGI");
  const [blastType, setBlastType] = useState("all");
  const [blastMsg, setBlastMsg] = useState("");
  const [personalized, setPersonalized] = useState(true);
  const [mediaFile, setMediaFile] = useState(null);
  const [blastRunning, setBlastRunning] = useState(false);
  const [blastStats, setBlastStats] = useState({ sent: 0, failed: 0, skipped: 0, total: 0 });

  useEffect(() => { if (authToken && activeTab === "contacts") fetchContacts(); }, [filter, unitFilter, activeTab, authToken]);
  useEffect(() => { if (authToken) fetchStats(); }, [authToken]);

  function saveAuth(token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    setAuthToken(token);
    setAuthError("");
  }

  function logout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setAuthToken("");
    setAuthMode("login");
    setAuthForm({ name: "", email: "", password: "" });
    setWaAll(defaultWaAll);
    setBlastRunning(false);
  }

  async function authFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${authToken}`);
    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      logout();
      throw new Error("Session expired. Please login again.");
    }

    return response;
  }

  async function submitAuth(e) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    try {
      const payload = authMode === "signup"
        ? { name: authForm.name, email: authForm.email, password: authForm.password }
        : { email: authForm.email, password: authForm.password };

      const response = await fetch(`${API_BASE}/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      saveAuth(data.token);
    } catch (err) {
      setAuthError(err.message || "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  }

  async function fetchWaAll() {
    try {
      const r = await authFetch(`${API_BASE}/api/wa/status/all`);
      const d = await r.json();
      setWaAll(d);
    } catch { setWaAll(defaultWaAll); }
  }

  async function connectWa(key) {
    await authFetch(`${API_BASE}/api/wa/connect/${key}`, { method: "POST" });
    const poll = setInterval(async () => {
      try {
        const r = await authFetch(`${API_BASE}/api/wa/status/all`);
        const d = await r.json();
        setWaAll(d);
        if (d[key]?.status === "ready") clearInterval(poll);
      } catch { clearInterval(poll); }
    }, 3000);
  }

  async function disconnectWa(key) {
    await authFetch(`${API_BASE}/api/wa/disconnect/${key}`, { method: "POST" });
    fetchWaAll();
  }

  async function fetchStats() {
    try {
      const r = await authFetch(`${API_BASE}/api/contacts/stats`);
      const s = await r.json();
      setStats(s);
    } catch {
      setStats({});
    }
  }

  async function fetchContacts() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("type", filter);
      if (unitFilter !== "all") params.set("unit", unitFilter);
      const qs = params.toString();
      const r = await authFetch(`${API_BASE}/api/contacts${qs ? `?${qs}` : ""}`);
      const data = await r.json();
      setContacts(data.contacts || []);
    } catch {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setMsg("Processing...");
    const text = await file.text();
    const rows = importMode === "hr" ? processHRCSV(text) : processStudentCSV(text, studentUnit);
    setAllRows(rows);
    setPreview(rows.slice(0, 10));
    setMsg(`✅ ${rows.length} records ready — preview dekho, phir Save karo!`);
  }

  async function saveToDatabase() {
    if (!allRows.length) return;
    setMsg("Saving...");
    let saved = 0;
    for (let i = 0; i < allRows.length; i += 500) {
      const r = await authFetch(`${API_BASE}/api/contacts/bulk-upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: allRows.slice(i, i + 500) })
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setMsg(`Save failed: ${data.error || "Please try again"}`);
        return;
      }
      const data = await r.json();
      saved += data.saved || Math.min(500, allRows.length - i);
    }
    setMsg(`🎉 ${saved} contacts saved!`);
    setPreview([]); setAllRows([]);
    fetchStats();
  }

  async function exportFiltered() {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("type", filter);
    if (unitFilter !== "all") params.set("unit", unitFilter);
    const qs = params.toString();
    const r = await authFetch(`${API_BASE}/api/contacts${qs ? `?${qs}` : ""}`);
    const result = await r.json();
    const data = result.contacts || [];
    const csv = ["mobile,name,type,unit,designation,campus,label", ...data.map(c => `${c.mobile},"${c.name}","${c.type}","${c.unit||""}","${c.designation||""}","${c.campus||""}","${c.label||""}"`)].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `ugi_${unitFilter}_${filter}_${Date.now()}.csv`;
    a.click();
  }

  async function uploadMedia() {
    if (!mediaFile) return null;
    const fd = new FormData();
    fd.append("file", mediaFile);
    const r = await authFetch(`${API_BASE}/api/upload`, { method: "POST", body: fd });
    return await r.json();
  }

  async function startBlast() {
    if (!blastMsg.trim()) return alert("Message likho pehle!");
    const waKey = UNIT_KEYS[blastUnit];
    if (waAll[waKey]?.status !== "ready") return alert(`${blastUnit} ka WhatsApp connect karo pehle!`);
    setBlastRunning(true);
    setBlastStats({ sent: 0, failed: 0, skipped: 0, total: 0 });
    let mediaInfo = null;
    if (mediaFile) mediaInfo = await uploadMedia();
    await authFetch(`${API_BASE}/api/blast/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit: blastUnit, type: blastType, message: blastMsg, personalized, mediaPath: mediaInfo?.path || null, mediaMime: mediaInfo?.mimetype || null, mediaName: mediaInfo?.name || null })
    });
    const poll = setInterval(async () => {
      const r = await authFetch(`${API_BASE}/api/blast/status`);
      const d = await r.json();
      setBlastStats(d);
      if (!d.running) { setBlastRunning(false); clearInterval(poll); }
    }, 2000);
  }

  async function stopBlast() {
    await authFetch(`${API_BASE}/api/blast/stop`, { method: "POST" });
    setBlastRunning(false);
  }

  const filtered = contacts.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.mobile?.includes(search) ||
    c.campus?.toLowerCase().includes(search.toLowerCase()) ||
    c.designation?.toLowerCase().includes(search.toLowerCase())
  );

  const btn = (active, color = "#4f46e5") => ({
    padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer",
    background: active ? color : "#e5e7eb",
    color: active ? "white" : "#374151", fontWeight: 600, fontSize: 13
  });

  const waStatusColor = (s) => s === "ready" ? "#10b981" : s === "qr" ? "#f59e0b" : "#ef4444";
  const waStatusLabel = (s) => s === "ready" ? "Connected ✅" : s === "qr" ? "QR Scan Karo" : s === "connecting" ? "Connecting..." : "Disconnected";

  if (!authToken) {
    return (
      <div style={{ fontFamily: "sans-serif", minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <form onSubmit={submitAuth} style={{ width: "100%", maxWidth: 420, background: "white", borderRadius: 12, padding: 28, boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)", border: "1px solid #e5e7eb" }}>
          <div style={{ marginBottom: 22 }}>
            <h1 style={{ margin: 0, color: "#1a1a2e", fontSize: 26 }}>UGI CRM</h1>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>{authMode === "login" ? "Login to continue" : "Create an account"}</p>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <button type="button" onClick={() => { setAuthMode("login"); setAuthError(""); }} style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, background: authMode === "login" ? "#4f46e5" : "#e5e7eb", color: authMode === "login" ? "white" : "#374151" }}>Login</button>
            <button type="button" onClick={() => { setAuthMode("signup"); setAuthError(""); }} style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, background: authMode === "signup" ? "#4f46e5" : "#e5e7eb", color: authMode === "signup" ? "white" : "#374151" }}>Signup</button>
          </div>

          {authMode === "signup" && (
            <label style={{ display: "block", marginBottom: 12, color: "#374151", fontWeight: 600, fontSize: 13 }}>
              Name
              <input value={authForm.name} onChange={e => setAuthForm({ ...authForm, name: e.target.value })} style={{ marginTop: 6, width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 }} />
            </label>
          )}

          <label style={{ display: "block", marginBottom: 12, color: "#374151", fontWeight: 600, fontSize: 13 }}>
            Email
            <input type="email" required value={authForm.email} onChange={e => setAuthForm({ ...authForm, email: e.target.value })} style={{ marginTop: 6, width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 }} />
          </label>

          <label style={{ display: "block", marginBottom: 16, color: "#374151", fontWeight: 600, fontSize: 13 }}>
            Password
            <input type="password" required minLength={6} value={authForm.password} onChange={e => setAuthForm({ ...authForm, password: e.target.value })} style={{ marginTop: 6, width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 }} />
          </label>

          {authError && <div style={{ marginBottom: 14, padding: 10, borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: 13, fontWeight: 600 }}>{authError}</div>}

          <button type="submit" disabled={authLoading} style={{ width: "100%", padding: "12px 16px", borderRadius: 8, border: "none", background: authLoading ? "#9ca3af" : "#4f46e5", color: "white", cursor: authLoading ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 15 }}>
            {authLoading ? "Please wait..." : authMode === "login" ? "Login" : "Create Account"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 1200, margin: "0 auto", padding: 24 }}>

      <div style={{ borderBottom: "3px solid #4f46e5", paddingBottom: 12, marginBottom: 20, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h1 style={{ margin: 0, color: "#1a1a2e", fontSize: 26 }}>🏫 UGI Contact Management System</h1>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 14 }}>Unique Group of Institutions — CBS Module</p>
        </div>
        <button onClick={logout} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#ef4444", color: "white", cursor: "pointer", fontWeight: 700 }}>Logout</button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        {[{ label: "Total", value: stats.all || 0, color: "#4f46e5", bg: "#ede9fe" }, { label: "Teachers (T)", value: stats.T || 0, color: "#1d4ed8", bg: "#dbeafe" }, { label: "Non-Teaching", value: stats.NT || 0, color: "#92400e", bg: "#fef3c7" }, { label: "Management", value: stats.TLM || 0, color: "#9d174d", bg: "#fce7f3" }, { label: "Students", value: stats.Student || 0, color: "#065f46", bg: "#d1fae5" }].map(s => (
          <div key={s.label} style={{ padding: "10px 18px", background: s.bg, borderRadius: 10, minWidth: 90, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: s.color }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {UNITS.map(u => (
          <div key={u} style={{ padding: "10px 18px", background: unitColor(u).bg, borderRadius: 10, minWidth: 90, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: unitColor(u).color }}>{(stats[u] || 0).toLocaleString()}</div>
            <div style={{ fontSize: 11, color: unitColor(u).color }}>{UNIT_EMOJI[u]} {u}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button style={btn(activeTab === "import")}   onClick={() => setActiveTab("import")}>📂 Import Data</button>
        <button style={btn(activeTab === "contacts")} onClick={() => setActiveTab("contacts")}>👥 Contacts</button>
        <button style={btn(activeTab === "whatsapp")} onClick={() => { setActiveTab("whatsapp"); fetchWaAll(); }}>📱 WhatsApp Setup</button>
        <button style={btn(activeTab === "blast")}    onClick={() => { setActiveTab("blast"); fetchWaAll(); }}>📣 Blast</button>
      </div>

      {/* ══ IMPORT ══ */}
      {activeTab === "import" && (
        <div>
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            {[["student", "🎓", "Student CSV", "Format: Name (P05-TS-A Hadia), Mobile"], ["hr", "👨‍🏫", "HR Staff CSV", "Format: Unit 1(T) JBT-Muhammad Asif, Phone"]].map(([mode, emoji, label, hint]) => (
              <div key={mode} onClick={() => { setImportMode(mode); setPreview([]); setAllRows([]); setMsg(""); }}
                style={{ flex: 1, padding: "16px 20px", borderRadius: 12, cursor: "pointer", textAlign: "center", border: `2px solid ${importMode === mode ? "#4f46e5" : "#e5e7eb"}`, background: importMode === mode ? "#ede9fe" : "#f8fafc" }}>
                <div style={{ fontSize: 28 }}>{emoji}</div>
                <div style={{ fontWeight: 700, color: importMode === mode ? "#4f46e5" : "#374151", marginTop: 4 }}>{label}</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{hint}</div>
              </div>
            ))}
          </div>

          {importMode === "student" && (
            <div style={{ marginBottom: 16, padding: 14, background: "#ede9fe", borderRadius: 10 }}>
              <div style={{ fontWeight: 600, color: "#4f46e5", marginBottom: 8 }}>📋 Yeh students kis unit ke hain?</div>
              <div style={{ display: "flex", gap: 8 }}>
                {UNITS.map(u => <button key={u} onClick={() => setStudentUnit(u)} style={btn(studentUnit === u)}>{UNIT_EMOJI[u]} {u}</button>)}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>Selected: <b>{studentUnit}</b> — sab students ko yeh unit assign hogi</div>
            </div>
          )}

          {importMode === "hr" && (
            <div style={{ marginBottom: 16, padding: 12, background: "#fef3c7", borderRadius: 8, fontSize: 13, color: "#92400e" }}>
              <b>📋 HR CSV Format:</b><br />
              <code>Name,Phone</code><br />
              <code>Unit 1(T) JBT-Muhammad Asif,923214567890</code><br />
              <code>Unit 2(NT) SS-Fatima Malik,923001234567</code><br />
              <code>UGI(T) HOD-Ahmad Ali,923331234567</code>
            </div>
          )}

          <div style={{ padding: 24, background: "#f8fafc", borderRadius: 12, border: "2px dashed #c7d2fe" }}>
            <h3 style={{ marginTop: 0, color: "#4f46e5" }}>📂 {importMode === "hr" ? "HR Staff" : `${studentUnit} Student`} CSV Import</h3>
            <label style={{ display: "inline-block", padding: "12px 24px", background: "#4f46e5", color: "white", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 15 }}>
              📂 CSV File Select Karo
              <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />
            </label>
          </div>

          {msg && <div style={{ marginTop: 16, padding: 12, background: "#d1fae5", borderRadius: 8, color: "#065f46", fontWeight: 500 }}>{msg}</div>}

          {preview.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3>Preview (first 10):</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f3f4f6" }}>
                      {["Name", "Mobile", "Type", "Unit", "Designation", "Campus"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((c, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.name}</td>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.mobile}</td>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}><span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600, ...typeColor(c.type) }}>{c.type}</span></td>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.unit && <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600, ...unitColor(c.unit) }}>{c.unit}</span>}</td>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.designation}</td>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.campus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={saveToDatabase} style={{ marginTop: 16, padding: "12px 28px", background: "#059669", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 15 }}>
                💾 Save All {allRows.length.toLocaleString()} Contacts
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══ WHATSAPP SETUP ══ */}
      {activeTab === "whatsapp" && (
        <div>
          <h3 style={{ color: "#1a1a2e", marginTop: 0 }}>📱 3 WhatsApp Numbers Setup</h3>
          <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 20 }}>Har unit ka alag WhatsApp number connect karo. Blast sirf us unit ke number se hoga.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {UNITS.map(unit => {
              const key = UNIT_KEYS[unit];
              const wa = waAll[key] || { status: "disconnected", qr: null };
              const uc = unitColor(unit);
              return (
                <div key={unit} style={{ padding: 20, background: "#f8fafc", borderRadius: 12, border: `2px solid ${uc.bg}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ padding: "4px 12px", borderRadius: 20, fontWeight: 700, fontSize: 14, background: uc.bg, color: uc.color }}>{UNIT_EMOJI[unit]} {unit}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 10, height: 10, borderRadius: "50%", background: waStatusColor(wa.status) }} />
                          <span style={{ fontWeight: 600, color: waStatusColor(wa.status), fontSize: 14 }}>{waStatusLabel(wa.status)}</span>
                        </div>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>{unit} ke sab contacts ko yeh number message karega</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {wa.status !== "ready" && <button onClick={() => connectWa(key)} style={{ padding: "9px 18px", background: "#10b981", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>🔌 Connect</button>}
                      {wa.status === "ready" && <button onClick={() => disconnectWa(key)} style={{ padding: "9px 18px", background: "#ef4444", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Disconnect</button>}
                      <button onClick={fetchWaAll} style={{ padding: "9px 14px", background: "#e5e7eb", color: "#374151", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>🔄</button>
                    </div>
                  </div>
                  {wa.qr && (
                    <div style={{ marginTop: 16, textAlign: "center" }}>
                      <p style={{ color: "#6b7280", marginBottom: 8, fontSize: 13 }}>{unit} wale phone pe WhatsApp → Linked Devices → QR scan karo:</p>
                      <img src={wa.qr} alt="QR" style={{ borderRadius: 8, border: `4px solid ${uc.color}` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ BLAST ══ */}
      {activeTab === "blast" && (
        <div>
          <div style={{ marginBottom: 20, padding: 16, background: "#f8fafc", borderRadius: 12, border: "2px solid #e5e7eb" }}>
            <div style={{ fontWeight: 700, color: "#1a1a2e", marginBottom: 10, fontSize: 15 }}>🏢 Step 1 — Kis Unit ko bhejein?</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {UNITS.map(u => {
                const key = UNIT_KEYS[u];
                const wa = waAll[key] || { status: "disconnected" };
                const uc = unitColor(u);
                return (
                  <div key={u} onClick={() => setBlastUnit(u)}
                    style={{ padding: "12px 20px", borderRadius: 10, cursor: "pointer", textAlign: "center", minWidth: 120, border: `2px solid ${blastUnit === u ? uc.color : "#e5e7eb"}`, background: blastUnit === u ? uc.bg : "white" }}>
                    <div style={{ fontSize: 22 }}>{UNIT_EMOJI[u]}</div>
                    <div style={{ fontWeight: 700, color: uc.color, marginTop: 2 }}>{u}</div>
                    <div style={{ fontSize: 11, marginTop: 2 }}><span style={{ color: waStatusColor(wa.status), fontWeight: 600 }}>● {waStatusLabel(wa.status)}</span></div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>{(stats[u] || 0).toLocaleString()} contacts</div>
                  </div>
                );
              })}
            </div>
            {waAll[UNIT_KEYS[blastUnit]]?.status !== "ready" && (
              <div style={{ marginTop: 10, padding: 10, background: "#fef2f2", borderRadius: 8, color: "#dc2626", fontSize: 13, fontWeight: 600 }}>
                ⚠️ {blastUnit} ka WhatsApp connected nahi — pehle WhatsApp Setup tab mein connect karo!
              </div>
            )}
          </div>

          <div style={{ marginBottom: 20, padding: 16, background: "#f8fafc", borderRadius: 12, border: "2px solid #e5e7eb" }}>
            <div style={{ fontWeight: 700, color: "#1a1a2e", marginBottom: 10, fontSize: 15 }}>👥 Step 2 — Kaun se log? <span style={{ fontWeight: 400, fontSize: 13, color: "#6b7280" }}>(sirf {blastUnit} mein se)</span></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["all", "🌍 Sab"], ["Student", "🎓 Students"], ["T", "👨‍🏫 Teachers (T)"], ["NT", "🧑‍💼 Non-Teaching (NT)"], ["TLM", "🏫 Management"]].map(([val, label]) => (
                <button key={val} onClick={() => setBlastType(val)} style={btn(blastType === val)}>{label}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 20, padding: 16, background: "#f8fafc", borderRadius: 12, border: "2px solid #e5e7eb" }}>
            <div style={{ fontWeight: 700, color: "#1a1a2e", marginBottom: 10, fontSize: 15 }}>✍️ Step 3 — Message</div>
            <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ fontWeight: 600, color: "#374151" }}>👤 Personalized:</label>
              <div onClick={() => setPersonalized(!personalized)} style={{ width: 44, height: 24, borderRadius: 12, background: personalized ? "#4f46e5" : "#d1d5db", cursor: "pointer", position: "relative" }}>
                <div style={{ position: "absolute", top: 2, left: personalized ? 22 : 2, width: 20, height: 20, borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
              </div>
              <span style={{ color: "#6b7280", fontSize: 13 }}>{personalized ? "ON — Naam ayega" : "OFF — Generic"}</span>
            </div>
            <textarea value={blastMsg} onChange={e => setBlastMsg(e.target.value)} placeholder="Apna message yahan likho..." rows={5}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, resize: "vertical", boxSizing: "border-box" }} />
            {blastMsg && (
              <div style={{ marginTop: 8, padding: 10, background: "#ede9fe", borderRadius: 8, fontSize: 13, color: "#4f46e5" }}>
                <b>Preview:</b><br />Assalam o Alaikum{personalized ? " [Naam]" : ""}!<br /><br />{blastMsg}<br /><br />Shukriya - UGI Team
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <label style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>📎 Media (optional):</label>
              <input type="file" accept="image/*,.pdf" onChange={e => setMediaFile(e.target.files[0])} />
              {mediaFile && <div style={{ marginTop: 6, color: "#059669", fontSize: 13 }}>✅ {mediaFile.name}</div>}
            </div>
          </div>

          <div style={{ padding: 20, background: blastRunning ? "#fef3c7" : "#f0fdf4", borderRadius: 12, border: `2px solid ${blastRunning ? "#f59e0b" : "#10b981"}` }}>
            {!blastRunning ? (
              <button onClick={startBlast} disabled={waAll[UNIT_KEYS[blastUnit]]?.status !== "ready"}
                style={{ padding: "14px 32px", background: waAll[UNIT_KEYS[blastUnit]]?.status === "ready" ? "#10b981" : "#9ca3af", color: "white", border: "none", borderRadius: 10, cursor: waAll[UNIT_KEYS[blastUnit]]?.status === "ready" ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 16, width: "100%" }}>
                🚀 {UNIT_EMOJI[blastUnit]} {blastUnit} — {blastType === "all" ? "Sab" : blastType} ko Blast Karo
              </button>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, color: "#92400e", fontSize: 16 }}>⏳ Blast chal raha hai... ({blastUnit})</span>
                  <button onClick={stopBlast} style={{ padding: "8px 18px", background: "#ef4444", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>⛔ Stop</button>
                </div>
                <div style={{ background: "#e5e7eb", borderRadius: 8, height: 12, marginBottom: 12 }}>
                  <div style={{ background: "#10b981", height: 12, borderRadius: 8, width: `${blastStats.total ? (blastStats.sent / blastStats.total) * 100 : 0}%`, transition: "width 0.5s" }} />
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <span style={{ color: "#059669", fontWeight: 600 }}>✅ Sent: {blastStats.sent}</span>
                  <span style={{ color: "#ef4444", fontWeight: 600 }}>❌ Failed: {blastStats.failed}</span>
                  <span style={{ color: "#f59e0b", fontWeight: 600 }}>⚠️ Skipped: {blastStats.skipped}</span>
                  <span style={{ color: "#6b7280", fontWeight: 600 }}>📊 Total: {blastStats.total}</span>
                </div>
              </div>
            )}
            {!blastRunning && blastStats.sent > 0 && (
              <div style={{ marginTop: 16, padding: 12, background: "#d1fae5", borderRadius: 8 }}>
                <b style={{ color: "#065f46" }}>🎉 Blast Complete!</b><br />
                <span style={{ color: "#065f46" }}>Sent: {blastStats.sent} | Failed: {blastStats.failed} | Skipped: {blastStats.skipped}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ CONTACTS ══ */}
      {activeTab === "contacts" && (
        <div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, fontWeight: 600 }}>UNIT:</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setUnitFilter("all")} style={btn(unitFilter === "all")}>🌍 All</button>
              {UNITS.map(u => <button key={u} onClick={() => setUnitFilter(u)} style={btn(unitFilter === u, unitColor(u).color)}>{UNIT_EMOJI[u]} {u}</button>)}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, fontWeight: 600 }}>TYPE:</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["all", "All"], ["Student", "Students"], ["T", "Teachers (T)"], ["NT", "Non-Teaching (NT)"], ["TLM", "Management"]].map(([val, label]) => (
                <button key={val} onClick={() => setFilter(val)} style={btn(filter === val)}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <input placeholder="Search naam, mobile, campus, designation..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, padding: "9px 14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 }} />
            <button onClick={exportFiltered} style={{ padding: "9px 18px", borderRadius: 8, background: "#2563eb", color: "white", border: "none", cursor: "pointer", fontWeight: 600 }}>⬇️ Export CSV</button>
          </div>
          <div style={{ marginBottom: 12, color: "#6b7280", fontSize: 14 }}>
            {filtered.length.toLocaleString()} contacts{unitFilter !== "all" ? ` · ${unitFilter}` : ""}{filter !== "all" ? ` · ${filter}` : ""}
          </div>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>Loading...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    {["Name", "Mobile", "Type", "Unit", "Designation", "Campus"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={c.id} style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.name}</td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.mobile}</td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}><span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600, ...typeColor(c.type) }}>{c.type}</span></td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.unit && <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600, ...unitColor(c.unit) }}>{c.unit}</span>}</td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.designation}</td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.campus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length === 0 && !loading && <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>No contacts found.</div>}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://geeulsqwiglxxggpwvta.supabase.co",
  "sb_publishable_Cv_ABFcw8MBQv4fxBboiOA_LMeruWwj"
);

function fixPhone(raw) {
  if (!raw) return "";
  let p = raw.toString().trim().replace(/\D/g, "");
  if (p.startsWith("0")) p = "92" + p.slice(1);
  if (p.startsWith("3")) p = "92" + p;
  return p.length >= 10 && p.length <= 13 ? p : "";
}

function detectType(name) {
  if (!name) return "Student";
  const n = name.toLowerCase();
  if (n.includes("(nt)")) return "NT";
  if (n.includes("(t)") && !n.includes("(nt)")) return "T";
  if (n.includes("management") || n.includes("tlm")) return "TLM";
  return "Student";
}

function parseCampusAndName(fullName) {
  // Format: "P05-TS-A 9th Hadia Ismail"
  // Campus = first token (P05-TS-A), rest = actual name
  if (!fullName) return { campus: "", name: "" };
  const parts = fullName.trim().split(" ");
  const campus = parts[0] || "";
  const name = parts.slice(1).join(" ") || fullName;
  return { campus, name };
}

function processCSV(text) {
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

    const phone = fixPhone(rawPhone);
    if (!phone) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);

    const { campus, name } = parseCampusAndName(rawName);
    const type = detectType(rawName);

    results.push({ name, phone, label: rawName, type, campus });
  }
  return results;
}

export default function App() {
  const [contacts, setContacts] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState([]);
  const [allRows, setAllRows] = useState([]);
  const [activeTab, setActiveTab] = useState("import");
  const [stats, setStats] = useState({});
  const [waStatus, setWaStatus] = useState("disconnected");
  const [waQr, setWaQr] = useState(null);
  const [blastFilter, setBlastFilter] = useState("all");
  const [blastMsg, setBlastMsg] = useState("");
  const [personalized, setPersonalized] = useState(true);
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaUploaded, setMediaUploaded] = useState(null);
  const [blastRunning, setBlastRunning] = useState(false);
  const [blastStats, setBlastStats] = useState({ sent: 0, failed: 0, skipped: 0, total: 0, log: [] });

  useEffect(() => { if (activeTab === "contacts") fetchContacts(); }, [filter, activeTab]);
  useEffect(() => { fetchStats(); }, []);

  async function checkWaStatus() {
    try {
      const r = await fetch("http://localhost:3001/api/wa/status");
      const d = await r.json();
      setWaStatus(d.status);
      setWaQr(d.qr);
    } catch { setWaStatus("disconnected"); }
  }

  async function connectWa() {
    await fetch("http://localhost:3001/api/wa/connect", { method: "POST" });
    setWaStatus("connecting");
    const poll = setInterval(async () => {
      const r = await fetch("http://localhost:3001/api/wa/status");
      const d = await r.json();
      setWaStatus(d.status);
      setWaQr(d.qr);
      if (d.status === "ready") clearInterval(poll);
    }, 3000);
  }

  async function uploadMedia() {
    if (!mediaFile) return null;
    const fd = new FormData();
    fd.append("file", mediaFile);
    const r = await fetch("http://localhost:3001/api/upload", { method: "POST", body: fd });
    return await r.json();
  }

  async function startBlast() {
    if (!blastMsg.trim()) return alert("Message likho pehle!");
    if (waStatus !== "ready") return alert("WhatsApp connect karo pehle!");
    setBlastRunning(true);
    setBlastStats({ sent: 0, failed: 0, skipped: 0, total: 0, log: [] });

    let mediaInfo = null;
    if (mediaFile) mediaInfo = await uploadMedia();

    await fetch("http://localhost:3001/api/blast/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: blastFilter,
        message: blastMsg,
        personalized,
        mediaPath: mediaInfo?.path || null,
        mediaMime: mediaInfo?.mimetype || null,
        mediaName: mediaInfo?.name || null,
      })
    });

    const poll = setInterval(async () => {
      const r = await fetch("http://localhost:3001/api/blast/status");
      const d = await r.json();
      setBlastStats(d);
      if (!d.running) { setBlastRunning(false); clearInterval(poll); }
    }, 2000);
  }

  async function stopBlast() {
    await fetch("http://localhost:3001/api/blast/stop", { method: "POST" });
    setBlastRunning(false);
  }

  async function fetchStats() {
    // Total count
    const { count: total } = await supabase
      .from("contacts")
      .select("*", { count: "exact", head: true });

    // Per type counts
    const types = ["T", "NT", "TLM", "Student"];
    const counts = await Promise.all(
      types.map(t =>
        supabase.from("contacts").select("*", { count: "exact", head: true }).eq("type", t)
      )
    );

    const s = { all: total || 0 };
    types.forEach((t, i) => { s[t] = counts[i].count || 0; });
    setStats(s);
  }

  async function fetchContacts() {
    setLoading(true);
    let query = supabase.from("contacts").select("*").order("name");
    if (filter !== "all") query = query.eq("type", filter);
    const { data } = await query.limit(10000);
    setContacts(data || []);
    setLoading(false);
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setMsg("Processing file...");
    const text = await file.text();
    const rows = processCSV(text);
    setAllRows(rows);
    setPreview(rows.slice(0, 10));
    setMsg(`✅ ${rows.length} records ready — preview neeche hai, Save karo!`);
  }

  async function saveToDatabase() {
    if (!allRows.length) return;
    setMsg("Saving to database...");
    let saved = 0;
    for (let i = 0; i < allRows.length; i += 500) {
      const { error } = await supabase.from("contacts")
        .upsert(allRows.slice(i, i + 500), { onConflict: "phone" });
      if (!error) saved += Math.min(500, allRows.length - i);
    }
    setMsg(`🎉 ${saved} contacts saved!`);
    setPreview([]);
    setAllRows([]);
    fetchStats();
  }

  async function exportFiltered() {
    setMsg("Exporting...");
    let query = supabase.from("contacts").select("*");
    if (filter !== "all") query = query.eq("type", filter);
    const { data } = await query;
    if (!data) return;
    const csv = ["phone,name,type,campus,label",
      ...data.map(c => `${c.phone},"${c.name}","${c.type}","${c.campus}","${c.label}"`)
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `ugi_${filter}_${Date.now()}.csv`;
    a.click();
    setMsg(`✅ ${data.length} contacts exported!`);
  }

  const filtered = contacts.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) ||
    c.campus?.toLowerCase().includes(search.toLowerCase())
  );

  const btn = (active) => ({
    padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer",
    background: active ? "#4f46e5" : "#e5e7eb",
    color: active ? "white" : "#374151", fontWeight: 600, fontSize: 14
  });

  const typeColor = (type) => {
    if (type === "T") return { bg: "#dbeafe", color: "#1d4ed8" };
    if (type === "NT") return { bg: "#fef3c7", color: "#92400e" };
    if (type === "TLM") return { bg: "#fce7f3", color: "#9d174d" };
    return { bg: "#d1fae5", color: "#065f46" };
  };

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      
      {/* Header */}
      <div style={{ borderBottom: "3px solid #4f46e5", paddingBottom: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, color: "#1a1a2e", fontSize: 26 }}>🏫 UGI Contact Management System</h1>
        <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 14 }}>Unique Group of Institutions — CBS Module</p>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Total", value: stats.all || 0, color: "#4f46e5", bg: "#ede9fe" },
          { label: "Teachers", value: stats.T || 0, color: "#1d4ed8", bg: "#dbeafe" },
          { label: "Non-Teaching", value: stats.NT || 0, color: "#92400e", bg: "#fef3c7" },
          { label: "Management", value: stats.TLM || 0, color: "#9d174d", bg: "#fce7f3" },
          { label: "Students", value: stats.Student || 0, color: "#065f46", bg: "#d1fae5" },
        ].map(s => (
          <div key={s.label} style={{ padding: "10px 20px", background: s.bg, borderRadius: 10, minWidth: 100, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: s.color }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button style={btn(activeTab === "import")} onClick={() => setActiveTab("import")}>📂 Import Data</button>
        <button style={btn(activeTab === "contacts")} onClick={() => setActiveTab("contacts")}>👥 View Contacts</button>
        <button style={btn(activeTab === "blast")} onClick={() => { setActiveTab("blast"); checkWaStatus(); }}>📣 WhatsApp Blast</button>
      </div>

      {/* IMPORT TAB */}
      {activeTab === "import" && (
        <div>
          <div style={{ padding: 24, background: "#f8fafc", borderRadius: 12, border: "2px dashed #c7d2fe" }}>
            <h3 style={{ marginTop: 0, color: "#4f46e5" }}>📂 CSV File Import</h3>
            <p style={{ color: "#6b7280" }}>
              Apni CSV file select karo — automatically process ho ke database mein jayegi!
            </p>
            <label style={{
              display: "inline-block", padding: "12px 24px", background: "#4f46e5",
              color: "white", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 15
            }}>
              📂 CSV File Select Karo
              <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />
            </label>
          </div>

          {msg && (
            <div style={{ marginTop: 16, padding: 12, background: "#d1fae5", borderRadius: 8, color: "#065f46", fontWeight: 500 }}>
              {msg}
            </div>
          )}

          {preview.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3>Preview (first 10 records):</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f3f4f6" }}>
                      {["Name", "Phone", "Type", "Campus", "Label"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((c, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.name}</td>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.phone}</td>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}>
                          <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600, background: typeColor(c.type).bg, color: typeColor(c.type).color }}>{c.type}</span>
                        </td>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.campus}</td>
                        <td style={{ padding: "6px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={saveToDatabase} style={{
                marginTop: 16, padding: "12px 28px", background: "#059669",
                color: "white", border: "none", borderRadius: 8, cursor: "pointer",
                fontWeight: 700, fontSize: 15
              }}>
                💾 Save All {allRows.length.toLocaleString()} Contacts to Database
              </button>
            </div>
          )}
        </div>
      )}

      {/* BLAST TAB */}
      {activeTab === "blast" && (
        <div>
          {/* WA Connection */}
          <div style={{ padding: 20, background: "#f8fafc", borderRadius: 12, border: "2px solid #e5e7eb", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <h3 style={{ margin: 0, color: "#1a1a2e" }}>📱 WhatsApp Status</h3>
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: waStatus === "ready" ? "#10b981" : waStatus === "qr" ? "#f59e0b" : "#ef4444" }} />
                  <span style={{ fontWeight: 600, color: waStatus === "ready" ? "#10b981" : waStatus === "qr" ? "#f59e0b" : "#ef4444" }}>
                    {waStatus === "ready" ? "Connected ✅" : waStatus === "qr" ? "QR Scan Karo 👇" : waStatus === "connecting" ? "Connecting..." : "Disconnected"}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {waStatus !== "ready" && (
                  <button onClick={connectWa} style={{ padding: "9px 20px", background: "#10b981", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                    🔌 Connect WhatsApp
                  </button>
                )}
                {waStatus === "ready" && (
                  <button onClick={async () => { await fetch("http://localhost:3001/api/wa/disconnect", { method: "POST" }); setWaStatus("disconnected"); }} style={{ padding: "9px 20px", background: "#ef4444", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                    Disconnect
                  </button>
                )}
                <button onClick={checkWaStatus} style={{ padding: "9px 16px", background: "#e5e7eb", color: "#374151", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                  🔄 Refresh
                </button>
              </div>
            </div>
            {waQr && (
              <div style={{ marginTop: 16, textAlign: "center" }}>
                <p style={{ color: "#6b7280", marginBottom: 8 }}>WhatsApp pe QR scan karo:</p>
                <img src={waQr} alt="QR Code" style={{ borderRadius: 8, border: "4px solid #4f46e5" }} />
              </div>
            )}
          </div>

          {/* Blast Config */}
          <div style={{ padding: 20, background: "#f8fafc", borderRadius: 12, border: "2px solid #e5e7eb", marginBottom: 20 }}>
            <h3 style={{ marginTop: 0, color: "#1a1a2e" }}>⚙️ Blast Settings</h3>

            {/* Filter */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>📋 Kis ko bhejein?</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[["all", "🌍 Sab ko"], ["Student", "🎓 Students"], ["T", "👨‍🏫 Teachers"], ["NT", "🧑‍💼 Non-Teaching"], ["TLM", "🏫 Management"]].map(([val, label]) => (
                  <button key={val} onClick={() => setBlastFilter(val)} style={{ ...btn(blastFilter === val) }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Personalized toggle */}
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ fontWeight: 600, color: "#374151" }}>👤 Personalized (naam include karo):</label>
              <div onClick={() => setPersonalized(!personalized)} style={{
                width: 44, height: 24, borderRadius: 12, background: personalized ? "#4f46e5" : "#d1d5db",
                cursor: "pointer", position: "relative", transition: "background 0.2s"
              }}>
                <div style={{ position: "absolute", top: 2, left: personalized ? 22 : 2, width: 20, height: 20, borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
              </div>
              <span style={{ color: "#6b7280", fontSize: 13 }}>{personalized ? "ON — Naam message mein ayega" : "OFF — Generic message"}</span>
            </div>

            {/* Message */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>✍️ Core Message (greeting/closing auto lagega):</label>
              <textarea
                value={blastMsg}
                onChange={e => setBlastMsg(e.target.value)}
                placeholder="Yahan apna message likho..."
                rows={5}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, resize: "vertical", boxSizing: "border-box" }}
              />
              {blastMsg && (
                <div style={{ marginTop: 8, padding: 10, background: "#ede9fe", borderRadius: 8, fontSize: 13, color: "#4f46e5" }}>
                  <b>Preview:</b><br />
                  Assalam o Alaikum{personalized ? " [Naam]" : ""}!<br /><br />
                  {blastMsg}<br /><br />
                  Shukriya - UGI Team
                </div>
              )}
            </div>

            {/* Media */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>📎 Media attach karo (optional):</label>
              <input type="file" accept="image/*,.pdf" onChange={e => setMediaFile(e.target.files[0])}
                style={{ padding: "8px 0" }} />
              {mediaFile && <div style={{ marginTop: 6, color: "#059669", fontSize: 13 }}>✅ {mediaFile.name} selected</div>}
            </div>
          </div>

          {/* Blast Button & Progress */}
          <div style={{ padding: 20, background: blastRunning ? "#fef3c7" : "#f0fdf4", borderRadius: 12, border: `2px solid ${blastRunning ? "#f59e0b" : "#10b981"}` }}>
            {!blastRunning ? (
              <button onClick={startBlast} disabled={waStatus !== "ready"} style={{
                padding: "14px 32px", background: waStatus === "ready" ? "#10b981" : "#9ca3af",
                color: "white", border: "none", borderRadius: 10, cursor: waStatus === "ready" ? "pointer" : "not-allowed",
                fontWeight: 700, fontSize: 16, width: "100%"
              }}>
                🚀 Blast Shuru Karo
              </button>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, color: "#92400e", fontSize: 16 }}>⏳ Blast chal raha hai...</span>
                  <button onClick={stopBlast} style={{ padding: "8px 18px", background: "#ef4444", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                    ⛔ Stop
                  </button>
                </div>

                {/* Progress bar */}
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

            {/* Completed */}
            {!blastRunning && blastStats.sent > 0 && (
              <div style={{ marginTop: 16, padding: 12, background: "#d1fae5", borderRadius: 8 }}>
                <b style={{ color: "#065f46" }}>🎉 Blast Complete!</b><br />
                <span style={{ color: "#065f46" }}>Sent: {blastStats.sent} | Failed: {blastStats.failed} | Skipped: {blastStats.skipped}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONTACTS TAB */}
      {activeTab === "contacts" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            {[["all", "All"], ["T", "Teachers"], ["NT", "Non-Teaching"], ["TLM", "Management"], ["Student", "Students"]].map(([val, label]) => (
              <button key={val} onClick={() => setFilter(val)} style={btn(filter === val)}>{label}</button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <input
              placeholder="Search name, phone, or campus..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, padding: "9px 14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 }}
            />
            <button onClick={exportFiltered} style={{
              padding: "9px 18px", borderRadius: 8, background: "#2563eb",
              color: "white", border: "none", cursor: "pointer", fontWeight: 600
            }}>
              ⬇️ Export CSV
            </button>
          </div>

          <div style={{ marginBottom: 12, color: "#6b7280", fontSize: 14 }}>
            Showing {filtered.length} contacts {filter !== "all" ? `(${filter})` : ""}
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>Loading...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    {["Name", "Phone", "Type", "Campus", "Label"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={c.id} style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.name}</td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.phone}</td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600, background: typeColor(c.type).bg, color: typeColor(c.type).color }}>{c.type}</span>
                      </td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.campus}</td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>{c.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length === 0 && !loading && (
            <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>No contacts found.</div>
          )}
        </div>
      )}
    </div>
  );
}
import React, { useState } from "react";

function DialerEinwandPanel({ lead, user }) {
  const OBJECTIONS = [
    { id: "teuer", icon: "💰", label: "Zu teuer" },
    { id: "interesse", icon: "🚫", label: "Kein Interesse" },
    { id: "spaeter", icon: "⏳", label: "Entscheide später" },
    { id: "vertrag", icon: "📋", label: "Vertraglich gebunden" },
    { id: "infos", icon: "📧", label: "Erst mal Infos" },
    { id: "anbieter", icon: "🏢", label: "Habe schon Anbieter" },
  ];

  const [activeObjection, setActiveObjection] = useState(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);

  const handleObjection = async (obj) => {
    if (activeObjection === obj.id && response) {
      setActiveObjection(null);
      setResponse(null);
      return;
    }
    setActiveObjection(obj.id);
    setLoading(true);
    setError(null);
    setResponse(null);

    const ctx = [
      `Lead: ${lead.company || lead.person || "—"}`,
      `Ansprechpartner: ${lead.person || "—"}`,
      `Status: ${lead.status}`,
      lead.consumption ? `Verbrauch: ${lead.consumption} kWh` : null,
      lead.currentProvider ? `Aktueller Anbieter: ${lead.currentProvider}` : null,
      lead.annualCosts ? `Jahreskosten: €${lead.annualCosts}` : null,
      lead.contractEnd ? `Vertragsende: ${lead.contractEnd}` : null,
    ].filter(Boolean).join("\n");

    try {
      const apiBase = process.env.REACT_APP_API_BASE_URL || "";
      const res = await fetch(`${apiBase}/api/ai-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "Du bist ein erfahrener Energievertriebscoach. Gib kurze, schlagfertige Antworten auf Kundeneinwände im Energievertrieb. Antworte auf Deutsch, direkt und praxisnah. Maximal 3-4 Sätze pro Antwort. Nutze die Lead-Informationen für personalisierte Argumente." },
            { role: "user", content: `${ctx}\n\nDer Kunde sagt: "${obj.label}"\n\nGib eine professionelle, überzeugende Antwort auf diesen Einwand.` }
          ]
        })
      });
      const data = await res.json();
      setResponse(data.choices?.[0]?.message?.content || data.result || "Keine Antwort erhalten.");
    } catch {
      setError("KI-Antwort fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  };

  const copyResponse = () => {
    if (response) navigator.clipboard.writeText(response);
  };

  if (!lead) return null;

  return (
    <div className="dialer-einwand-panel">
      <div className="objection-header">
        <span className="objection-title-icon">🛡️</span>
        <div>
          <p className="objection-title">KI-Einwandbehandlung</p>
          <p className="objection-sub">{lead.company || lead.person} — Einwand auswählen:</p>
        </div>
      </div>
      <div className="objection-grid">
        {OBJECTIONS.map(obj => (
          <button
            key={obj.id}
            className={`objection-chip${activeObjection === obj.id ? " active" : ""}`}
            onClick={() => handleObjection(obj)}
            disabled={loading && activeObjection !== obj.id}
          >
            <span>{obj.icon}</span> {obj.label}
          </button>
        ))}
      </div>
      {loading && (
        <div className="objection-loading">
          <div className="obj-spinner" />
          <span>KI generiert Antwort...</span>
        </div>
      )}
      {error && <div className="objection-error">{error}</div>}
      {response && !loading && (
        <div className="objection-response">
          <div className="objection-response-header">
            <span>💡 Empfohlene Antwort</span>
            <button className="objection-copy" onClick={copyResponse}>📋 Kopieren</button>
          </div>
          <div className="objection-response-text">
            {response.split("\n").filter(Boolean).map((line, i) => (
              <p key={i} className={line.startsWith("- ") || line.startsWith("• ") ? "objection-bullet" : "objection-line"}>{line}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default DialerEinwandPanel;

import React, { useState } from "react";

function AIAssistantPanel({ lead, user, userRole, onUpdateField, onUpdateStatus }) {
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [appliedKeys, setAppliedKeys] = useState([]);

  const extractJsonFromText = (text) => {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try { return JSON.parse(fenced[1].trim()); } catch (_) {}
    }
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { return JSON.parse(braceMatch[0]); } catch (_) {}
    }
    return null;
  };

  const buildPrompt = (selectedMode) => {
    const ctx = [
      `Lead: ${lead.company || "—"} / ${lead.person || "—"}`,
      `Status: ${lead.status}`,
      lead.phone ? `Telefon: ${lead.phone}` : null,
      lead.email ? `E-Mail: ${lead.email}` : null,
      lead.consumption ? `Verbrauch: ${lead.consumption} kWh` : null,
      lead.annualCosts ? `Jahreskosten: €${lead.annualCosts}` : null,
      lead.currentProvider ? `Aktueller Anbieter: ${lead.currentProvider}` : null,
      lead.contractEnd ? `Vertragsende: ${lead.contractEnd}` : null,
      lead.customerType ? `Kundentyp: ${lead.customerType}` : null,
      lead.postalCode ? `PLZ: ${lead.postalCode}` : null,
      lead.followUp ? `Follow-up: ${lead.followUp}` : null,
      (lead.callLogs?.length > 0) ? `Letzte Anrufe: ${lead.callLogs.slice(-3).map(c => `${c.outcome} (${c.timestamp?.split("T")[0]})`).join(", ")}` : null,
      (lead.comments?.length > 0) ? `Letzte Notizen: ${lead.comments.slice(-3).map(c => `"${c.text.slice(0, 60)}" (${c.timestamp?.split("T")[0]})`).join(", ")}` : null,
    ].filter(Boolean).join("\n");

    if (selectedMode === "prepare") {
      return {
        system: "Du bist ein Energievertriebscoach und hilfst Sales-Agents, sich auf Verkaufsgespräche vorzubereiten. Gib konkrete, umsetzbare Tipps basierend auf den Lead-Daten. Antworte auf Deutsch.",
        user: `${ctx}\n\nBereite mich auf das nächste Gespräch mit diesem Lead vor. Gib mir:\n1. 3 Gesprächseinstiege\n2. Welche Einwände zu erwarten sind\n3. Konkreter Pitch basierend auf den Daten`,
      };
    }
    if (selectedMode === "analyze") {
      return {
        system: `Du bist ein CRM-Analyse-Assistent im Energievertrieb. Analysiere Leads und gib strukturierte Empfehlungen. Antworte als JSON:\n{"status":"Neu"|"Kontaktiert"|"Angebot"|"Follow-up"|"Abschluss"|"Verloren","followUp":"YYYY-MM-DD","summary":"kurzer Text","actions":["Aktion 1","Aktion 2"]}\nWenn du das Feld nicht ändern willst, lass es weg.`,
        user: `${ctx}\n\nAnalysiere diesen Lead und gib strukturierte Empfehlungen. Was sollte der nächste Status sein? Wann sollte das Follow-up sein?`,
      };
    }
    if (selectedMode === "nextSteps") {
      return {
        system: "Du bist ein Energievertriebscoach. Gib für den aktuellen Lead-Status die besten nächsten Schritte. Antworte auf Deutsch, praxisnah und direkt.",
        user: `${ctx}\n\nWas sind die optimalen nächsten 3 Schritte für diesen Lead? Berücksichtige den aktuellen Status und alle verfügbaren Daten.`,
      };
    }
    if (selectedMode === "email") {
      return {
        system: "Du bist ein E-Mail-Copywriter im Energievertrieb. Schreibe professionelle, personalisierte E-Mails. Antworte auf Deutsch.",
        user: `${ctx}\n\nSchreibe eine professionelle Follow-up E-Mail an diesen Lead. Die E-Mail soll:\n1. Persönlich und professionell sein\n2. Den Mehrwert eines Anbieterwechsels betonen\n3. Einen klaren Call-to-Action haben`,
      };
    }
    return { system: "", user: ctx };
  };

  const runAI = async (selectedMode) => {
    setMode(selectedMode);
    setLoading(true);
    setResult(null);
    setAppliedKeys([]);

    const { system, user: userMsg } = buildPrompt(selectedMode);
    try {
      const apiBase = process.env.REACT_APP_API_BASE_URL || "";
      const res = await fetch(`${apiBase}/api/ai-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "system", content: system }, { role: "user", content: userMsg }] }),
      });
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || data.result || "Keine Antwort erhalten.";

      if (selectedMode === "analyze") {
        const parsed = extractJsonFromText(content);
        setResult({ type: "structured", raw: content, parsed });
      } else {
        setResult({ type: "text", content });
      }
    } catch (e) {
      setResult({ type: "error", content: `Fehler: ${e?.message || "Unbekannt"}` });
    } finally {
      setLoading(false);
    }
  };

  const applySuggestion = async (key, value) => {
    if (appliedKeys.includes(key)) return;
    if (key === "status") {
      await onUpdateStatus(lead.id, value);
    } else {
      await onUpdateField(lead.id, key, value);
    }
    setAppliedKeys((prev) => [...prev, key]);
  };

  const MODES = [
    { id: "prepare", icon: "🎯", label: "Gesprächsvorbereitung" },
    { id: "analyze", icon: "🔍", label: "Lead analysieren" },
    { id: "nextSteps", icon: "📋", label: "Nächste Schritte" },
    { id: "email", icon: "✉️", label: "E-Mail generieren" },
  ];

  return (
    <div className="ai-assistant-panel">
      <div className="ai-mode-selector">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`ai-mode-btn ${mode === m.id ? "active" : ""}`}
            onClick={() => runAI(m.id)}
            disabled={loading}
          >
            <span className="ai-mode-icon">{m.icon}</span>
            <span className="ai-mode-label">{m.label}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="ai-loading">
          <div className="ai-spinner" />
          <span>KI analysiert...</span>
        </div>
      )}

      {result?.type === "error" && (
        <div className="ai-error">{result.content}</div>
      )}

      {result?.type === "text" && (
        <div className="ai-result-text">
          {result.content.split("\n").filter(Boolean).map((line, i) => (
            <p key={i} className={line.startsWith("- ") || line.startsWith("• ") ? "ai-bullet" : "ai-line"}>{line}</p>
          ))}
          {mode === "email" && (
            <button className="ai-copy-btn" onClick={() => navigator.clipboard.writeText(result.content)}>
              📋 E-Mail kopieren
            </button>
          )}
        </div>
      )}

      {result?.type === "structured" && result.parsed && (
        <div className="ai-structured-result">
          {result.parsed.summary && (
            <div className="ai-summary">
              <strong>Zusammenfassung:</strong>
              <p>{result.parsed.summary}</p>
            </div>
          )}
          {result.parsed.status && result.parsed.status !== lead.status && (
            <div className="ai-suggestion">
              <span>Status → <strong>{result.parsed.status}</strong></span>
              <button
                className={`ai-apply-btn ${appliedKeys.includes("status") ? "applied" : ""}`}
                onClick={() => applySuggestion("status", result.parsed.status)}
                disabled={appliedKeys.includes("status")}
              >
                {appliedKeys.includes("status") ? "✓ Übernommen" : "Übernehmen"}
              </button>
            </div>
          )}
          {result.parsed.followUp && result.parsed.followUp !== lead.followUp && (
            <div className="ai-suggestion">
              <span>Follow-up → <strong>{result.parsed.followUp}</strong></span>
              <button
                className={`ai-apply-btn ${appliedKeys.includes("followUp") ? "applied" : ""}`}
                onClick={() => applySuggestion("followUp", result.parsed.followUp)}
                disabled={appliedKeys.includes("followUp")}
              >
                {appliedKeys.includes("followUp") ? "✓ Übernommen" : "Übernehmen"}
              </button>
            </div>
          )}
          {result.parsed.actions && result.parsed.actions.length > 0 && (
            <div className="ai-actions-list">
              <strong>Empfohlene Aktionen:</strong>
              <ul>{result.parsed.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}
          {!result.parsed && result.raw && (
            <div className="ai-result-text">
              {result.raw.split("\n").filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
            </div>
          )}
        </div>
      )}

      {result?.type === "structured" && !result.parsed && result.raw && (
        <div className="ai-result-text">
          {result.raw.split("\n").filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
        </div>
      )}
    </div>
  );
}

export default AIAssistantPanel;

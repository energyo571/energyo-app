import React from "react";
import logo from "../logo.png";

function LeadLoadingOverlay() {
  return (
    <div className="lead-loading-overlay">
      <div className="lead-loading-content">
        <img src={logo} alt="ENERGYO Logo" className="lead-loading-logo" />
        <div className="lead-loading-bar-container"><div className="lead-loading-bar" /></div>
        <div className="lead-loading-text">Tarifoptimierung gestartet ...</div>
      </div>
    </div>
  );
}

export default LeadLoadingOverlay;

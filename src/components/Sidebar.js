import React, { useRef } from "react";
import logo from "../logo.png";
import { formatEnergyVolume, formatEuro, getClosingRateClass } from "../utils/format";

function Sidebar({ activeTab, setActiveTab, stats, user, userRole, userProfile, avatarUploading, onAvatarUpload, onSignOut }) {
  const avatarInputRef = useRef(null);
  const avatarUrl = userProfile?.avatarDataUrl || "";

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0];
    if (file) onAvatarUpload(file);
    event.target.value = "";
  };

  const navItems = [
    { id: "leads", label: "Lead-Pipeline", icon: "📋" },
    { id: "calendar", label: "Kalender", icon: "🗓️" },
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "team", label: "Team", icon: "👥" },
  ];

  const handleNavClick = (id) => {
    setActiveTab(id);
    if (id === "leads") {
      setTimeout(() => {
        document.querySelector(".main-content")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header"><img src={logo} alt="ENERGYO" className="sidebar-logo" /></div>
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <button key={item.id} className={`sidebar-nav-item ${activeTab === item.id ? "active" : ""}`} onClick={() => handleNavClick(item.id)}>
            <span className="sidebar-item-icon">{item.icon}</span>
            <span className="sidebar-item-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-kpis">
        <div className="sidebar-kpi-item" onClick={() => handleNavClick("leads")}>
          <span className="sidebar-kpi-value kpi-alert">{stats.inactive48}</span>
          <span className="sidebar-kpi-label">To Do</span>
        </div>
        <div className="sidebar-kpi-item" onClick={() => handleNavClick("leads")}>
          <span className="sidebar-kpi-value kpi-blue sidebar-kpi-value--compact">{formatEnergyVolume(stats.movedEnergyKwh)}</span>
          <span className="sidebar-kpi-label">Bewegte Energie</span>
        </div>
        <div className="sidebar-kpi-item" onClick={() => handleNavClick("leads")}>
          <span className="sidebar-kpi-value kpi-success sidebar-kpi-value--compact">{formatEuro(stats.totalUmsatzPotential)}</span>
          <span className="sidebar-kpi-label">Umsatzpotenzial</span>
        </div>
        <div className="sidebar-kpi-item">
          <span className={`sidebar-kpi-value ${getClosingRateClass(stats.closingRate)}`}>{stats.closingRate}%</span>
          <span className="sidebar-kpi-label">Closing Rate</span>
        </div>
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <button
            type="button"
            className="user-avatar-btn"
            onClick={() => avatarInputRef.current?.click()}
            title="Profilbild ändern"
            disabled={avatarUploading}
          >
            <div className="user-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profilbild" className="user-avatar-img" />
              ) : (
                user.email[0].toUpperCase()
              )}
            </div>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleAvatarChange}
          />
          <div className="user-info">
            <span className="user-email-short">{user.email.split("@")[0]}</span>
            <span className="user-domain">{user.email.split("@")[1]}</span>
            <span className={`user-role-chip ${userRole === "admin" ? "admin" : "agent"}`}>{userRole === "admin" ? "Admin" : "Agent"}</span>
            <button type="button" className="avatar-upload-link" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
              {avatarUploading ? "Bild wird gespeichert..." : "Profilbild ändern"}
            </button>
          </div>
        </div>
        <button className="sidebar-signout-btn" onClick={onSignOut}>Abmelden</button>
      </div>
    </aside>
  );
}

export default Sidebar;

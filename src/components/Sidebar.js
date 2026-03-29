import React, { useRef } from "react";

/* ── Wordmark as styled text ── */
const Logo = () => (
  <span className="sidebar-wordmark">energyo<span className="sidebar-wordmark-dot">.</span></span>
);

/* ── Elegant monochrome SVG icons (20×20, strokeWidth 1.5) ── */
const Icon = ({ d, ...props }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>{d}</svg>
);
const IconDashboard = () => <Icon d={<><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2" /></>} />;
const IconLeads = () => <Icon d={<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></>} />;
const IconCalendar = () => <Icon d={<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>} />;
const IconSettings = () => <Icon d={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></>} />;
const IconMail = () => <Icon d={<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>} />;

const IconLogout = () => <Icon d={<><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>} />;

const IconHelp = () => <Icon d={<><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></>} />;

function Sidebar({ activeTab, setActiveTab, user, userRole, userProfile, avatarUploading, onAvatarUpload, onSignOut, onCloseDrawer }) {
  const avatarInputRef = useRef(null);
  const avatarUrl = userProfile?.avatarDataUrl || "";

  // Build display name from Firebase displayName or email prefix
  const rawName = user.displayName || user.email.split("@")[0] || "";
  const nameParts = rawName.replace(/[._]/g, " ").split(/\s+/).filter(Boolean);
  const displayName = nameParts.map(p => p[0].toUpperCase() + p.slice(1)).join(" ");
  const initials = nameParts.length >= 2
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : rawName.slice(0, 2).toUpperCase();

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0];
    if (file) onAvatarUpload(file);
    event.target.value = "";
  };

  const handleNavClick = (id) => {
    setActiveTab(id);
    if (onCloseDrawer) onCloseDrawer();
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", Icon: IconDashboard },
    { id: "leads",     label: "Leads",     Icon: IconLeads },
    { id: "calendar",  label: "Kalender",  Icon: IconCalendar },
    { id: "mailbox",   label: "Nachrichten", Icon: IconMail },
    { id: "team",      label: "Team",      Icon: IconSettings },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Logo />
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ id, label, Icon: NavIcon }) => (
          <button key={id} className={`sidebar-nav-item${activeTab === id ? " active" : ""}`} onClick={() => handleNavClick(id)}>
            <NavIcon /><span className="sidebar-item-label">{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-row">
          <button type="button" className="sidebar-footer-icon" title="Profilbild ändern" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
            <div className="user-avatar user-avatar--sm">
              {avatarUrl ? <img src={avatarUrl} alt="" className="user-avatar-img" /> : initials}
            </div>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarChange} />
          <span className="sidebar-footer-name">{displayName}</span>
          <span className="sidebar-footer-spacer" />
          <a href={`mailto:info@energyo.de?subject=${encodeURIComponent('Fehlermeldung – ENERGYO SalesEngine')}&body=${encodeURIComponent(`Fehler gemeldet von: ${user.email}\n\nBeschreibung:\n\n`)}`} className="sidebar-footer-icon" title="Fehler melden"><IconHelp /></a>
          <button type="button" className="sidebar-footer-icon" title="Abmelden" onClick={onSignOut}><IconLogout /></button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;

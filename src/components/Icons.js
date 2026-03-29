import React from "react";

/* ── Monochrome SVG icon kit ── */
const I = ({ d, size = 16, className = "", ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    className={`icon ${className}`} {...p}>{d}</svg>
);

/* ── Navigation / General ── */
export const IconSearch     = (p) => <I d={<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>} {...p} />;
export const IconFilter     = (p) => <I d={<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />} {...p} />;
export const IconPlus       = (p) => <I d={<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>} {...p} />;
export const IconUpload     = (p) => <I d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>} {...p} />;
export const IconDownload   = (p) => <I d={<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>} {...p} />;
export const IconX          = (p) => <I d={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} {...p} />;
export const IconCheck      = (p) => <I d={<polyline points="20 6 9 17 4 12" />} {...p} />;
export const IconCheckSquare= (p) => <I d={<><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></>} {...p} />;
export const IconList       = (p) => <I d={<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>} {...p} />;
export const IconGrid       = (p) => <I d={<><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>} {...p} />;
export const IconCopy       = (p) => <I d={<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>} {...p} />;

/* ── Activity types ── */
export const IconComment    = (p) => <I d={<><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></>} {...p} />;
export const IconPhone      = (p) => <I d={<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />} {...p} />;
export const IconRefresh    = (p) => <I d={<><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></>} {...p} />;
export const IconEdit       = (p) => <I d={<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></>} {...p} />;
export const IconMail       = (p) => <I d={<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>} {...p} />;

/* ── Energy / Domain ── */
export const IconZap        = (p) => <I d={<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />} {...p} />;
export const IconFlame      = (p) => <I d={<path d="M12 2c.5 3.5 4 6 4 10a6 6 0 01-12 0c0-4 3.5-6.5 4-10 1.5 2 3 3 4 0z" />} {...p} />;
export const IconCalendar   = (p) => <I d={<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>} {...p} />;
export const IconClock      = (p) => <I d={<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>} {...p} />;
export const IconBell       = (p) => <I d={<><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></>} {...p} />;
export const IconMapPin     = (p) => <I d={<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></>} {...p} />;
export const IconLink       = (p) => <I d={<><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></>} {...p} />;
export const IconFile       = (p) => <I d={<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></>} {...p} />;
export const IconClipboard  = (p) => <I d={<><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></>} {...p} />;
export const IconTarget     = (p) => <I d={<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>} {...p} />;
export const IconShield     = (p) => <I d={<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />} {...p} />;
export const IconAlertTriangle = (p) => <I d={<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>} {...p} />;
export const IconInfo       = (p) => <I d={<><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>} {...p} />;
export const IconTrophy     = (p) => <I d={<><path d="M6 9H4.5a2.5 2.5 0 010-5H6" /><path d="M18 9h1.5a2.5 2.5 0 000-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" /><path d="M18 2H6v7a6 6 0 1012 0V2z" /></>} {...p} />;
export const IconStar       = (p) => <I d={<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />} {...p} />;
export const IconDollar     = (p) => <I d={<><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></>} {...p} />;
export const IconEuro       = (p) => <I d={<><path d="M4 10h12M4 14h12M6.5 4.5A6.5 6.5 0 0118 8v0a6.5 6.5 0 01-6.5 6.5H10A6.5 6.5 0 013.5 8v0" /><path d="M18 10a6.5 6.5 0 01-5.5 6.4" /><circle cx="12" cy="12" r="10" /></>} {...p} />;
export const IconArrowRight = (p) => <I d={<><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>} {...p} />;
export const IconPaperclip  = (p) => <I d={<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />} {...p} />;
export const IconUserPlus   = (p) => <I d={<><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></>} {...p} />;
export const IconUsers      = (p) => <I d={<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></>} {...p} />;
export const IconCrown      = (p) => <I d={<><path d="M2 4l3 12h14l3-12-5 4-5-4-5 4z" /><line x1="5" y1="20" x2="19" y2="20" /></>} {...p} />;
export const IconLoader     = (p) => <I d={<><line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /><line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" /></>} {...p} />;
export const IconLightbulb  = (p) => <I d={<><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z" /></>} {...p} />;
export const IconPin        = (p) => <I d={<><path d="M12 17v5" /><path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1V3H8v3h1z" /></>} {...p} />;

/* ── Rank badges (filled, no stroke) ── */
export const RankBadge = ({ rank }) => {
  const colors = ["#c9a227", "#8a94a0", "#9a6832"];
  const color = rank <= 3 ? colors[rank - 1] : "#64748b";
  return (
    <span className="rank-badge" style={{ color }}>
      {rank <= 3 ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill={color} stroke="none">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ) : `#${rank}`}
    </span>
  );
};

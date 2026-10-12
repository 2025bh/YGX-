/* ============ 00 图标库：统一线性 SVG 图标（替代 emoji） ============ */
'use strict';

const ICON_PATHS = {
  // 导航
  chart: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6" rx="1"/><rect x="12" y="7" width="3" height="10" rx="1"/><rect x="17" y="14" width="3" height="3" rx="1"/>',
  folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h3.6a2 2 0 0 1 1.6.8l.9 1.2H19a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7.5 18.5 3.5 20l1.5-4z"/>',
  factory: '<path d="M3 20h18"/><path d="M4 20V9l5 3V9l5 3V6l6 3v11"/><path d="M8 20v-3M13 20v-3M18 20v-3"/>',
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 3.5V16h-8z"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  wrench: '<path d="M15.5 3a5 5 0 0 0-4.3 7.5L3 18.7 5.3 21l8.2-8.2A5 5 0 1 0 15.5 3z"/><circle cx="16.5" cy="7.5" r="1.2"/>',
  support: '<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19v1a2 2 0 0 1-2 2h-3"/>',
  trend: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/>',
  checkSquare: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l3 3 5.5-6.5"/>',
  // 指标
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.5 2"/>',
  alert: '<path d="M10.3 3.9 2.6 17.8A2 2 0 0 0 4.3 20.8h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/>',
  package: '<path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5z"/><path d="M3 8.5 12 14l9-5.5"/><path d="M12 14v7"/>',
  check: '<path d="M20 6.5 9.5 17 4 11.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  star: '<path d="m12 3.5 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.8l-5.6 3 1.1-6.2L3 10.1l6.2-.9z"/>',
  yuan: '<circle cx="12" cy="12" r="9"/><path d="M8.5 7.5 12 12l3.5-4.5"/><path d="M12 12v5.5"/><path d="M8.8 13.5h6.4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  pie: '<path d="M21.2 15.9A10 10 0 1 1 8.1 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  funnel: '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6"/><path d="M18 20a6.5 6.5 0 0 0-2-4.7"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  // 操作/其他
  bell: '<path d="M6 9.5a6 6 0 0 1 12 0c0 4.5 2 5.5 2 5.5H4s2-1 2-5.5"/><path d="M10.5 20a2 2 0 0 0 3 0"/>',
  inbox: '<path d="M3.5 12.5h4l1.5 2.5h6l1.5-2.5h4"/><path d="M5.5 5h13l2.5 7.5V19h-19v-6.5z"/>',
  plus: '<path d="M12 5.5v13"/><path d="M5.5 12h13"/>',
  paperclip: '<path d="M20 11.5 12.5 19a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7"/>',
  bolt: '<path d="M13 2.5 4.5 14H11l-1 7.5L18.5 10H12z"/>',
  rocket: '<path d="M5 15c-1 2-1 4-1 4s2 0 4-1"/><path d="M14.5 3.5c3 0 6 3 6 6 0 4-4 7-7 9L9 14c2-3 5-7 5.5-10.5z"/><circle cx="15" cy="9" r="1.3"/>',
  x: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
  key: '<circle cx="8" cy="15.5" r="4"/><path d="M11 12.5 20 3.5"/><path d="M16.5 4.5l3 3"/>',
  book: '<path d="M5 5a2 2 0 0 1 2-2h12v18H7a2 2 0 0 1-2-2z"/><path d="M9 3v18"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M4.4 4.4l2.1 2.1M17.5 17.5l2.1 2.1M2.5 12h3M18.5 12h3M4.4 19.6l2.1-2.1M17.5 6.5l2.1-2.1"/>',
  phone: '<path d="M5 3.5h3.5l1.8 4.5-2.2 1.6a12 12 0 0 0 5.3 5.3l1.6-2.2 4.5 1.8V18a2.5 2.5 0 0 1-2.5 2.5A16.5 16.5 0 0 1 2.5 6 2.5 2.5 0 0 1 5 3.5z"/>',
  pin: '<path d="M12 21.5s7-6.2 7-11.5a7 7 0 1 0-14 0c0 5.3 7 11.5 7 11.5z"/><circle cx="12" cy="10" r="2.6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clipboard: '<rect x="6" y="4.5" width="12" height="17" rx="2.5"/><path d="M9.5 4.5V3h5v1.5"/><path d="M9.5 10.5h5M9.5 14.5h3.5"/>',
  file: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  swap: '<path d="M4.5 8.5h12l-3-3"/><path d="M19.5 15.5h-12l3 3"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4" cy="6.5" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="17.5" r="1.2"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="16" rx="1.5"/><rect x="16" y="4" width="5" height="16" rx="1.5"/>',
  box: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
  userCheck: '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0"/><path d="m17 12.5 2 2 3.5-4"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3 7.8-7.5 9.5-4.5-1.7-7.5-5-7.5-9.5V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  activity: '<path d="M3 12.5h4l2.5-6 4 12 2.5-6h5"/>',
  arrowLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  // 员工管理 / 大模型
  trash: '<path d="M4 6.5h16"/><path d="M9 6.5V4.5h6v2"/><path d="M6 6.5 7 20h10l1-13.5"/><path d="M10.5 10v6M13.5 10v6"/>',
  power: '<path d="M12 3.5v8"/><path d="M7.2 6.4a7 7 0 1 0 9.6 0"/>',
  mic: '<rect x="9.5" y="3" width="5" height="10.5" rx="2.5"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/><path d="M8.5 21h7"/>',
  bot: '<rect x="4" y="7.5" width="16" height="12" rx="3"/><path d="M12 3v4.5"/><circle cx="9" cy="13" r="1.1"/><circle cx="15" cy="13" r="1.1"/><path d="M9.5 17h5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="17" r="2"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14.5 5.5 18.5 9.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-13.7-5.6L4 7.5"/><path d="M4 4v3.5h3.5"/><path d="M4 13a8 8 0 0 0 13.7 5.6L20 16.5"/><path d="M20 20v-3.5h-3.5"/>',
  badge: '<rect x="4.5" y="4" width="15" height="16" rx="3"/><path d="M9 4V2.5h6V4"/><path d="M8.5 11.5h7M8.5 15.5h4"/>',
};

/* 生成图标：size 像素；颜色继承 currentColor */
function ico(name, size) {
  const s = size || 16;
  const p = ICON_PATHS[name];
  if (!p) return '';
  return '<svg class="ic-svg" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}
/* 带底色的圆角图标（统计卡片用） */
function icoBadge(name, bg, fg, size) {
  return '<span class="ic-badge" style="background:' + bg + ';color:' + fg + '">' + ico(name, size || 20) + '</span>';
}
/* 状态圆点（替代 🔴🟢🔵 等） */
function dot(color, size) {
  const s = size || 10;
  return '<span style="display:inline-block;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:' + color + ';vertical-align:middle;margin-right:0;flex:none"></span>';
}

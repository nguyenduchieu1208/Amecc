const API_BASE = String(window.AMECC_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
const API_KEY = String(window.AMECC_CONFIG?.apiKey || '');
const ADMIN_MODE = /(?:^|\/)admin\.html$/.test(window.location.pathname);
import { MAX_MATERIAL_FILE_BYTES, MAX_MATERIAL_FILE_MB, projectCodeFromFilename, readMaterialWorkbook } from './material-import.js';
import { getBtpShortageQuantity, getBtpShortageWeight, highlightMatch } from './material-search.js';
import { formatMaterialDate } from './material-display.js';
import { exportBtpShortageWorkbook, filterBtpRowsByReceiptDate } from './shortage-export.js';
import { renderMaterialDashboard } from './material-dashboard.js';
import { buildMaterialAuditRows, hasBtpIdentity, isPurchasingMaterialSheet, materialAuditRowSearchText, materialSheetKey, materialSheetName } from './material-linkage.js';
import { readProjectWorkbook } from './project-import.js';
import { dateFilterMarkup, parseDateFilter, renderProjectDashboard } from './project-dashboard.js';
const app = document.querySelector('#app');
const themes = ['light','midnight','paper','ocean','emerald','violet','graphite','sunset'];
const themeLabels = { light:'Sáng tối giản', midnight:'Midnight', paper:'Giấy ấm', ocean:'Đại dương', emerald:'Ngọc lục bảo', violet:'Tím hiện đại', graphite:'Than chì', sunset:'Hoàng hôn' };
const savedTheme = localStorage.getItem('amecc-theme') || 'light';
const state = { user: null, projects: [], plFiles: [], currentProject: '', loadedProject: '', materialLotFilter: '', projectSearch: '', projectMobileFiltersOpen: false, projectStatusFilter: '', projectShipmentFilter: '', projectItemFilter: '', projectTeamFilter: '', projectPageIndex: 0, projectDashboardData: null, projectDashboardDataKey: '', projectDashboardSelectedProjects: null, projectDashboardFiltersOpen: false, projectDashboardStartDate: '', projectDashboardEndDate: '', projectDashboardMetric: 'kg', auditDataCache: null, materialSelectedSheets: null, materialReceiptDateFilter: '', materialUnitFilter: '', materialStatusFilter: '', materialSearch: '', materialPageIndex: 0, materialMobileFiltersOpen: false, materialPrintSelectedGroups: new Map(), materialPrintAvailableGroups: new Map(), materialExpandedGroups: new Set(), materialDashboardSheetFilter: '', materialDashboardStartDate: '', materialDashboardEndDate: '', materialDashboardMetric: 'quantity', page: 'overview', theme: themes.includes(savedTheme) ? savedTheme : 'light', sidebarCollapsed: localStorage.getItem('amecc-sidebar-collapsed') === 'true', data: null, btpData: null, progressData: null, loading: false };
const labels = {
  project_code: 'Dự án', shipment: 'Shipment', item: 'Hạng mục', mh: 'MH', wo_date: 'Ngày WO', product_type: 'Dạng SP', classification: 'Phân loại', allocation: 'Phân giao', drawing: 'Bản vẽ', part_no: 'Số chi tiết', size: 'Size', quantity: 'T’Qty', unit_weight: 'U.Weight', btp_unit_weight: 'U.Weight (kg/chi tiết)', total_weight: 'T.Weight', profile: 'Profile', item_id: 'ID', note: 'Ghi chú', fitup_date: 'Ngày gá', fitup_qty: 'SL gá', fitup_weight: 'KL gá', welding_date: 'Ngày hàn', welding_qty: 'SL hàn', welding_weight: 'KL hàn', trial_assembly_date: 'Ngày tổ hợp', trial_assembly_qty: 'SL tổ hợp', trial_assembly_weight: 'KL tổ hợp', acceptance_date: 'Ngày nghiệm thu', acceptance_qty: 'SL nghiệm thu', acceptance_weight: 'KL nghiệm thu', handover_date: 'Ngày bàn giao', handover_qty: 'SL bàn giao', handover_weight: 'KL bàn giao', receiver: 'Đơn vị nhận', record_no: 'Số biên bản', assembly: 'Cụm lắp ráp', description: 'Mô tả', scope: 'Phạm vi công việc', weight: 'Khối lượng', received: 'Đã nhận', remaining: 'Còn thiếu', as_symbol: 'AS Symbol', delivery_date: 'Ngày nhận', issue_dates: 'Ngày trên biên bản', parent: 'Cấu kiện chính', material_type: 'Chủng loại', material: 'Vật liệu', unit: 'Đơn vị giao (DVG)', shortage_rows: 'Dòng còn thiếu', part_count: 'Số mã BTP', shortage_quantity: 'SL còn thiếu', shortage_weight: 'Khối lượng thiếu (kg)', weight_missing_rows: 'Dòng thiếu U.Weight', daily_progress: 'Lịch nhận · ngày: số lượng', status: 'Trạng thái', source_file: 'File nguồn', source_sheet: 'Sheet', source_row: 'Dòng nguồn', is_main: 'Cấu kiện chính', material_rows: 'Dòng vật tư', progress_rows: 'Dòng tiến độ', updated_at: 'Cập nhật',
};
document.addEventListener('pointerdown', (event) => {
  document.querySelectorAll('details.sheet-multi-select[open], details.project-multi-select[open]').forEach((dropdown) => {
    if (!dropdown.contains(event.target)) dropdown.open = false;
  });
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const dropdown = [...document.querySelectorAll('details.sheet-multi-select[open], details.project-multi-select[open]')].at(-1);
  if (!dropdown) return;
  dropdown.open = false;
  dropdown.querySelector('summary')?.focus();
});
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]); }
function fmt(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
  return esc(value);
}
function normalizeProjectSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi');
}
function projectLotCode(row) {
  // Lot is project metadata in QLDA (normally MH or Hạng mục). Do not
  // classify part numbers, drawings, or notes as Lots just because they
  // contain the text "LOT".
  for (const field of ['mh','item','classification','allocation']) {
    const match = String(row?.[field] ?? '').match(/\bLOT[\s_-]*(\d+)\b/i);
    if (match) return `LOT${match[1].toUpperCase()}`;
  }
  return '';
}
function projectLotLabel(code) { return `Lot ${String(code).replace(/^LOT/i, '')}`; }
function materialAuditLotCodes(row) {
  const linkedLots = [...new Set((row?.progress || []).map(projectLotCode).filter(Boolean))];
  if (linkedLots.length) return linkedLots;
  const sourceSheets = [row?.bom_source_sheet, row?.btp_source_sheet, row?.source_sheet, row?.bomLine?.source_sheet, row?.bomParent?.source_sheet, row?.btp?.source_sheet];
  for (const sheet of sourceSheets) {
    const explicitLot = projectLotCode({ mh:sheet });
    if (explicitLot) return [explicitLot];
  }
  return [];
}
function applyTheme(theme) {
  if (!themes.includes(theme)) return;
  state.theme = theme;
  localStorage.setItem('amecc-theme', theme);
  const shellElement = document.querySelector('.shell');
  if (!shellElement) return;
  shellElement.classList.remove(...themes.map((name) => `theme-${name}`));
  shellElement.classList.add(`theme-${theme}`);
}
function icon(name) {
  const paths = {
    overview:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    materials:'<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/>',
    projects:'<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 9h.01M15 9h.01M9 12h.01M15 12h.01"/>',
    admin:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    collapse:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m5-11 3 3-3 3"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-1.4-2.4L7.1 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2Z"/>',
    chevron:'<path d="m9 18 6-6-6-6"/>', menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', refresh:'<path d="M20 7v5h-5"/><path d="M20 12a8 8 0 1 1-2.3-5.7L20 9"/>', upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>', download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.overview}</svg>`;
}
async function api(path, options = {}) {
  if (!API_BASE || API_BASE.includes('REPLACE_WITH')) throw new Error('Chưa cấu hình địa chỉ API trong public/config.js.');
  const headers = new Headers(options.headers || {});
  if (API_KEY) headers.set('apikey', API_KEY);
  const token = sessionStorage.getItem('amecc-session-token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'omit', ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : {};
  if (!response.ok) {
    const error = new Error(data.error || 'Không thể hoàn thành yêu cầu.');
    error.status = response.status;
    throw error;
  }
  return data;
}
let spreadsheetLibraryPromise;
function loadSpreadsheetLibrary() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!spreadsheetLibraryPromise) {
    spreadsheetLibraryPromise = new Promise((resolve, reject) => {
      const fail = () => {
        spreadsheetLibraryPromise = null;
        reject(new Error('Không tải được thư viện đọc Excel; hãy tải lại trang rồi thử lại.'));
      };
      const script = document.createElement('script');
      script.src = new URL('./vendor/xlsx.full.min.js', import.meta.url).href;
      script.async = true;
      script.onload = () => window.XLSX ? resolve(window.XLSX) : fail();
      script.onerror = fail;
      document.head.append(script);
    });
  }
  return spreadsheetLibraryPromise;
}
let excelJsLibraryPromise;
function loadExcelJsLibrary() {
  if (window.ExcelJS?.Workbook) return Promise.resolve(window.ExcelJS);
  if (!excelJsLibraryPromise) {
    excelJsLibraryPromise = new Promise((resolve, reject) => {
      const fail = () => {
        excelJsLibraryPromise = null;
        reject(new Error('Không tải được bộ xử lý Excel có giữ định dạng; hãy tải lại trang rồi thử lại.'));
      };
      const script = document.createElement('script');
      script.src = new URL('./vendor/exceljs.min.js', import.meta.url).href;
      script.async = true;
      script.onload = () => window.ExcelJS?.Workbook ? resolve(window.ExcelJS) : fail();
      script.onerror = fail;
      document.head.append(script);
    });
  }
  return excelJsLibraryPromise;
}
const projectDataRequests = new Map();
const projectDashboardRequests = new Map();
let renderGeneration = 0;
function currentPageTitle() { return ({ overview:'Danh mục dự án', materials:'BOM & Vật tư PL', 'materials-dashboard':'Dashboard BOM & vật tư', 'projects-dashboard':'Dashboard quản lý dự án', projects:'Quản lý dự án' })[state.page] || 'AMECC'; }
function shell() {
  const navigation = `<div class="nav-label">KHÔNG GIAN LÀM VIỆC</div>
      <nav class="nav-list" aria-label="Điều hướng chính">
        <a class="nav-link ${state.page === 'overview' ? 'active' : ''}" href="#overview">${icon('overview')}<span>Tổng quan</span></a>
        <div class="nav-group ${['materials','materials-dashboard'].includes(state.page) ? 'expanded' : ''}">
          <button class="nav-parent" type="button" data-group="materials" aria-expanded="${['materials','materials-dashboard'].includes(state.page)}">${icon('materials')}<span>Quản lý vật tư</span><span class="nav-chevron">${icon('chevron')}</span></button>
          <div class="nav-children"><a class="nav-child ${state.page === 'materials-dashboard' ? 'active' : ''}" href="#materials-dashboard">Dashboard BOM &amp; vật tư</a><a class="nav-child ${state.page === 'materials' ? 'active' : ''}" href="#materials">BOM &amp; Vật tư PL</a></div>
        </div>
        <div class="nav-group ${['projects','projects-dashboard'].includes(state.page) ? 'expanded' : ''}">
          <button class="nav-parent" type="button" data-group="projects" aria-expanded="${['projects','projects-dashboard'].includes(state.page)}">${icon('projects')}<span>Quản lý dự án</span><span class="nav-chevron">${icon('chevron')}</span></button>
          <div class="nav-children"><a class="nav-child ${state.page === 'projects-dashboard' ? 'active' : ''}" href="#projects-dashboard">Dashboard báo cáo</a><a class="nav-child ${state.page === 'projects' ? 'active' : ''}" href="#projects">Tiến độ dự án</a></div>
        </div>
      </nav>`;
  app.innerHTML = `<div class="shell theme-${esc(state.theme)} ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="#overview" aria-label="AMECC - Trang tổng quan"><img src="./assets/logo.png" alt="AMECC"><span class="brand-caption">PROJECT CONTROL</span></a>
      ${navigation}
      <div class="sidebar-bottom">
        <section class="sidebar-settings" aria-label="Cài đặt giao diện"><button class="settings-toggle" id="settingsToggle" type="button" aria-label="Mở cài đặt giao diện" title="Cài đặt giao diện">${icon('settings')}<span>Cài đặt giao diện</span></button><div class="settings-heading">CÀI ĐẶT GIAO DIỆN</div><label class="settings-theme-label">Giao diện<select class="theme-select" id="themeSelect" aria-label="Chọn giao diện">${themes.map((theme) => `<option value="${theme}" ${theme === state.theme ? 'selected' : ''}>${themeLabels[theme]}</option>`).join('')}</select></label></section>
        <button class="sidebar-collapse" id="sidebarCollapse" type="button" aria-label="${state.sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}" title="${state.sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}">${icon('collapse')}<span>Thu gọn thanh bên</span></button>
        <div class="sidebar-foot"><span class="online-dot"></span><span>Hệ thống dữ liệu AMECC</span></div>
      </div>
    </aside>
    <div class="mobile-scrim" id="scrim"></div>
    <main class="main-area">
      <header class="topbar"><button class="icon-button mobile-menu" id="mobileMenu" aria-label="Mở menu">${icon('menu')}</button><div><div class="top-eyebrow">AMECC <span>/</span> WORKSPACE</div><h1 id="pageTitle">${currentPageTitle()}</h1></div>
      </header><section id="page" class="page" aria-live="polite"></section>
    </main>
  </div>`;
  document.querySelector('#themeSelect').addEventListener('change', (event) => applyTheme(event.currentTarget.value));
  document.querySelector('#sidebarCollapse').addEventListener('click', () => {
    if (window.matchMedia('(max-width: 820px)').matches) {
      document.querySelector('.shell').classList.remove('drawer-open');
      return;
    }
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem('amecc-sidebar-collapsed', String(state.sidebarCollapsed));
    if (state.sidebarCollapsed) document.querySelector('.sidebar-settings')?.classList.remove('theme-settings-open');
    document.querySelector('.shell').classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    const button = document.querySelector('#sidebarCollapse');
    button.setAttribute('aria-label', state.sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên');
    button.title = state.sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên';
  });
  document.querySelector('#settingsToggle').addEventListener('click', () => {
    document.querySelector('.sidebar-settings').classList.toggle('theme-settings-open');
    if (state.sidebarCollapsed) {
      state.sidebarCollapsed = false;
      localStorage.setItem('amecc-sidebar-collapsed', 'false');
      document.querySelector('.shell').classList.remove('sidebar-collapsed');
      const collapseButton = document.querySelector('#sidebarCollapse');
      collapseButton.setAttribute('aria-label', 'Thu gọn thanh bên');
      collapseButton.title = 'Thu gọn thanh bên';
    }
    document.querySelector('#themeSelect').focus();
  });
  document.querySelector('#logout')?.addEventListener('click', logout);
  document.querySelector('#mobileMenu').addEventListener('click', () => document.querySelector('.shell').classList.add('drawer-open'));
  document.querySelector('#scrim').addEventListener('click', () => document.querySelector('.shell').classList.remove('drawer-open'));
  document.querySelectorAll('.nav-parent').forEach((button) => button.addEventListener('click', () => {
    const group = button.closest('.nav-group'); const expanded = group.classList.toggle('expanded'); button.setAttribute('aria-expanded', String(expanded));
  }));
  document.querySelectorAll('.nav-link,.nav-child').forEach((link) => link.addEventListener('click', () => document.querySelector('.shell').classList.remove('drawer-open')));
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.querySelector('.shell')?.classList.remove('drawer-open');
});
function loginScreen(message = '') {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card"><div class="auth-logo"><img src="./assets/logo.png" alt="AMECC"></div><span class="eyebrow">PROJECT OPERATIONS PLATFORM</span><h1>Đăng nhập quản trị</h1><p>Đăng nhập để cập nhật workbook, quản lý tài khoản và file dự án.</p>${message ? `<div class="notice error">${esc(message)}</div>` : ''}<form id="loginForm"><label>Tên đăng nhập<input name="username" autocomplete="username" required minlength="3"></label><label>Mật khẩu<input name="password" type="password" autocomplete="current-password" required></label><button class="button primary full-width" type="submit">Đăng nhập <span>→</span></button></form><a class="admin-public-link" href="./index.html">← Quay lại trang xem dữ liệu công khai</a><div class="auth-foot"><span class="online-dot"></span> Kết nối bảo mật · Chỉ tài khoản admin được cập nhật</div></section><span class="auth-copyright">© AMECC · INTERNAL PROJECT WORKSPACE</span></main>`;
  document.querySelector('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const button = event.currentTarget.querySelector('button'); button.disabled = true; button.textContent = 'Đang xác thực…';
    try {
      const result = await api('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ username:form.get('username'), password:form.get('password') }) });
      if (result.user?.role !== 'admin') throw new Error('Trang cập nhật chỉ dành cho tài khoản admin.');
      sessionStorage.setItem('amecc-session-token', result.token); state.user = result.user;
      location.hash = 'admin';
      await initializeWorkspace();
    }
    catch (error) { loginScreen(error.message); }
  });
}
function heading(eyebrow, title, description, action = '') { return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2><p>${description}</p></div>${action}</div>`; }
function statCard(label, value, caption, tone = '') { return `<article class="stat-card ${tone}"><div class="stat-top"><span>${label}</span><span class="stat-symbol">●</span></div><strong>${fmt(value)}</strong><small>${caption}</small></article>`; }
function tableMarkup(rows, columns, options = {}) {
  if (!rows.length) return '<div class="empty-state"><span class="empty-icon">⌕</span><strong>Chưa có dữ liệu phù hợp</strong><p>Thử đổi bộ lọc hoặc chọn dự án khác.</p></div>';
  const visibleRows = rows.slice(0, options.limit || 500);
  return `<div class="table-frame"><table class="data-table"><thead><tr>${columns.map((key) => `<th>${esc(labels[key] || key)}</th>`).join('')}</tr></thead><tbody>${visibleRows.map((row) => `<tr>${columns.map((key) => `<td>${key === 'status' ? `<span class="status-pill ${String(row.status || '').toLocaleLowerCase() === 'đủ' ? 'success' : ['chưa đủ','chưa có','còn thiếu'].includes(String(row.status || '').toLocaleLowerCase()) ? 'warning' : 'neutral'}">${fmt(row[key])}</span>` : key === 'delivery_date' ? fmt(formatMaterialDate(row[key])) : options.search && ['assembly','drawing','description','part_no','source_sheet'].includes(key) ? highlightMatch(row[key], options.search) : fmt(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length > visibleRows.length ? `<p class="table-note">Đang hiển thị ${visibleRows.length} / ${rows.length} dòng. Hãy dùng bộ lọc để thu hẹp kết quả.</p>` : ''}`;
}
function projectFilenameLabel(project) {
  const filename = String(project?.source_file || `${project?.code || ''}.xlsx`).trim();
  return filename.replace(/(?:PL)?\.xlsx$/i, '') || project?.code || '';
}
function projectsForData(scope = 'all') {
  const hasMaterials = (project) => Number(project.material_rows || 0) + Number(project.btp_rows || 0) > 0;
  const hasProgress = (project) => Number(project.progress_rows || 0) > 0;
  return [...state.projects]
    .filter((project) => scope === 'materials' ? hasMaterials(project) : scope === 'progress' ? hasProgress(project) : true)
    .sort((left, right) => String(left.code).localeCompare(String(right.code), 'vi', { numeric:true, sensitivity:'base' }));
}
function projectSelect(scope = 'all') { const projects = projectsForData(scope); return `<label class="filter-label">Dự án<select id="projectFilter"><option value="">Chọn dự án</option>${projects.map((project) => `<option value="${esc(project.code)}" ${state.currentProject === project.code ? 'selected' : ''}>${esc(projectFilenameLabel(project))}</option>`).join('')}</select></label>`; }
function btpReceivedQuantity(row) {
  if (typeof row.received === 'number') return Math.max(0, row.received);
  const remaining = getBtpShortageQuantity(row);
  return remaining !== null && typeof row.design_quantity === 'number' ? Math.max(0, row.design_quantity - remaining) : null;
}
function overviewPage() {
  const projects = [...state.projects].sort((left, right) => String(left.code).localeCompare(String(right.code), 'vi', { numeric:true, sensitivity:'base' }));
  const cards = projects.map((project) => {
    const projectName = projectFilenameLabel(project);
    const searchText = `${projectName} ${project.code} ${project.source_file || ''}`;
    const actions = [
      Number(project.material_rows || 0) + Number(project.btp_rows || 0) > 0 ? `<a href="#materials" data-project="${esc(project.code)}">Vật tư <span>→</span></a>` : '',
      Number(project.progress_rows || 0) > 0 ? `<a href="#projects" data-project="${esc(project.code)}">Tiến độ <span>→</span></a>` : '',
    ].filter(Boolean).join('');
    return `<article class="project-card" data-project-card data-project-search="${esc(searchText)}"><div class="project-card-head"><span class="project-icon">${icon('projects')}</span><span class="project-updated">${project.updated_at ? `Cập nhật ${fmt(project.updated_at).slice(0,10)}` : 'Đã đồng bộ'}</span></div><span class="eyebrow">DỰ ÁN</span><h4>${esc(projectName)}</h4><p>Mã dự án: ${esc(project.code)} · ${esc(project.source_file || `${project.code}.xlsx`)}</p><div class="project-meta"><span>${fmt(Number(project.material_rows || 0) + Number(project.btp_rows || 0))} dòng PL/BTP</span><span>${fmt(project.progress_rows)} dòng tiến độ</span></div><div class="project-actions">${actions}</div></article>`;
  }).join('');
  return `${heading('AMECC · PROJECT PORTFOLIO','Danh mục dự án','Chọn một dự án để tra cứu vật tư hoặc theo dõi tiến độ.')}
    <div class="project-catalog-toolbar"><label class="search-box project-catalog-search">${icon('search')}<input id="overviewProjectSearch" type="search" inputmode="search" autocomplete="off" placeholder="Tìm theo tên hoặc mã dự án…" aria-label="Tìm dự án"></label><span class="count-chip" id="overviewProjectCount">${projects.length} dự án</span></div>
    ${projects.length ? `<div class="project-grid" id="overviewProjectGrid">${cards}</div><div class="empty-state project-catalog-empty" id="overviewProjectEmpty" hidden><strong>Không tìm thấy dự án</strong><p>Thử tìm bằng tên file hoặc mã dự án khác.</p></div>` : '<div class="empty-state"><strong>Chưa có dự án</strong><p>Chưa có dữ liệu dự án để hiển thị.</p></div>'}`;
}
function usableBtpRows() {
  const cache = materialAuditCache();
  if (!cache.usableBtpRows) cache.usableBtpRows = (state.btpData?.rows || []).filter((row) => !isPurchasingMaterialSheet(row.source_sheet)
    && hasBtpIdentity(row));
  return cache.usableBtpRows;
}
function auditSheetOptions() {
  const cache = materialAuditCache();
  if (cache.sheetOptions) return cache.sheetOptions;
  const rows = usableBtpRows();
  cache.sheetOptions = [...new Map(rows.filter((row) => row.source_file && row.source_sheet)
    .map((row) => {
      const source_sheet = materialSheetName(row.source_sheet);
      const key = materialSheetKey(row.source_file, source_sheet);
      return [key, { key, source_file:row.source_file, source_sheet }];
    })).values()]
    .sort((left, right) => left.source_sheet.localeCompare(right.source_sheet, 'vi', { numeric:true, sensitivity:'base' })
      || left.source_file.localeCompare(right.source_file, 'vi', { numeric:true, sensitivity:'base' }));
  return cache.sheetOptions;
}
function auditStatus(row) {
  if (row.kind === 'bom-only') return 'Chưa có BTP';
  const remaining = getBtpShortageQuantity(row.btp);
  if (remaining === 0) return 'Đã đủ';
  if (typeof row.btp?.received === 'number' && row.btp.received > 0) return 'Đang nhận';
  if (remaining > 0) return 'Còn thiếu';
  return 'Chưa rõ';
}
function auditStatusClass(status) {
  const value = String(status || '').trim().toLocaleLowerCase();
  if (value === 'đã đủ' || value === 'đủ') return 'success';
  if (value.includes('chưa') || value.includes('thiếu')) return 'danger';
  return 'warning';
}
function auditReceiptEvents(row) {
  const entries = String(row?.btp?.daily_progress || '').split(/\s*;\s*/).filter(Boolean);
  return entries.length ? `<span class="audit-receipt-list">${entries.map((event) => `<span>${fmt(event.replace(/:\s*/, ': '))}</span>`).join('')}</span>` : '<span class="muted">Chưa có ngày nhận</span>';
}
function auditDetailMatchesSearch(row, query) {
  if (!query) return false;
  const values = row.btp
    ? [row.btp.part_no,row.btp.material_type,row.btp.description,row.btp.material,row.btp.unit,row.btp.size,row.btp.length_mm,row.btp.unit_weight,row.btp.total_weight,row.btp.design_quantity,row.btp.received,row.btp.remaining,row.btp.daily_progress,row.btp.joint_check,row.btp.status,row.btp.note,row.bomLine?.part_no,row.bomLine?.description,row.bomLine?.size,row.bomLine?.note,row.bomParent?.note]
    : [row.bomLine?.part_no,row.bomLine?.description,row.bomLine?.size,row.bomLine?.note,row.bomParent?.note];
  return values.filter((value) => value !== null && value !== undefined).join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase());
}
function auditBtpTableRowMarkup(row, query = '') {
  const btp = row.btp;
  const matched = auditDetailMatchesSearch(row, query);
  if (!btp) {
    const bomPart = row.bomLine?.part_no || '—';
    const code = query ? highlightMatch(bomPart, query) : fmt(bomPart);
    return `<tr class="btp-missing-row ${matched ? 'search-match-row' : ''}"><td class="btp-frozen-code audit-code">${code}</td><td>—</td><td>—</td><td>—</td><td class="numeric-cell">—</td><td class="numeric-cell">—</td><td class="numeric-cell">—</td><td class="numeric-cell">—</td><td><span class="muted">Chưa có ngày</span></td><td>—</td><td><span class="status-pill danger">Chưa có BTP</span></td><td class="audit-description">${fmt(row.bomNote || 'BOM chưa có dòng BTP')}</td></tr>`;
  }
  const remaining = getBtpShortageQuantity(btp);
  const status = btp.status || auditStatus(row);
  const materialType = String(btp.material_type || '').toLocaleLowerCase();
  const typeClass = materialType.includes('shape') ? 'shape' : materialType.includes('plate') ? 'plate' : '';
  const partLabel = btp.part_no || btp.description || '—';
  const partNo = query ? highlightMatch(partLabel, query) : fmt(partLabel);
  const note = [...new Set([row.bomNote, row.bomLine?.note, row.bomParent?.note, btp.note].map((value) => String(value || '').trim()).filter(Boolean))].join(' | ');
  return `<tr class="${[remaining === 0 ? 'btp-complete-row' : '',matched ? 'search-match-row' : ''].filter(Boolean).join(' ')}"><td class="btp-frozen-code audit-code">${partNo}</td><td><span class="btp-type-chip ${typeClass}">${fmt(btp.material_type)}</span></td><td><span class="btp-unit-chip">${fmt(btp.unit)}</span></td><td>${fmt(btp.size)}</td><td class="numeric-cell">${fmt(btp.length_mm)}</td><td class="numeric-cell">${fmt(btp.design_quantity)}</td><td class="numeric-cell received-value">${fmt(btp.received)}</td><td class="numeric-cell ${remaining > 0 ? 'shortage-value' : ''}">${fmt(remaining)}</td><td class="audit-receipt-cell">${auditReceiptEvents(row)}</td><td>${fmt(btp.joint_check)}</td><td><span class="status-pill ${auditStatusClass(status)}">${esc(status)}</span></td><td class="audit-description">${fmt(note)}</td></tr>`;
}
function auditSearchPreviewMarkup(row, query) {
  const btp = row.btp;
  const partNo = btp?.part_no || btp?.description || row.bomLine?.part_no || row.bomLine?.description || '—';
  const remaining = getBtpShortageQuantity(btp);
  const materialType = String(btp?.material_type || '').toLocaleLowerCase();
  const typeClass = materialType.includes('shape') ? 'shape' : materialType.includes('plate') ? 'plate' : '';
  const status = btp ? btp.status || auditStatus(row) : 'Chưa có BTP';
  const cells = [
    ['Mã BTP (Chi tiết)', query ? highlightMatch(partNo, query) : fmt(partNo), 'audit-code'],
    ['Chủng loại', btp ? `<span class="btp-type-chip ${typeClass}">${fmt(btp.material_type)}</span>` : '—', ''],
    ['DVG', btp ? `<span class="btp-unit-chip">${fmt(btp.unit)}</span>` : '—', ''],
    ['Quy cách (Size)', fmt(btp?.size)],
    ['Chiều dài (mm)', fmt(btp?.length_mm)],
    ['SL thiết kế', fmt(btp?.design_quantity)],
    ['Đã nhận', fmt(btp?.received)],
    ['Còn thiếu', fmt(remaining)],
    ['Tiến độ theo ngày', btp ? auditReceiptEvents(row) : '<span class="muted">Chưa có ngày</span>'],
    ['Ktra nối', fmt(btp?.joint_check)],
    ['Trạng thái', `<span class="status-pill ${btp ? auditStatusClass(status) : 'danger'}">${esc(status)}</span>`],
    ['Ghi chú', fmt([row.bomNote, row.bomLine?.note, row.bomParent?.note, btp?.note].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' | ') || (btp ? '' : 'BOM chưa có dòng BTP'))],
  ];
  return `<span class="bom-search-match-line">${cells.map(([label, value, extra = '']) => `<span class="audit-search-cell ${extra}"><small>${label}</small><b>${value}</b></span>`).join('')}</span>`;
}
function auditBomGroupKey(row) {
  const parent = row.bomParent;
  const sheet = materialSheetName(row.btp_source_sheet || row.source_sheet);
  return parent?.assembly
    ? `${row.bom_source_file || parent.source_file || row.source_file}|${materialSheetName(parent.source_sheet || row.source_sheet)}|${parent.assembly}`
    : `${row.btp_source_file || row.source_file}|${sheet}|unlinked|${row.btp?.part_no || row.btp?.source_row || row.btp?.description || row.bomLine?.part_no || row.bomLine?.source_row || ''}`;
}
function auditBomGroups(rows, contextRows = rows, query = '') {
  const groups = new Map();
  for (const row of rows) {
    const groupKey = auditBomGroupKey(row);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }
  const contextByGroup = new Map();
  for (const row of contextRows) {
    const key = auditBomGroupKey(row);
    if (!contextByGroup.has(key)) contextByGroup.set(key, []);
    contextByGroup.get(key).push(row);
  }
  return [...groups].map(([key, groupRows]) => ({ key, rows:groupRows, detailRows:query ? contextByGroup.get(key) || groupRows : groupRows, query }));
}
function auditBomGroupMarkup({ key, rows, detailRows = rows, query = '' }) {
  const first = detailRows[0] || rows[0];
  const parent = first?.bomParent;
  const sheet = materialSheetName(first?.btp_source_sheet || parent?.source_sheet || first?.source_sheet);
  const assembly = parent?.assembly || first?.bomLine?.parent || 'Chưa khớp cấu kiện BOM';
  const btpRows = detailRows.filter((row) => row.btp);
  const btpCount = btpRows.length;
  const receivedCount = btpRows.filter((row) => Number(row.btp.received) > 0).length;
  const designTotal = btpRows.reduce((sum, row) => sum + (Number.isFinite(Number(row.btp.design_quantity)) ? Math.max(0, Number(row.btp.design_quantity)) : 0), 0);
  const receivedTotal = btpRows.reduce((sum, row) => sum + (Number.isFinite(Number(row.btp.received)) ? Math.max(0, Number(row.btp.received)) : 0), 0);
  const progress = designTotal > 0 ? Math.min(100, receivedTotal / designTotal * 100) : btpCount ? receivedCount / btpCount * 100 : 0;
  const completeCount = btpRows.filter((row) => getBtpShortageQuantity(row.btp) === 0).length;
  const status = !btpCount ? 'Chưa có BTP' : completeCount === btpCount ? 'Đã đủ' : receivedCount ? 'Đang về' : 'Chưa có';
  const dimensions = parent?.size ? `<span class="bom-meta-chip">${query ? highlightMatch(parent.size, query) : fmt(parent.size)}</span>` : '';
  const drawing = parent?.drawing ? `<span class="bom-meta-chip">${query ? highlightMatch(parent.drawing, query) : fmt(parent.drawing)}</span>` : '';
  const statusClass = status === 'Đã đủ' ? 'success' : status === 'Đang về' ? 'warning' : 'neutral';
  const searchMatches = query ? detailRows.filter((row) => auditDetailMatchesSearch(row, query)) : [];
  const searchPreview = searchMatches.length ? `<span class="bom-search-match-preview-wrap"><span class="bom-search-match-label">${fmt(searchMatches.length)} dòng khớp · bấm thẻ để xem đủ BTP</span>${searchMatches.map((row) => auditSearchPreviewMarkup(row, query)).join('')}</span>` : '';
  const printSelected = state.materialPrintSelectedGroups.has(key);
  const expanded = state.materialExpandedGroups.has(key);
  return `<article class="bom-btp-group ${expanded ? 'is-expanded' : ''}" data-print-group="${esc(key)}">
    <div class="bom-btp-group-header"><button class="bom-btp-group-summary" type="button" data-toggle-btp-group="${esc(key)}" aria-expanded="${expanded}"><span class="bom-card-toggle" aria-hidden="true">›</span><span class="bom-btp-group-main"><strong>${query ? highlightMatch(assembly, query) : fmt(assembly)}</strong>${drawing}${dimensions}<small>Sheet: ${fmt(sheet)} · Gồm ${fmt(btpCount)} BTP con</small></span><span class="status-pill ${statusClass}">${esc(status)}</span><span class="bom-group-progress"><span>${fmt(receivedCount)}/${fmt(btpCount)} BTP</span><strong>${progress.toFixed(1)}%</strong><i><b style="width:${progress.toFixed(1)}%"></b></i></span>${searchPreview}</button><div class="bom-card-print-actions"><label class="bom-print-select"><input type="checkbox" data-print-btp-group value="${esc(key)}" ${printSelected ? 'checked' : ''}><span>Chọn in</span></label><button class="button bom-print-single" type="button" data-print-btp-single="${esc(key)}" aria-label="In PDF ${esc(assembly)}">In PDF</button></div></div>
    <div class="bom-btp-table-wrap" ${expanded ? '' : 'hidden'}><table class="bom-btp-table"><thead><tr><th>Mã BTP (Chi tiết)</th><th>Chủng loại</th><th>DVG</th><th>Quy cách (Size)</th><th>Chiều dài (mm)</th><th>SL thiết kế</th><th>Đã nhận</th><th>Còn thiếu</th><th>Tiến độ theo ngày</th><th>Ktra nối</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead><tbody>${detailRows.map((row) => auditBtpTableRowMarkup(row, query)).join('')}</tbody></table></div>
  </article>`;
}
function btpPrintRowMarkup(row) {
  const btp = row.btp;
  const part = btp?.part_no || btp?.description || row.bomLine?.part_no || row.bomLine?.description || '—';
  const remaining = btp ? getBtpShortageQuantity(btp) : null;
  const status = btp ? (btp.status || auditStatus(row)) : 'Chưa có BTP';
  const note = [...new Set([row.bomNote, row.bomLine?.note, row.bomParent?.note, btp?.note].map((value) => String(value || '').trim()).filter(Boolean))].join(' | ');
  const events = String(btp?.daily_progress || '').split(/\s*;\s*/).filter(Boolean).map((event) => esc(event)).join('<br>') || '—';
  const values = [
    fmt(part), fmt(btp?.material_type), fmt(btp?.unit), fmt(btp?.size), fmt(btp?.length_mm),
    fmt(btp?.design_quantity), fmt(btp?.received), fmt(remaining), events, fmt(btp?.joint_check),
    `<span class="btp-print-status ${btp ? auditStatusClass(status) : 'danger'}">${esc(status)}</span>`, fmt(note || (btp ? '' : row.bomNote || 'BOM chưa có dòng BTP')),
  ];
  return `<tr>${values.map((value) => `<td>${value}</td>`).join('')}</tr>`;
}
function btpPrintGroupMarkup(group, index) {
  const rows = group.detailRows || group.rows;
  const first = rows[0] || group.rows[0];
  const parent = first?.bomParent;
  const btpRows = rows.filter((row) => row.btp);
  const designTotal = btpRows.reduce((sum, row) => sum + (Number(row.btp.design_quantity) || 0), 0);
  const receivedTotal = btpRows.reduce((sum, row) => sum + (Number(row.btp.received) || 0), 0);
  const remainingTotal = btpRows.reduce((sum, row) => sum + (getBtpShortageQuantity(row.btp) || 0), 0);
  const assembly = parent?.assembly || first?.bomLine?.parent || 'Chưa khớp cấu kiện BOM';
  const drawing = parent?.drawing || first?.bomLine?.drawing || '';
  const item = parent?.item || first?.bomLine?.item || '';
  const size = parent?.size || first?.bomLine?.size || '';
  const sheet = materialSheetName(first?.btp_source_sheet || parent?.source_sheet || first?.source_sheet);
  const breakClass = index ? ' btp-print-page-break' : '';
  return `<section class="btp-print-section${breakClass}">
    <header class="btp-print-header"><div><span class="btp-print-brand">AMECC · PROJECT CONTROL</span><h1>Bảng chi tiết bán thành phẩm</h1><p>Thông tin BTP theo cấu kiện trong BOM</p></div><div class="btp-print-date"><span>Ngày in</span><strong>${esc(new Intl.DateTimeFormat('vi-VN', { dateStyle:'short', timeStyle:'short' }).format(new Date()))}</strong></div></header>
    <div class="btp-print-project"><div><span>Dự án</span><strong>${esc(state.currentProject || '—')}</strong></div><div><span>Cấu kiện</span><strong>${fmt(assembly)}</strong></div><div><span>Bản vẽ</span><strong>${fmt(drawing)}</strong></div><div><span>Hạng mục</span><strong>${fmt(item)}</strong></div><div><span>Sheet BTP</span><strong>${fmt(sheet)}</strong></div><div><span>Quy cách</span><strong>${fmt(size)}</strong></div></div>
    <div class="btp-print-totals"><span><small>Số dòng BTP</small><strong>${fmt(btpRows.length)}</strong></span><span><small>SL thiết kế</small><strong>${fmt(designTotal)}</strong></span><span><small>Đã nhận</small><strong>${fmt(receivedTotal)}</strong></span><span><small>Còn thiếu</small><strong>${fmt(remainingTotal)}</strong></span></div>
    <table class="btp-print-table"><colgroup><col style="width:14%"><col style="width:7%"><col style="width:6%"><col style="width:8%"><col style="width:6%"><col style="width:5%"><col style="width:5%"><col style="width:5%"><col style="width:12%"><col style="width:5%"><col style="width:8%"><col style="width:19%"></colgroup><thead><tr><th>Mã BTP (Chi tiết)</th><th>Chủng loại</th><th>DVG</th><th>Quy cách</th><th>Chiều dài (mm)</th><th>SL thiết kế</th><th>Đã nhận</th><th>Còn thiếu</th><th>Tiến độ theo ngày</th><th>Ktra nối</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead><tbody>${rows.map(btpPrintRowMarkup).join('')}</tbody></table>
    <footer class="btp-print-footer"><span>AMECC · Dữ liệu trích từ BOM/BTP</span><span>${fmt(rows.length)} dòng chi tiết</span></footer>
  </section>`;
}
function printBtpGroups(groups) {
  if (!groups?.length) return;
  document.querySelector('#btpPrintDocument')?.remove();
  const documentNode = document.createElement('main');
  documentNode.id = 'btpPrintDocument';
  documentNode.innerHTML = groups.map(btpPrintGroupMarkup).join('');
  document.body.append(documentNode);
  document.body.classList.add('btp-printing');
  const cleanup = () => {
    document.body.classList.remove('btp-printing');
    documentNode.remove();
  };
  window.addEventListener('afterprint', cleanup, { once:true });
  window.print();
}
function syncBtpPrintSelectionUi() {
  const selectedCount = state.materialPrintSelectedGroups.size;
  const count = document.querySelector('#selectedBtpPrintCount');
  if (count) count.textContent = `${fmt(selectedCount)} thẻ đã chọn`;
  const printButton = document.querySelector('#printSelectedBtp');
  if (printButton) printButton.disabled = selectedCount === 0;
  const clearButton = document.querySelector('#clearBtpPrintSelection');
  if (clearButton) clearButton.hidden = selectedCount === 0;
  const pageKeys = [...document.querySelectorAll('#page .bom-btp-group[data-print-group]')].map((group) => group.dataset.printGroup);
  const master = document.querySelector('#selectVisibleBtpForPrint');
  if (master) {
    const checkedCount = pageKeys.filter((key) => state.materialPrintSelectedGroups.has(key)).length;
    master.checked = pageKeys.length > 0 && checkedCount === pageKeys.length;
    master.indeterminate = checkedCount > 0 && checkedCount < pageKeys.length;
  }
}
function bindBtpPrintActions(pageRoot) {
  if (!pageRoot || pageRoot.dataset.btpPrintActionsBound) return;
  pageRoot.dataset.btpPrintActionsBound = 'true';
  pageRoot.addEventListener('change', (event) => {
    const checkbox = event.target;
    if (checkbox.matches?.('[data-print-btp-group]')) {
      const group = state.materialPrintAvailableGroups.get(checkbox.value);
      if (checkbox.checked && group) state.materialPrintSelectedGroups.set(checkbox.value, group);
      else state.materialPrintSelectedGroups.delete(checkbox.value);
      syncBtpPrintSelectionUi();
      return;
    }
    if (checkbox.matches?.('#selectVisibleBtpForPrint')) {
      pageRoot.querySelectorAll('.bom-btp-group[data-print-group]').forEach((card) => {
        const key = card.dataset.printGroup;
        const group = state.materialPrintAvailableGroups.get(key);
        const cardCheckbox = card.querySelector('[data-print-btp-group]');
        if (checkbox.checked && group) state.materialPrintSelectedGroups.set(key, group);
        else state.materialPrintSelectedGroups.delete(key);
        if (cardCheckbox) cardCheckbox.checked = checkbox.checked;
      });
      syncBtpPrintSelectionUi();
    }
  });
  pageRoot.addEventListener('click', (event) => {
    const toggle = event.target.closest?.('[data-toggle-btp-group]');
    if (toggle) {
      const key = toggle.dataset.toggleBtpGroup;
      const card = toggle.closest('.bom-btp-group');
      const expanded = !state.materialExpandedGroups.has(key);
      if (expanded) state.materialExpandedGroups.add(key);
      else state.materialExpandedGroups.delete(key);
      toggle.setAttribute('aria-expanded', String(expanded));
      card?.classList.toggle('is-expanded', expanded);
      const table = card?.querySelector('.bom-btp-table-wrap');
      if (table) table.hidden = !expanded;
      const groupKeys = [...state.materialPrintAvailableGroups.keys()];
      const allExpanded = groupKeys.length > 0 && groupKeys.every((groupKey) => state.materialExpandedGroups.has(groupKey));
      const anyExpanded = groupKeys.some((groupKey) => state.materialExpandedGroups.has(groupKey));
      const expandButton = pageRoot.querySelector('#expandAllBtpGroups');
      const collapseButton = pageRoot.querySelector('#collapseAllBtpGroups');
      if (expandButton) expandButton.disabled = allExpanded || groupKeys.length === 0;
      if (collapseButton) collapseButton.disabled = !anyExpanded;
      return;
    }
    const expandAll = event.target.closest?.('#expandAllBtpGroups');
    const collapseAll = event.target.closest?.('#collapseAllBtpGroups');
    if (expandAll || collapseAll) {
      const expand = Boolean(expandAll);
      const groupKeys = [...state.materialPrintAvailableGroups.keys()];
      groupKeys.forEach((key) => {
        if (expand) state.materialExpandedGroups.add(key);
        else state.materialExpandedGroups.delete(key);
      });
      pageRoot.querySelectorAll('.bom-btp-group[data-print-group]').forEach((card) => {
        const summary = card.querySelector('[data-toggle-btp-group]');
        const table = card.querySelector('.bom-btp-table-wrap');
        card.classList.toggle('is-expanded', expand);
        summary?.setAttribute('aria-expanded', String(expand));
        if (table) table.hidden = !expand;
      });
      const expandButton = pageRoot.querySelector('#expandAllBtpGroups');
      const collapseButton = pageRoot.querySelector('#collapseAllBtpGroups');
      if (expandButton) expandButton.disabled = expand || groupKeys.length === 0;
      if (collapseButton) collapseButton.disabled = !expand || groupKeys.length === 0;
      return;
    }
    const singlePrint = event.target.closest?.('[data-print-btp-single]');
    if (singlePrint) {
      event.preventDefault();
      const group = state.materialPrintAvailableGroups.get(singlePrint.dataset.printBtpSingle)
        || state.materialPrintSelectedGroups.get(singlePrint.dataset.printBtpSingle);
      if (group) printBtpGroups([group]);
      return;
    }
    if (event.target.closest?.('#printSelectedBtp')) {
      const groups = [...state.materialPrintSelectedGroups.values()];
      if (groups.length) printBtpGroups(groups);
      return;
    }
    if (event.target.closest?.('#clearBtpPrintSelection')) {
      state.materialPrintSelectedGroups.clear();
      const page = document.querySelector('#page');
      if (page) {
        const rendered = document.createElement('div');
        rendered.innerHTML = materialsAuditPage();
        for (const selector of ['.audit-table-heading','.bom-btp-groups']) {
          const current = page.querySelector(selector);
          const next = rendered.querySelector(selector);
          if (current && next) current.innerHTML = next.innerHTML;
        }
      }
      syncBtpPrintSelectionUi();
    }
  });
}
function materialAuditCache() {
  const { data, btpData, progressData } = state;
  const current = state.auditDataCache;
  if (!current || current.data !== data || current.btpData !== btpData || current.progressData !== progressData) {
    state.auditDataCache = { data, btpData, progressData, usableBtpRows:null, sheetOptions:null, rows:null };
  }
  return state.auditDataCache;
}
function materialAuditRows() {
  const cache = materialAuditCache();
  if (!cache.rows) cache.rows = buildMaterialAuditRows({ materialRows:state.data?.rows || [], btpRows:usableBtpRows(), progressRows:state.progressData?.rows || [] })
    .sort((left, right) => Number(right.kind === 'bom-only') - Number(left.kind === 'bom-only')
      || Number(getBtpShortageQuantity(right.btp) || 0) - Number(getBtpShortageQuantity(left.btp) || 0)
      || String(left.source_sheet || '').localeCompare(String(right.source_sheet || ''), 'vi', { numeric:true, sensitivity:'base' })
      || Number(left.btp?.source_row || left.bomLine?.source_row || 0) - Number(right.btp?.source_row || right.bomLine?.source_row || 0));
  return cache.rows;
}
function auditSelectedKeys(options = auditSheetOptions()) {
  const all = options.map((option) => option.key);
  return new Set(state.materialSelectedSheets === null ? all : state.materialSelectedSheets);
}
function auditRowMatchesSheets(row, selected) {
  if (!selected.size) return false;
  const file = row.btp ? row.btp.source_file : row.source_file;
  const sheet = row.btp ? row.btp.source_sheet : row.source_sheet;
  return selected.has(materialSheetKey(file, sheet));
}
function filteredMaterialAuditRows({ rows = materialAuditRows(), options = auditSheetOptions(), includeSearch = true } = {}) {
  const selected = auditSelectedKeys(options);
  const search = String(state.materialSearch || '').trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (!auditRowMatchesSheets(row, selected)) return false;
    if (state.materialLotFilter) {
      const rowLots = materialAuditLotCodes(row);
      if (state.materialLotFilter === '__unassigned__' ? rowLots.length > 0 : !rowLots.includes(state.materialLotFilter)) return false;
    }
    if (state.materialReceiptDateFilter && (!row.btp || !filterBtpRowsByReceiptDate([row.btp], state.materialReceiptDateFilter).length)) return false;
    if (state.materialUnitFilter && String(row.btp?.unit ?? '').trim() !== state.materialUnitFilter) return false;
    const status = auditStatus(row);
    if (state.materialStatusFilter === 'shortage' && !(getBtpShortageQuantity(row.btp) > 0)) return false;
    if (state.materialStatusFilter === 'received' && !(Number(row.btp?.received) > 0)) return false;
    if (state.materialStatusFilter === 'no-btp' && row.kind !== 'bom-only') return false;
    if (state.materialStatusFilter === 'unlinked' && row.bomStatus === 'matched' && row.qldaStatus === 'matched') return false;
    if (includeSearch && search && !materialAuditRowSearchText(row).includes(search)) return false;
    return status !== 'Không dùng';
  });
}
function materialsAuditPage() {
  const options = auditSheetOptions();
  const selected = auditSelectedKeys(options);
  const allRows = materialAuditRows();
  const lotOptions = [...new Set(allRows.flatMap(materialAuditLotCodes))]
    .sort((left, right) => left.localeCompare(right, 'vi', { numeric:true, sensitivity:'base' }));
  const hasUnassignedLot = allRows.some((row) => !materialAuditLotCodes(row).length);
  const selectedLot = lotOptions.includes(state.materialLotFilter)
    || (state.materialLotFilter === '__unassigned__' && hasUnassignedLot) ? state.materialLotFilter : '';
  const visibleRows = filteredMaterialAuditRows({ options });
  const search = String(state.materialSearch || '').trim();
  const contextRows = search ? filteredMaterialAuditRows({ options, includeSearch:false }) : visibleRows;
  const selectedBtpRows = usableBtpRows().filter((row) => selected.has(materialSheetKey(row.source_file, row.source_sheet)));
  const deliveryUnits = [...new Set(selectedBtpRows.map((row) => String(row.unit ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'vi', { numeric:true, sensitivity:'base' }));
  const shortageCount = visibleRows.filter((row) => row.btp && getBtpShortageQuantity(row.btp) > 0).length;
  const unmatchedCount = visibleRows.filter((row) => row.bomStatus !== 'matched' || row.qldaStatus !== 'matched').length;
  const pageSize = 100;
  const allGroups = auditBomGroups(visibleRows, contextRows, search);
  const allGroupsExpanded = allGroups.length > 0 && allGroups.every((group) => state.materialExpandedGroups.has(group.key));
  const anyGroupsExpanded = allGroups.some((group) => state.materialExpandedGroups.has(group.key));
  const pageCount = Math.max(1, Math.ceil(allGroups.length / pageSize));
  state.materialPageIndex = Math.min(Math.max(0, state.materialPageIndex), pageCount - 1);
  const pageIndex = state.materialPageIndex;
  const pageGroups = allGroups.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  state.materialPrintAvailableGroups = new Map(allGroups.map((group) => [group.key, group]));
  const printSelectionCount = state.materialPrintSelectedGroups.size;
  const checkedOnPage = pageGroups.filter((group) => state.materialPrintSelectedGroups.has(group.key)).length;
  const allPageGroupsSelected = pageGroups.length > 0 && checkedOnPage === pageGroups.length;
  const allSelected = options.length > 0 && selected.size === options.length;
  const sheetOptionsMarkup = options.map((option) => `<label class="sheet-check-option"><input type="checkbox" data-material-sheet value="${esc(option.key)}" ${selected.has(option.key) ? 'checked' : ''}><span>${esc(option.source_sheet)}</span><small>${esc(option.source_file)}</small></label>`).join('');
  const selectedLabel = allSelected ? `Tất cả sheet (${options.length})` : `${selected.size}/${options.length} sheet`;
  const filteredBtp = visibleRows.filter((row) => row.btp).map((row) => row.btp);
  const project = state.projects.find((item) => item.code === state.currentProject);
  const filename = usableBtpRows()[0]?.source_file || state.data?.rows?.[0]?.source_file || `${state.currentProject}PL.xlsx`;
  const qldaFilename = state.progressData?.rows?.[0]?.source_file || `${state.currentProject}.xlsx`;
  return `${heading('MATERIAL CONTROL · BOM / BTP / QLDA','BOM & Vật tư PL','Đối chiếu BOM, BTP và tiến độ QLDA theo tên file dự án; tất cả ngày nhận được giữ lại để kiểm tra.')}
    <section class="material-audit-controls ${state.materialMobileFiltersOpen ? 'mobile-expanded' : ''}" aria-label="Lọc và xuất dữ liệu BOM, BTP">
      <div class="audit-filter-grid">
        <div class="mobile-audit-extra-filters" id="mobileAuditExtraFilters">
          ${projectSelect('materials')}
          <label class="filter-label">Sheet BTP<details class="sheet-multi-select" id="materialSheetDropdown"><summary>${esc(selectedLabel)}</summary><div class="sheet-multi-menu"><label class="sheet-check-option sheet-check-all"><input type="checkbox" data-material-sheet-all ${allSelected ? 'checked' : ''}><span>Chọn tất cả</span><small>${options.length} sheet</small></label>${sheetOptionsMarkup || '<p class="muted">Chưa có sheet BTP</p>'}</div></details></label>
          <label class="filter-label">Lot<select id="materialLotFilter" ${lotOptions.length || hasUnassignedLot ? '' : 'disabled'}><option value="">${lotOptions.length ? `Tất cả Lot (${lotOptions.length})` : 'Không phát hiện Lot'}</option>${lotOptions.map((lot) => `<option value="${esc(lot)}" ${selectedLot === lot ? 'selected' : ''}>${esc(projectLotLabel(lot))}</option>`).join('')}${hasUnassignedLot ? `<option value="__unassigned__" ${selectedLot === '__unassigned__' ? 'selected' : ''}>Chưa phân Lot</option>` : ''}</select></label>
          <label class="filter-label">Ngày nhận<div class="date-filter-control"><input type="date" id="materialReceiptDateFilter" value="${esc(state.materialReceiptDateFilter)}" aria-label="Chọn hoặc nhập ngày nhận" title="Chọn ngày trên lịch hoặc nhập ngày trực tiếp">${state.materialReceiptDateFilter ? '<button class="date-filter-clear" id="clearMaterialReceiptDate" type="button" title="Xem tất cả ngày">Xóa</button>' : ''}</div></label>
          <label class="filter-label">Đơn vị giao<select id="materialUnitFilter"><option value="" ${state.materialUnitFilter ? '' : 'selected'}>Tất cả đơn vị</option>${deliveryUnits.map((unit) => `<option value="${esc(unit)}" ${state.materialUnitFilter === unit ? 'selected' : ''}>${esc(unit)}</option>`).join('')}</select></label>
          <label class="filter-label">Trạng thái<select id="materialStatusFilter"><option value="" ${state.materialStatusFilter ? '' : 'selected'}>Tất cả trạng thái</option><option value="shortage" ${state.materialStatusFilter === 'shortage' ? 'selected' : ''}>Còn thiếu</option><option value="received" ${state.materialStatusFilter === 'received' ? 'selected' : ''}>Đã nhận</option><option value="no-btp" ${state.materialStatusFilter === 'no-btp' ? 'selected' : ''}>BOM chưa có BTP</option><option value="unlinked" ${state.materialStatusFilter === 'unlinked' ? 'selected' : ''}>Chưa khớp BOM / QLDA</option></select></label>
          <button class="button primary audit-export-button" id="exportBtpShortage" type="button" ${shortageCount ? '' : 'disabled'}>${icon('download')}<span>Xuất List thiếu</span></button>
        </div>
        <div class="mobile-audit-search-row">
          <label class="search-box audit-search">${icon('search')}<input id="materialSearch" type="search" inputmode="search" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="Tìm mã BTP, chủng loại, DVG, size, ghi chú…" value="${esc(state.materialSearch)}"></label>
          <button class="button mobile-audit-filter-toggle" id="toggleMobileAuditFilters" type="button" aria-controls="mobileAuditExtraFilters" aria-expanded="${state.materialMobileFiltersOpen}"><span>${state.materialMobileFiltersOpen ? 'Thu gọn' : 'Bộ lọc'}</span><span class="mobile-filter-chevron" aria-hidden="true">⌄</span></button>
        </div>
      </div>
      <div class="audit-control-footer"><span class="source-chip">Nguồn BOM/BTP: ${esc(filename)} · QLDA: ${esc(qldaFilename)} · Tên dự án lấy từ tên file</span><span id="btpExportMessage" class="btp-export-message" aria-live="polite"></span></div>
    </section>
    <div class="stats-grid compact audit-stats">${statCard('Dòng đối chiếu',visibleRows.length,'Theo sheet, ngày, trạng thái và từ khóa')}${statCard('Dòng BTP còn thiếu',shortageCount,'Được đưa vào List thiếu','red')}${statCard('BOM chưa có BTP',visibleRows.filter((row) => row.kind === 'bom-only').length,'Kiểm tra phần chưa được lập BTP','gold')}${statCard('Liên kết cần xem',unmatchedCount,'BOM hoặc QLDA chưa khớp','blue')}</div>
<div class="section-heading audit-table-heading"><div><span class="eyebrow">BTP · BÁN THÀNH PHẨM</span><h3>BTP trong BOM <span class="muted-count">${fmt(visibleRows.length)}</span></h3><span class="count-chip">${allGroups.length ? `${pageIndex * pageSize + 1}–${Math.min((pageIndex + 1) * pageSize, allGroups.length)} / ${fmt(allGroups.length)} cấu kiện` : '0 cấu kiện'}</span></div><div class="btp-print-selection-actions"><button class="button btp-expand-all" id="expandAllBtpGroups" type="button" ${allGroups.length && !allGroupsExpanded ? '' : 'disabled'}>Mở tất cả</button><button class="button btp-expand-all" id="collapseAllBtpGroups" type="button" ${anyGroupsExpanded ? '' : 'disabled'}>Thu gọn tất cả</button><label class="btp-print-page-select"><input id="selectVisibleBtpForPrint" type="checkbox" ${allPageGroupsSelected ? 'checked' : ''}><span>Chọn trang</span></label><span id="selectedBtpPrintCount" class="btp-print-selected-count">${fmt(printSelectionCount)} thẻ đã chọn</span><button class="button primary" id="printSelectedBtp" type="button" ${printSelectionCount ? '' : 'disabled'}>In PDF đã chọn</button><button class="button btp-print-clear" id="clearBtpPrintSelection" type="button" ${printSelectionCount ? '' : 'hidden'}>Bỏ chọn</button></div></div>
    <div class="bom-btp-groups">${pageGroups.map(auditBomGroupMarkup).join('') || '<div class="empty-state"><strong>Không có dòng phù hợp</strong><p>Hãy đổi bộ lọc hoặc chọn dự án có dữ liệu.</p></div>'}</div>
    <div class="btp-pagination"><span>${fmt(allGroups.length)} cấu kiện · ${fmt(visibleRows.length)} dòng BTP phù hợp</span><div><button class="button" id="auditPrevPage" type="button" ${pageIndex === 0 ? 'disabled' : ''}>Trước</button><span>Trang ${pageIndex + 1} / ${pageCount}</span><button class="button" id="auditNextPage" type="button" ${pageIndex >= pageCount - 1 ? 'disabled' : ''}>Sau</button></div></div>
    ${filteredBtp.filter((row) => getBtpShortageQuantity(row) > 0 && getBtpShortageWeight(row) === null).length ? '<p id="auditShortageNote" class="shortage-report-note">Một số dòng thiếu chưa có U.Weight; khối lượng thiếu tương ứng chưa được tính.</p>' : ''}`;
}
function materialDashboardPage() {
  const options = auditSheetOptions();
  const rows = usableBtpRows();
  const selectedRows = rows.filter((row) => !state.materialDashboardSheetFilter
    || materialSheetKey(row.source_file, row.source_sheet) === state.materialDashboardSheetFilter);
  const selectedLabel = state.materialDashboardSheetFilter
    ? options.find((option) => option.key === state.materialDashboardSheetFilter)?.source_sheet || 'Sheet đã chọn'
    : 'Toàn bộ sheet của dự án';
  const chartRange = { from:state.materialDashboardStartDate, to:state.materialDashboardEndDate, metric:state.materialDashboardMetric };
  return `${heading('MATERIAL DASHBOARD · BOM & VẬT TƯ','Dashboard BOM & vật tư','Chọn sheet, khoảng ngày và đơn vị đo; rê chuột lên biểu đồ để xem số liệu chi tiết.',projectSelect('materials'))}
    <div class="audit-dashboard-filter"><label class="filter-label">Sheet dashboard<select id="materialDashboardSheetFilter"><option value="">Tất cả sheet (${options.length})</option>${options.map((option) => `<option value="${esc(option.key)}" ${option.key === state.materialDashboardSheetFilter ? 'selected' : ''}>${esc(option.source_sheet)} · ${esc(option.source_file)}</option>`).join('')}</select></label>${dateFilterMarkup('materialDashboardStartDate', 'Từ ngày', state.materialDashboardStartDate)}${dateFilterMarkup('materialDashboardEndDate', 'Đến ngày', state.materialDashboardEndDate)}<label class="filter-label">Đơn vị biểu đồ<select id="materialDashboardMetric"><option value="quantity" ${state.materialDashboardMetric === 'quantity' ? 'selected' : ''}>Số lượng BTP</option><option value="kg" ${state.materialDashboardMetric === 'kg' ? 'selected' : ''}>Khối lượng · kg</option><option value="ton" ${state.materialDashboardMetric === 'ton' ? 'selected' : ''}>Khối lượng · tấn</option></select></label><span class="source-chip">Nguồn: ${esc(rows[0]?.source_file || `${state.currentProject}PL.xlsx`)}</span></div>
    <div class="stats-grid compact audit-dashboard-stats">${statCard('Dòng BTP',selectedRows.length,selectedLabel)}${statCard('Đã nhận',selectedRows.reduce((sum, row) => sum + (btpReceivedQuantity(row) || 0), 0),'Cộng từ các sheet đang xem','green')}${statCard('Còn thiếu',selectedRows.reduce((sum, row) => sum + (getBtpShortageQuantity(row) || 0), 0),'Theo cột Còn thiếu','red')}${statCard('Đơn vị giao',new Set(selectedRows.map((row) => row.unit).filter(Boolean)).size,'Theo DVG trong file BTP')}</div>
    ${renderMaterialDashboard(selectedRows, selectedLabel, chartRange)}`;
}
const projectStages = [
  { key:'fitup', label:'1. Gá lắp', fullLabel:'Gá lắp (Fit-up)', tone:'fitup' },
  { key:'welding', label:'2. Hàn', fullLabel:'Hàn (Welding)', tone:'welding' },
  { key:'trial_assembly', label:'3. TH thử', fullLabel:'Tổ hợp thử (Trial Assembly)', tone:'trial' },
  { key:'acceptance', label:'4. NT (QC)', fullLabel:'Nghiệm thu (QC Inspection)', tone:'qc' },
  { key:'handover', label:'5. Bàn giao', fullLabel:'Bàn giao (Handover / Delivery)', tone:'handover' },
];
function projectStageValue(row, stage) {
  const quantity = row[`${stage.key}_qty`];
  const weight = Number(row[`${stage.key}_weight`] || 0);
  const date = row[`${stage.key}_date`];
  const planned = Number(row.quantity || 0);
  const optional = stage.key === 'trial_assembly' && quantity == null && !date && weight === 0;
  const actual = quantity == null ? 0 : Number(quantity);
  const hasRecord = Boolean(date) || quantity != null || weight > 0;
  const complete = planned > 0 && actual >= planned;
  const percent = planned > 0 ? Math.min(100, Math.round(actual / planned * 100)) : 0;
  return { quantity, actual, planned, weight, date, optional, hasRecord, complete, percent };
}
function progressDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return match ? `${match[3].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[1]}` : text || '—';
}
function projectAssemblyStatus(row) {
  const handover = projectStageValue(row, projectStages[4]);
  const acceptance = projectStageValue(row, projectStages[3]);
  const welding = projectStageValue(row, projectStages[1]);
  const fitup = projectStageValue(row, projectStages[0]);
  if (handover.complete) return { label:'Bàn giao', tone:'success' };
  if (handover.hasRecord || acceptance.hasRecord) return { label:'Đang nghiệm thu', tone:'info' };
  if (welding.hasRecord) return { label:'Đang hàn', tone:'warning' };
  if (fitup.hasRecord) return { label:'Đang gá lắp', tone:'warning' };
  return { label:'Chưa bắt đầu', tone:'neutral' };
}
function projectStageCell(row, stage) {
  const data = projectStageValue(row, stage);
  if (data.optional || !data.hasRecord) return '<span class="project-stage-empty">—</span>';
  return `<div class="project-stage-cell ${data.complete ? 'complete' : ''}"><strong>${fmt(data.actual)}/${fmt(data.planned)}</strong><span>${fmt(data.weight)} kg</span><small>${esc(progressDate(data.date))}</small></div>`;
}
function projectAcceptedRows(row) {
  const projectCode = row.project_code || state.currentProject;
  return (state.progressData?.rows || [])
    .filter((candidate) => (candidate.project_code || state.currentProject) === projectCode
      && (Number(candidate.acceptance_qty || 0) > 0 || Number(candidate.acceptance_weight || 0) > 0))
    .sort((a, b) => String(a.part_no || a.item_id || '').localeCompare(String(b.part_no || b.item_id || ''), 'vi', { numeric:true, sensitivity:'base' }));
}
function projectAcceptedRowCard(row) {
  const partNo = row.part_no || row.item_id || 'Chưa có mã chi tiết';
  return `<article class="project-accepted-row"><div class="project-accepted-row-heading"><strong>${fmt(partNo)}</strong><span>${fmt(row.shipment)}${row.item ? ` · ${fmt(row.item)}` : ''}</span></div><div class="project-accepted-row-meta"><span><small>Bản vẽ</small><b>${fmt(row.drawing)}</b></span><span><small>Ngày nghiệm thu</small><b>${esc(progressDate(row.acceptance_date))}</b></span><span><small>Số lượng nghiệm thu</small><b>${fmt(row.acceptance_qty)} / ${fmt(row.quantity)} pcs</b></span><span><small>Khối lượng nghiệm thu</small><b>${fmt(row.acceptance_weight)} kg</b></span>${row.acceptance_record_no ? `<span><small>Số biên bản nghiệm thu</small><b>${fmt(row.acceptance_record_no)}</b></span>` : ''}</div></article>`;
}
function projectDetailDialog(row) {
  const status = projectAssemblyStatus(row);
  const acceptedRows = projectAcceptedRows(row);
  const technical = [
    ['Shipment', row.shipment], ['Hạng mục', row.item], ['Tổ phần giao', row.allocation ? `Tổ ${row.allocation}` : '—'],
    ['Tên bản vẽ', row.drawing], ['Quy cách (Size)', row.size], ['Số lượng (T’Qty)', `${fmt(row.quantity)} pcs`],
    ['Tổng khối lượng', `${fmt(row.total_weight)} kg`],
    ['Ngày giao hàng', progressDate(row.wo_date)], ['Profile / Dạng SP', [row.profile, row.product_type].filter(Boolean).join(' / ') || '—'],
    ['Đơn trọng (U.Wt)', `${fmt(row.unit_weight)} kg`],
  ];
  const stages = projectStages.map((stage) => {
    const data = projectStageValue(row, stage);
    const stageStatus = data.optional ? 'Không yêu cầu công đoạn này' : data.complete ? 'Đã hoàn thành 100%' : data.actual > 0 ? `Đang thực hiện · ${data.percent}%` : 'Chưa thực hiện';
    const tone = data.optional ? 'optional' : data.complete ? 'complete' : data.actual > 0 ? 'in-progress' : 'pending';
    const quantity = data.optional ? 'Không áp dụng' : `${fmt(data.actual)} / ${fmt(data.planned)} pcs`;
    const acceptanceMeta = stage.key === 'acceptance'
      ? `<div class="project-acceptance-meta"><span>▤ Số biên bản nghiệm thu: <b>${fmt(row.acceptance_record_no || 'Chưa có trong file QLDA')}</b></span><button class="button project-acceptance-toggle" type="button" data-toggle-accepted-details aria-expanded="false">Xem chi tiết đã nghiệm thu (${fmt(acceptedRows.length)})</button></div><div class="project-accepted-details" data-accepted-details hidden><div class="project-accepted-details-heading"><strong>${fmt(acceptedRows.length)} cấu kiện đã có khối lượng nghiệm thu</strong><span>Danh sách thuộc dự án ${fmt(row.project_code || state.currentProject)}</span></div><div class="project-accepted-list" data-acceptance-list>${acceptedRows.slice(0, 100).map(projectAcceptedRowCard).join('') || '<p class="project-accepted-empty">Chưa có cấu kiện nào được ghi nhận nghiệm thu.</p>'}</div>${acceptedRows.length > 100 ? `<button class="button project-accepted-more" type="button" data-load-more-accepted>Hiển thị thêm 100</button>` : ''}</div>`
      : '';
    return `<article class="project-detail-stage ${tone}"><div class="project-detail-stage-icon" aria-hidden="true">${stage.key === 'fitup' ? '⚒' : stage.key === 'welding' ? '♨' : stage.key === 'trial_assembly' ? '⌘' : stage.key === 'acceptance' ? '✓' : '⇢'}</div><div class="project-detail-stage-main"><div class="project-detail-stage-heading"><h4>${esc(stage.label)} <span>${esc(stage.fullLabel.replace(/^\d\.\s*/, ''))}</span></h4><strong>${esc(stageStatus)}</strong></div><div class="project-detail-stage-metrics"><span><small>Số lượng</small><b>${esc(quantity)}</b></span><span><small>Khối lượng</small><b>${fmt(data.weight)} kg</b></span><span><small>Ngày thực hiện</small><b>${esc(progressDate(data.date))}</b></span></div>${acceptanceMeta}${stage.key === 'handover' && (row.receiver || row.record_no) ? `<div class="project-delivery-meta">${row.receiver ? `<span>🏢 Đơn vị nhận: <b>${fmt(row.receiver)}</b></span>` : ''}${row.record_no ? `<span>▤ Số biên bản bàn giao: <b>${fmt(row.record_no)}</b></span>` : ''}</div>` : ''}</div></article>`;
  }).join('');
  return `<dialog class="project-assembly-dialog" aria-labelledby="projectAssemblyTitle"><div class="project-dialog-header"><div class="project-dialog-symbol" aria-hidden="true">◇</div><div class="project-dialog-title"><div><h3 id="projectAssemblyTitle">Cấu kiện: ${fmt(row.part_no || row.item_id || 'Chưa có mã')}</h3><span class="status-pill ${status.tone}">${esc(status.label)}</span></div><p>Dự án: ${esc(state.currentProject)}${row.shipment ? ` | Shipment: ${fmt(row.shipment)}` : ''}${row.item ? ` | Hạng mục: ${fmt(row.item)}` : ''}</p></div><button class="project-dialog-close" type="button" data-close-project-dialog aria-label="Đóng">×</button></div><div class="project-dialog-scroll"><section class="project-technical-panel"><h4><span aria-hidden="true">ⓘ</span> Thông số kỹ thuật cấu kiện</h4><div class="project-technical-grid">${technical.map(([label, value]) => `<div class="project-technical-item"><span>${esc(label)}</span><strong>${fmt(value)}</strong></div>`).join('')}</div></section><section class="project-detail-progress"><h4><span aria-hidden="true">⌁</span> Tiến độ 5 công đoạn chế tạo (hành trình cấu kiện)</h4><div class="project-detail-stage-list">${stages}</div></section></div><div class="project-dialog-footer"><button class="button" type="button" data-close-project-dialog>Đóng</button></div></dialog>`;
}
function openProjectDetail(row) {
  document.querySelector('.project-assembly-dialog')?.remove();
  const page = document.querySelector('#page');
  page.insertAdjacentHTML('beforeend', projectDetailDialog(row));
  const dialog = page.querySelector('.project-assembly-dialog');
  dialog.querySelectorAll('[data-close-project-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  const acceptedDetailsToggle = dialog.querySelector('[data-toggle-accepted-details]');
  const acceptedDetails = dialog.querySelector('[data-accepted-details]');
  acceptedDetailsToggle?.addEventListener('click', () => {
    const expanded = acceptedDetailsToggle.getAttribute('aria-expanded') === 'true';
    acceptedDetailsToggle.setAttribute('aria-expanded', String(!expanded));
    acceptedDetailsToggle.textContent = expanded ? `Xem chi tiết đã nghiệm thu (${fmt(projectAcceptedRows(row).length)})` : 'Thu gọn danh sách nghiệm thu';
    acceptedDetails.hidden = expanded;
  });
  const acceptedRows = projectAcceptedRows(row);
  const acceptedList = dialog.querySelector('[data-acceptance-list]');
  const acceptedMore = dialog.querySelector('[data-load-more-accepted]');
  let acceptedCount = Math.min(100, acceptedRows.length);
  acceptedMore?.addEventListener('click', () => {
    const nextRows = acceptedRows.slice(acceptedCount, acceptedCount + 100);
    acceptedList.insertAdjacentHTML('beforeend', nextRows.map(projectAcceptedRowCard).join(''));
    acceptedCount += nextRows.length;
    if (acceptedCount >= acceptedRows.length) acceptedMore.remove();
    else acceptedMore.textContent = `Hiển thị thêm ${Math.min(100, acceptedRows.length - acceptedCount)}`;
  });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove(), { once:true });
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}
function projectDashboardPage() {
  const projects = projectsForData('all');
  const allCodes = projects.map((project) => project.code);
  const selectedCodes = state.projectDashboardSelectedProjects === null ? allCodes : state.projectDashboardSelectedProjects.filter((code) => allCodes.includes(code));
  const selectedSet = new Set(selectedCodes);
  const rows = (state.projectDashboardData?.rows || []).filter((row) => selectedSet.has(row.project_code));
  const btpSummary = (state.projectDashboardData?.btpSummaries || []).filter((row) => selectedSet.has(row.project_code));
  const projectNames = Object.fromEntries(projects.map((project) => [project.code, projectFilenameLabel(project)]));
  const allSelected = projects.length > 0 && selectedCodes.length === projects.length;
  const projectFilterMarkup = `<label class="filter-label project-dashboard-project-filter">Dự án<details class="sheet-multi-select project-multi-select" id="projectDashboardProjects"><summary>${allSelected ? `Tất cả dự án (${projects.length})` : `${selectedCodes.length}/${projects.length} dự án`}</summary><div class="sheet-multi-menu"><label class="sheet-check-option sheet-check-all"><input type="checkbox" data-dashboard-project-all ${allSelected ? 'checked' : ''}><span>Chọn tất cả</span><small>${projects.length} dự án</small></label>${projects.map((project) => `<label class="sheet-check-option"><input type="checkbox" data-dashboard-project value="${esc(project.code)}" ${selectedSet.has(project.code) ? 'checked' : ''}><span>${esc(projectFilenameLabel(project))}</span><small>${esc(project.code)}</small></label>`).join('') || '<p class="muted">Chưa có dữ liệu QLDA.</p>'}</div></details></label>`;
  const sourceRows = [...new Set(rows.map((row) => row.source_file).filter(Boolean))];
  const sourceLabel = allSelected ? `${projects.length} dự án` : `${selectedCodes.length} dự án đã chọn`;
  return `${heading('PROJECT REPORTING · QLDA','Dashboard báo cáo dự án','Theo dõi lũy kế, khối lượng theo công đoạn, tổ phụ trách và bàn giao trên một hoặc nhiều dự án.')}
    ${renderProjectDashboard(rows, { from:state.projectDashboardStartDate, to:state.projectDashboardEndDate, metric:state.projectDashboardMetric, filtersOpen:state.projectDashboardFiltersOpen, projectFilterMarkup, sourceLabel:sourceRows.length ? sourceRows.slice(0, 3).join(', ') : sourceLabel, btpSummary, projectNames })}`;
}
function projectsPage() {
  const rows = state.progressData?.rows || [];
  const query = state.projectSearch.trim();
  const normalizedQuery = normalizeProjectSearch(query);
  const shipments = [...new Set(rows.map((row) => String(row.shipment || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'vi',{numeric:true,sensitivity:'base'}));
  const shipmentRows = rows.filter((row) => !state.projectShipmentFilter || String(row.shipment || '').trim() === state.projectShipmentFilter);
  const items = [...new Set(shipmentRows.map((row) => String(row.item || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'vi',{numeric:true,sensitivity:'base'}));
  const itemRows = shipmentRows.filter((row) => !state.projectItemFilter || String(row.item || '').trim() === state.projectItemFilter);
  const teams = [...new Set(itemRows.map((row) => String(row.allocation || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'vi',{numeric:true,sensitivity:'base'}));
  const filtered = rows.filter((row) => {
    const matchesSearch = !normalizedQuery || [row.shipment,row.item,row.mh,row.drawing,row.part_no,row.profile,row.note,row.allocation,row.size]
      .some((value) => normalizeProjectSearch(value).includes(normalizedQuery));
    const status = projectAssemblyStatus(row).label;
    const matchesStatus = !state.projectStatusFilter || (state.projectStatusFilter === 'handover' ? status === 'Bàn giao' : state.projectStatusFilter === 'active' ? !['Bàn giao','Chưa bắt đầu'].includes(status) : status === 'Chưa bắt đầu');
    const matchesShipment = !state.projectShipmentFilter || String(row.shipment || '').trim() === state.projectShipmentFilter;
    const matchesItem = !state.projectItemFilter || String(row.item || '').trim() === state.projectItemFilter;
    const matchesTeam = !state.projectTeamFilter || String(row.allocation || '').trim() === state.projectTeamFilter;
    return matchesSearch && matchesStatus && matchesShipment && matchesItem && matchesTeam;
  });
  const completed = filtered.filter((row) => projectAssemblyStatus(row).label === 'Bàn giao').length;
  const active = filtered.filter((row) => !['Bàn giao','Chưa bắt đầu'].includes(projectAssemblyStatus(row).label)).length;
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  state.projectPageIndex = Math.min(Math.max(state.projectPageIndex, 0), pageCount - 1);
  const pageIndex = state.projectPageIndex;
  const visible = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const rowsMarkup = visible.map((row, offset) => {
    const status = projectAssemblyStatus(row);
    const index = pageIndex * pageSize + offset + 1;
    return `<tr><td class="project-row-number">${fmt(index)}</td><td class="project-shipment-cell">${fmt(row.shipment)}</td><td>${fmt(row.item)}</td><td><span class="project-team-badge">${fmt(row.allocation)}</span></td><td class="project-part-cell"><button type="button" class="project-part-link" data-project-detail-row="${esc(row.source_row)}">${fmt(row.part_no || row.item_id || '—')} <span aria-hidden="true">↗</span></button></td><td>${fmt(row.drawing)}</td><td><strong>${fmt(row.size)}</strong>${row.profile ? `<small>${fmt(row.profile)}</small>` : ''}</td><td class="project-number">${fmt(row.quantity)}</td><td class="project-number">${fmt(row.unit_weight)}</td><td class="project-number project-total-weight">${fmt(row.total_weight)}</td><td><span class="status-pill ${status.tone}">${esc(status.label)}</span></td>${projectStages.map((stage) => `<td class="project-stage-column ${stage.tone}">${projectStageCell(row, stage)}</td>`).join('')}<td class="project-action-column"><button type="button" class="project-detail-button" data-project-detail-row="${esc(row.source_row)}" aria-label="Xem chi tiết cấu kiện ${esc(row.part_no || '')}" title="Xem chi tiết">◎</button></td></tr>`;
  }).join('');
  const projectExportMarkup = `<div class="project-export-actions"><button class="button primary" id="exportProjectWorkbook" type="button" ${rows.length ? '' : 'disabled'}>${icon('download')}<span>Xuất Excel đã lọc cột</span></button><input id="projectExportFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden><small>Chọn file QLDA gốc để giữ màu và định dạng.</small><span id="projectExportMessage" class="project-export-message" aria-live="polite"></span></div>`;
  const projectFilterMarkup = `<div class="project-mobile-search-row"><label class="search-box project-catalog-search">${icon('search')}<input id="projectSearch" type="search" placeholder="Tìm mã cấu kiện, bản vẽ, hạng mục…" value="${esc(query)}"></label><button class="button mobile-project-filter-toggle" id="toggleMobileProjectFilters" type="button" aria-controls="projectMobileExtraFilters" aria-expanded="${state.projectMobileFiltersOpen}"><span>${state.projectMobileFiltersOpen ? 'Thu gọn' : 'Bộ lọc'}</span><span class="mobile-filter-chevron" aria-hidden="true">⌄</span></button></div><div class="project-mobile-extra-filters" id="projectMobileExtraFilters"><label class="filter-label project-shipment-filter">Shipment<select id="projectShipmentFilter"><option value="">Tất cả shipment${shipments.length ? ` (${shipments.length})` : ''}</option>${shipments.map((value) => `<option value="${esc(value)}" ${state.projectShipmentFilter === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><label class="filter-label project-item-filter">Hạng mục<select id="projectItemFilter"><option value="">Tất cả hạng mục${items.length ? ` (${items.length})` : ''}</option>${items.map((value) => `<option value="${esc(value)}" ${state.projectItemFilter === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><label class="filter-label project-team-filter">Tổ<select id="projectTeamFilter"><option value="">Tất cả tổ${teams.length ? ` (${teams.length})` : ''}</option>${teams.map((value) => `<option value="${esc(value)}" ${state.projectTeamFilter === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><label class="filter-label project-status-filter">Trạng thái<select id="projectStatusFilter"><option value="" ${!state.projectStatusFilter ? 'selected' : ''}>Tất cả trạng thái</option><option value="handover" ${state.projectStatusFilter === 'handover' ? 'selected' : ''}>Đã bàn giao</option><option value="active" ${state.projectStatusFilter === 'active' ? 'selected' : ''}>Đang thực hiện</option><option value="not-started" ${state.projectStatusFilter === 'not-started' ? 'selected' : ''}>Chưa bắt đầu</option></select></label>${projectExportMarkup}</div>`;
  return `${heading('PROJECT DELIVERY · QLDA','Quản lý dự án','Tra cứu cấu kiện và xem tiến độ 5 công đoạn trong một bảng tổng hợp.',projectSelect('progress'))}
    <div class="project-progress-controls"><section class="panel project-progress-filter-panel ${state.projectMobileFiltersOpen ? 'mobile-expanded' : ''}" aria-label="Tìm kiếm và lọc tiến độ dự án"><div class="project-progress-toolbar">${projectFilterMarkup}</div></section></div>
    <div class="stats-grid compact project-progress-stats">${statCard('Cấu kiện',filtered.length,'Theo bộ lọc hiện tại')}${statCard('Đã bàn giao',completed,'Hoàn thành công đoạn 5','green')}${statCard('Đang thực hiện',active,'Đã có ghi nhận sản xuất','gold')}${statCard('Tổng khối lượng · kg',filtered.reduce((sum, row) => sum + (Number(row.total_weight) || 0), 0),'Theo cột Tổng KL')}</div>
    <div class="section-heading project-progress-heading"><div><span class="eyebrow">PROJECT PROGRESS</span><h3>Tiến độ cấu kiện <span class="muted-count">${filtered.length.toLocaleString('vi-VN')}</span></h3></div><span class="count-chip">${filtered.length ? `${pageIndex * pageSize + 1}–${Math.min((pageIndex + 1) * pageSize, filtered.length)} / ${filtered.length.toLocaleString('vi-VN')}` : '0 cấu kiện'}</span></div>
    ${filtered.length ? `<div class="project-table-frame"><table class="project-progress-table"><thead><tr><th>STT</th><th>Shipment</th><th>Hạng mục</th><th>Tổ</th><th>Số chi tiết (Mã CK)</th><th>Bản vẽ</th><th>Quy cách (Size)</th><th>T’Qty</th><th>Đơn trọng</th><th>Tổng KL (kg)</th><th>Trạng thái</th>${projectStages.map((stage) => `<th class="project-stage-column ${stage.tone}">${esc(stage.label)}</th>`).join('')}<th class="project-action-column">Thao tác</th></tr></thead><tbody>${rowsMarkup}</tbody></table></div><div class="btp-pagination project-pagination"><span>${filtered.length.toLocaleString('vi-VN')} cấu kiện${filtered.length !== rows.length ? ` · ${rows.length.toLocaleString('vi-VN')} toàn dự án` : ''}</span><div><button class="button" id="projectPrevPage" type="button" ${pageIndex === 0 ? 'disabled' : ''}>Trước</button><span>Trang ${pageIndex + 1} / ${pageCount}</span><button class="button" id="projectNextPage" type="button" ${pageIndex >= pageCount - 1 ? 'disabled' : ''}>Sau</button></div></div>` : '<div class="empty-state"><strong>Không tìm thấy cấu kiện</strong><p>Hãy đổi từ khóa hoặc bộ lọc trạng thái.</p></div>'}
    <p class="footnote">Bấm mã cấu kiện hoặc biểu tượng xem để mở thông số kỹ thuật và lịch sử từng công đoạn. Không nhập vào báo cáo: A, C–D, T–AI, AS và BB đến cột cuối (bắt đầu từ Check 1).</p>`;
}
function adminPage() {
  return `${heading('ACCESS CONTROL · ADMIN','Quản trị tài khoản & dữ liệu','Tạo tài khoản chỉ xem và nhập dữ liệu thực từ workbook trên máy tính của bạn.')}
    <div class="admin-grid"><section class="panel"><div class="panel-title"><span class="eyebrow">USER ACCESS</span><h3>Tạo tài khoản người xem</h3><p>Tài khoản viewer chỉ có quyền đọc dữ liệu; không thể tải hoặc thay thế dữ liệu.</p></div><form id="viewerForm" class="form-grid"><label>Tên đăng nhập<input name="username" minlength="3" maxlength="64" required></label><label>Mật khẩu tạm (ít nhất 12 ký tự)<input name="password" type="password" minlength="12" required></label><button class="button primary" type="submit">Tạo tài khoản viewer</button><div class="form-message" id="viewerMessage" aria-live="polite"></div></form></section>
    <section class="panel"><div class="panel-title"><span class="eyebrow">WORKBOOK IMPORT</span><h3>Nạp dữ liệu từ máy tính</h3><p>PL và BTP được phân tích trên trình duyệt rồi gửi JSON; có thể chọn nhiều file PL. Tải file trùng tên sẽ thay thế dữ liệu cũ cùng file.</p></div><form id="importForm" class="form-grid"><label>Loại dữ liệu<select name="category"><option value="materials">Vật tư PL + BTP</option><option value="projects">Tiến độ QLDA</option></select></label><label class="file-picker">Chọn file Excel<input name="file" type="file" accept=".xlsx" required><small id="importFileHint">Chọn một hoặc nhiều file PL, tên mỗi file kết thúc bằng PL.xlsx; tối đa ${MAX_MATERIAL_FILE_MB} MB/file.</small></label><div class="form-message import-project-preview" id="importProjectPreview" aria-live="polite">Mã dự án sẽ lấy từ tên file.</div><div class="import-file-progress" id="importFileProgress" aria-live="polite" hidden></div><button class="button primary" type="submit">${icon('upload')}<span>Kiểm tra &amp; nhập dữ liệu</span></button><div class="form-message" id="importMessage" aria-live="polite"></div></form></section></div>
    <section class="panel account-panel"><div class="panel-title"><span class="eyebrow">PL / BTP FILES</span><h3>File vật tư đang lưu</h3><p>Xóa file tại đây để gỡ dữ liệu PL/BTP cũ trước khi nhập file thay thế. Tiến độ QLDA không bị ảnh hưởng.</p></div><div id="plFileList">${plFilesMarkup()}</div></section>
    <section class="panel account-panel"><div class="panel-title"><span class="eyebrow">PROJECT DATA</span><h3>Các dự án trên hệ thống</h3></div>${state.projects.length ? `<div class="account-list">${state.projects.map((project) => `<div class="account-row"><b>${esc(project.code)}</b><span>${fmt(project.material_rows)} vật tư</span><span>${fmt(project.progress_rows)} tiến độ</span><small>${fmt(project.updated_at)}</small></div>`).join('')}</div>` : '<p class="muted">Chưa nhập workbook nào.</p>'}</section>`;
}
function plFilesMarkup() {
  return state.plFiles.length ? `<div class="account-list">${state.plFiles.map((file) => `<div class="account-row pl-file-row"><b>${esc(file.project_code)}</b><span class="pl-file-name">${esc(file.source_file)}</span><span>${fmt(file.material_rows)} dòng PL · ${fmt(file.btp_rows)} dòng BTP</span><button class="button danger" type="button" data-delete-pl-file data-project="${esc(file.project_code)}" data-filename="${esc(file.source_file)}">Xóa file</button></div>`).join('')}</div>` : '<p class="muted">Chưa có file PL/BTP nào được nhập.</p>';
}
function bindPlFileDeleteButtons() {
  document.querySelectorAll('[data-delete-pl-file]').forEach((button) => button.addEventListener('click', async () => {
    const projectCode = button.dataset.project;
    const filename = button.dataset.filename;
    if (!window.confirm(`Xóa toàn bộ dữ liệu PL/BTP từ ${filename} của dự án ${projectCode}? Thao tác này không thể hoàn tác.`)) return;
    button.disabled = true;
    try {
      const result = await api('/api/admin/pl-files', {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project_code: projectCode, filename }),
      });
      invalidateProjectData(projectCode);
      await Promise.all([refreshProjects(), refreshPlFiles()]);
      const list = document.querySelector('#plFileList');
      if (list) list.innerHTML = plFilesMarkup();
      bindPlFileDeleteButtons();
      const notice = document.createElement('div');
      notice.className = 'notice success';
      notice.textContent = `Đã xóa ${result.deleted_rows.toLocaleString('vi-VN')} dòng PL/BTP từ ${filename}.`;
      document.querySelector('#page')?.prepend(notice);
    } catch (error) {
      button.disabled = false;
      window.alert(`Không xóa được file: ${error.message}`);
    }
  }));
}
function syncProjectFrozenColumnOffsets() {
  document.querySelectorAll('.project-table-frame').forEach((frame) => {
    const table = frame.querySelector('.project-progress-table');
    const headerCells = table?.tHead?.rows?.[0]?.cells;
    if (!headerCells || headerCells.length < 11) return;
    let left = 0;
    for (let index = 0; index < 11; index += 1) {
      const offset = `${left}px`;
      headerCells[index].style.left = offset;
      table.querySelectorAll('tbody tr').forEach((row) => {
        if (row.cells[index]) row.cells[index].style.left = offset;
      });
      left += headerCells[index].getBoundingClientRect().width;
    }
  });
}
function bindPage() {
  const pageRoot = document.querySelector('#page');
  bindBtpPrintActions(pageRoot);
  syncProjectFrozenColumnOffsets();
  if (pageRoot && !pageRoot.dataset.projectFreezeLayoutBound) {
    pageRoot.dataset.projectFreezeLayoutBound = 'true';
    if (typeof ResizeObserver === 'function') {
      pageRoot._projectFreezeResizeObserver = new ResizeObserver(() => requestAnimationFrame(syncProjectFrozenColumnOffsets));
      pageRoot._projectFreezeResizeObserver.observe(pageRoot);
    }
    window.addEventListener('resize', () => requestAnimationFrame(syncProjectFrozenColumnOffsets));
    document.fonts?.ready?.then(() => syncProjectFrozenColumnOffsets());
  }
  document.querySelectorAll('.project-table-frame').forEach((frame) => {
    if (frame.dataset.dragScrollBound) return;
    frame.dataset.dragScrollBound = 'true';
    let drag = null;
    let suppressClick = false;
    frame.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button,a,input,select,textarea,[contenteditable="true"]')) return;
      drag = { pointerId:event.pointerId, x:event.clientX, y:event.clientY, left:frame.scrollLeft, top:frame.scrollTop, moved:false };
    });
    frame.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        frame.classList.add('is-dragging');
        try { frame.setPointerCapture(event.pointerId); } catch {}
      }
      event.preventDefault();
      frame.scrollLeft = drag.left - dx;
      frame.scrollTop = drag.top - dy;
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      suppressClick = drag.moved;
      if (frame.hasPointerCapture?.(event.pointerId)) frame.releasePointerCapture(event.pointerId);
      drag = null;
      frame.classList.remove('is-dragging');
    };
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);
    frame.addEventListener('click', (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    frame.addEventListener('lostpointercapture', () => {
      drag = null;
      frame.classList.remove('is-dragging');
    });
  });
  if (pageRoot && !pageRoot.dataset.chartTooltipDismissBound) {
    pageRoot.dataset.chartTooltipDismissBound = 'true';
    pageRoot.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.chart-unit-hit')) return;
      pageRoot.querySelectorAll('.material-chart-tooltip').forEach((tooltip) => { tooltip.hidden = true; });
    });
  }
  document.querySelectorAll('.chart-unit-hit').forEach((target) => {
    const figure = target.closest('.material-chart-card');
    const tooltip = figure?.querySelector('.material-chart-tooltip');
    if (!figure || !tooltip) return;
    const showTooltip = (clientX, clientY) => {
      tooltip.textContent = `${target.dataset.unitLabel || 'Đơn vị giao'}\nĐã nhận: ${target.dataset.received || '0'} ${target.dataset.unit || ''}\nCòn thiếu: ${target.dataset.shortage || '0'} ${target.dataset.unit || ''}`;
      tooltip.hidden = false;
      target.setAttribute('aria-describedby', 'materialChartTooltip');
      const figureRect = figure.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const anchorX = Number.isFinite(clientX) ? clientX - figureRect.left : targetRect.left + targetRect.width / 2 - figureRect.left;
      const anchorY = Number.isFinite(clientY) ? clientY - figureRect.top : targetRect.top - figureRect.top;
      const x = Math.max(8, Math.min(figureRect.width - tooltip.offsetWidth - 8, anchorX + 12));
      const y = Math.max(38, Math.min(figureRect.height - tooltip.offsetHeight - 8, anchorY - tooltip.offsetHeight - 10));
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    };
    target.addEventListener('pointerenter', (event) => showTooltip(event.clientX, event.clientY));
    target.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse' && !tooltip.hidden) showTooltip(event.clientX, event.clientY);
    });
    target.addEventListener('pointerdown', (event) => showTooltip(event.clientX, event.clientY));
    target.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') tooltip.hidden = true; });
    target.addEventListener('focus', () => showTooltip(NaN, NaN));
    target.addEventListener('blur', () => { tooltip.hidden = true; });
    target.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { tooltip.hidden = true; target.blur(); }
    });
  });
  document.querySelectorAll('[data-expand-chart]').forEach((button) => button.addEventListener('click', async () => {
    const figure = button.closest('.project-report-card');
    if (!figure) return;
    try {
      if (document.fullscreenElement === figure) await document.exitFullscreen();
      else if (typeof figure.requestFullscreen === 'function') await figure.requestFullscreen();
      else throw new Error('Trình duyệt này chưa hỗ trợ phóng to biểu đồ.');
    } catch (error) {
      const notice = document.querySelector('#projectDashboardNotice');
      if (notice) notice.textContent = error.message || 'Không thể phóng to biểu đồ.';
    }
  }));
  if (!document.documentElement.dataset.projectChartFullscreenBound) {
    document.documentElement.dataset.projectChartFullscreenBound = 'true';
    document.addEventListener('fullscreenchange', () => {
      document.querySelectorAll('[data-expand-chart]').forEach((button) => {
        const expanded = document.fullscreenElement === button.closest('.project-report-card');
        button.setAttribute('aria-pressed', String(expanded));
        button.setAttribute('aria-label', expanded ? 'Thoát toàn màn hình' : 'Phóng to biểu đồ');
        button.title = expanded ? 'Thoát toàn màn hình' : 'Phóng to biểu đồ';
        button.querySelector('span').textContent = expanded ? 'Thu nhỏ' : 'Toàn màn hình';
      });
    });
  }
  const importCategory = document.querySelector('#importForm select[name="category"]');
  const importFile = document.querySelector('#importForm input[name="file"]');
  const importFileHint = document.querySelector('#importFileHint');
  const importProjectPreview = document.querySelector('#importProjectPreview');
  const importFileProgress = document.querySelector('#importFileProgress');
  const progressState = { files:[], statuses:[] };
  const renderImportProgress = () => {
    if (!importFileProgress) return;
    if (!progressState.files.length) {
      importFileProgress.hidden = true;
      importFileProgress.replaceChildren();
      return;
    }
    const completed = progressState.statuses.filter((item) => item.status === 'complete').length;
    const failed = progressState.statuses.filter((item) => item.status === 'error').length;
    importFileProgress.hidden = false;
    importFileProgress.innerHTML = `<div class="import-file-progress-head"><strong>Tiến độ từng file</strong><span>${completed}/${progressState.files.length} hoàn tất${failed ? ` · ${failed} lỗi` : ''}</span></div><ul class="import-file-progress-list">${progressState.files.map((file, index) => {
      const item = progressState.statuses[index] || { status:'pending', detail:'Chờ xử lý' };
      const indicator = item.status === 'complete' ? '✓' : item.status === 'error' ? '!' : item.status === 'working' ? '' : '·';
      return `<li class="import-file-progress-item ${item.status}"><span class="import-file-progress-indicator" aria-hidden="true">${indicator}</span><span class="import-file-progress-copy"><strong>${esc(file.name)}</strong><small>${esc(item.detail)}</small></span></li>`;
    }).join('')}</ul>`;
  };
  const setImportProgress = (index, status, detail) => {
    if (index < 0 || index >= progressState.files.length) return;
    progressState.statuses[index] = { status, detail };
    renderImportProgress();
  };
  const updateImportProjectPreview = () => {
    if (!importProjectPreview) return;
    const files = [...(importFile?.files || [])];
    if (!files.length) {
      importProjectPreview.textContent = 'Mã dự án sẽ lấy từ tên file.';
      importProjectPreview.className = 'form-message import-project-preview';
      return;
    }
    const category = importCategory?.value === 'materials' ? 'materials' : 'projects';
    const labels = files.map((file) => {
      try { return `${file.name} → ${projectCodeFromFilename(file.name, category)}`; }
      catch { return `${file.name} · tên file không hợp lệ`; }
    });
    importProjectPreview.textContent = `Dự án: ${labels.join(' · ')}`;
    importProjectPreview.className = 'form-message import-project-preview';
  };
  const updateImportFileMode = () => {
    const isMaterials = importCategory?.value === 'materials';
    if (importFile) {
      importFile.multiple = Boolean(isMaterials);
    }
    if (importFileHint) importFileHint.textContent = isMaterials
      ? `Chọn file theo dạng mã dự án + PL.xlsx (ví dụ M304PL.xlsx); tối đa ${MAX_MATERIAL_FILE_MB} MB/file.`
      : 'Tên file là mã dự án.xlsx (ví dụ A290.xlsx), cần sheet Progress; tối đa 10 MB.';
    updateImportProjectPreview();
  };
  importCategory?.addEventListener('change', () => {
    progressState.files = [];
    progressState.statuses = [];
    renderImportProgress();
    updateImportFileMode();
  });
  importFile?.addEventListener('change', () => {
    progressState.files = [...importFile.files];
    progressState.statuses = progressState.files.map(() => ({ status:'pending', detail:'Sẵn sàng tải lên' }));
    renderImportProgress();
    updateImportProjectPreview();
  });
  updateImportFileMode();
  const bindDateFilter = (id, onChange) => {
    const input = document.getElementById(id);
    const picker = document.getElementById(`${id}Picker`);
    const button = document.querySelector(`[data-date-open="${id}"]`);
    if (!input || !picker || !button) return;
    input.addEventListener('input', () => input.setCustomValidity(''));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    });
    input.addEventListener('change', () => {
      const iso = parseDateFilter(input.value);
      if (iso === null) {
        input.setCustomValidity('Nhập ngày hợp lệ theo định dạng dd/mm/yyyy, ví dụ 01/09/2026.');
        input.reportValidity();
        return;
      }
      input.setCustomValidity('');
      onChange(iso);
    });
    picker.addEventListener('change', () => onChange(picker.value));
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const iso = parseDateFilter(input.value);
      if (iso) picker.value = iso;
      try {
        if (typeof picker.showPicker === 'function') picker.showPicker();
        else { picker.focus(); picker.click(); }
      } catch {
        picker.focus();
        picker.click();
      }
    });
  };
  document.querySelector('#projectFilter')?.addEventListener('change', async (event) => {
    state.currentProject = event.target.value;
    state.materialLotFilter = '';
    state.projectSearch = '';
    state.projectStatusFilter = '';
    state.projectShipmentFilter = '';
    state.projectItemFilter = '';
    state.projectTeamFilter = '';
    state.projectPageIndex = 0;
    state.materialSelectedSheets = null;
    state.materialReceiptDateFilter = '';
    state.materialUnitFilter = '';
    state.materialStatusFilter = '';
    state.materialSearch = '';
    state.materialPageIndex = 0;
    state.materialDashboardSheetFilter = '';
    state.materialDashboardStartDate = '';
    state.materialDashboardEndDate = '';
    state.materialDashboardMetric = 'quantity';
    state.projectDashboardStartDate = '';
    state.projectDashboardEndDate = '';
    state.projectDashboardMetric = 'kg';
    renderPage();
  });
  const rerenderProjectDashboard = ({ keepDropdown = false } = {}) => {
    const page = document.querySelector('#page');
    const position = window.scrollY;
    const dropdownOpen = keepDropdown && document.querySelector('#projectDashboardProjects')?.open;
    if (!page) return;
    page.innerHTML = projectDashboardPage();
    bindPage();
    if (dropdownOpen) {
      const dropdown = document.querySelector('#projectDashboardProjects');
      if (dropdown) dropdown.open = true;
    }
    window.scrollTo(0, position);
  };
  document.querySelector('#toggleProjectDashboardFilters')?.addEventListener('click', (event) => {
    state.projectDashboardFiltersOpen = !state.projectDashboardFiltersOpen;
    const panel = document.querySelector('.project-report-filter');
    panel?.classList.toggle('mobile-expanded', state.projectDashboardFiltersOpen);
    const button = event.currentTarget;
    button.setAttribute('aria-expanded', String(state.projectDashboardFiltersOpen));
    button.querySelector('span')?.replaceChildren(state.projectDashboardFiltersOpen ? 'Thu gọn' : 'Bộ lọc báo cáo');
  });
  bindDateFilter('projectDashboardStartDate', (value) => { state.projectDashboardStartDate = value; rerenderProjectDashboard(); });
  bindDateFilter('projectDashboardEndDate', (value) => { state.projectDashboardEndDate = value; rerenderProjectDashboard(); });
  document.querySelector('#projectDashboardMetric')?.addEventListener('change', (event) => {
    state.projectDashboardMetric = event.currentTarget.value;
    rerenderProjectDashboard();
  });
  document.querySelector('[data-dashboard-project-all]')?.addEventListener('change', (event) => {
    state.projectDashboardSelectedProjects = event.currentTarget.checked ? null : [];
    rerenderProjectDashboard({ keepDropdown:true });
  });
  document.querySelectorAll('[data-dashboard-project]').forEach((checkbox) => checkbox.addEventListener('change', () => {
    const allCodes = projectsForData('all').map((project) => project.code);
    const selected = new Set(state.projectDashboardSelectedProjects === null ? allCodes : state.projectDashboardSelectedProjects);
    if (checkbox.checked) selected.add(checkbox.value);
    else selected.delete(checkbox.value);
    state.projectDashboardSelectedProjects = selected.size === allCodes.length ? null : [...selected];
    rerenderProjectDashboard({ keepDropdown:true });
  }));
  const rerenderAudit = ({ keepDropdown = false } = {}) => {
    const page = document.querySelector('#page');
    const position = window.scrollY;
    const dropdownOpen = keepDropdown && document.querySelector('#materialSheetDropdown')?.open;
    if (!page) return;
    page.innerHTML = materialsAuditPage();
    bindPage();
    const dropdown = document.querySelector('#materialSheetDropdown');
    if (dropdownOpen && dropdown) dropdown.open = true;
    window.scrollTo(0,position);
  };
  const bindAuditPagination = () => {
    document.querySelector('#auditPrevPage')?.addEventListener('click', () => {
      state.materialPageIndex = Math.max(0, state.materialPageIndex - 1);
      rerenderAudit();
    });
    document.querySelector('#auditNextPage')?.addEventListener('click', () => {
      state.materialPageIndex += 1;
      rerenderAudit();
    });
  };
  const rerenderAuditResults = () => {
    const page = document.querySelector('#page');
    if (!page) return;
    const rendered = document.createElement('div');
    rendered.innerHTML = materialsAuditPage();
    for (const selector of ['.audit-stats','.audit-table-heading','.bom-btp-groups','.btp-pagination']) {
      const current = page.querySelector(selector);
      const next = rendered.querySelector(selector);
      if (current && next) current.innerHTML = next.innerHTML;
    }
    const exportButton = page.querySelector('#exportBtpShortage');
    const nextExportButton = rendered.querySelector('#exportBtpShortage');
    if (exportButton && nextExportButton) exportButton.disabled = nextExportButton.disabled;
    const shortageNote = page.querySelector('#auditShortageNote');
    const nextShortageNote = rendered.querySelector('#auditShortageNote');
    if (shortageNote && nextShortageNote) shortageNote.replaceWith(nextShortageNote);
    else if (shortageNote) shortageNote.remove();
    else if (nextShortageNote) page.append(nextShortageNote);
    bindAuditPagination();
    syncBtpPrintSelectionUi();
  };
  document.querySelector('#toggleMobileAuditFilters')?.addEventListener('click', (event) => {
    state.materialMobileFiltersOpen = !state.materialMobileFiltersOpen;
    const controls = document.querySelector('.material-audit-controls');
    controls?.classList.toggle('mobile-expanded', state.materialMobileFiltersOpen);
    const button = event.currentTarget;
    button.setAttribute('aria-expanded', String(state.materialMobileFiltersOpen));
    button.querySelector('span')?.replaceChildren(state.materialMobileFiltersOpen ? 'Thu gọn' : 'Bộ lọc');
  });
  document.querySelector('#materialSearch')?.addEventListener('input', (event) => {
    state.materialSearch = event.currentTarget.value;
    state.materialPageIndex = 0;
    rerenderAuditResults();
  });
  document.querySelectorAll('[data-material-sheet]')?.forEach((checkbox) => checkbox.addEventListener('change', () => {
    const checked = [...document.querySelectorAll('[data-material-sheet]:checked')].map((item) => item.value);
    const options = auditSheetOptions();
    state.materialSelectedSheets = checked.length === options.length ? null : checked;
    state.materialPageIndex = 0;
    state.materialReceiptDateFilter = '';
    state.materialUnitFilter = '';
    rerenderAudit({ keepDropdown:true });
  }));
  document.querySelector('[data-material-sheet-all]')?.addEventListener('change', (event) => {
    state.materialSelectedSheets = event.currentTarget.checked ? null : [];
    state.materialPageIndex = 0;
    state.materialReceiptDateFilter = '';
    state.materialUnitFilter = '';
    rerenderAudit({ keepDropdown:true });
  });
  document.querySelector('#materialReceiptDateFilter')?.addEventListener('change', (event) => {
    state.materialReceiptDateFilter = event.currentTarget.value;
    state.materialPageIndex = 0;
    rerenderAudit();
  });
  document.querySelector('#clearMaterialReceiptDate')?.addEventListener('click', () => {
    state.materialReceiptDateFilter = '';
    state.materialPageIndex = 0;
    rerenderAudit();
  });
  document.querySelector('#materialStatusFilter')?.addEventListener('change', (event) => {
    state.materialStatusFilter = event.currentTarget.value;
    state.materialPageIndex = 0;
    rerenderAudit();
  });
  document.querySelector('#materialUnitFilter')?.addEventListener('change', (event) => {
    state.materialUnitFilter = event.currentTarget.value;
    state.materialPageIndex = 0;
    rerenderAudit();
  });
  document.querySelector('#materialLotFilter')?.addEventListener('change', (event) => {
    state.materialLotFilter = event.currentTarget.value;
    state.materialPageIndex = 0;
    rerenderAudit();
  });
  bindAuditPagination();
  const rerenderMaterialDashboard = () => {
    const page = document.querySelector('#page');
    const position = window.scrollY;
    page.innerHTML = materialDashboardPage(); bindPage(); window.scrollTo(0,position);
  };
  document.querySelector('#materialDashboardSheetFilter')?.addEventListener('change', (event) => {
    state.materialDashboardSheetFilter = event.currentTarget.value;
    rerenderMaterialDashboard();
  });
  bindDateFilter('materialDashboardStartDate', (value) => { state.materialDashboardStartDate = value; rerenderMaterialDashboard(); });
  bindDateFilter('materialDashboardEndDate', (value) => { state.materialDashboardEndDate = value; rerenderMaterialDashboard(); });
  document.querySelector('#materialDashboardMetric')?.addEventListener('change', (event) => {
    state.materialDashboardMetric = event.currentTarget.value;
    rerenderMaterialDashboard();
  });
  document.querySelector('#exportBtpShortage')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const message = document.querySelector('#btpExportMessage');
    button.disabled = true;
    message.textContent = 'Đang tạo file…';
    message.className = 'btp-export-message';
    try {
      const options = auditSheetOptions();
      const selectedKeys = auditSelectedKeys(options);
      const selectedSheets = options.filter((option) => selectedKeys.has(option.key));
      const shortageRows = filteredMaterialAuditRows({ options })
        .filter((row) => row.btp)
        .map((row) => ({ ...row.btp, remaining:getBtpShortageQuantity(row.btp), shortage_weight:getBtpShortageWeight(row.btp) }))
        .filter((row) => typeof row.remaining === 'number' && row.remaining > 0);
      if (!shortageRows.length) throw new Error('Không có dòng BTP còn thiếu trong bộ lọc hiện tại.');
      const report = await exportBtpShortageWorkbook({
        rows:shortageRows,
        projectCode:state.currentProject,
        selectedSheets,
        templateUrl:new URL('./templates/List_thieu_mau.xlsx', import.meta.url),
      });
      message.textContent = `Đã tạo ${report.filename} · ${fmt(report.rowCount)} dòng BTP.`;
      message.className = 'btp-export-message success-message';
    } catch (error) {
      message.textContent = error.message;
      message.className = 'btp-export-message error-message';
    } finally {
      button.disabled = filteredMaterialAuditRows().every((row) => !row.btp || !(getBtpShortageQuantity(row.btp) > 0));
    }
  });
  const rerenderProjects = ({ restoreSearchFocus = false } = {}) => {
    const page = document.querySelector('#page');
    const position = window.scrollY;
    const search = page?.querySelector('#projectSearch');
    const selection = restoreSearchFocus && search ? search.selectionStart : null;
    if (!page) return;
    page.innerHTML = projectsPage();
    bindPage();
    if (restoreSearchFocus) {
      const nextSearch = page.querySelector('#projectSearch');
      nextSearch?.focus();
      if (selection !== null) nextSearch?.setSelectionRange(selection, selection);
    }
    window.scrollTo(0, position);
  };
  document.querySelector('#toggleMobileProjectFilters')?.addEventListener('click', (event) => {
    state.projectMobileFiltersOpen = !state.projectMobileFiltersOpen;
    const panel = document.querySelector('.project-progress-filter-panel');
    panel?.classList.toggle('mobile-expanded', state.projectMobileFiltersOpen);
    const button = event.currentTarget;
    button.setAttribute('aria-expanded', String(state.projectMobileFiltersOpen));
    button.querySelector('span')?.replaceChildren(state.projectMobileFiltersOpen ? 'Thu gọn' : 'Bộ lọc');
  });
  document.querySelector('#projectSearch')?.addEventListener('input', (event) => {
    state.projectSearch = event.currentTarget.value;
    state.projectPageIndex = 0;
    rerenderProjects({ restoreSearchFocus:true });
  });
  document.querySelector('#projectStatusFilter')?.addEventListener('change', (event) => {
    state.projectStatusFilter = event.currentTarget.value;
    state.projectPageIndex = 0;
    rerenderProjects();
  });
  document.querySelector('#projectShipmentFilter')?.addEventListener('change', (event) => {
    state.projectShipmentFilter = event.currentTarget.value;
    state.projectItemFilter = '';
    state.projectTeamFilter = '';
    state.projectPageIndex = 0;
    rerenderProjects();
  });
  document.querySelector('#projectItemFilter')?.addEventListener('change', (event) => {
    state.projectItemFilter = event.currentTarget.value;
    state.projectTeamFilter = '';
    state.projectPageIndex = 0;
    rerenderProjects();
  });
  document.querySelector('#projectTeamFilter')?.addEventListener('change', (event) => {
    state.projectTeamFilter = event.currentTarget.value;
    state.projectPageIndex = 0;
    rerenderProjects();
  });
  document.querySelector('#projectPrevPage')?.addEventListener('click', () => {
    state.projectPageIndex = Math.max(0, state.projectPageIndex - 1);
    rerenderProjects();
  });
  document.querySelector('#projectNextPage')?.addEventListener('click', () => {
    state.projectPageIndex += 1;
    rerenderProjects();
  });
  document.querySelectorAll('[data-project-detail-row]').forEach((button) => button.addEventListener('click', () => {
    const sourceRow = Number(button.dataset.projectDetailRow);
    const selectedRow = (state.progressData?.rows || []).find((row) => Number(row.source_row) === sourceRow);
    if (selectedRow) openProjectDetail(selectedRow);
  }));
  const projectExportButton = document.querySelector('#exportProjectWorkbook');
  const projectExportFile = document.querySelector('#projectExportFile');
  const projectExportMessage = document.querySelector('#projectExportMessage');
  projectExportButton?.addEventListener('click', () => projectExportFile?.click());
  projectExportFile?.addEventListener('change', async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    projectExportButton.disabled = true;
    projectExportMessage.textContent = 'Đang đọc file gốc…';
    projectExportMessage.className = 'project-export-message';
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size <= 0 || file.size > 20 * 1024 * 1024) {
        throw new Error('Chọn workbook .xlsx hợp lệ, dung lượng tối đa 20 MB.');
      }
      const fileProject = file.name.replace(/\.xlsx$/i, '').trim().toUpperCase();
      if (fileProject !== String(state.currentProject).toUpperCase()) {
        throw new Error(`Tên file phải là ${state.currentProject}.xlsx để xuất đúng dự án đang xem.`);
      }
      const ExcelJS = await loadExcelJsLibrary();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.getWorksheet('Progress');
      if (!worksheet) throw new Error(`Workbook ${file.name} không có sheet Progress.`);
      const lastColumn = Math.max(worksheet.columnCount, worksheet.columns.length);
      if (lastColumn >= 54) worksheet.spliceColumns(54, lastColumn - 53);
      [[45,1],[20,16],[3,2],[1,1]].forEach(([start, count]) => {
        if (worksheet.columnCount >= start) worksheet.spliceColumns(start, Math.min(count, worksheet.columnCount - start + 1));
      });
      const output = await workbook.xlsx.writeBuffer();
      const blob = new Blob([output], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${state.currentProject}_QLDA_da_loai_cot.xlsx`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      projectExportMessage.textContent = 'Đã xuất sheet Progress; màu sắc và định dạng gốc được giữ lại.';
      projectExportMessage.className = 'project-export-message success-message';
    } catch (error) {
      projectExportMessage.textContent = error.message;
      projectExportMessage.className = 'project-export-message error-message';
    } finally {
      projectExportButton.disabled = false;
      event.currentTarget.value = '';
    }
  });
  document.querySelector('#overviewProjectSearch')?.addEventListener('input', (event) => {
    const query = normalizeProjectSearch(event.currentTarget.value.trim());
    const cards = [...document.querySelectorAll('[data-project-card]')];
    let visible = 0;
    for (const card of cards) {
      const matches = !query || normalizeProjectSearch(card.dataset.projectSearch).includes(query);
      card.hidden = !matches;
      if (matches) visible += 1;
    }
    const count = document.querySelector('#overviewProjectCount');
    if (count) count.textContent = query ? `${visible} / ${cards.length} dự án` : `${cards.length} dự án`;
    const empty = document.querySelector('#overviewProjectEmpty');
    if (empty) empty.hidden = visible > 0;
  });
  document.querySelectorAll('[data-project]').forEach((link) => link.addEventListener('click', () => {
    if (state.currentProject !== link.dataset.project) {
      state.projectSearch = '';
      state.projectStatusFilter = '';
      state.projectShipmentFilter = '';
      state.projectItemFilter = '';
      state.projectTeamFilter = '';
      state.projectPageIndex = 0;
      state.materialLotFilter = '';
      state.materialSelectedSheets = null;
      state.materialReceiptDateFilter = '';
      state.materialUnitFilter = '';
      state.materialStatusFilter = '';
      state.materialSearch = '';
      state.materialDashboardSheetFilter = '';
      state.materialDashboardStartDate = '';
      state.materialDashboardEndDate = '';
      state.materialDashboardMetric = 'quantity';
      state.projectDashboardStartDate = '';
      state.projectDashboardEndDate = '';
      state.projectDashboardMetric = 'kg';
    }
    state.currentProject = link.dataset.project;
  }));
  document.querySelector('#viewerForm')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const output = document.querySelector('#viewerMessage');
    try { const result = await api('/api/admin/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:data.get('username'),password:data.get('password')})}); output.textContent = `Đã tạo tài khoản ${result.username}.`; output.className = 'form-message success-message'; event.currentTarget.reset(); }
    catch (error) { output.textContent = error.message; output.className = 'form-message error-message'; }
  });
  bindPlFileDeleteButtons();
  document.querySelector('#importForm')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const output = document.querySelector('#importMessage'); const button = form.querySelector('button');
  const endpoint = data.get('category') === 'materials' ? 'materials' : 'projects'; button.disabled = true; output.textContent = 'Đang kiểm tra cấu trúc và nhập dữ liệu…'; output.className = 'form-message';
    let completedMaterialRows = 0;
    let completedMaterialFiles = 0;
    let selectedMaterialFiles = 0;
    const failedMaterialFiles = [];
    let importStopReason = '';
    let unprocessedMaterialFiles = 0;
    const projectCodes = new Set();
    try {
      let result;
      if (endpoint === 'materials') {
        const files = [...form.querySelector('[name="file"]').files];
        progressState.files = files;
        progressState.statuses = files.map(() => ({ status:'pending', detail:'Chờ tải lên' }));
        renderImportProgress();
        if (!files.length) throw new Error('Hãy chọn ít nhất một file PL.xlsx.');
        selectedMaterialFiles = files.length;
        const filenames = new Set();
        for (const file of files) {
          const key = file.name.toLocaleLowerCase();
          if (filenames.has(key)) throw new Error(`Bạn đã chọn trùng tên file ${file.name}; hãy chỉ chọn một bản.`);
          filenames.add(key);
          if (file.size === 0) throw new Error(`File ${file.name} đang trống.`);
          if (file.size > MAX_MATERIAL_FILE_BYTES) throw new Error(`File ${file.name} có dung lượng ${(file.size / 1024 / 1024).toFixed(1)} MB, vượt giới hạn ${MAX_MATERIAL_FILE_MB} MB.`);
          if (!/^[\w.-]+PL\.xlsx$/i.test(file.name)) throw new Error(`Tên file ${file.name} phải kết thúc bằng PL.xlsx, ví dụ M304PL.xlsx.`);
          projectCodes.add(projectCodeFromFilename(file.name, 'materials'));
        }
        output.textContent = 'Đang tải thư viện đọc Excel…';
        const xlsx = await loadSpreadsheetLibrary();
        for (const [fileIndex, file] of files.entries()) {
          try {
            setImportProgress(fileIndex, 'working', `Đang đọc file ${fileIndex + 1}/${files.length}`);
            output.textContent = `Đang đọc file ${fileIndex + 1}/${files.length}: ${file.name}…`;
            const projectCode = projectCodeFromFilename(file.name, 'materials');
            const payload = await readMaterialWorkbook(file, projectCode, xlsx);
            output.textContent = `Đang đọc file ${fileIndex + 1}/${files.length}: ${payload.filename} (${payload.records.length.toLocaleString('vi-VN')} dòng PL, ${payload.btp_records.length.toLocaleString('vi-VN')} dòng BTP)…`;
            for (const [category, categoryRecords] of [['materials', payload.records], ['btp', payload.btp_records]]) {
              const categoryLabel = category === 'btp' ? 'BTP' : 'PL';
              setImportProgress(fileIndex, 'working', `Đang tải ${categoryLabel}: 0/${categoryRecords.length.toLocaleString('vi-VN')} dòng`);
              if (!categoryRecords.length) {
                await api('/api/admin/import/materials', {
                  method: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ action: 'clear-category', category, project_code: payload.project_code, filename: payload.filename }),
                });
                setImportProgress(fileIndex, 'working', `${categoryLabel} đã cập nhật · không có dòng`);
                continue;
              }
              output.textContent = `Đang nhập ${categoryLabel} · ${payload.filename} (${categoryRecords.length.toLocaleString('vi-VN')} dòng)…`;
              const importSession = await api('/api/admin/import/materials', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'begin', category, project_code: payload.project_code, filename: payload.filename, expected_rows: categoryRecords.length }),
              });
              try {
                const chunkSize = importSession.chunk_size;
                let start = 0;
                while (start < categoryRecords.length) {
                  let rowCount = Math.min(chunkSize, categoryRecords.length - start);
                  let records = categoryRecords.slice(start, start + rowCount);
                  let chunkBody = JSON.stringify({ action: 'chunk', import_id: importSession.import_id, start_row: start, records });
                  while (new TextEncoder().encode(chunkBody).byteLength > 512 * 1024 && rowCount > 1) {
                    rowCount = Math.max(1, Math.floor(rowCount / 2));
                    records = categoryRecords.slice(start, start + rowCount);
                    chunkBody = JSON.stringify({ action: 'chunk', import_id: importSession.import_id, start_row: start, records });
                  }
                  if (new TextEncoder().encode(chunkBody).byteLength > 512 * 1024) {
                    throw new Error(`Dòng ${start + 1} quá lớn để tải an toàn; dữ liệu hiện hành chưa bị thay đổi.`);
                  }
                  await api('/api/admin/import/materials', {
                    method: 'POST', headers: { 'content-type': 'application/json' }, body: chunkBody,
                  });
                  output.textContent = `${category === 'btp' ? 'BTP' : 'PL'} · ${payload.filename}: ${Math.min(start + records.length, categoryRecords.length).toLocaleString('vi-VN')}/${categoryRecords.length.toLocaleString('vi-VN')} dòng…`;
                  start += records.length;
                  setImportProgress(fileIndex, 'working', `Đang tải ${categoryLabel}: ${start.toLocaleString('vi-VN')}/${categoryRecords.length.toLocaleString('vi-VN')} dòng`);
                }
                const commitRequest = {
                  method: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ action: 'commit', import_id: importSession.import_id }),
                };
                try { result = await api('/api/admin/import/materials', commitRequest); }
                catch (commitError) {
                  try { result = await api('/api/admin/import/materials', commitRequest); }
                  catch { throw commitError; }
                }
              } catch (error) {
                try {
                  await api('/api/admin/import/materials', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ action: 'abort', import_id: importSession.import_id }),
                  });
                } catch { /* Expired imports are cleaned up automatically. */ }
                throw error;
              }
              completedMaterialRows += result.imported_rows;
              setImportProgress(fileIndex, 'working', `${categoryLabel} đã tải xong · ${categoryRecords.length.toLocaleString('vi-VN')} dòng`);
            }
            completedMaterialFiles += 1;
            setImportProgress(fileIndex, 'complete', `Đã tải xong PL và BTP · ${payload.records.length.toLocaleString('vi-VN')} PL + ${payload.btp_records.length.toLocaleString('vi-VN')} BTP`);
          } catch (error) {
            failedMaterialFiles.push({ filename: file.name, message: error.message || 'Lỗi không xác định' });
            setImportProgress(fileIndex, 'error', `Lỗi: ${error.message || 'Không xác định'}`);
            if (error.status === 429) {
              importStopReason = error.message;
              unprocessedMaterialFiles = files.length - fileIndex - 1;
              for (let nextIndex = fileIndex + 1; nextIndex < files.length; nextIndex += 1) {
                setImportProgress(nextIndex, 'pending', 'Chưa gửi · dừng theo giới hạn API');
              }
              break;
            }
          }
        }
        result = { project_code: [...projectCodes].join(', '), imported_rows: completedMaterialRows };
      } else {
        const files = [...form.querySelector('[name="file"]').files];
        progressState.files = files;
        progressState.statuses = files.map(() => ({ status:'pending', detail:'Chờ tải lên' }));
        renderImportProgress();
        if (files.length !== 1) throw new Error('QLDA chỉ hỗ trợ chọn một file mỗi lần.');
        if (files[0].size === 0 || files[0].size > 10 * 1024 * 1024) throw new Error('File QLDA phải có dung lượng từ 1 byte đến 10 MB.');
        const file = files[0];
        const projectCode = projectCodeFromFilename(file.name, 'projects');
        projectCodes.add(projectCode);
        output.textContent = 'Đang tải thư viện đọc Excel…';
        const xlsx = await loadSpreadsheetLibrary();
        setImportProgress(0, 'working', 'Đang đọc sheet Progress');
        output.textContent = `Đang đọc sheet Progress trong ${file.name}…`;
        const records = await readProjectWorkbook(file, xlsx);
        setImportProgress(0, 'working', `Đã đọc ${records.length.toLocaleString('vi-VN')} dòng · bắt đầu tải`);
        const importSession = await api('/api/admin/import/projects', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'begin', filename: file.name, project_code: projectCode, expected_rows: records.length }),
        });
        try {
          let start = 0;
          while (start < records.length) {
            let rowCount = Math.min(importSession.chunk_size, records.length - start);
            let chunkRecords = records.slice(start, start + rowCount);
            let chunkBody = JSON.stringify({ action: 'chunk', import_id: importSession.import_id, start_row: start, records: chunkRecords });
            while (new TextEncoder().encode(chunkBody).byteLength > 512 * 1024 && rowCount > 1) {
              rowCount = Math.max(1, Math.floor(rowCount / 2));
              chunkRecords = records.slice(start, start + rowCount);
              chunkBody = JSON.stringify({ action: 'chunk', import_id: importSession.import_id, start_row: start, records: chunkRecords });
            }
            if (new TextEncoder().encode(chunkBody).byteLength > 512 * 1024) {
              throw new Error(`Dòng QLDA ${start + 1} quá lớn để tải an toàn; dữ liệu hiện hành chưa bị thay thế.`);
            }
            await api('/api/admin/import/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: chunkBody });
            start += chunkRecords.length;
            output.textContent = `QLDA · ${file.name}: ${start.toLocaleString('vi-VN')}/${records.length.toLocaleString('vi-VN')} dòng…`;
            setImportProgress(0, 'working', `Đang tải QLDA: ${start.toLocaleString('vi-VN')}/${records.length.toLocaleString('vi-VN')} dòng`);
          }
          const commitRequest = {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'commit', import_id: importSession.import_id }),
          };
          try { result = await api('/api/admin/import/projects', commitRequest); }
          catch (commitError) {
            try { result = await api('/api/admin/import/projects', commitRequest); }
            catch { throw commitError; }
          }
        } catch (error) {
          try {
            await api('/api/admin/import/projects', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'abort', import_id: importSession.import_id }),
            });
          } catch { /* Expired imports are cleaned up automatically. */ }
          throw error;
        }
        setImportProgress(0, 'complete', `Đã tải xong QLDA · ${records.length.toLocaleString('vi-VN')} dòng`);
      }
      if (endpoint === 'materials' && failedMaterialFiles.length) {
        const failedSummary = failedMaterialFiles.map(({ filename, message }) => `• ${filename}: ${message}`).join('\n');
        const stoppedSummary = importStopReason
          ? `\n${importStopReason}${unprocessedMaterialFiles ? ` Còn ${unprocessedMaterialFiles} file chưa gửi.` : ''} Danh sách file vẫn được giữ để thử lại sau.`
          : '\nCác file lỗi vẫn còn được chọn để thử lại.';
        output.textContent = `Đã nhập ${result.imported_rows.toLocaleString('vi-VN')} dòng; hoàn tất đủ dữ liệu PL/BTP cho ${completedMaterialFiles}/${selectedMaterialFiles} file.\n${failedSummary}${stoppedSummary}`;
        output.style.whiteSpace = 'pre-line';
        output.className = 'form-message error-message';
      } else {
        output.textContent = `Đã nhập ${result.imported_rows.toLocaleString('vi-VN')} dòng${endpoint === 'materials' ? ` PL/BTP từ ${form.querySelector('[name="file"]').files.length} file` : ''} cho dự án ${result.project_code}.`;
        output.style.whiteSpace = '';
        output.className = 'form-message success-message';
        form.reset(); updateImportFileMode(); updateImportProjectPreview();
      }
      if (endpoint === 'materials' && (completedMaterialRows || !failedMaterialFiles.length)) { await Promise.all([refreshProjects(), refreshPlFiles()]); const list = document.querySelector('#plFileList'); if (list) list.innerHTML = plFilesMarkup(); bindPlFileDeleteButtons(); }
      else await refreshProjects();
    }
    catch (error) {
      progressState.statuses = progressState.statuses.map((item) => item.status === 'complete'
        ? item : { status:'error', detail:`Không hoàn tất: ${error.message || 'Lỗi không xác định'}` });
      renderImportProgress();
      output.textContent = completedMaterialRows
        ? `Đã nhập ${completedMaterialRows.toLocaleString('vi-VN')} dòng từ ${completedMaterialFiles}/${selectedMaterialFiles} file trước khi gặp lỗi: ${error.message}`
        : error.message;
      output.className = 'form-message error-message';
      if (completedMaterialRows) {
        await Promise.all([refreshProjects(), refreshPlFiles()]).catch(() => {});
        const list = document.querySelector('#plFileList');
        if (list) { list.innerHTML = plFilesMarkup(); bindPlFileDeleteButtons(); }
      }
    }
    finally {
      for (const projectCode of projectCodes) invalidateProjectData(projectCode);
      button.disabled = false;
    }
  });
}
async function refreshProjects() { const result = await api('/api/projects'); state.projects = result.projects; }
async function refreshPlFiles() {
  if (state.user?.role !== 'admin') { state.plFiles = []; return; }
  const result = await api('/api/admin/pl-files');
  state.plFiles = result.files;
}
function invalidateProjectData(projectCode) {
  state.projectDashboardData = null;
  state.projectDashboardDataKey = '';
  if (state.loadedProject !== projectCode) return;
  state.data = null;
  state.btpData = null;
  state.progressData = null;
  state.auditDataCache = null;
  state.materialLotFilter = '';
}
function resetProjectData(projectCode) {
  if (state.loadedProject !== projectCode) {
    state.materialPrintSelectedGroups.clear();
    state.materialExpandedGroups.clear();
  }
  state.loadedProject = projectCode;
  state.data = null;
  state.btpData = null;
  state.progressData = null;
  state.auditDataCache = null;
  state.materialLotFilter = '';
}
async function loadProjectDataField(projectCode, field, endpoint) {
  if (state[field]) return;
  const key = `${projectCode}:${field}`;
  let request = projectDataRequests.get(key);
  if (!request) {
    request = api(`/api/projects/${encodeURIComponent(projectCode)}/${endpoint}`)
      .finally(() => projectDataRequests.delete(key));
    projectDataRequests.set(key, request);
  }
  const result = await request;
  if (state.currentProject === projectCode && state.loadedProject === projectCode && !state[field]) {
    state[field] = result;
    state.auditDataCache = null;
  }
}
async function loadProjectDashboardData() {
  const projects = projectsForData('all');
  const progressCodes = projects.filter((project) => Number(project.progress_rows || 0) > 0).map((project) => project.code);
  const btpCodes = projects.filter((project) => Number(project.btp_rows || 0) > 0).map((project) => project.code);
  const key = `${progressCodes.join('|')}::${btpCodes.join('|')}`;
  if (!progressCodes.length && !btpCodes.length) {
    state.projectDashboardData = { rows:[], btpSummaries:[] };
    state.projectDashboardDataKey = key;
    return;
  }
  if (state.projectDashboardData && state.projectDashboardDataKey === key) return;
  let request = projectDashboardRequests.get(key);
  if (!request) {
    const progressQuery = new URLSearchParams();
    progressCodes.forEach((code) => progressQuery.append('project', code));
    const btpQuery = new URLSearchParams();
    btpCodes.forEach((code) => btpQuery.append('project', code));
    const progressRequest = progressCodes.length ? api(`/api/projects/progress?${progressQuery.toString()}`) : Promise.resolve({ rows:[] });
    const btpRequest = btpCodes.length ? api(`/api/projects/btp-summary?${btpQuery.toString()}`) : Promise.resolve({ summaries:[] });
    request = Promise.all([progressRequest, btpRequest])
      .then(([progressResult, btpResult]) => ({ rows:progressResult.rows || [], btpSummaries:btpResult.summaries || [] }))
      .finally(() => projectDashboardRequests.delete(key));
    projectDashboardRequests.set(key, request);
  }
  const result = await request;
  const currentProjects = projectsForData('all');
  const currentProgressCodes = currentProjects.filter((project) => Number(project.progress_rows || 0) > 0).map((project) => project.code);
  const currentBtpCodes = currentProjects.filter((project) => Number(project.btp_rows || 0) > 0).map((project) => project.code);
  if (`${currentProgressCodes.join('|')}::${currentBtpCodes.join('|')}` === key) {
    state.projectDashboardData = result;
    state.projectDashboardDataKey = key;
  }
}
async function loadPageData() {
  if (state.page === 'projects-dashboard') {
    await loadProjectDashboardData();
    return;
  }
  if (!state.currentProject || !['materials','materials-dashboard','projects'].includes(state.page)) return;
  const projectCode = state.currentProject;
  if (state.loadedProject !== projectCode) resetProjectData(projectCode);
  const fields = state.page === 'materials'
    ? [['data','materials'], ['btpData','btp'], ['progressData','progress']]
    : state.page === 'materials-dashboard' ? [['btpData','btp']] : [['progressData','progress']];
  await Promise.all(fields.map(([field, endpoint]) => loadProjectDataField(projectCode, field, endpoint)));
}
async function renderPage() {
  const generation = ++renderGeneration;
  const page = document.querySelector('#page'); if (!page) return;
  page.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Đang tải dữ liệu…</p></div>';
  try {
    if (state.page === 'overview') page.innerHTML = overviewPage();
    else if (['materials','materials-dashboard','projects-dashboard','projects'].includes(state.page)) {
      const availableProjects = ['projects','projects-dashboard'].includes(state.page)
        ? projectsForData('progress')
        : ['materials','materials-dashboard'].includes(state.page) ? projectsForData('materials') : state.projects;
      if (!availableProjects.some((project) => project.code === state.currentProject)) {
        state.currentProject = availableProjects[0]?.code || '';
      }
      await loadPageData();
      if (generation !== renderGeneration) return;
      page.innerHTML = state.page === 'materials' ? materialsAuditPage() : state.page === 'materials-dashboard' ? materialDashboardPage() : state.page === 'projects-dashboard' ? projectDashboardPage() : projectsPage();
    } else {
      await refreshPlFiles();
      if (generation !== renderGeneration) return;
      page.innerHTML = adminPage();
    }
    bindPage();
  } catch (error) {
    if (generation === renderGeneration) page.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
  }
}
async function navigate() {
  if (ADMIN_MODE) {
    if (state.user?.role !== 'admin') { loginScreen(); return; }
    const key = location.hash.replace(/^#\/?/, '') || 'admin';
    state.page = ['overview','materials','materials-dashboard','projects-dashboard','projects','admin'].includes(key) ? key : 'admin';
    shell(); await renderPage();
    return;
  }
  const key = location.hash.replace(/^#\/?/, '') || 'overview';
  state.page = ['overview','materials','materials-dashboard','projects-dashboard','projects'].includes(key) ? key : 'overview';
  shell(); await renderPage();
}
async function logout() {
  try { await api('/api/auth/logout',{method:'POST'}); } finally {
    sessionStorage.removeItem('amecc-session-token'); state.user = null; state.plFiles = [];
    await refreshProjects().catch(() => {});
    if (ADMIN_MODE) loginScreen();
    else await navigate();
  }
}
async function initializeWorkspace() {
  await refreshProjects();
  await navigate();
}
async function start() {
  if (!API_BASE || API_BASE.includes('REPLACE_WITH')) {
    app.innerHTML = `<main class="auth-screen"><section class="auth-card"><div class="auth-logo"><img src="./assets/logo.png" alt="AMECC"></div><h1>Chưa cấu hình dữ liệu</h1><p>Cần cấu hình địa chỉ API trong public/config.js để tải dữ liệu dự án.</p></section></main>`;
    return;
  }
  if (ADMIN_MODE) {
    try {
      const result = await api('/api/auth/me');
      state.user = result.user?.role === 'admin' ? result.user : null;
      if (!state.user) sessionStorage.removeItem('amecc-session-token');
    } catch { state.user = null; }
    if (!state.user) { loginScreen(); return; }
  }
  try { await initializeWorkspace(); }
  catch (error) { app.innerHTML = `<main class="auth-screen"><section class="auth-card"><div class="auth-logo"><img src="./assets/logo.png" alt="AMECC"></div><h1>Không tải được dữ liệu</h1><p>${esc(error.message)}</p><button class="button primary" onclick="location.reload()">Thử lại</button></section></main>`; }
}
window.addEventListener('hashchange', () => navigate());
start();

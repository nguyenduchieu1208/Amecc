const API_BASE = String(window.AMECC_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
const ADMIN_MODE = /(?:^|\/)admin\.html$/.test(window.location.pathname);
import { MAX_MATERIAL_FILE_BYTES, MAX_MATERIAL_FILE_MB, projectCodeFromFilename, readMaterialWorkbook } from './material-import.js';
import { getBtpShortageQuantity, getBtpShortageWeight, highlightMatch } from './material-search.js';
import { formatMaterialDate } from './material-display.js';
import { exportBtpShortageWorkbook, filterBtpRowsByReceiptDate } from './shortage-export.js';
import { renderMaterialDashboard } from './material-dashboard.js';
import { buildMaterialAuditRows, hasBtpIdentity, isPurchasingMaterialSheet, materialAuditRowSearchText, materialSheetKey, materialSheetName } from './material-linkage.js';
const app = document.querySelector('#app');
const themes = ['light','midnight','paper','ocean','emerald','violet','graphite','sunset'];
const themeLabels = { light:'Sáng tối giản', midnight:'Midnight', paper:'Giấy ấm', ocean:'Đại dương', emerald:'Ngọc lục bảo', violet:'Tím hiện đại', graphite:'Than chì', sunset:'Hoàng hôn' };
const savedTheme = localStorage.getItem('amecc-theme') || 'light';
const state = { user: null, projects: [], plFiles: [], currentProject: '', materialSelectedSheets: null, materialReceiptDateFilter: '', materialUnitFilter: '', materialStatusFilter: '', materialSearch: '', materialPageIndex: 0, materialMobileFiltersOpen: false, materialDashboardSheetFilter: '', materialDashboardStartDate: '', materialDashboardEndDate: '', materialDashboardMetric: 'quantity', page: 'overview', theme: themes.includes(savedTheme) ? savedTheme : 'light', sidebarCollapsed: localStorage.getItem('amecc-sidebar-collapsed') === 'true', data: null, btpData: null, progressData: null, loading: false };
const labels = {
  project_code: 'Dự án', item: 'Hạng mục', mh: 'MH', wo_date: 'Ngày WO', product_type: 'Dạng SP', classification: 'Phân loại', allocation: 'Phân giao', drawing: 'Bản vẽ', part_no: 'Số chi tiết', size: 'Size', quantity: 'T’Qty', unit_weight: 'U.Weight', btp_unit_weight: 'U.Weight (kg/chi tiết)', total_weight: 'T.Weight', profile: 'Profile', item_id: 'ID', note: 'Ghi chú', fitup_date: 'Ngày gá', fitup_qty: 'SL gá', fitup_weight: 'KL gá', welding_date: 'Ngày hàn', welding_qty: 'SL hàn', welding_weight: 'KL hàn', trial_assembly_date: 'Ngày tổ hợp', trial_assembly_qty: 'SL tổ hợp', trial_assembly_weight: 'KL tổ hợp', acceptance_date: 'Ngày nghiệm thu', acceptance_qty: 'SL nghiệm thu', acceptance_weight: 'KL nghiệm thu', handover_date: 'Ngày bàn giao', handover_qty: 'SL bàn giao', handover_weight: 'KL bàn giao', receiver: 'Đơn vị nhận', record_no: 'Số biên bản', assembly: 'Cụm lắp ráp', description: 'Mô tả', scope: 'Phạm vi công việc', weight: 'Khối lượng', received: 'Đã nhận', remaining: 'Còn thiếu', as_symbol: 'AS Symbol', delivery_date: 'Ngày nhận', issue_dates: 'Ngày trên biên bản', parent: 'Cấu kiện chính', material_type: 'Chủng loại', material: 'Vật liệu', unit: 'Đơn vị giao (DVG)', shortage_rows: 'Dòng còn thiếu', part_count: 'Số mã BTP', shortage_quantity: 'SL còn thiếu', shortage_weight: 'Khối lượng thiếu (kg)', weight_missing_rows: 'Dòng thiếu U.Weight', daily_progress: 'Lịch nhận · ngày: số lượng', status: 'Trạng thái', source_file: 'File nguồn', source_sheet: 'Sheet', source_row: 'Dòng nguồn', is_main: 'Cấu kiện chính', material_rows: 'Dòng vật tư', progress_rows: 'Dòng tiến độ', updated_at: 'Cập nhật',
};
const progressColumns = ['item','mh','wo_date','product_type','classification','allocation','drawing','part_no','size','quantity','unit_weight','total_weight','profile','item_id','note','fitup_date','fitup_qty','fitup_weight','welding_date','welding_qty','welding_weight','trial_assembly_date','trial_assembly_qty','trial_assembly_weight','acceptance_date','acceptance_qty','acceptance_weight','handover_date','handover_qty','handover_weight','receiver','record_no'];
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]); }
function fmt(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
  return esc(value);
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
    chevron:'<path d="m9 18 6-6-6-6"/>', menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>', download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.overview}</svg>`;
}
async function api(path, options = {}) {
  if (!API_BASE || API_BASE.includes('REPLACE_WITH')) throw new Error('Chưa cấu hình địa chỉ Cloudflare Worker trong public/config.js.');
  const headers = new Headers(options.headers || {});
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
function currentPageTitle() { return ({ overview:'Tổng quan', materials:'BOM & Vật tư PL', 'materials-dashboard':'Dashboard BOM & vật tư', projects:'Quản lý dự án', admin:'Quản trị tài khoản' })[state.page] || 'AMECC'; }
function shell() {
  const isAdmin = state.user?.role === 'admin';
  const navigation = `<div class="nav-label">KHÔNG GIAN LÀM VIỆC</div>
      <nav class="nav-list" aria-label="Điều hướng chính">
        <a class="nav-link ${state.page === 'overview' ? 'active' : ''}" href="#overview">${icon('overview')}<span>Tổng quan</span></a>
        <div class="nav-group ${['materials','materials-dashboard'].includes(state.page) ? 'expanded' : ''}">
          <button class="nav-parent" type="button" data-group="materials" aria-expanded="${['materials','materials-dashboard'].includes(state.page)}">${icon('materials')}<span>Quản lý vật tư</span><span class="nav-chevron">${icon('chevron')}</span></button>
          <div class="nav-children"><a class="nav-child ${state.page === 'materials-dashboard' ? 'active' : ''}" href="#materials-dashboard">Dashboard BOM &amp; vật tư</a><a class="nav-child ${state.page === 'materials' ? 'active' : ''}" href="#materials">BOM &amp; Vật tư PL</a></div>
        </div>
        <div class="nav-group ${state.page === 'projects' ? 'expanded' : ''}">
          <button class="nav-parent" type="button" data-group="projects" aria-expanded="${state.page === 'projects'}">${icon('projects')}<span>Quản lý dự án</span><span class="nav-chevron">${icon('chevron')}</span></button>
          <div class="nav-children"><a class="nav-child ${state.page === 'projects' ? 'active' : ''}" href="#projects">Tiến độ dự án</a></div>
        </div>
      </nav>
      ${isAdmin ? `<div class="nav-label admin-nav-label">QUẢN TRỊ</div><a class="nav-link ${state.page === 'admin' ? 'active' : ''}" href="${ADMIN_MODE ? '#admin' : './admin.html'}">${icon('admin')}<span>Cập nhật dữ liệu</span></a>` : ''}`;
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
        <div class="top-actions">${state.user ? `<span class="user-chip"><span class="avatar">${esc(state.user.username.slice(0,1).toUpperCase())}</span><span>${esc(state.user.username)}</span></span><button class="icon-button logout-button" id="logout" aria-label="Đăng xuất">${icon('logout')}</button>` : '<a class="button primary guest-login" href="./admin.html">Đăng nhập quản trị</a>'}</div>
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
function projectSelect() { const projects = [...state.projects].sort((left, right) => String(left.code).localeCompare(String(right.code), 'vi', { numeric:true, sensitivity:'base' })); return `<label class="filter-label">Dự án<select id="projectFilter"><option value="">Chọn dự án</option>${projects.map((project) => `<option value="${esc(project.code)}" ${state.currentProject === project.code ? 'selected' : ''}>${esc(projectFilenameLabel(project))}</option>`).join('')}</select></label>`; }
function btpReceivedQuantity(row) {
  if (typeof row.received === 'number') return Math.max(0, row.received);
  const remaining = getBtpShortageQuantity(row);
  return remaining !== null && typeof row.design_quantity === 'number' ? Math.max(0, row.design_quantity - remaining) : null;
}
function overviewPage() {
  const materialCount = state.projects.reduce((sum, project) => sum + Number(project.material_rows || 0) + Number(project.btp_rows || 0), 0);
  const progressCount = state.projects.reduce((sum, project) => sum + Number(project.progress_rows || 0), 0);
  return `${heading('AMECC · PROJECT OPERATIONS','Tổng quan vận hành','Không gian theo dõi vật tư sản xuất và tiến độ dự án từ workbook nguồn thực tế.')}
    <section class="welcome-banner"><div><span class="banner-label">XIN CHÀO, ${esc(state.user.username.toUpperCase())}</span><h3>Điều hành dự án<br><em>trên một không gian duy nhất.</em></h3><p>Dữ liệu được phân quyền theo tài khoản và cập nhật từ workbook AMECC.</p></div><div class="banner-mark">A<span>.</span></div></section>
    <div class="stats-grid">${statCard('Dự án đang quản lý',state.projects.length,'Dự án có dữ liệu đã nhập','blue')}${statCard('Dòng dữ liệu vật tư',materialCount,'Đọc từ workbook PL','red')}${statCard('Dòng tiến độ dự án',progressCount,'Đọc từ sheet Progress QLDA','green')}${statCard('Quyền truy cập',state.user.role === 'admin' ? 'Admin' : 'Viewer','Tài khoản hiện tại', 'gold')}</div>
    <div class="section-heading"><div><span class="eyebrow">PROJECT PORTFOLIO</span><h3>Danh mục dự án</h3></div><span class="count-chip">${state.projects.length} dự án</span></div>
    ${state.projects.length ? `<div class="project-grid">${[...state.projects].sort((left, right) => String(left.code).localeCompare(String(right.code), 'vi', { numeric:true, sensitivity:'base' })).map((project) => `<article class="project-card"><div class="project-card-head"><span class="project-icon">${icon('projects')}</span><span class="project-updated">${project.updated_at ? `Cập nhật ${fmt(project.updated_at).slice(0,10)}` : 'Đã đồng bộ'}</span></div><span class="eyebrow">TÊN TỪ FILE NGUỒN</span><h4>${esc(projectFilenameLabel(project))}</h4><p>Mã dự án: ${esc(project.code)} · ${esc(project.source_file || `${project.code}.xlsx`)}</p><div class="project-meta"><span>${fmt(Number(project.material_rows || 0) + Number(project.btp_rows || 0))} dòng PL/BTP</span><span>${fmt(project.progress_rows)} dòng tiến độ</span></div><div class="project-actions"><a href="#materials" data-project="${esc(project.code)}">Vật tư <span>→</span></a><a href="#projects" data-project="${esc(project.code)}">Tiến độ <span>→</span></a></div></article>`).join('')}</div>` : '<div class="empty-state"><strong>Chưa có dữ liệu dự án</strong><p>Admin cần đăng nhập và nhập workbook PL/QLDA để bắt đầu.</p></div>'}`;
}
function usableBtpRows() {
  return (state.btpData?.rows || []).filter((row) => !isPurchasingMaterialSheet(row.source_sheet)
    && hasBtpIdentity(row));
}
function auditSheetOptions() {
  const rows = usableBtpRows();
  return [...new Map(rows.filter((row) => row.source_file && row.source_sheet)
    .map((row) => {
      const source_sheet = materialSheetName(row.source_sheet);
      const key = materialSheetKey(row.source_file, source_sheet);
      return [key, { key, source_file:row.source_file, source_sheet }];
    })).values()]
    .sort((left, right) => left.source_sheet.localeCompare(right.source_sheet, 'vi', { numeric:true, sensitivity:'base' })
      || left.source_file.localeCompare(right.source_file, 'vi', { numeric:true, sensitivity:'base' }));
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
    ? [row.btp.part_no,row.btp.material_type,row.btp.description,row.btp.material,row.btp.unit,row.btp.size,row.btp.length_mm,row.btp.unit_weight,row.btp.total_weight,row.btp.design_quantity,row.btp.received,row.btp.remaining,row.btp.daily_progress,row.btp.joint_check,row.btp.status,row.btp.note,row.bomLine?.part_no,row.bomLine?.description,row.bomLine?.size]
    : [row.bomLine?.part_no,row.bomLine?.description,row.bomLine?.size];
  return values.filter((value) => value !== null && value !== undefined).join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase());
}
function auditBtpTableRowMarkup(row, query = '') {
  const btp = row.btp;
  const matched = auditDetailMatchesSearch(row, query);
  if (!btp) {
    const bomPart = row.bomLine?.part_no || '—';
    const code = query ? highlightMatch(bomPart, query) : fmt(bomPart);
    return `<tr class="btp-missing-row ${matched ? 'search-match-row' : ''}"><td class="btp-frozen-code audit-code">${code}</td><td>—</td><td>—</td><td>—</td><td class="numeric-cell">—</td><td class="numeric-cell">—</td><td class="numeric-cell">—</td><td class="numeric-cell">—</td><td><span class="muted">Chưa có ngày</span></td><td>—</td><td><span class="status-pill danger">Chưa có BTP</span></td><td>BOM chưa có dòng BTP</td></tr>`;
  }
  const remaining = getBtpShortageQuantity(btp);
  const status = btp.status || auditStatus(row);
  const materialType = String(btp.material_type || '').toLocaleLowerCase();
  const typeClass = materialType.includes('shape') ? 'shape' : materialType.includes('plate') ? 'plate' : '';
  const partLabel = btp.part_no || btp.description || '—';
  const partNo = query ? highlightMatch(partLabel, query) : fmt(partLabel);
  return `<tr class="${[remaining === 0 ? 'btp-complete-row' : '',matched ? 'search-match-row' : ''].filter(Boolean).join(' ')}"><td class="btp-frozen-code audit-code">${partNo}</td><td><span class="btp-type-chip ${typeClass}">${fmt(btp.material_type)}</span></td><td><span class="btp-unit-chip">${fmt(btp.unit)}</span></td><td>${fmt(btp.size)}</td><td class="numeric-cell">${fmt(btp.length_mm)}</td><td class="numeric-cell">${fmt(btp.design_quantity)}</td><td class="numeric-cell received-value">${fmt(btp.received)}</td><td class="numeric-cell ${remaining > 0 ? 'shortage-value' : ''}">${fmt(remaining)}</td><td class="audit-receipt-cell">${auditReceiptEvents(row)}</td><td>${fmt(btp.joint_check)}</td><td><span class="status-pill ${auditStatusClass(status)}">${esc(status)}</span></td><td class="audit-description">${fmt(btp.note || '')}</td></tr>`;
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
    ['Ghi chú', fmt(btp?.note || (btp ? '' : 'BOM chưa có dòng BTP'))],
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
  return [...groups].map(([key, groupRows]) => ({ rows:groupRows, detailRows:query ? contextByGroup.get(key) || groupRows : groupRows, query }));
}
function auditBomGroupMarkup({ rows, detailRows = rows, query = '' }) {
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
  return `<details class="bom-btp-group">
    <summary class="bom-btp-group-summary"><span class="bom-card-toggle" aria-hidden="true">›</span><span class="bom-btp-group-main"><strong>${query ? highlightMatch(assembly, query) : fmt(assembly)}</strong>${drawing}${dimensions}<small>Sheet: ${fmt(sheet)} · Gồm ${fmt(btpCount)} BTP con</small></span><span class="status-pill ${statusClass}">${esc(status)}</span><span class="bom-group-progress"><span>${fmt(receivedCount)}/${fmt(btpCount)} BTP</span><strong>${progress.toFixed(1)}%</strong><i><b style="width:${progress.toFixed(1)}%"></b></i></span>${searchPreview}</summary>
    <div class="bom-btp-table-wrap"><table class="bom-btp-table"><thead><tr><th>Mã BTP (Chi tiết)</th><th>Chủng loại</th><th>DVG</th><th>Quy cách (Size)</th><th>Chiều dài (mm)</th><th>SL thiết kế</th><th>Đã nhận</th><th>Còn thiếu</th><th>Tiến độ theo ngày</th><th>Ktra nối</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead><tbody>${detailRows.map((row) => auditBtpTableRowMarkup(row, query)).join('')}</tbody></table></div>
  </details>`;
}
function materialAuditRows() {
  return buildMaterialAuditRows({ materialRows:state.data?.rows || [], btpRows:usableBtpRows(), progressRows:state.progressData?.rows || [] });
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
    if (state.materialReceiptDateFilter && (!row.btp || !filterBtpRowsByReceiptDate([row.btp], state.materialReceiptDateFilter).length)) return false;
    if (state.materialUnitFilter && String(row.btp?.unit ?? '').trim() !== state.materialUnitFilter) return false;
    const status = auditStatus(row);
    if (state.materialStatusFilter === 'shortage' && !(getBtpShortageQuantity(row.btp) > 0)) return false;
    if (state.materialStatusFilter === 'received' && !(Number(row.btp?.received) > 0)) return false;
    if (state.materialStatusFilter === 'no-btp' && row.kind !== 'bom-only') return false;
    if (state.materialStatusFilter === 'unlinked' && row.bomStatus === 'matched' && row.qldaStatus === 'matched') return false;
    if (includeSearch && search && !materialAuditRowSearchText(row).includes(search)) return false;
    return status !== 'Không dùng';
  }).sort((left, right) => Number(right.kind === 'bom-only') - Number(left.kind === 'bom-only')
    || Number(getBtpShortageQuantity(right.btp) || 0) - Number(getBtpShortageQuantity(left.btp) || 0)
    || String(left.source_sheet || '').localeCompare(String(right.source_sheet || ''), 'vi', { numeric:true, sensitivity:'base' })
    || Number(left.btp?.source_row || left.bomLine?.source_row || 0) - Number(right.btp?.source_row || right.bomLine?.source_row || 0));
}
function materialsAuditPage() {
  const options = auditSheetOptions();
  const selected = auditSelectedKeys(options);
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
  const pageCount = Math.max(1, Math.ceil(allGroups.length / pageSize));
  state.materialPageIndex = Math.min(Math.max(0, state.materialPageIndex), pageCount - 1);
  const pageIndex = state.materialPageIndex;
  const pageGroups = allGroups.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
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
          ${projectSelect()}
          <label class="filter-label">Sheet BTP<details class="sheet-multi-select" id="materialSheetDropdown"><summary>${esc(selectedLabel)}</summary><div class="sheet-multi-menu"><label class="sheet-check-option sheet-check-all"><input type="checkbox" data-material-sheet-all ${allSelected ? 'checked' : ''}><span>Chọn tất cả</span><small>${options.length} sheet</small></label>${sheetOptionsMarkup || '<p class="muted">Chưa có sheet BTP</p>'}</div></details></label>
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
    <div class="section-heading audit-table-heading"><div><span class="eyebrow">BTP · BÁN THÀNH PHẨM</span><h3>BTP trong BOM <span class="muted-count">${fmt(visibleRows.length)}</span></h3></div><span class="count-chip">${allGroups.length ? `${pageIndex * pageSize + 1}–${Math.min((pageIndex + 1) * pageSize, allGroups.length)} / ${fmt(allGroups.length)} cấu kiện` : '0 cấu kiện'}</span></div>
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
  return `${heading('MATERIAL DASHBOARD · BOM & VẬT TƯ','Dashboard BOM & vật tư','Chọn sheet, khoảng ngày và đơn vị đo; rê chuột lên biểu đồ để xem số liệu chi tiết.',projectSelect())}
    <div class="audit-dashboard-filter"><label class="filter-label">Sheet dashboard<select id="materialDashboardSheetFilter"><option value="">Tất cả sheet (${options.length})</option>${options.map((option) => `<option value="${esc(option.key)}" ${option.key === state.materialDashboardSheetFilter ? 'selected' : ''}>${esc(option.source_sheet)} · ${esc(option.source_file)}</option>`).join('')}</select></label><label class="filter-label">Từ ngày<input type="date" id="materialDashboardStartDate" value="${esc(state.materialDashboardStartDate)}"></label><label class="filter-label">Đến ngày<input type="date" id="materialDashboardEndDate" value="${esc(state.materialDashboardEndDate)}"></label><label class="filter-label">Đơn vị biểu đồ<select id="materialDashboardMetric"><option value="quantity" ${state.materialDashboardMetric === 'quantity' ? 'selected' : ''}>Số lượng BTP</option><option value="kg" ${state.materialDashboardMetric === 'kg' ? 'selected' : ''}>Khối lượng · kg</option><option value="ton" ${state.materialDashboardMetric === 'ton' ? 'selected' : ''}>Khối lượng · tấn</option></select></label><span class="source-chip">Nguồn: ${esc(rows[0]?.source_file || `${state.currentProject}PL.xlsx`)}</span></div>
    <div class="stats-grid compact audit-dashboard-stats">${statCard('Dòng BTP',selectedRows.length,selectedLabel)}${statCard('Đã nhận',selectedRows.reduce((sum, row) => sum + (btpReceivedQuantity(row) || 0), 0),'Cộng từ các sheet đang xem','green')}${statCard('Còn thiếu',selectedRows.reduce((sum, row) => sum + (getBtpShortageQuantity(row) || 0), 0),'Theo cột Còn thiếu','red')}${statCard('Đơn vị giao',new Set(selectedRows.map((row) => row.unit).filter(Boolean)).size,'Theo DVG trong file BTP')}</div>
    ${renderMaterialDashboard(selectedRows, selectedLabel, chartRange)}`;
}
function projectsPage() {
  const rows = state.data?.rows || [];
  const query = document.querySelector('#projectSearch')?.value.trim().toLowerCase() || '';
  const filtered = rows.filter((row) => !query || [row.item,row.drawing,row.part_no,row.profile,row.note].some((value) => String(value || '').toLowerCase().includes(query)));
  const completed = rows.filter((row) => row.handover_qty != null && row.quantity != null && Number(row.handover_qty) >= Number(row.quantity)).length;
  const columns = progressColumns;
  return `${heading('PROJECT DELIVERY · QLDA','Quản lý tiến độ dự án','Theo dõi khối lượng theo hạng mục, cấu kiện và từng công đoạn sản xuất.',projectSelect())}
    <div class="filter-toolbar"><label class="search-box">${icon('search')}<input id="projectSearch" placeholder="Tìm hạng mục, bản vẽ, mã cấu kiện…" value="${esc(query)}"></label><span class="source-chip">Nguồn: sheet Progress · header hàng 3 · dữ liệu từ hàng 4</span></div>
    <div class="stats-grid compact">${statCard('Dòng tiến độ',rows.length,'Bản ghi trong workbook')}${statCard('Đã bàn giao',completed,'Theo SL bàn giao / T’Qty','green')}${statCard('Đang có dữ liệu',rows.filter((row) => row.fitup_qty != null || row.welding_qty != null || row.trial_assembly_qty != null).length,'Có ghi nhận sản xuất','gold')}${statCard('File nguồn',new Set(rows.map((row) => row.source_file)).size,'Workbook QLDA')}</div>
    <div class="section-heading"><div><span class="eyebrow">PROJECT PROGRESS</span><h3>Bảng tiến độ <span class="muted-count">${filtered.length.toLocaleString('vi-VN')}</span></h3></div></div>
    <div class="table-panel">${tableMarkup(filtered,columns,{limit:500})}</div><p class="footnote">Các cột đã loại khỏi báo cáo không được gửi tới trình duyệt. Cột AG–AI không đưa vào dữ liệu hiển thị.</p>`;
}
function adminPage() {
  return `${heading('ACCESS CONTROL · ADMIN','Quản trị tài khoản & dữ liệu','Tạo tài khoản chỉ xem và nhập dữ liệu thực từ workbook trên máy tính của bạn.')}
    <div class="admin-grid"><section class="panel"><div class="panel-title"><span class="eyebrow">USER ACCESS</span><h3>Tạo tài khoản người xem</h3><p>Tài khoản viewer chỉ có quyền đọc dữ liệu; không thể tải hoặc thay thế dữ liệu.</p></div><form id="viewerForm" class="form-grid"><label>Tên đăng nhập<input name="username" minlength="3" maxlength="64" required></label><label>Mật khẩu tạm (ít nhất 12 ký tự)<input name="password" type="password" minlength="12" required></label><button class="button primary" type="submit">Tạo tài khoản viewer</button><div class="form-message" id="viewerMessage" aria-live="polite"></div></form></section>
    <section class="panel"><div class="panel-title"><span class="eyebrow">WORKBOOK IMPORT</span><h3>Nạp dữ liệu từ máy tính</h3><p>PL và BTP được phân tích trên trình duyệt rồi gửi JSON; có thể chọn nhiều file PL. Tải file trùng tên sẽ thay thế dữ liệu cũ cùng file.</p></div><form id="importForm" class="form-grid"><label>Loại dữ liệu<select name="category"><option value="materials">Vật tư PL + BTP</option><option value="projects">Tiến độ QLDA</option></select></label><label class="file-picker">Chọn file Excel<input name="file" type="file" accept=".xlsx" required><small id="importFileHint">Chọn một hoặc nhiều file PL, tên mỗi file kết thúc bằng PL.xlsx; tối đa ${MAX_MATERIAL_FILE_MB} MB/file.</small></label><div class="form-message import-project-preview" id="importProjectPreview" aria-live="polite">Mã dự án sẽ lấy từ tên file.</div><button class="button primary" type="submit">${icon('upload')}<span>Kiểm tra &amp; nhập dữ liệu</span></button><div class="form-message" id="importMessage" aria-live="polite"></div></form></section></div>
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
function bindPage() {
  const importCategory = document.querySelector('#importForm select[name="category"]');
  const importFile = document.querySelector('#importForm input[name="file"]');
  const importFileHint = document.querySelector('#importFileHint');
  const importProjectPreview = document.querySelector('#importProjectPreview');
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
  importCategory?.addEventListener('change', updateImportFileMode);
  importFile?.addEventListener('change', updateImportProjectPreview);
  updateImportFileMode();
  document.querySelector('#projectFilter')?.addEventListener('change', async (event) => {
    state.currentProject = event.target.value;
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
    await loadPageData(); renderPage();
  });
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
  document.querySelector('#materialDashboardStartDate')?.addEventListener('change', (event) => {
    state.materialDashboardStartDate = event.currentTarget.value;
    rerenderMaterialDashboard();
  });
  document.querySelector('#materialDashboardEndDate')?.addEventListener('change', (event) => {
    state.materialDashboardEndDate = event.currentTarget.value;
    rerenderMaterialDashboard();
  });
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
  document.querySelector('#projectSearch')?.addEventListener('input', () => { const page = document.querySelector('#page'); const position = window.scrollY; page.innerHTML = projectsPage(); bindPage(); window.scrollTo(0,position); });
  document.querySelectorAll('[data-project]').forEach((link) => link.addEventListener('click', () => {
    if (state.currentProject !== link.dataset.project) {
      state.materialSelectedSheets = null;
      state.materialReceiptDateFilter = '';
      state.materialUnitFilter = '';
      state.materialStatusFilter = '';
      state.materialSearch = '';
      state.materialDashboardSheetFilter = '';
      state.materialDashboardStartDate = '';
      state.materialDashboardEndDate = '';
      state.materialDashboardMetric = 'quantity';
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
        const xlsx = window.XLSX;
        if (!xlsx) throw new Error('Không tải được thư viện đọc Excel; hãy tải lại trang rồi thử lại.');
        const files = [...form.querySelector('[name="file"]').files];
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
        for (const [fileIndex, file] of files.entries()) {
          try {
            output.textContent = `Đang đọc file ${fileIndex + 1}/${files.length}: ${file.name}…`;
            const projectCode = projectCodeFromFilename(file.name, 'materials');
            const payload = await readMaterialWorkbook(file, projectCode, xlsx);
            output.textContent = `Đang đọc file ${fileIndex + 1}/${files.length}: ${payload.filename} (${payload.records.length.toLocaleString('vi-VN')} dòng PL, ${payload.btp_records.length.toLocaleString('vi-VN')} dòng BTP)…`;
            for (const [category, categoryRecords] of [['materials', payload.records], ['btp', payload.btp_records]]) {
              if (!categoryRecords.length) {
                await api('/api/admin/import/materials', {
                  method: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ action: 'clear-category', category, project_code: payload.project_code, filename: payload.filename }),
                });
                continue;
              }
              output.textContent = `Đang nhập ${category === 'btp' ? 'BTP' : 'PL'} · ${payload.filename} (${categoryRecords.length.toLocaleString('vi-VN')} dòng)…`;
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
            }
            completedMaterialFiles += 1;
          } catch (error) {
            failedMaterialFiles.push({ filename: file.name, message: error.message || 'Lỗi không xác định' });
            if (error.status === 429) {
              importStopReason = error.message;
              unprocessedMaterialFiles = files.length - fileIndex - 1;
              break;
            }
          }
        }
        result = { project_code: [...projectCodes].join(', '), imported_rows: completedMaterialRows };
      } else {
        const files = [...form.querySelector('[name="file"]').files];
        if (files.length !== 1) throw new Error('QLDA chỉ hỗ trợ chọn một file mỗi lần.');
        if (files[0].size === 0 || files[0].size > 10 * 1024 * 1024) throw new Error('File QLDA phải có dung lượng từ 1 byte đến 10 MB.');
        projectCodes.add(projectCodeFromFilename(files[0].name, 'projects'));
        result = await api(`/api/admin/import/${endpoint}`,{method:'POST',body:data});
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
    finally { button.disabled = false; }
  });
}
async function refreshProjects() { const result = await api('/api/projects'); state.projects = result.projects; }
async function refreshPlFiles() {
  if (state.user?.role !== 'admin') { state.plFiles = []; return; }
  const result = await api('/api/admin/pl-files');
  state.plFiles = result.files;
}
async function loadPageData() {
  state.data = null;
  state.btpData = null;
  state.progressData = null;
  if (!state.currentProject || !['materials','materials-dashboard','projects'].includes(state.page)) return;
  if (['materials','materials-dashboard'].includes(state.page)) {
    [state.data, state.btpData, state.progressData] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(state.currentProject)}/materials`),
      api(`/api/projects/${encodeURIComponent(state.currentProject)}/btp`),
      api(`/api/projects/${encodeURIComponent(state.currentProject)}/progress`),
    ]);
    return;
  }
  state.data = await api(`/api/projects/${encodeURIComponent(state.currentProject)}/progress`);
}
async function renderPage() {
  const page = document.querySelector('#page'); if (!page) return;
  page.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Đang tải dữ liệu…</p></div>';
  try {
    if (state.page === 'overview') page.innerHTML = overviewPage();
    else if (['materials','materials-dashboard','projects'].includes(state.page)) {
      if (!state.currentProject && state.projects.length) state.currentProject = state.projects[0].code;
      await loadPageData();
      page.innerHTML = state.page === 'materials' ? materialsAuditPage() : state.page === 'materials-dashboard' ? materialDashboardPage() : projectsPage();
    } else {
      await refreshPlFiles();
      page.innerHTML = adminPage();
    }
    bindPage();
  } catch (error) { page.innerHTML = `<div class="notice error">${esc(error.message)}</div>`; }
}
async function navigate() {
  if (ADMIN_MODE) {
    if (state.user?.role !== 'admin') { loginScreen(); return; }
    const key = location.hash.replace(/^#\/?/, '') || 'admin';
    state.page = ['overview','materials','materials-dashboard','projects','admin'].includes(key) ? key : 'admin';
    shell(); await renderPage();
    return;
  }
  const key = location.hash.replace(/^#\/?/, '') || 'overview';
  state.page = ['overview','materials','materials-dashboard','projects'].includes(key) ? key : 'overview';
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
    app.innerHTML = `<main class="auth-screen"><section class="auth-card"><div class="auth-logo"><img src="./assets/logo.png" alt="AMECC"></div><h1>Chưa cấu hình dữ liệu</h1><p>Cần cấu hình Worker URL trong public/config.js để tải dữ liệu dự án.</p><a class="button primary" href="./admin.html">Trang quản trị</a></section></main>`;
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
  catch (error) { app.innerHTML = `<main class="auth-screen"><section class="auth-card"><div class="auth-logo"><img src="./assets/logo.png" alt="AMECC"></div><h1>Không tải được dữ liệu</h1><p>${esc(error.message)}</p><a class="button primary" href="./admin.html">Trang quản trị</a><button class="button" onclick="location.reload()">Thử lại</button></section></main>`; }
}
window.addEventListener('hashchange', () => navigate());
start();

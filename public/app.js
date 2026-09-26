const API_BASE = String(window.AMECC_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
const app = document.querySelector('#app');
const state = { user: null, projects: [], currentProject: '', page: 'overview', theme: localStorage.getItem('amecc-theme') || 'light', data: null, loading: false };
const themes = ['light', 'midnight', 'paper'];
const labels = {
  project_code: 'Dự án', item: 'Hạng mục', mh: 'MH', wo_date: 'Ngày WO', product_type: 'Dạng SP', classification: 'Phân loại', allocation: 'Phân giao', drawing: 'Bản vẽ', part_no: 'Số chi tiết', size: 'Size', quantity: 'T’Qty', unit_weight: 'U.Weight', total_weight: 'T.Weight', profile: 'Profile', item_id: 'ID', note: 'Ghi chú', fitup_date: 'Ngày gá', fitup_qty: 'SL gá', fitup_weight: 'KL gá', welding_date: 'Ngày hàn', welding_qty: 'SL hàn', welding_weight: 'KL hàn', trial_assembly_date: 'Ngày tổ hợp', trial_assembly_qty: 'SL tổ hợp', trial_assembly_weight: 'KL tổ hợp', acceptance_date: 'Ngày nghiệm thu', acceptance_qty: 'SL nghiệm thu', acceptance_weight: 'KL nghiệm thu', handover_date: 'Ngày bàn giao', handover_qty: 'SL bàn giao', handover_weight: 'KL bàn giao', receiver: 'Đơn vị nhận', record_no: 'Số biên bản', assembly: 'Cụm lắp ráp', description: 'Mô tả', scope: 'Phạm vi công việc', weight: 'Khối lượng', received: 'Đã nhận', remaining: 'Còn thiếu', as_symbol: 'AS Symbol', parent: 'Cấu kiện chính', status: 'Trạng thái', source_file: 'File nguồn', source_sheet: 'Sheet', source_row: 'Dòng nguồn', is_main: 'Cấu kiện chính', material_rows: 'Dòng vật tư', progress_rows: 'Dòng tiến độ', updated_at: 'Cập nhật',
};
const progressColumns = ['item','mh','wo_date','product_type','classification','allocation','drawing','part_no','size','quantity','unit_weight','total_weight','profile','item_id','note','fitup_date','fitup_qty','fitup_weight','welding_date','welding_qty','welding_weight','trial_assembly_date','trial_assembly_qty','trial_assembly_weight','acceptance_date','acceptance_qty','acceptance_weight','handover_date','handover_qty','handover_weight','receiver','record_no'];
const materialColumns = ['source_sheet','source_row','drawing','assembly','description','part_no','size','scope','quantity','weight','received','remaining','as_symbol','status'];

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]); }
function fmt(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
  return esc(value);
}
function icon(name) {
  const paths = {
    overview:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    materials:'<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/>',
    projects:'<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 9h.01M15 9h.01M9 12h.01M15 12h.01"/>',
    admin:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    chevron:'<path d="m9 18 6-6-6-6"/>', menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
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
  if (!response.ok) throw new Error(data.error || 'Không thể hoàn thành yêu cầu.');
  return data;
}
function currentPageTitle() { return ({ overview:'Tổng quan', materials:'Quản lý vật tư', projects:'Quản lý dự án', admin:'Quản trị tài khoản' })[state.page] || 'AMECC'; }
function shell() {
  app.innerHTML = `<div class="shell theme-${esc(state.theme)}">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="#overview" aria-label="AMECC - Trang tổng quan"><img src="./assets/logo.png" alt="AMECC"><span class="brand-caption">PROJECT CONTROL</span></a>
      <div class="nav-label">KHÔNG GIAN LÀM VIỆC</div>
      <nav class="nav-list" aria-label="Điều hướng chính">
        <a class="nav-link ${state.page === 'overview' ? 'active' : ''}" href="#overview">${icon('overview')}<span>Tổng quan</span></a>
        <div class="nav-group ${['materials'].includes(state.page) ? 'expanded' : ''}">
          <button class="nav-parent" type="button" data-group="materials" aria-expanded="${state.page === 'materials'}">${icon('materials')}<span>Quản lý vật tư</span><span class="nav-chevron">${icon('chevron')}</span></button>
          <div class="nav-children"><a class="nav-child ${state.page === 'materials' ? 'active' : ''}" href="#materials">BOM &amp; Vật tư PL</a></div>
        </div>
        <div class="nav-group ${state.page === 'projects' ? 'expanded' : ''}">
          <button class="nav-parent" type="button" data-group="projects" aria-expanded="${state.page === 'projects'}">${icon('projects')}<span>Quản lý dự án</span><span class="nav-chevron">${icon('chevron')}</span></button>
          <div class="nav-children"><a class="nav-child ${state.page === 'projects' ? 'active' : ''}" href="#projects">Tiến độ dự án</a></div>
        </div>
      </nav>
      ${state.user.role === 'admin' ? `<div class="nav-label admin-nav-label">QUẢN TRỊ</div><a class="nav-link ${state.page === 'admin' ? 'active' : ''}" href="#admin">${icon('admin')}<span>Tài khoản &amp; cập nhật</span></a>` : ''}
      <div class="sidebar-foot"><span class="online-dot"></span><span>Hệ thống dữ liệu AMECC</span></div>
    </aside>
    <div class="mobile-scrim" id="scrim"></div>
    <main class="main-area">
      <header class="topbar"><button class="icon-button mobile-menu" id="mobileMenu" aria-label="Mở menu">${icon('menu')}</button><div><div class="top-eyebrow">AMECC <span>/</span> WORKSPACE</div><h1 id="pageTitle">${currentPageTitle()}</h1></div>
        <div class="top-actions"><select class="theme-select" id="themeSelect" aria-label="Chọn giao diện">${themes.map((theme) => `<option value="${theme}" ${theme === state.theme ? 'selected' : ''}>${({ light:'Sáng', midnight:'Midnight', paper:'Giấy hồ sơ' })[theme]}</option>`).join('')}</select><span class="user-chip"><span class="avatar">${esc(state.user.username.slice(0,1).toUpperCase())}</span><span>${esc(state.user.username)}</span></span><button class="icon-button logout-button" id="logout" aria-label="Đăng xuất">${icon('logout')}</button></div>
      </header><section id="page" class="page" aria-live="polite"></section>
    </main>
  </div>`;
  document.querySelector('#themeSelect').addEventListener('change', (event) => { state.theme = event.target.value; localStorage.setItem('amecc-theme', state.theme); shell(); renderPage(); });
  document.querySelector('#logout').addEventListener('click', logout);
  document.querySelector('#mobileMenu').addEventListener('click', () => document.querySelector('.shell').classList.add('drawer-open'));
  document.querySelector('#scrim').addEventListener('click', () => document.querySelector('.shell').classList.remove('drawer-open'));
  document.querySelectorAll('.nav-parent').forEach((button) => button.addEventListener('click', () => {
    const group = button.closest('.nav-group'); const expanded = group.classList.toggle('expanded'); button.setAttribute('aria-expanded', String(expanded));
  }));
  document.querySelectorAll('.nav-link,.nav-child').forEach((link) => link.addEventListener('click', () => document.querySelector('.shell').classList.remove('drawer-open')));
}
function loginScreen(message = '') {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card"><div class="auth-logo"><img src="./assets/logo.png" alt="AMECC"></div><span class="eyebrow">PROJECT OPERATIONS PLATFORM</span><h1>Đăng nhập hệ thống</h1><p>Truy cập không gian quản lý vật tư và tiến độ dự án AMECC.</p>${message ? `<div class="notice error">${esc(message)}</div>` : ''}<form id="loginForm"><label>Tên đăng nhập<input name="username" autocomplete="username" required minlength="3"></label><label>Mật khẩu<input name="password" type="password" autocomplete="current-password" required></label><button class="button primary full-width" type="submit">Đăng nhập <span>→</span></button></form><div class="auth-foot"><span class="online-dot"></span> Kết nối bảo mật · Phân quyền theo tài khoản</div></section><span class="auth-copyright">© AMECC · INTERNAL PROJECT WORKSPACE</span></main>`;
  document.querySelector('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const button = event.currentTarget.querySelector('button'); button.disabled = true; button.textContent = 'Đang xác thực…';
    try { const result = await api('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ username:form.get('username'), password:form.get('password') }) }); sessionStorage.setItem('amecc-session-token', result.token); state.user = result.user; await initializeWorkspace(); }
    catch (error) { loginScreen(error.message); }
  });
}
function heading(eyebrow, title, description, action = '') { return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2><p>${description}</p></div>${action}</div>`; }
function statCard(label, value, caption, tone = '') { return `<article class="stat-card ${tone}"><div class="stat-top"><span>${label}</span><span class="stat-symbol">●</span></div><strong>${fmt(value)}</strong><small>${caption}</small></article>`; }
function tableMarkup(rows, columns, options = {}) {
  if (!rows.length) return '<div class="empty-state"><span class="empty-icon">⌕</span><strong>Chưa có dữ liệu phù hợp</strong><p>Thử đổi bộ lọc hoặc chọn dự án khác.</p></div>';
  const visibleRows = rows.slice(0, options.limit || 500);
  return `<div class="table-frame"><table class="data-table"><thead><tr>${columns.map((key) => `<th>${esc(labels[key] || key)}</th>`).join('')}</tr></thead><tbody>${visibleRows.map((row) => `<tr>${columns.map((key) => `<td>${key === 'status' ? `<span class="status-pill ${row.status === 'đủ' ? 'success' : row.status === 'chưa đủ' ? 'warning' : 'neutral'}">${fmt(row[key])}</span>` : fmt(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length > visibleRows.length ? `<p class="table-note">Đang hiển thị ${visibleRows.length} / ${rows.length} dòng. Hãy dùng bộ lọc để thu hẹp kết quả.</p>` : ''}`;
}
function projectSelect() { return `<label class="filter-label">Dự án<select id="projectFilter"><option value="">Chọn dự án</option>${state.projects.map((project) => `<option value="${esc(project.code)}" ${state.currentProject === project.code ? 'selected' : ''}>${esc(project.code)} · ${esc(project.name)}</option>`).join('')}</select></label>`; }
function overviewPage() {
  const materialCount = state.projects.reduce((sum, project) => sum + Number(project.material_rows || 0), 0);
  const progressCount = state.projects.reduce((sum, project) => sum + Number(project.progress_rows || 0), 0);
  return `${heading('AMECC · PROJECT OPERATIONS','Tổng quan vận hành','Không gian theo dõi vật tư sản xuất và tiến độ dự án từ workbook nguồn thực tế.')}
    <section class="welcome-banner"><div><span class="banner-label">XIN CHÀO, ${esc(state.user.username.toUpperCase())}</span><h3>Điều hành dự án<br><em>trên một không gian duy nhất.</em></h3><p>Dữ liệu được phân quyền theo tài khoản và cập nhật từ workbook AMECC.</p></div><div class="banner-mark">A<span>.</span></div></section>
    <div class="stats-grid">${statCard('Dự án đang quản lý',state.projects.length,'Dự án có dữ liệu đã nhập','blue')}${statCard('Dòng dữ liệu vật tư',materialCount,'Đọc từ workbook PL','red')}${statCard('Dòng tiến độ dự án',progressCount,'Đọc từ sheet Progress QLDA','green')}${statCard('Quyền truy cập',state.user.role === 'admin' ? 'Admin' : 'Viewer','Tài khoản hiện tại', 'gold')}</div>
    <div class="section-heading"><div><span class="eyebrow">PROJECT PORTFOLIO</span><h3>Danh mục dự án</h3></div><span class="count-chip">${state.projects.length} dự án</span></div>
    ${state.projects.length ? `<div class="project-grid">${state.projects.map((project) => `<article class="project-card"><div class="project-card-head"><span class="project-icon">${icon('projects')}</span><span class="project-updated">${project.updated_at ? `Cập nhật ${fmt(project.updated_at).slice(0,10)}` : 'Đã đồng bộ'}</span></div><span class="eyebrow">PROJECT CODE</span><h4>${esc(project.code)}</h4><p>${esc(project.name)}</p><div class="project-meta"><span>${fmt(project.material_rows)} dòng vật tư</span><span>${fmt(project.progress_rows)} dòng tiến độ</span></div><div class="project-actions"><a href="#materials" data-project="${esc(project.code)}">Vật tư <span>→</span></a><a href="#projects" data-project="${esc(project.code)}">Tiến độ <span>→</span></a></div></article>`).join('')}</div>` : '<div class="empty-state"><strong>Chưa có dữ liệu dự án</strong><p>Admin cần đăng nhập và nhập workbook PL/QLDA để bắt đầu.</p></div>'}`;
}
function materialsPage() {
  const rows = state.data?.rows || [];
  const groups = new Map();
  const activeParent = new Map();
  for (const row of rows) {
    const sheetKey = `${row.source_file}|${row.source_sheet}`;
    if (row.is_main) {
      const key = `${sheetKey}|${row.source_row}`;
      const group = { ...row, childCount:0, total:0, receivedTotal:0, hasQuantity:false, hasReceived:false, children:[] };
      groups.set(key, group);
      activeParent.set(sheetKey, group);
      continue;
    }
    const parent = activeParent.get(sheetKey);
    if (parent) { parent.children.push(row); parent.childCount += 1; if (typeof row.quantity === 'number') { parent.total += row.quantity; parent.hasQuantity = true; } if (typeof row.received === 'number') { parent.receivedTotal += row.received; parent.hasReceived = true; } }
  }
  const components = [...groups.values()];
  const received = rows.reduce((sum, row) => sum + (typeof row.received === 'number' ? row.received : 0),0);
  const search = document.querySelector('#materialSearch')?.value.trim().toLowerCase() || '';
  const filtered = components.filter((item) => !search || [item.assembly,item.drawing,item.description,item.part_no,item.source_sheet].some((v) => String(v || '').toLowerCase().includes(search)));
  const files = [...new Set(rows.map((row) => row.source_file))];
  return `${heading('MATERIAL CONTROL · PL','Quản lý vật tư','BOM theo cấu kiện, tình trạng nhận và phạm vi công việc từ các file PL thực tế.',projectSelect())}
    <div class="filter-toolbar"><label class="search-box">${icon('search')}<input id="materialSearch" placeholder="Tìm cấu kiện, mã bản vẽ, mô tả…" value="${esc(search)}"></label><span class="source-chip">Nguồn: ${files.map(esc).join(', ') || '—'}</span></div>
    <div class="stats-grid compact">${statCard('Dòng vật tư',rows.length,'Theo dự án đang chọn')}${statCard('Cấu kiện chính',components.length,'Nhóm AS Symbol / Symbol')}${statCard('Tổng đã nhận',received,'Cộng từ dữ liệu nhận PL','green')}${statCard('Workbook nguồn',files.length,'Không công khai file gốc')}</div>
    <div class="section-heading"><div><span class="eyebrow">ASSEMBLY BOM</span><h3>Cấu kiện chính <span class="muted-count">${filtered.length}</span></h3></div></div>
    ${filtered.length ? `<div class="assembly-list">${filtered.slice(0,250).map((group,index) => {
      const percent = group.hasQuantity && group.total && group.hasReceived ? Math.min(100,Math.round(group.receivedTotal / group.total * 100)) : null;
      const children = group.children;
      return `<details class="assembly-card" ${index === 0 ? 'open' : ''}><summary><span class="progress-ring" style="--value:${percent || 0}%"><b>${percent === null ? '—' : `${percent}%`}</b></span><span class="assembly-title"><strong>${fmt(group.assembly || group.drawing || group.description)}</strong><small>${fmt(group.description)} · ${fmt(group.drawing)}</small><small>${esc(group.source_file)} · ${esc(group.source_sheet)} · ${group.childCount} dòng con</small></span><span class="scope-chip">${fmt(group.scope)}</span><span class="assembly-qty"><b>${fmt(group.hasReceived ? group.receivedTotal : null)} / ${fmt(group.hasQuantity ? group.total : null)}</b><small>Đã nhận / tổng SL</small></span><span class="disclosure">⌄</span></summary><div class="assembly-body">${tableMarkup(children,materialColumns,{limit:150})}</div></details>`;
    }).join('')}</div>` : '<div class="empty-state"><strong>Không tìm thấy cấu kiện chính</strong><p>Dữ liệu hoặc bộ lọc hiện tại chưa có kết quả.</p></div>'}`;
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
    <section class="panel"><div class="panel-title"><span class="eyebrow">WORKBOOK IMPORT</span><h3>Nạp dữ liệu từ máy tính</h3><p>File được gửi riêng tới API bảo mật; workbook gốc không được commit vào GitHub.</p></div><form id="importForm" class="form-grid"><label>Mã dự án<input name="project_code" placeholder="VD: A290" pattern="[A-Za-z0-9_-]{2,32}" required></label><label>Loại dữ liệu<select name="category"><option value="materials">Vật tư PL</option><option value="projects">Tiến độ QLDA</option></select></label><label class="file-picker">Chọn file Excel<input name="file" type="file" accept=".xlsx" required><small>PL cần tên kết thúc bằng PL.xlsx; QLDA cần sheet Progress. Tối đa 10 MB.</small></label><button class="button primary" type="submit">${icon('upload')}<span>Kiểm tra &amp; nhập dữ liệu</span></button><div class="form-message" id="importMessage" aria-live="polite"></div></form></section></div>
    <section class="panel account-panel"><div class="panel-title"><span class="eyebrow">PROJECT DATA</span><h3>Các dự án trên hệ thống</h3></div>${state.projects.length ? `<div class="account-list">${state.projects.map((project) => `<div class="account-row"><b>${esc(project.code)}</b><span>${fmt(project.material_rows)} vật tư</span><span>${fmt(project.progress_rows)} tiến độ</span><small>${fmt(project.updated_at)}</small></div>`).join('')}</div>` : '<p class="muted">Chưa nhập workbook nào.</p>'}</section>`;
}
function bindPage() {
  document.querySelector('#projectFilter')?.addEventListener('change', async (event) => {
    state.currentProject = event.target.value; await loadPageData(); renderPage();
  });
  document.querySelector('#materialSearch')?.addEventListener('input', () => { const page = document.querySelector('#page'); const position = window.scrollY; page.innerHTML = materialsPage(); bindPage(); window.scrollTo(0,position); });
  document.querySelector('#projectSearch')?.addEventListener('input', () => { const page = document.querySelector('#page'); const position = window.scrollY; page.innerHTML = projectsPage(); bindPage(); window.scrollTo(0,position); });
  document.querySelectorAll('[data-project]').forEach((link) => link.addEventListener('click', () => { state.currentProject = link.dataset.project; }));
  document.querySelector('#viewerForm')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const output = document.querySelector('#viewerMessage');
    try { const result = await api('/api/admin/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:data.get('username'),password:data.get('password')})}); output.textContent = `Đã tạo tài khoản ${result.username}.`; output.className = 'form-message success-message'; event.currentTarget.reset(); }
    catch (error) { output.textContent = error.message; output.className = 'form-message error-message'; }
  });
  document.querySelector('#importForm')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const output = document.querySelector('#importMessage'); const button = form.querySelector('button');
    const endpoint = data.get('category') === 'materials' ? 'materials' : 'projects'; button.disabled = true; output.textContent = 'Đang kiểm tra cấu trúc và nhập dữ liệu…'; output.className = 'form-message';
    try { const result = await api(`/api/admin/import/${endpoint}`,{method:'POST',body:data}); output.textContent = `Đã nhập ${result.imported_rows.toLocaleString('vi-VN')} dòng cho dự án ${result.project_code}.`; output.className = 'form-message success-message'; form.reset(); await refreshProjects(); }
    catch (error) { output.textContent = error.message; output.className = 'form-message error-message'; }
    finally { button.disabled = false; }
  });
}
async function refreshProjects() { const result = await api('/api/projects'); state.projects = result.projects; }
async function loadPageData() {
  state.data = null;
  if (!state.currentProject || !['materials','projects'].includes(state.page)) return;
  const category = state.page === 'materials' ? 'materials' : 'progress';
  state.data = await api(`/api/projects/${encodeURIComponent(state.currentProject)}/${category}`);
}
async function renderPage() {
  const page = document.querySelector('#page'); if (!page) return;
  page.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Đang tải dữ liệu…</p></div>';
  try {
    if (state.page === 'overview') page.innerHTML = overviewPage();
    else if (['materials','projects'].includes(state.page)) {
      if (!state.currentProject && state.projects.length) state.currentProject = state.projects[0].code;
      await loadPageData();
      page.innerHTML = state.page === 'materials' ? materialsPage() : projectsPage();
    } else page.innerHTML = adminPage();
    bindPage();
  } catch (error) { page.innerHTML = `<div class="notice error">${esc(error.message)}</div>`; }
}
async function navigate() {
  const key = location.hash.replace(/^#\/?/, '') || 'overview';
  state.page = ['overview','materials','projects','admin'].includes(key) ? key : 'overview';
  if (state.page === 'admin' && state.user.role !== 'admin') state.page = 'overview';
  shell(); await renderPage();
}
async function logout() {
  try { await api('/api/auth/logout',{method:'POST'}); } finally { sessionStorage.removeItem('amecc-session-token'); state.user = null; state.projects = []; loginScreen(); }
}
async function initializeWorkspace() {
  try { await refreshProjects(); await navigate(); }
  catch (error) { loginScreen(error.message); }
}
async function start() {
  if (!API_BASE || API_BASE.includes('REPLACE_WITH')) { loginScreen('Cần cấu hình Worker URL trong public/config.js trước khi đăng nhập.'); return; }
  try { const result = await api('/api/auth/me'); if (!result.user) { sessionStorage.removeItem('amecc-session-token'); loginScreen(); return; } state.user = result.user; await initializeWorkspace(); }
  catch (error) { loginScreen(error.message); }
}
window.addEventListener('hashchange', () => { if (state.user) navigate(); });
start();
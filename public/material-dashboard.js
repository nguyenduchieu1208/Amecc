function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
}

function quantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return null;
  let normalized = raw;
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  if (comma !== -1 && dot !== -1) {
    normalized = comma > dot ? normalized.replace(/\./g, '').replace(',', '.') : normalized.replace(/,/g, '');
  } else if (comma !== -1) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(normalized) ? normalized.replace(/,/g, '') : normalized.replace(',', '.');
  } else if ((normalized.match(/\./g) || []).length > 1) {
    normalized = normalized.replace(/\./g, '');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits:1 }).format(value);
}

function dateSortKey(value) {
  const match = String(value ?? '').match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!match) return String(value ?? '');
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year.padStart(4, '0')}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function receiptTotals(rows) {
  const totals = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const event of String(row?.daily_progress ?? '').split(/\s*;\s*/)) {
      const divider = event.lastIndexOf(':');
      if (divider < 0) continue;
      const date = event.slice(0, divider).trim();
      const received = quantity(event.slice(divider + 1));
      if (date && received !== null && received > 0) totals.set(date, (totals.get(date) || 0) + received);
    }
  }
  return [...totals].sort(([left], [right]) => dateSortKey(left).localeCompare(dateSortKey(right)));
}

function tickIndices(count, limit = 7) {
  if (count <= limit) return Array.from({ length:count }, (_, index) => index);
  return Array.from({ length:limit }, (_, index) => Math.round(index * (count - 1) / (limit - 1)));
}

function cumulativeLineChart(dailyTotals) {
  if (!dailyTotals.length) return '<div class="material-chart-empty">Chưa có lịch nhận theo ngày trong dữ liệu BTP.</div>';
  const points = [];
  let cumulative = 0;
  for (const [date, received] of dailyTotals) {
    cumulative += received;
    points.push({ date, value:cumulative });
  }
  const width = Math.max(600, Math.min(1800, 110 + points.length * 28));
  const height = 270;
  const left = 58;
  const right = 22;
  const top = 24;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(1, ...points.map((point) => point.value));
  const coords = points.map((point, index) => ({
    ...point,
    x:left + (points.length === 1 ? plotWidth / 2 : index * plotWidth / (points.length - 1)),
    y:top + plotHeight - point.value / maxValue * plotHeight,
  }));
  const line = coords.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${coords[coords.length - 1].x.toFixed(1)} ${(top + plotHeight).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(top + plotHeight).toFixed(1)} Z`;
  const grid = Array.from({ length:5 }, (_, index) => {
    const value = maxValue * (4 - index) / 4;
    const y = top + plotHeight * index / 4;
    return `<g><line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="chart-gridline"/><text x="${left - 9}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${escapeHtml(formatNumber(value))}</text></g>`;
  }).join('');
  const labels = tickIndices(coords.length).map((index) => {
    const point = coords[index];
    return `<text x="${point.x}" y="${height - 17}" text-anchor="middle" class="chart-axis-label">${escapeHtml(point.date)}</text>`;
  }).join('');
  const markers = coords.length <= 32 ? coords.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3" class="chart-point"><title>${escapeHtml(point.date)} · lũy kế ${escapeHtml(formatNumber(point.value))}</title></circle>`).join('') : '';
  return `<div class="material-chart-scroll"><svg class="material-chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ đường số lượng BTP nhận lũy kế theo ngày"><title>Số lượng BTP nhận lũy kế theo ngày</title>${grid}<path d="${area}" class="chart-area"/><path d="${line}" class="chart-line"/>${markers}${labels}<text x="${left}" y="13" class="chart-axis-caption">Số lượng nhận lũy kế</text></svg></div>`;
}

function unitColumnChart(units) {
  if (!units.length) return '<div class="material-chart-empty">Chưa có đơn vị giao trong dữ liệu BTP.</div>';
  const width = Math.max(560, Math.min(1600, 120 + units.length * 82));
  const height = 270;
  const left = 56;
  const right = 18;
  const top = 26;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(1, ...units.flatMap((unit) => [unit.received, unit.shortage]));
  const groupWidth = plotWidth / units.length;
  const barWidth = Math.min(25, groupWidth * .28);
  const grid = Array.from({ length:5 }, (_, index) => {
    const value = maxValue * (4 - index) / 4;
    const y = top + plotHeight * index / 4;
    return `<g><line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="chart-gridline"/><text x="${left - 8}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${escapeHtml(formatNumber(value))}</text></g>`;
  }).join('');
  const columns = units.map((unit, index) => {
    const center = left + index * groupWidth + groupWidth / 2;
    const receivedHeight = unit.received / maxValue * plotHeight;
    const shortageHeight = unit.shortage / maxValue * plotHeight;
    const shortLabel = unit.label.length > 12 ? `${unit.label.slice(0, 11)}…` : unit.label;
    return `<g><rect x="${center - barWidth - 2}" y="${top + plotHeight - receivedHeight}" width="${barWidth}" height="${receivedHeight}" rx="3" class="chart-bar-received"><title>${escapeHtml(unit.label)} · đã nhận ${escapeHtml(formatNumber(unit.received))}</title></rect><rect x="${center + 2}" y="${top + plotHeight - shortageHeight}" width="${barWidth}" height="${shortageHeight}" rx="3" class="chart-bar-shortage"><title>${escapeHtml(unit.label)} · còn thiếu ${escapeHtml(formatNumber(unit.shortage))}</title></rect><text x="${center}" y="${height - 25}" text-anchor="middle" class="chart-axis-label"><title>${escapeHtml(unit.label)}</title>${escapeHtml(shortLabel)}</text></g>`;
  }).join('');
  return `<div class="material-chart-scroll"><svg class="material-chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ cột số lượng đã nhận và còn thiếu theo đơn vị giao"><title>Số lượng đã nhận và còn thiếu theo đơn vị giao</title>${grid}${columns}<text x="${left}" y="13" class="chart-axis-caption">Số lượng BTP</text></svg></div>`;
}

export function renderMaterialDashboard(rows, scopeLabel = '') {
  const dailyTotals = receiptTotals(rows);
  const unitMap = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const unit = String(row?.unit ?? '').trim() || 'Chưa xác định';
    if (!unitMap.has(unit)) unitMap.set(unit, { label:unit, received:0, shortage:0 });
    const summary = unitMap.get(unit);
    const design = quantity(row?.design_quantity);
    const received = quantity(row?.received);
    const remaining = quantity(row?.remaining);
    summary.received += received ?? (design !== null && remaining !== null ? Math.max(0, design - remaining) : 0);
    summary.shortage += Math.max(0, remaining ?? (design !== null && received !== null ? design - received : 0));
  }
  const units = [...unitMap.values()].sort((left, right) => (right.received + right.shortage) - (left.received + left.shortage)
    || left.label.localeCompare(right.label, 'vi', { sensitivity:'base' }));
  const sourceCount = Array.isArray(rows) ? rows.length : 0;
  return `<section class="material-dashboard" aria-label="Dashboard BOM và vật tư">
    <div class="material-dashboard-heading"><div><span class="eyebrow">MATERIAL DASHBOARD</span><h3>Dashboard BOM &amp; vật tư</h3><p>${escapeHtml(scopeLabel || 'Toàn bộ dự án')} · ${formatNumber(sourceCount)} dòng BTP · số liệu lấy từ lịch nhận và đơn vị giao trong workbook.</p></div></div>
    <div class="material-chart-grid">
      <figure class="material-chart-card"><figcaption><strong>Lũy kế nhận theo ngày</strong><span>Cộng số lượng nhận từng ngày</span></figcaption>${cumulativeLineChart(dailyTotals)}</figure>
      <figure class="material-chart-card"><figcaption><strong>Phân theo đơn vị giao</strong><span>So sánh đã nhận và còn thiếu</span></figcaption><div class="material-chart-legend"><span><i class="legend-received"></i>Đã nhận</span><span><i class="legend-shortage"></i>Còn thiếu</span></div>${unitColumnChart(units)}</figure>
    </div>
  </section>`;
}

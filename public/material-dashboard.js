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

const METRICS = {
  quantity:{ unit:'BTP', factor:1, decimals:2 },
  kg:{ unit:'kg', factor:1, decimals:6 },
  ton:{ unit:'tấn', factor:0.001, decimals:6 },
};

function metricSpec(metric) { return METRICS[metric] || METRICS.quantity; }

function formatNumber(value, metric = 'quantity') {
  const spec = metricSpec(metric);
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits:spec.decimals }).format(value);
}

function eventDate(value) {
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const local = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!local) return '';
  const year = local[3].length === 2 ? `20${local[3]}` : local[3];
  return `${year}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
}

function dateSortKey(value) { return eventDate(value) || String(value ?? ''); }

function inRange(isoDate, range) {
  if (!isoDate) return !range?.from && !range?.to;
  return (!range?.from || isoDate >= range.from) && (!range?.to || isoDate <= range.to);
}

function rowMetricValue(row, count, metric, missing = () => {}) {
  if (metric === 'quantity') return count;
  const unitWeight = quantity(row?.unit_weight);
  if (unitWeight === null) { missing(); return null; }
  return count * unitWeight * metricSpec(metric).factor;
}

function receiptTotals(rows, range, metric, missing = () => {}) {
  const totals = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const event of String(row?.daily_progress ?? '').split(/\s*;\s*/)) {
      const divider = event.lastIndexOf(':');
      if (divider < 0) continue;
      const date = event.slice(0, divider).trim();
      const amount = quantity(event.slice(divider + 1));
      const isoDate = eventDate(date);
      if (!date || amount === null || amount <= 0 || !inRange(isoDate, range)) continue;
      const value = rowMetricValue(row, amount, metric, missing);
      if (value === null) continue;
      totals.set(date, (totals.get(date) || 0) + value);
    }
  }
  return [...totals].sort(([left], [right]) => dateSortKey(left).localeCompare(dateSortKey(right)));
}

function tickIndices(count, limit = 7) {
  if (count <= limit) return Array.from({ length:count }, (_, index) => index);
  return Array.from({ length:limit }, (_, index) => Math.round(index * (count - 1) / (limit - 1)));
}

function cumulativeLineChart(dailyTotals, metric) {
  const spec = metricSpec(metric);
  if (!dailyTotals.length) return '<div class="material-chart-empty">Không có lịch nhận trong khoảng ngày và đơn vị đang chọn.</div>';
  const points = [];
  let cumulative = 0;
  for (const [date, received] of dailyTotals) {
    cumulative += received;
    points.push({ date, value:cumulative });
  }
  const width = Math.max(600, Math.min(1800, 110 + points.length * 28));
  const height = 270;
  const left = 67;
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
    return `<g><line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="chart-gridline"/><text x="${left - 9}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${escapeHtml(formatNumber(value, metric))}</text></g>`;
  }).join('');
  const labels = tickIndices(coords.length).map((index) => {
    const point = coords[index];
    return `<text x="${point.x}" y="${height - 17}" text-anchor="middle" class="chart-axis-label">${escapeHtml(point.date)}</text>`;
  }).join('');
  const markers = coords.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="5" tabindex="0" role="graphics-symbol" aria-label="${escapeHtml(point.date)} · lũy kế ${escapeHtml(formatNumber(point.value, metric))} ${spec.unit}" class="chart-point"><title>${escapeHtml(point.date)} · lũy kế ${escapeHtml(formatNumber(point.value, metric))} ${spec.unit}</title></circle>`).join('');
  return `<div class="material-chart-scroll"><svg class="material-chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ đường lũy kế ${spec.unit} nhận theo ngày"><title>Lũy kế nhận theo ngày · ${spec.unit}</title>${grid}<path d="${area}" class="chart-area"/><path d="${line}" class="chart-line"/>${markers}${labels}<text x="${left}" y="13" class="chart-axis-caption">Lũy kế (${spec.unit})</text></svg></div>`;
}

function unitColumnChart(units, metric) {
  const spec = metricSpec(metric);
  if (!units.length) return '<div class="material-chart-empty">Chưa có đơn vị giao trong dữ liệu BTP.</div>';
  const width = Math.max(560, Math.min(1600, 120 + units.length * 82));
  const height = 270;
  const left = 67;
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
    return `<g><line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="chart-gridline"/><text x="${left - 9}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${escapeHtml(formatNumber(value, metric))}</text></g>`;
  }).join('');
  const columns = units.map((unit, index) => {
    const center = left + index * groupWidth + groupWidth / 2;
    const receivedHeight = unit.received / maxValue * plotHeight;
    const shortageHeight = unit.shortage / maxValue * plotHeight;
    const shortLabel = unit.label.length > 12 ? `${unit.label.slice(0, 11)}…` : unit.label;
    return `<g><rect x="${center - barWidth - 2}" y="${top + plotHeight - receivedHeight}" width="${barWidth}" height="${receivedHeight}" rx="3" tabindex="0" class="chart-bar-received"><title>${escapeHtml(unit.label)} · đã nhận ${escapeHtml(formatNumber(unit.received, metric))} ${spec.unit}</title></rect><rect x="${center + 2}" y="${top + plotHeight - shortageHeight}" width="${barWidth}" height="${shortageHeight}" rx="3" tabindex="0" class="chart-bar-shortage"><title>${escapeHtml(unit.label)} · còn thiếu hiện tại ${escapeHtml(formatNumber(unit.shortage, metric))} ${spec.unit}</title></rect><text x="${center}" y="${height - 25}" text-anchor="middle" class="chart-axis-label"><title>${escapeHtml(unit.label)}</title>${escapeHtml(shortLabel)}</text></g>`;
  }).join('');
  return `<div class="material-chart-scroll"><svg class="material-chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ cột đã nhận và còn thiếu theo đơn vị giao · ${spec.unit}"><title>Đã nhận và còn thiếu theo đơn vị giao · ${spec.unit}</title>${grid}${columns}<text x="${left}" y="13" class="chart-axis-caption">${spec.unit}</text></svg></div>`;
}

function currentReceived(row) {
  const received = quantity(row?.received);
  if (received !== null) return received;
  const design = quantity(row?.design_quantity);
  const remaining = quantity(row?.remaining);
  return design !== null && remaining !== null ? Math.max(0, design - remaining) : 0;
}

function currentShortage(row) {
  const remaining = quantity(row?.remaining);
  if (remaining !== null) return Math.max(0, remaining);
  const design = quantity(row?.design_quantity);
  const received = quantity(row?.received);
  return design !== null && received !== null ? Math.max(0, design - received) : 0;
}

export function renderMaterialDashboard(rows, scopeLabel = '', options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const range = { from:String(options?.from || ''), to:String(options?.to || '') };
  const metric = options?.metric || 'quantity';
  const spec = metricSpec(metric);
  const invalidRange = Boolean(range.from && range.to && range.from > range.to);
  let missingWeightEvents = 0;
  const missingWeightRows = new Set();
  const dailyTotals = invalidRange ? [] : receiptTotals(sourceRows, range, metric, () => { missingWeightEvents += 1; });
  const unitMap = new Map();
  for (const row of sourceRows) {
    const unit = String(row?.unit ?? '').trim() || 'Chưa xác định';
    if (!unitMap.has(unit)) unitMap.set(unit, { label:unit, received:0, shortage:0 });
    const summary = unitMap.get(unit);
    let receivedCount = currentReceived(row);
    if (range.from || range.to) {
      receivedCount = 0;
      for (const event of String(row?.daily_progress ?? '').split(/\s*;\s*/)) {
        const divider = event.lastIndexOf(':');
        if (divider < 0) continue;
        const isoDate = eventDate(event.slice(0, divider));
        const amount = quantity(event.slice(divider + 1));
        if (amount !== null && amount > 0 && inRange(isoDate, range)) receivedCount += amount;
      }
    }
    const missingRowWeight = () => {
      if (receivedCount > 0 || currentShortage(row) > 0) missingWeightRows.add(`${row?.source_file || ''}|${row?.source_sheet || ''}|${row?.source_row || ''}|${row?.part_no || ''}`);
    };
    const receivedValue = rowMetricValue(row, receivedCount, metric, missingRowWeight);
    const shortageValue = rowMetricValue(row, currentShortage(row), metric, missingRowWeight);
    if (receivedValue !== null) summary.received += receivedValue;
    if (shortageValue !== null) summary.shortage += shortageValue;
  }
  const units = [...unitMap.values()].sort((left, right) => (right.received + right.shortage) - (left.received + left.shortage)
    || left.label.localeCompare(right.label, 'vi', { sensitivity:'base' }));
  const sourceCount = sourceRows.length;
  const rangeCaption = range.from || range.to ? ` · khoảng ${range.from || 'đầu kỳ'} – ${range.to || 'hiện tại'}` : '';
  const emptyMessage = invalidRange ? '<div class="material-chart-empty">Khoảng ngày không hợp lệ: ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</div>' : '';
  const weightNotice = metric !== 'quantity' && (missingWeightEvents || missingWeightRows.size)
    ? `<p class="material-chart-note">Không tính được khối lượng cho ${formatNumber(missingWeightEvents)} lượt nhận và ${formatNumber(missingWeightRows.size)} dòng thiếu U.Weight; hãy bổ sung U.Weight trong BTL để số kg/tấn đầy đủ.</p>`
    : '';
  return `<section class="material-dashboard" aria-label="Dashboard BOM và vật tư">
    <div class="material-dashboard-heading"><div><span class="eyebrow">MATERIAL DASHBOARD</span><h3>Dashboard BOM &amp; vật tư</h3><p>${escapeHtml(scopeLabel || 'Toàn bộ dự án')} · ${formatNumber(sourceCount)} dòng BTP${escapeHtml(rangeCaption)} · đơn vị ${escapeHtml(spec.unit)}.</p></div></div>
    ${emptyMessage ? `<div class="material-dashboard-invalid">${emptyMessage}</div>` : `<div class="material-chart-grid">
      <figure class="material-chart-card"><figcaption><strong>Lũy kế nhận theo ngày</strong><span>Cộng trong khoảng đã chọn · ${escapeHtml(spec.unit)}</span></figcaption>${invalidRange ? '' : cumulativeLineChart(dailyTotals, metric)}</figure>
      <figure class="material-chart-card"><figcaption><strong>Phân theo đơn vị giao</strong><span>Đã nhận trong khoảng ngày · còn thiếu hiện tại · ${escapeHtml(spec.unit)}</span></figcaption><div class="material-chart-legend"><span><i class="legend-received"></i>Đã nhận</span><span><i class="legend-shortage"></i>Còn thiếu hiện tại</span></div>${invalidRange ? '' : unitColumnChart(units, metric)}</figure>
    </div>`}${weightNotice}
  </section>`;
}

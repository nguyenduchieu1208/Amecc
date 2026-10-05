const STAGES = [
  { key:'fitup', label:'Gá lắp', date:'fitup_date', quantity:'fitup_qty', weight:'fitup_weight' },
  { key:'welding', label:'Hàn', date:'welding_date', quantity:'welding_qty', weight:'welding_weight' },
  { key:'trial_assembly', label:'Tổ hợp thử', date:'trial_assembly_date', quantity:'trial_assembly_qty', weight:'trial_assembly_weight' },
  { key:'acceptance', label:'Nghiệm thu / QC', date:'acceptance_date', quantity:'acceptance_qty', weight:'acceptance_weight' },
  { key:'handover', label:'Bàn giao', date:'handover_date', quantity:'handover_qty', weight:'handover_weight' },
];

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim().replace(/\s/g, '');
  if (!text) return null;
  const normalized = text.includes(',') && text.includes('.')
    ? (text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, ''))
    : text.includes(',') ? text.replace(',', '.') : text;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function isoDate(value) {
  const text = String(value ?? '').trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const local = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  return local ? `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}` : '';
}

function displayDate(value) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}`;
}

function weight(row, stage) {
  const recorded = number(row?.[stage.weight]);
  if (recorded !== null && recorded > 0) return recorded;
  const quantity = number(row?.[stage.quantity]);
  const unitWeight = number(row?.unit_weight);
  if (quantity !== null && unitWeight !== null) return Math.max(0, quantity * unitWeight);
  return recorded === null ? 0 : Math.max(0, recorded);
}

function plannedWeight(row) {
  const total = number(row?.total_weight);
  if (total !== null && total > 0) return total;
  const quantity = number(row?.quantity);
  const unitWeight = number(row?.unit_weight);
  return quantity !== null && unitWeight !== null ? Math.max(0, quantity * unitWeight) : 0;
}

function fmt(value, metric, digits = 1) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits:digits }).format(metric === 'ton' ? value / 1000 : value);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

function inRange(date, range) {
  return (!range.from || date >= range.from) && (!range.to || date <= range.to);
}

function stageEvents(rows, range) {
  const byDate = new Map();
  for (const stage of STAGES) {
    byDate.set(stage.key, new Map());
    for (const row of rows) {
      const date = isoDate(row?.[stage.date]);
      if (!date || !inRange(date, range)) continue;
      const amount = weight(row, stage);
      if (amount > 0) byDate.get(stage.key).set(date, (byDate.get(stage.key).get(date) || 0) + amount);
    }
  }
  return byDate;
}

function cumulativeChart(rows, range, metric) {
  const events = stageEvents(rows, range);
  const dates = [...new Set([...events.values()].flatMap((series) => [...series.keys()]))].sort();
  if (!dates.length) return '<div class="project-chart-empty">Chưa có ngày và khối lượng công đoạn trong khoảng đã chọn.</div>';
  const width = Math.max(620, Math.min(1500, 150 + dates.length * 24));
  const height = 300;
  const left = 76;
  const right = 24;
  const top = 28;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const cumulative = new Map(STAGES.map((stage) => [stage.key, 0]));
  const values = STAGES.map((stage) => {
    let total = 0;
    return dates.map((date) => {
      total += events.get(stage.key).get(date) || 0;
      cumulative.set(stage.key, total);
      return { date, value:total, event:events.get(stage.key).get(date) || 0 };
    });
  });
  const maxValue = Math.max(1, ...values.flatMap((series) => series.map((point) => point.value)));
  const yAt = (value) => top + plotHeight - (value / maxValue) * plotHeight;
  const xAt = (index) => left + (dates.length === 1 ? plotWidth / 2 : index * plotWidth / (dates.length - 1));
  const grid = Array.from({ length:5 }, (_, index) => {
    const value = maxValue * (4 - index) / 4;
    const y = top + plotHeight * index / 4;
    return `<g><line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="project-chart-gridline"/><text x="${left - 10}" y="${y + 4}" text-anchor="end" class="project-chart-axis">${esc(fmt(value, metric))}</text></g>`;
  }).join('');
  const tickCount = Math.min(8, dates.length);
  const ticks = Array.from({ length:tickCount }, (_, index) => Math.round(index * (dates.length - 1) / Math.max(1, tickCount - 1)));
  const labels = ticks.map((index) => `<text x="${xAt(index)}" y="${height - 16}" text-anchor="middle" class="project-chart-axis">${displayDate(dates[index])}</text>`).join('');
  const lines = STAGES.map((stage, seriesIndex) => {
    const points = values[seriesIndex];
    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${xAt(index).toFixed(1)} ${yAt(point.value).toFixed(1)}`).join(' ');
    const markers = points.map((point, index) => `<circle cx="${xAt(index)}" cy="${yAt(point.value)}" r="3.6" tabindex="0" role="graphics-symbol" aria-label="${esc(stage.label)} · ${displayDate(point.date)} · tăng ${esc(fmt(point.event, metric))} · lũy kế ${esc(fmt(point.value, metric))} ${metric === 'ton' ? 'tấn' : 'kg'}" class="project-chart-point series-${seriesIndex}"><title>${esc(stage.label)} · ${displayDate(point.date)}: tăng ${esc(fmt(point.event, metric))}, lũy kế ${esc(fmt(point.value, metric))} ${metric === 'ton' ? 'tấn' : 'kg'}</title></circle>`).join('');
    return `<path d="${path}" class="project-chart-line series-${seriesIndex}"/>${markers}`;
  }).join('');
  const legend = STAGES.map((stage, index) => `<span><i class="series-${index}"></i>${esc(stage.label)}</span>`).join('');
  return `<div class="project-chart-legend">${legend}</div><div class="project-chart-scroll"><svg class="project-dashboard-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Lũy kế khối lượng đã ghi nhận theo ngày và công đoạn"><title>Lũy kế công đoạn, đơn vị ${metric === 'ton' ? 'tấn' : 'kg'}</title>${grid}${lines}${labels}<text x="${left}" y="15" class="project-chart-caption">Lũy kế (${metric === 'ton' ? 'tấn' : 'kg'})</text></svg></div>`;
}

function stageCompletionChart(rows, metric) {
  const totalPlanned = rows.reduce((sum, row) => sum + plannedWeight(row), 0);
  if (!totalPlanned) return '<div class="project-chart-empty">Thiếu tổng khối lượng thiết kế hoặc đơn trọng trong file QLDA.</div>';
  return `<div class="project-stage-report-list">${STAGES.map((stage, index) => {
    const actual = rows.reduce((sum, row) => sum + weight(row, stage), 0);
    const percent = Math.min(100, actual / totalPlanned * 100);
    return `<div class="project-stage-report-row"><div><b>${esc(stage.label)}</b><span>${esc(fmt(actual, metric))} / ${esc(fmt(totalPlanned, metric))} ${metric === 'ton' ? 'tấn' : 'kg'}</span></div><div class="project-stage-report-track"><i class="series-${index}" style="width:${percent.toFixed(2)}%"></i></div><small>${fmt(percent, 'kg', 1)}%</small></div>`;
  }).join('')}</div>`;
}

function teamBacklogChart(rows, metric) {
  const teams = new Map();
  for (const row of rows) {
    const team = String(row?.allocation || '').trim() || 'Chưa xác định';
    const delivered = weight(row, STAGES[4]);
    const total = Math.max(plannedWeight(row), delivered);
    if (!teams.has(team)) teams.set(team, { total:0, delivered:0 });
    const entry = teams.get(team);
    entry.total += total;
    entry.delivered += delivered;
  }
  const ranked = [...teams].map(([label, values]) => ({ label, ...values, remaining:Math.max(0, values.total - values.delivered) }))
    .sort((left, right) => right.total - left.total).slice(0, 12);
  if (!ranked.length) return '<div class="project-chart-empty">Chưa có tổ hoặc khối lượng để tổng hợp.</div>';
  const maxValue = Math.max(1, ...ranked.map((team) => team.total));
  return `<div class="project-team-report">${ranked.map((team) => {
    const deliveredWidth = team.total ? team.delivered / maxValue * 100 : 0;
    const remainingWidth = team.total ? team.remaining / maxValue * 100 : 0;
    return `<div class="project-team-report-row"><b title="${esc(team.label)}">${esc(team.label)}</b><div class="project-team-report-track"><i class="project-team-delivered" style="width:${deliveredWidth.toFixed(2)}%" title="Bàn giao ${esc(fmt(team.delivered, metric))}"></i><i class="project-team-remaining" style="width:${remainingWidth.toFixed(2)}%" title="Còn lại ${esc(fmt(team.remaining, metric))}"></i></div><span>${esc(fmt(team.delivered, metric))} / ${esc(fmt(team.total, metric))}</span></div>`;
  }).join('')}</div><div class="project-team-legend"><span><i class="project-team-delivered"></i>Đã bàn giao</span><span><i class="project-team-remaining"></i>Còn lại</span></div>`;
}

function receiverChart(rows, range, metric) {
  const receivers = new Map();
  for (const row of rows) {
    const date = isoDate(row?.handover_date);
    if (!date || !inRange(date, range)) continue;
    const receiver = String(row?.receiver || '').trim() || 'Chưa ghi đơn vị nhận';
    receivers.set(receiver, (receivers.get(receiver) || 0) + weight(row, STAGES[4]));
  }
  const ranked = [...receivers].sort((left, right) => right[1] - left[1]).slice(0, 10);
  if (!ranked.length) return '<div class="project-chart-empty">Chưa có khối lượng bàn giao trong khoảng ngày.</div>';
  const maxValue = Math.max(1, ...ranked.map(([, value]) => value));
  return `<div class="project-receiver-report">${ranked.map(([label, value]) => `<div class="project-receiver-row"><span title="${esc(label)}">${esc(label)}</span><div class="project-receiver-track"><i style="width:${(value / maxValue * 100).toFixed(2)}%"></i></div><b>${esc(fmt(value, metric))}</b></div>`).join('')}</div>`;
}

export function renderProjectDashboard(rows, options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const range = { from:String(options.from || ''), to:String(options.to || '') };
  const metric = options.metric === 'ton' ? 'ton' : 'kg';
  const filteredRows = sourceRows.filter((row) => {
    const dates = STAGES.map((stage) => isoDate(row?.[stage.date])).filter(Boolean);
    const hasActivity = STAGES.some((stage) => Boolean(row?.[stage.date])
      || number(row?.[stage.quantity]) !== null || (number(row?.[stage.weight]) || 0) > 0);
    return hasActivity && (!(range.from || range.to) || dates.some((date) => inRange(date, range)));
  });
  const total = sourceRows.reduce((sum, row) => sum + plannedWeight(row), 0);
  const delivered = sourceRows.reduce((sum, row) => sum + weight(row, STAGES[4]), 0);
  const remaining = Math.max(0, total - delivered);
  const percent = total ? Math.min(100, delivered / total * 100) : 0;
  const emptyRange = Boolean(range.from && range.to && range.from > range.to);
  return `<section class="project-dashboard" aria-label="Dashboard báo cáo quản lý dự án">
    <div class="project-report-filter"><label class="filter-label">Từ ngày<input type="date" id="projectDashboardStartDate" value="${esc(range.from)}"></label><label class="filter-label">Đến ngày<input type="date" id="projectDashboardEndDate" value="${esc(range.to)}"></label><label class="filter-label">Đơn vị<select id="projectDashboardMetric"><option value="kg" ${metric === 'kg' ? 'selected' : ''}>Khối lượng · kg</option><option value="ton" ${metric === 'ton' ? 'selected' : ''}>Khối lượng · tấn</option></select></label><span class="source-chip">Nguồn: ${esc(sourceRows[0]?.source_file || 'QLDA')}</span></div>
    <div class="stats-grid compact project-report-stats"><article class="stat-card"><div class="stat-top"><span>Tổng KL thiết kế</span><span class="stat-symbol">●</span></div><strong>${fmt(total, metric)}</strong><small>${metric === 'ton' ? 'tấn' : 'kg'} · toàn dự án</small></article><article class="stat-card green"><div class="stat-top"><span>Đã bàn giao</span><span class="stat-symbol">●</span></div><strong>${fmt(delivered, metric)}</strong><small>${fmt(percent, 'kg')}% khối lượng thiết kế</small></article><article class="stat-card gold"><div class="stat-top"><span>Khối lượng còn lại</span><span class="stat-symbol">●</span></div><strong>${fmt(remaining, metric)}</strong><small>${metric === 'ton' ? 'tấn' : 'kg'} · theo SL bàn giao</small></article><article class="stat-card blue"><div class="stat-top"><span>Cấu kiện có hoạt động</span><span class="stat-symbol">●</span></div><strong>${fmt(filteredRows.length)}</strong><small>${range.from || range.to ? 'Có ghi nhận trong khoảng ngày' : `Trên tổng ${fmt(sourceRows.length)} cấu kiện`}</small></article></div>
    ${emptyRange ? '<div class="notice error">Khoảng ngày không hợp lệ: ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</div>' : ''}
    <div class="project-report-grid"><figure class="project-report-card project-report-cumulative"><figcaption><strong>Lũy kế khối lượng theo ngày và công đoạn</strong><span>${range.from || range.to ? `${range.from || 'Đầu kỳ'} – ${range.to || 'Hiện tại'}` : 'Toàn bộ ngày ghi nhận'} · rê hoặc tab vào điểm để xem số liệu</span></figcaption>${emptyRange ? '' : cumulativeChart(sourceRows, range, metric)}</figure><figure class="project-report-card"><figcaption><strong>Tiến độ khối lượng 5 công đoạn</strong><span>Khối lượng đã ghi nhận so với tổng thiết kế</span></figcaption>${stageCompletionChart(sourceRows, metric)}</figure><figure class="project-report-card"><figcaption><strong>Bàn giao và khối lượng còn lại theo tổ</strong><span>Tổng hợp hiện tại · không phụ thuộc khoảng ngày</span></figcaption>${teamBacklogChart(sourceRows, metric)}</figure><figure class="project-report-card"><figcaption><strong>Khối lượng bàn giao theo đơn vị nhận</strong><span>${range.from || range.to ? `${range.from || 'Đầu kỳ'} – ${range.to || 'Hiện tại'}` : 'Toàn bộ ngày ghi nhận'} · tối đa 10 đơn vị</span></figcaption>${emptyRange ? '' : receiverChart(sourceRows, range, metric)}</figure></div>
    <p class="project-report-note"><b>Đường lũy kế hiện là khối lượng thực tế được ghi trong QLDA.</b> File đang có ngày hoàn thành và khối lượng thực tế theo công đoạn nhưng chưa có ngày mục tiêu hoặc đường kế hoạch chuẩn; vì vậy chưa thể tính đường S kế hoạch, chậm tiến độ hoặc dự báo ngày hoàn thành một cách đáng tin cậy.</p>
  </section>`;
}

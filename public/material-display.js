export function getMaterialReceiptDate(group) {
  const dates = [group?.delivery_date, ...(Array.isArray(group?.children)
    ? group.children.map((row) => row?.delivery_date)
    : [])]
    .flatMap((value) => String(value ?? '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  const uniqueDates = [...new Set(dates)].sort((left, right) => left.localeCompare(right, 'en'));
  return uniqueDates.join(', ') || null;
}

export function formatMaterialDate(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).split(',').map((part) => {
    const date = part.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!date) return part.trim();
    const [, year, month, day] = date;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day)) {
      return part.trim();
    }
    return `${day}/${month}/${year}`;
  }).join(', ');
}
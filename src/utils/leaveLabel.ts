// Centralized formatter for leave type + slot so every surface (badges,
// notifications, dashboard widget, leave history) renders the same string.
// Examples:
//   half_day + morning → "Half day · Morning"
//   short_leave + q2   → "Short leave · Q2"
//   full_day           → "Full day"
//   unpaid             → "Unpaid"

const SLOT_LABEL: Record<string, string> = {
  morning: 'Morning',
  evening: 'Evening',
  q1: 'Q1',
  q2: 'Q2',
  q3: 'Q3',
  q4: 'Q4',
};

export function leaveTypeLabel(type?: string | null, slot?: string | null): string {
  if (!type) return '';
  const base = type.replace(/_/g, ' ');
  const slotPart = slot && SLOT_LABEL[slot] ? ` · ${SLOT_LABEL[slot]}` : '';
  return `${base}${slotPart}`;
}

export function slotLabel(slot?: string | null): string | null {
  if (!slot) return null;
  return SLOT_LABEL[slot] ?? null;
}

// Notification types that REQUIRE the recipient to do something
// (approve / review / act) as opposed to purely informational
// updates ("your leave was approved", "someone paid your expense").
//
// This drives the "Action required" filter on the /notifications page
// and the top-bar bell, so admin/HR can cut through the FYI noise and
// see only items still waiting on them.
//
// Keep in sync with the backend notification producers in api/index.ts
// (search: notifyAdmins, notifyAdminsAndHR, notifyManagerOfEmployee).
// A new "someone submitted X" or "X needs your approval" type should
// be added here so the filter surfaces it.
export const ACTION_REQUIRED_TYPES: readonly string[] = [
  // Leave / attendance
  'leave_applied',
  'wfh_applied',
  // Expenses / incentives
  'expense_submitted',
  'upsell_submitted',
  // Project ops
  'allocation_request',
  // Assets / IT
  'asset_takeout_requested',
  'repair_ticket_created',
  'repair_approval_needed',
  // Finance
  'invoice_clear_requested',
  // Performance / HR
  'appraisal_submitted',
  'self_assessment_updated',
  // Feature flags (super-admin)
  'feature_draft',
];

const ACTION_SET = new Set(ACTION_REQUIRED_TYPES);
export function isActionRequired(type: string | null | undefined): boolean {
  return type != null && ACTION_SET.has(type);
}

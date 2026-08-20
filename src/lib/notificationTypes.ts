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
  // `leave_applied` is sent to the MANAGER (they must approve). Admin gets
  // either `leave_submitted` (FYI on optional-leave submissions — NOT in
  // this list, keeps admin's action badge honest) or `leave_needs_hr_approval`
  // (fallback when no manager exists, and post-manager final signoff — IS
  // in this list so admin sees action badge for it).
  'leave_applied',
  'leave_needs_hr_approval',
  'wfh_applied',
  'attendance_note_pending',
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
  // Hiring — Team Lead / interviewer handoffs. HR-side notifications
  // ('recommendation_ready', 'interview_feedback_submitted') aren't
  // action-required by themselves — they're FYI on someone else's
  // action — so they stay off this list.
  'candidate_review_requested',
  'interview_scheduled',
  // Task collaboration
  'task_assigned',
  'task_mention',
];

const ACTION_SET = new Set(ACTION_REQUIRED_TYPES);
export function isActionRequired(type: string | null | undefined): boolean {
  return type != null && ACTION_SET.has(type);
}

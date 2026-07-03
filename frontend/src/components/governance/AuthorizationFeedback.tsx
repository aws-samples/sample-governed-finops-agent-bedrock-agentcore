/**
 * AuthorizationFeedback - Shows the result of a Cedar authorization decision.
 * ALLOW (green), DENY (red), REQUIRES_APPROVAL (yellow).
 * Includes reason text and is dismissible.
 */

import type { AuthorizationDecision } from '../../types';
import './governance.css';

interface AuthorizationFeedbackProps {
  decision: AuthorizationDecision;
  reason: string;
  onDismiss: () => void;
}

const decisionConfig: Record<AuthorizationDecision, { label: string; className: string }> = {
  ALLOW: { label: 'Action Authorized', className: 'auth-feedback--allow' },
  DENY: { label: 'Action Denied', className: 'auth-feedback--deny' },
  REQUIRES_APPROVAL: { label: 'Pending Approval', className: 'auth-feedback--pending' },
};

function getDetailMessage(decision: AuthorizationDecision, reason: string): string {
  if (decision === 'DENY') {
    if (reason.toLowerCase().includes('role') || reason.toLowerCase().includes('analyst')) {
      return `Your role does not have permission for this action. ${reason}`;
    }
    if (reason.toLowerCase().includes('production')) {
      return `This resource is in a production environment. ${reason}`;
    }
    return reason;
  }
  if (decision === 'REQUIRES_APPROVAL') {
    return `This action requires human-in-the-loop approval. A notification has been sent to the designated approver. ${reason}`;
  }
  return reason;
}

export function AuthorizationFeedback({ decision, reason, onDismiss }: AuthorizationFeedbackProps) {
  const config = decisionConfig[decision];
  const detailMessage = getDetailMessage(decision, reason);

  return (
    <div className={`auth-feedback ${config.className}`} role="status" aria-live="polite">
      <div className="auth-feedback__message">
        <strong>{config.label}</strong>
        <div className="auth-feedback__reason">{detailMessage}</div>
      </div>
      <button
        className="auth-feedback__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        x
      </button>
    </div>
  );
}

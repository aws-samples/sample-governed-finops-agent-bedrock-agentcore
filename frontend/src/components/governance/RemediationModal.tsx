/**
 * RemediationModal - Confirmation modal for remediation actions.
 * Shows action details, risk level, and estimated savings.
 * High-risk actions display a warning about HITL approval.
 */

import type { RiskLevel } from '../../types';
import './governance.css';

interface RemediationModalProps {
  actionType: string;
  resourceId: string;
  riskLevel: RiskLevel;
  estimatedSavings: number;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RemediationModal({
  actionType,
  resourceId,
  riskLevel,
  estimatedSavings,
  loading = false,
  onConfirm,
  onCancel,
}: RemediationModalProps) {
  return (
    <div className="remediation-overlay" role="dialog" aria-modal="true" aria-label="Confirm remediation action">
      <div className="remediation-modal">
        <h2 className="remediation-modal__title">Confirm Remediation</h2>

        <div className="remediation-modal__detail">
          <span className="remediation-modal__label">Action</span>
          <span className="remediation-modal__value">{actionType}</span>
        </div>

        <div className="remediation-modal__detail">
          <span className="remediation-modal__label">Resource</span>
          <span className="remediation-modal__value">{resourceId}</span>
        </div>

        <div className="remediation-modal__detail">
          <span className="remediation-modal__label">Risk Level</span>
          <span className={`remediation-modal__risk remediation-modal__risk--${riskLevel}`}>
            {riskLevel}
          </span>
        </div>

        <div className="remediation-modal__detail">
          <span className="remediation-modal__label">Estimated Savings</span>
          <span className="remediation-modal__value">${estimatedSavings.toFixed(2)}/mo</span>
        </div>

        {riskLevel === 'high' && (
          <div className="remediation-modal__warning" role="alert">
            This is a high-risk action. It will require human-in-the-loop approval
            before execution. A notification will be sent to the designated approver.
          </div>
        )}

        <div className="remediation-modal__actions">
          <button
            className="remediation-modal__btn remediation-modal__btn--cancel"
            onClick={onCancel}
            disabled={loading}
            aria-label="Cancel action"
          >
            Cancel
          </button>
          <button
            className="remediation-modal__btn remediation-modal__btn--confirm"
            onClick={onConfirm}
            disabled={loading}
            aria-label="Confirm action"
          >
            {loading ? 'Processing...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

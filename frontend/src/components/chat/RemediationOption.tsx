import { useState } from 'react';
import type { RiskLevel, RemediationStatus } from '../../types';
import './chat.css';

export interface RemediationOptionData {
  id: string;
  action_type: string;
  resource_id: string;
  description: string;
  estimated_savings_monthly: number;
  risk_level: RiskLevel;
  parameters: Record<string, string>;
}

interface Props {
  option: RemediationOptionData;
  onExecute: (option: RemediationOptionData) => void;
  status: RemediationStatus;
}

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'Low Risk',
  medium: 'Medium Risk',
  high: 'High Risk',
};

const RISK_DESCRIPTIONS: Record<RiskLevel, string> = {
  low: 'Safe to execute. Minimal impact.',
  medium: 'May cause brief interruption.',
  high: 'Destructive action. Requires approval.',
};

const ACTION_LABELS: Record<string, string> = {
  resize_instance: 'Resize Instance',
  stop_instance: 'Stop Instance',
  terminate_instance: 'Terminate Instance',
  modify_storage: 'Modify Storage',
  add_tag: 'Add Tag',
  delete_snapshot: 'Delete Snapshot',
  delete_ebs_volume: 'Delete EBS Volume',
};

export function RemediationOption({ option, onExecute, status }: Props) {
  const [confirmed, setConfirmed] = useState(false);

  const handleClick = () => {
    if (option.risk_level === 'high' && !confirmed) {
      setConfirmed(true);
      return;
    }
    onExecute(option);
  };

  const isLoading = status === 'loading';
  const isDenied = status === 'denied';
  const isSuccess = status === 'success';
  const isPending = status === 'pending_approval';

  return (
    <div className={`remediation-option risk-${option.risk_level}`}>
      <div className="remediation-option-header">
        <span className="remediation-action-label">
          {ACTION_LABELS[option.action_type] || option.action_type}
        </span>
        <span className={`remediation-risk-badge risk-${option.risk_level}`}>
          {RISK_LABELS[option.risk_level]}
        </span>
      </div>

      <p className="remediation-description">{option.description}</p>

      <div className="remediation-details">
        <span className="remediation-resource">{option.resource_id}</span>
        <span className="remediation-savings">
          ~${option.estimated_savings_monthly.toFixed(2)}/mo savings
        </span>
      </div>

      <p className="remediation-risk-info">{RISK_DESCRIPTIONS[option.risk_level]}</p>

      {isSuccess && (
        <div className="remediation-status success">Action executed successfully.</div>
      )}
      {isDenied && (
        <div className="remediation-status denied">Access denied. Insufficient permissions.</div>
      )}
      {isPending && (
        <div className="remediation-status pending">Approval request sent. Awaiting manager review.</div>
      )}

      {status === 'idle' && (
        <button
          className={`remediation-execute-btn ${confirmed ? 'confirm' : ''}`}
          onClick={handleClick}
          disabled={isLoading}
        >
          {confirmed ? 'Confirm execution (high risk)' : 'Execute'}
        </button>
      )}
      {isLoading && (
        <button className="remediation-execute-btn" disabled>
          Executing...
        </button>
      )}
    </div>
  );
}

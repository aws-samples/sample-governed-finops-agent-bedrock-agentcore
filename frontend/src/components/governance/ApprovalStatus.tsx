import type { ApprovalRequest } from '../../types';
import './governance.css';

interface ApprovalStatusProps {
  approvals: ApprovalRequest[];
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'approval-status__badge--pending' },
  APPROVED: { label: 'Approved', className: 'approval-status__badge--approved' },
  DENIED: { label: 'Denied', className: 'approval-status__badge--denied' },
  EXPIRED: { label: 'Expired', className: 'approval-status__badge--expired' },
  EXECUTED: { label: 'Executed', className: 'approval-status__badge--executed' },
};

export function ApprovalStatus({ approvals }: ApprovalStatusProps) {
  if (approvals.length === 0) {
    return (
      <div className="approval-status">
        <h4 className="approval-status__title">Approval Requests</h4>
        <p className="approval-status__empty">No pending approval requests.</p>
      </div>
    );
  }

  return (
    <div className="approval-status">
      <h4 className="approval-status__title">Approval Requests</h4>
      <div className="approval-status__list">
        {approvals.map((req) => {
          const config = STATUS_CONFIG[req.status] || STATUS_CONFIG.PENDING;
          return (
            <div key={req.request_id} className="approval-status__item">
              <div className="approval-status__info">
                <span className="approval-status__action">{req.action_type}</span>
                <span className="approval-status__resource">{req.resource_id}</span>
              </div>
              <div className="approval-status__meta">
                <span className={`approval-status__badge ${config.className}`}>
                  {config.label}
                </span>
                <span className="approval-status__date">
                  {new Date(req.created_at).toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { RemediationStatus } from '../../types';
import './analytics.css';

export interface ExecutionRecord {
  id: string;
  resourceId: string;
  resourceType: string;
  action: string;
  status: RemediationStatus;
  requestedAt: string;
  completedAt?: string;
  requestedBy: string;
  policyDecision: string;
  savings?: number;
}

interface Props {
  records: ExecutionRecord[];
}

type FilterStatus = 'all' | 'success' | 'pending_approval' | 'denied';

export function ExecutionHistory({ records }: Props) {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');

  const filtered = records.filter(r => {
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

  const pendingCount = records.filter(r => r.status === 'pending_approval').length;
  const executedCount = records.filter(r => r.status === 'success').length;
  const deniedCount = records.filter(r => r.status === 'denied').length;

  function getStatusBadge(status: RemediationStatus) {
    switch (status) {
      case 'success': return <span className="exec-status-badge executed">Executed</span>;
      case 'pending_approval': return <span className="exec-status-badge pending">Pending Approval</span>;
      case 'denied': return <span className="exec-status-badge denied">Denied</span>;
      default: return <span className="exec-status-badge">{status}</span>;
    }
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div className="execution-history">
      <div className="exec-stats">
        <div className="exec-stat-card">
          <div className="exec-stat-value executed-text">{executedCount}</div>
          <div className="exec-stat-label">Executed</div>
        </div>
        <div className="exec-stat-card">
          <div className="exec-stat-value pending-text">{pendingCount}</div>
          <div className="exec-stat-label">Pending Approval</div>
        </div>
        <div className="exec-stat-card">
          <div className="exec-stat-value denied-text">{deniedCount}</div>
          <div className="exec-stat-label">Denied</div>
        </div>
      </div>

      <div className="exec-filter-bar">
        <button
          className={`exec-filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          All ({records.length})
        </button>
        <button
          className={`exec-filter-btn ${statusFilter === 'success' ? 'active' : ''}`}
          onClick={() => setStatusFilter('success')}
        >
          Executed ({executedCount})
        </button>
        <button
          className={`exec-filter-btn ${statusFilter === 'pending_approval' ? 'active' : ''}`}
          onClick={() => setStatusFilter('pending_approval')}
        >
          Pending ({pendingCount})
        </button>
        <button
          className={`exec-filter-btn ${statusFilter === 'denied' ? 'active' : ''}`}
          onClick={() => setStatusFilter('denied')}
        >
          Denied ({deniedCount})
        </button>
      </div>

      <div className="exec-list">
        {filtered.length === 0 ? (
          <p className="exec-empty">No records match the current filter.</p>
        ) : (
          filtered.map(record => (
            <div key={record.id} className={`exec-card ${record.status}`}>
              <div className="exec-card-header">
                <div className="exec-card-resource">
                  <span className="exec-resource-type">{record.resourceType}</span>
                  <span className="exec-resource-id">{record.resourceId}</span>
                </div>
                {getStatusBadge(record.status)}
              </div>
              <div className="exec-card-action">{record.action}</div>
              <div className="exec-card-details">
                <div className="exec-detail">
                  <span className="exec-detail-label">Requested:</span>
                  <span>{formatDate(record.requestedAt)}</span>
                </div>
                {record.completedAt && (
                  <div className="exec-detail">
                    <span className="exec-detail-label">Completed:</span>
                    <span>{formatDate(record.completedAt)}</span>
                  </div>
                )}
                <div className="exec-detail">
                  <span className="exec-detail-label">By:</span>
                  <span>{record.requestedBy}</span>
                </div>
                <div className="exec-detail">
                  <span className="exec-detail-label">Policy:</span>
                  <span className="exec-policy">{record.policyDecision}</span>
                </div>
                {record.savings && record.status === 'success' && (
                  <div className="exec-detail">
                    <span className="exec-detail-label">Savings:</span>
                    <span className="exec-savings-value">${record.savings.toFixed(2)}/mo</span>
                  </div>
                )}
              </div>
              {record.status === 'pending_approval' && (
                <div className="exec-pending-notice">
                  Awaiting manager approval via email notification
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

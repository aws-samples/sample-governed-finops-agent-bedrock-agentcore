import './dashboard.css';
import type { RemediationStatus } from '../../types';

export interface RecommendationData {
  id: string;
  resourceId: string;
  resourceType: string;
  category: string;
  action: string;
  reason: string;
  estimatedSavings: number;
  riskLevel: 'low' | 'medium' | 'high';
  priorityScore: number;
  actionType: string;
  parameters: Record<string, string>;
}

interface Props {
  recommendation: RecommendationData;
  onExecute: (rec: RecommendationData) => void;
  status?: RemediationStatus;
}

export function RecommendationCard({ recommendation: rec, onExecute, status = 'idle' }: Props) {
  const isLoading = status === 'loading';
  const isExecuted = status === 'success';
  const isDenied = status === 'denied';
  const isPending = status === 'pending_approval';

  function getButtonLabel() {
    if (isLoading) return 'Executing...';
    if (isExecuted) return 'Executed';
    if (isDenied) return 'Denied';
    if (isPending) return 'Pending Approval';
    return 'Execute';
  }

  function getButtonClass() {
    if (isExecuted) return 'rec-execute-btn executed';
    if (isDenied) return 'rec-execute-btn denied';
    if (isPending) return 'rec-execute-btn pending';
    return 'rec-execute-btn';
  }

  return (
    <div className="rec-card">
      <div className="rec-header">
        <div className="rec-resource">
          {rec.resourceType} <span className="rec-resource-id">{rec.resourceId}</span>
        </div>
        <div className="rec-meta">
          <span className={`rec-badge ${rec.riskLevel}`}>{rec.riskLevel}</span>
          <span className={`rec-badge category${rec.category === 'best_practices' ? '-best_practices' : ''}`}>
            {rec.category.replace('_', ' ')}
          </span>
        </div>
      </div>
      <div className="rec-body">
        <div className="rec-action">{rec.action}</div>
        <div className="rec-reason">{rec.reason}</div>
      </div>
      <div className="rec-footer">
        <span className="rec-savings">
          {rec.estimatedSavings > 0
            ? `$${rec.estimatedSavings.toFixed(2)}/mo potential savings`
            : 'Operational best practice'}
        </span>
        <button
          className={getButtonClass()}
          onClick={() => onExecute(rec)}
          disabled={isLoading || isExecuted || isPending}
        >
          {getButtonLabel()}
        </button>
      </div>
    </div>
  );
}

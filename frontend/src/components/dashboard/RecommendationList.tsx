import { useState } from 'react';
import { RecommendationCard, type RecommendationData } from './RecommendationCard';
import type { RemediationStatus } from '../../types';
import './dashboard.css';

interface Props {
  recommendations: RecommendationData[];
  onExecute: (rec: RecommendationData) => void;
  statuses: Record<string, RemediationStatus>;
}

export function RecommendationList({ recommendations, onExecute, statuses }: Props) {
  const [riskFilter, setRiskFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const filtered = recommendations.filter(rec => {
    if (riskFilter !== 'all' && rec.riskLevel !== riskFilter) return false;
    if (categoryFilter !== 'all' && rec.category !== categoryFilter) return false;
    return true;
  });

  const categories = [...new Set(recommendations.map(r => r.category))];
  const totalSavings = filtered.reduce((sum, r) => sum + r.estimatedSavings, 0);
  const bestPracticesCount = filtered.filter(r => r.category === 'best_practices').length;

  return (
    <div>
      <div className="rec-summary-bar">
        <div className="rec-summary-info">
          <span className="rec-summary-count">
            {filtered.length} recommendations
            {bestPracticesCount > 0 && ` (${bestPracticesCount} best practices)`}
          </span>
          <span className="rec-summary-savings">
            Potential savings: <strong>${totalSavings.toFixed(2)}/mo</strong>
          </span>
        </div>
        <div className="dashboard-filters">
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All Categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c.replace('_', ' ')}</option>
            ))}
          </select>
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value)}
            aria-label="Filter by risk"
          >
            <option value="all">All Risk Levels</option>
            <option value="low">Low Risk</option>
            <option value="medium">Medium Risk</option>
            <option value="high">High Risk</option>
          </select>
        </div>
      </div>
      <div className="rec-list">
        {filtered.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center' }}>
            No recommendations match the current filters.
          </p>
        ) : (
          filtered.map(rec => (
            <RecommendationCard
              key={rec.id}
              recommendation={rec}
              onExecute={onExecute}
              status={statuses[rec.id]}
            />
          ))
        )}
      </div>
    </div>
  );
}

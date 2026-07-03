import './dashboard.css';

interface Props {
  totalSpend: string;
  potentialSavings: string;
  recommendationCount: number;
}

export function CostSummaryCards({ totalSpend, potentialSavings, recommendationCount }: Props) {
  return (
    <div className="summary-cards">
      <div className="summary-card">
        <div className="summary-value">{totalSpend}</div>
        <div className="summary-label">Monthly Spend</div>
      </div>
      <div className="summary-card savings">
        <div className="summary-value">{potentialSavings}</div>
        <div className="summary-label">Potential Savings</div>
      </div>
      <div className="summary-card">
        <div className="summary-value">{recommendationCount}</div>
        <div className="summary-label">Recommendations</div>
      </div>
    </div>
  );
}

export interface BeforeAfterData {
  resourceId: string;
  previousCost: number;
  currentCost: number;
  date: string;
}

interface BeforeAfterCardProps {
  data: BeforeAfterData;
}

export function BeforeAfterCard({ data }: BeforeAfterCardProps) {
  const savings = data.previousCost - data.currentCost;
  const hasSavings = savings > 0;

  return (
    <div className={`before-after-card ${hasSavings ? 'has-savings' : ''}`}>
      <div className="ba-resource">
        <div className="ba-resource-id">{data.resourceId}</div>
        <div className="ba-date">Remediated: {data.date}</div>
      </div>

      <div className="ba-costs">
        <div className="ba-cost-item">
          <div className="ba-cost-label">Before</div>
          <div className="ba-cost-value previous">${data.previousCost.toFixed(2)}/mo</div>
        </div>

        <span className="ba-arrow">→</span>

        <div className="ba-cost-item">
          <div className="ba-cost-label">After</div>
          <div className="ba-cost-value current">${data.currentCost.toFixed(2)}/mo</div>
        </div>
      </div>

      <div className="ba-savings">
        <div className="ba-savings-value">-${savings.toFixed(2)}</div>
        <div className="ba-savings-label">saved/mo</div>
      </div>
    </div>
  );
}

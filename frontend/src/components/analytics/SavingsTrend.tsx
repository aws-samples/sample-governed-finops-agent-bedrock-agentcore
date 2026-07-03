import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// Sample data - will connect to real data later
const sampleData = [
  { date: '2025-01-01', savings: 0 },
  { date: '2025-01-15', savings: 25 },
  { date: '2025-02-01', savings: 73 },
  { date: '2025-02-15', savings: 98 },
  { date: '2025-03-01', savings: 145 },
  { date: '2025-03-15', savings: 210 },
  { date: '2025-04-01', savings: 285 },
  { date: '2025-04-15', savings: 340 },
  { date: '2025-05-01', savings: 420 },
  { date: '2025-05-15', savings: 510 },
  { date: '2025-06-01', savings: 580 },
];

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function SavingsTrend() {
  return (
    <div className="savings-chart-wrapper">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={sampleData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#3d4852" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            stroke="#b0b8c1"
            fontSize={12}
          />
          <YAxis
            stroke="#b0b8c1"
            fontSize={12}
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip
            contentStyle={{
              background: '#1a1f26',
              border: '1px solid #3d4852',
              borderRadius: 6,
              color: '#fff',
            }}
            labelFormatter={formatDate}
            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cumulative Savings']}
          />
          <Line
            type="monotone"
            dataKey="savings"
            stroke="#ff9900"
            strokeWidth={2}
            dot={{ fill: '#ff9900', r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

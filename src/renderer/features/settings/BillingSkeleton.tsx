import { Metric } from './BillingMetric.js';

export function BillingSkeleton() {
  return <div className="billing-panel"><p className="settings-muted">Current organization wallet</p><div className="billing-grid"><Metric label="Balance" value="0 USD" loading /><Metric label="Bonus" value="0 USD" loading /><Metric label="Outstanding debt" value="0 USD" loading /></div></div>;
}

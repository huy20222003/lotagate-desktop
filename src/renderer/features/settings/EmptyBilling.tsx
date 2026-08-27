import { Card } from '../../components/ui.js';

export function EmptyBilling({ detail }: { detail: string }) {
  return <Card className="settings-empty"><strong>Billing unavailable</strong><p>{detail}</p></Card>;
}

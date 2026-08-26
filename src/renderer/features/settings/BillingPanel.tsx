import { useEffect, useState } from 'react';
import { Card, Skeleton, Table } from '../../components/ui.js';
import { Pagination } from '../../components/Pagination.js';
import { formatTime } from '../../utils/time.js';
import { extractArray, isRecord, readString } from '../../utils/data.js';
import { toUserErrorMessage } from '../../utils/errors.js';

export function BillingPanel({ organizationCode }: { organizationCode?: string }) {
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [walletLoading, setWalletLoading] = useState(Boolean(organizationCode));
  const [walletError, setWalletError] = useState<string | undefined>();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState<string | undefined>();
  const [paymentPage, setPaymentPage] = useState(1);
  useEffect(() => {
    let mounted = true;
    setWalletLoading(Boolean(organizationCode)); setWalletError(undefined); setPaymentsLoading(true); setPaymentsError(undefined); setPaymentPage(1);
    const walletRequest = organizationCode === undefined ? Promise.resolve(null) : window.lotagate.userContext.wallet(organizationCode);
    void Promise.allSettled([walletRequest, window.lotagate.userContext.paymentHistory()]).then(([walletResult, paymentsResult]) => {
      if (!mounted) return;
      if (walletResult.status === 'fulfilled') setWallet(normalizeWallet(walletResult.value)); else setWalletError(toUserErrorMessage(walletResult.reason, 'Unable to load billing information.'));
      if (paymentsResult.status === 'fulfilled') setPayments(normalizePaymentHistory(paymentsResult.value)); else setPaymentsError(toUserErrorMessage(paymentsResult.reason, 'Unable to load payment history.'));
      setWalletLoading(false); setPaymentsLoading(false);
    });
    return () => { mounted = false; };
  }, [organizationCode]);
  const pageSize = 8;
  const visiblePayments = payments.slice((paymentPage - 1) * pageSize, paymentPage * pageSize);
  const paymentColumns = [{ key: 'date', label: 'Date', render: (row: PaymentRecord) => formatPaymentDate(row.date) }, { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount', render: (row: PaymentRecord) => `${row.amount} ${row.currency}` }, { key: 'status', label: 'Status' }];
  return <div className="billing-panel">{organizationCode ? walletLoading ? <BillingSkeleton /> : walletError ? <EmptyBilling detail={walletError} /> : wallet ? <div><p className="settings-muted">Current organization wallet</p><div className="billing-grid"><Metric label="Balance" value={`${wallet.balance} ${wallet.currency}`} /><Metric label="Bonus" value={`${wallet.bonus} ${wallet.currency}`} /><Metric label="Outstanding debt" value={`${wallet.outstandingDebt} ${wallet.currency}`} /></div>{wallet.updatedAt ? <p className="settings-muted">Updated {formatTime(wallet.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}</p> : null}</div> : <EmptyBilling detail="No wallet information is available." /> : null}<section className="billing-history"><div className="billing-history-heading"><div><h2>Payment history</h2><p className="settings-muted">Payments made by this account.</p></div></div>{paymentsError ? <EmptyBilling detail={paymentsError} /> : paymentsLoading ? <PaymentHistorySkeleton /> : payments.length === 0 ? <EmptyBilling detail="No payments have been recorded yet." /> : <><Table columns={paymentColumns} rows={visiblePayments} /><Pagination page={paymentPage} pageSize={pageSize} total={payments.length} onPageChange={setPaymentPage} /></>}</section></div>;
}
function BillingSkeleton() { return <div className="billing-panel"><p className="settings-muted">Current organization wallet</p><div className="billing-grid"><Metric label="Balance" value="0 USD" loading /><Metric label="Bonus" value="0 USD" loading /><Metric label="Outstanding debt" value="0 USD" loading /></div></div>; }
function PaymentHistorySkeleton() { return <div className="billing-history-skeleton">{[1, 2, 3, 4].map(index => <Card key={index}><Skeleton className="billing-history-skeleton-line" /></Card>)}</div>; }
function Metric({ label, value, loading = false }: { label: string; value: string; loading?: boolean }) { return <Card className="billing-metric"><span>{label}</span><strong>{loading ? <Skeleton className="skeleton-value">{value}</Skeleton> : value}</strong></Card>; }
function EmptyBilling({ detail }: { detail: string }) { return <Card className="settings-empty"><strong>Billing unavailable</strong><p>{detail}</p></Card>; }
interface WalletSnapshot { balance: string; bonus: string; outstandingDebt: string; currency: string; updatedAt?: string }
interface PaymentRecord { id: string; date: string; description: string; amount: string; currency: string; status: string }
function normalizeWallet(value: unknown): WalletSnapshot | null { if (!isRecord(value)) return null; const updatedAt = readString(value['updatedAt']); return { balance: toDisplayValue(value['balance']), bonus: toDisplayValue(value['bonus']), outstandingDebt: toDisplayValue(value['outstandingDebt']), currency: readString(value['currency']) ?? 'USD', ...(updatedAt === undefined ? {} : { updatedAt }) }; }
function toDisplayValue(value: unknown): string { return typeof value === 'number' || typeof value === 'string' ? String(value) : '0'; }
function normalizePaymentHistory(value: unknown): PaymentRecord[] { return extractArray(value, ['payments', 'items', 'history', 'data']).flatMap((item, index) => { if (!isRecord(item)) return []; return [{ id: readRecordString(item, ['id', 'paymentId', 'transactionId']) ?? `payment-${index}`, date: readRecordString(item, ['paidAt', 'createdAt', 'date']) ?? '', description: readRecordString(item, ['description', 'reason', 'method']) ?? 'Payment', amount: toDisplayValue(item['amount'] ?? item['totalAmount'] ?? item['value']), currency: readRecordString(item, ['currency', 'currencyCode']) ?? 'USD', status: readRecordString(item, ['status', 'state']) ?? 'Completed' }]; }); }
function readRecordString(record: Record<string, unknown>, keys: readonly string[]): string | undefined { for (const key of keys) { const value = readString(record[key]); if (value) return value; } return undefined; }
function formatPaymentDate(value: string): string { if (!value) return '—'; const timestamp = Date.parse(value); return Number.isNaN(timestamp) ? value : formatTime(value, { dateStyle: 'medium' }); }

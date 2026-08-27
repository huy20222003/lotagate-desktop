import { useEffect, useState } from 'react';
import { Badge, Table } from '../../components/ui.js';
import { Pagination } from '../../components/Pagination.js';
import { formatTime } from '../../utils/time.js';
import { extractArray, isRecord, readNumber, readString } from '../../utils/data.js';
import { toUserErrorMessage } from '../../utils/errors.js';
import { BillingSkeleton } from './BillingSkeleton.js';
import { PaymentHistorySkeleton } from './PaymentHistorySkeleton.js';
import { Metric } from './BillingMetric.js';
import { EmptyBilling } from './EmptyBilling.js';

const PAYMENT_PAGE_SIZE = 10;

export function BillingPanel({ organizationCode }: { organizationCode?: string }) {
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [walletLoading, setWalletLoading] = useState(Boolean(organizationCode));
  const [walletError, setWalletError] = useState<string | undefined>();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState<string | undefined>();
  const [paymentPage, setPaymentPage] = useState(1);
  const [paymentTotal, setPaymentTotal] = useState(0);
  useEffect(() => {
    let mounted = true;
    setWalletLoading(Boolean(organizationCode));
    setWalletError(undefined);
    if (organizationCode === undefined) { setWallet(null); setWalletLoading(false); return () => { mounted = false; }; }
    void window.lotagate.userContext.wallet(organizationCode).then(value => { if (mounted) setWallet(normalizeWallet(value)); }).catch(reason => { if (mounted) setWalletError(toUserErrorMessage(reason, 'Unable to load billing information.')); }).finally(() => { if (mounted) setWalletLoading(false); });
    return () => { mounted = false; };
  }, [organizationCode]);
  useEffect(() => {
    setPaymentPage(1);
  }, [organizationCode]);
  useEffect(() => {
    let mounted = true;
    setPaymentsLoading(Boolean(organizationCode));
    setPaymentsError(undefined);
    if (organizationCode === undefined) { setPayments([]); setPaymentTotal(0); setPaymentsLoading(false); return () => { mounted = false; }; }
    void window.lotagate.userContext.paymentHistory(organizationCode, paymentPage, PAYMENT_PAGE_SIZE).then(value => { if (!mounted) return; const result = normalizePaymentHistory(value); setPayments(result.records); setPaymentTotal(result.total); }).catch(reason => { if (mounted) setPaymentsError(toUserErrorMessage(reason, 'Unable to load payment history.')); }).finally(() => { if (mounted) setPaymentsLoading(false); });
    return () => { mounted = false; };
  }, [organizationCode, paymentPage]);
  const paymentColumns = [{ key: 'date', label: 'Date', render: (row: PaymentRecord) => formatPaymentDate(row.date) }, { key: 'description', label: 'Description' }, { key: 'amount', label: 'Amount', render: (row: PaymentRecord) => `${row.amount} ${row.currency}` }, { key: 'status', label: 'Status', render: (row: PaymentRecord) => <Badge tone={paymentStatusTone(row.status)}>{row.status}</Badge> }];
  return <div className="billing-panel">{organizationCode ? walletLoading ? <BillingSkeleton /> : walletError ? <EmptyBilling detail={walletError} /> : wallet ? <div><p className="settings-muted">Current organization wallet</p><div className="billing-grid"><Metric label="Balance" value={`${wallet.balance} ${wallet.currency}`} /><Metric label="Bonus" value={`${wallet.bonus} ${wallet.currency}`} /><Metric label="Outstanding debt" value={`${wallet.outstandingDebt} ${wallet.currency}`} /></div>{wallet.updatedAt ? <p className="settings-muted">Updated {formatTime(wallet.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}</p> : null}</div> : <EmptyBilling detail="No wallet information is available." /> : null}<section className="billing-history"><div className="billing-history-heading"><div><h2>Payment history</h2><p className="settings-muted">Payments made by this account.</p></div></div>{paymentsError ? <EmptyBilling detail={paymentsError} /> : paymentsLoading ? <PaymentHistorySkeleton /> : payments.length === 0 ? <EmptyBilling detail="No payments have been recorded yet." /> : <><Table columns={paymentColumns} rows={payments} /><Pagination page={paymentPage} pageSize={PAYMENT_PAGE_SIZE} total={paymentTotal} onPageChange={setPaymentPage} /></>}</section></div>;
}
interface WalletSnapshot { balance: string; bonus: string; outstandingDebt: string; currency: string; updatedAt?: string }
interface PaymentRecord { id: string; date: string; description: string; amount: string; currency: string; status: string }
function normalizeWallet(value: unknown): WalletSnapshot | null { if (!isRecord(value)) return null; const updatedAt = readString(value['updatedAt']); return { balance: toDisplayValue(value['balance']), bonus: toDisplayValue(value['bonus']), outstandingDebt: toDisplayValue(value['outstandingDebt']), currency: readString(value['currency']) ?? 'USD', ...(updatedAt === undefined ? {} : { updatedAt }) }; }
function toDisplayValue(value: unknown): string { return typeof value === 'number' || typeof value === 'string' ? String(value) : '0'; }
function normalizePaymentHistory(value: unknown): { records: PaymentRecord[]; total: number } {
  const container = isRecord(value) && isRecord(value['data']) ? value['data'] : value;
  const records = extractArray(container, ['payments', 'items', 'history', 'data']).flatMap((item, index) => {
    if (!isRecord(item)) return [];
    return [{ id: readRecordString(item, ['id', 'paymentId', 'transactionId']) ?? `payment-${index}`, date: readRecordString(item, ['paidAt', 'createdAt', 'date']) ?? '', description: readRecordString(item, ['description', 'reason', 'method']) ?? 'Payment', amount: toDisplayValue(item['amount'] ?? item['totalAmount'] ?? item['value']), currency: readRecordString(item, ['currency', 'currencyCode']) ?? 'USD', status: readRecordString(item, ['status', 'state']) ?? 'Completed' }];
  });
  const total = isRecord(container) ? readNumber(container['total']) ?? readNumber(container['count']) : undefined;
  return { records, total: Math.max(total ?? records.length, records.length) };
}
function readRecordString(record: Record<string, unknown>, keys: readonly string[]): string | undefined { for (const key of keys) { const value = readString(record[key]); if (value) return value; } return undefined; }
function formatPaymentDate(value: string): string { if (!value) return '—'; const timestamp = Date.parse(value); return Number.isNaN(timestamp) ? value : formatTime(value, { dateStyle: 'medium' }); }
function paymentStatusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'PENDING' || status === 'REFUNDED') return 'warning';
  return 'neutral';
}

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '@/components/layout/Navbar';
import { api } from '@/lib/api';
import { useUser } from '@/store/authStore';
import { useRouter } from 'next/navigation';
import { Loader2, Users, Home, Flag, MessageSquare, User, MessageCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn, formatTimeAgo } from '@/lib/utils';

// Reports predate `targetType` (it's a nullable, backfilled-default-LISTING
// column) -- a row from before the migration has no value for it at all, so
// this must be treated the same as an explicit 'LISTING'.
type ReportTargetType = 'LISTING' | 'USER' | 'MESSAGE';
function targetTypeOf(r: any): ReportTargetType {
  return r.targetType || 'LISTING';
}

const TYPE_CHIP: Record<ReportTargetType, { label: string; icon: any; className: string }> = {
  LISTING: { label: 'Listing', icon: Home, className: 'bg-brand-50 text-brand-700' },
  USER: { label: 'User', icon: User, className: 'bg-amber-50 text-amber-700' },
  MESSAGE: { label: 'Message', icon: MessageCircle, className: 'bg-purple-50 text-purple-700' },
};

function TypeChip({ type }: { type: ReportTargetType }) {
  const { label, icon: Icon, className } = TYPE_CHIP[type];
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide', className)}>
      <Icon size={10} /> {label}
    </span>
  );
}

type ReportStatusFilter = 'PENDING' | 'RESOLVED' | 'DISMISSED';
const STATUS_TABS: { value: ReportStatusFilter; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DISMISSED', label: 'Dismissed' },
];

export default function AdminPage() {
  const user = useUser();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageDetail, setMessageDetail] = useState<any | null>(null);
  // Reports are fetched one status at a time (the backend defaults to
  // PENDING when no ?status is given) -- this tab lets a moderator also
  // look up already-resolved/dismissed reports, e.g. to confirm resolvedAt
  // was stamped correctly or to check a message report's retention state.
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>('PENDING');
  const { toast } = useToast();

  useEffect(() => {
    if (user && user.role === 'USER') { router.push('/'); return; }
    setLoading(true);
    Promise.all([
      api.get<any>('/admin/stats'),
      api.get<any>(`/admin/reports?status=${statusFilter}`),
    ]).then(([s, r]) => {
      setStats(s.data);
      setReports(r.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user, statusFilter]);

  if (!user || user.role === 'USER') return null;

  return (
    <div className="min-h-dvh">
      <Navbar />
      <main className="pt-[72px] max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="font-serif text-3xl mb-8">Admin Panel</h1>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-muted" /></div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
              {stats && [
                { icon: Users, label: 'Total users', value: stats.users },
                { icon: Home, label: 'Active listings', value: stats.activeListings },
                { icon: Flag, label: 'Pending reports', value: stats.pendingReports },
                { icon: MessageSquare, label: 'Messages', value: stats.messages },
              ].map(s => (
                <div key={s.label} className="bg-white border border-ink/8 rounded-2xl p-5 shadow-card">
                  <s.icon size={20} className="text-muted mb-3" />
                  <p className="text-2xl font-bold text-brand-700">{s.value?.toLocaleString()}</p>
                  <p className="text-xs text-muted">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Reports */}
            <div className="bg-white border border-ink/8 rounded-3xl shadow-card overflow-hidden">
              <div className="px-6 py-4 border-b border-ink/8 flex items-center justify-between gap-4 flex-wrap">
                <h2 className="font-semibold">{STATUS_TABS.find(t => t.value === statusFilter)?.label} Reports</h2>
                <div className="flex gap-1.5">
                  {STATUS_TABS.map(tab => (
                    <button
                      key={tab.value}
                      onClick={() => setStatusFilter(tab.value)}
                      className={cn(
                        'px-3 py-1 text-xs font-semibold rounded-full transition-colors',
                        statusFilter === tab.value ? 'bg-brand-700 text-white' : 'bg-gray-100 hover:bg-gray-200'
                      )}>
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              {reports.length === 0 ? (
                <div className="py-12 text-center text-muted">
                  <Flag size={32} className="mx-auto mb-3 opacity-20" />
                  <p>No {statusFilter.toLowerCase()} reports</p>
                </div>
              ) : (
                <div className="divide-y divide-ink/6">
                  {reports.map((r: any) => {
                    const type = targetTypeOf(r);
                    return (
                      <div key={r.id} className="px-6 py-4 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <TypeChip type={type} />
                            <p className="font-semibold text-sm">{r.reason}</p>
                          </div>
                          <p className="text-xs text-muted">{r.description || 'No description'}</p>
                          <p className="text-xs text-muted mt-1">By: {r.reporter?.name} {r.reporter?.email && `(${r.reporter.email})`}</p>
                          {r.resolvedAt && (
                            <p className="text-xs text-muted">Resolved: {formatTimeAgo(r.resolvedAt)}{r.resolution ? ` — ${r.resolution}` : ''}</p>
                          )}

                          {type === 'LISTING' && (
                            <p className="text-xs text-muted">Listing: {r.listing?.title || 'Listing no longer available'}</p>
                          )}

                          {type === 'USER' && (
                            <div className="text-xs text-muted">
                              <p>
                                Reported user: {r.reportedUser?.name || 'Unknown'} ({r.reportedUser?.email || 'no email on record'})
                                {r.reportedUser?.isBanned && (
                                  <span className="ml-1.5 text-red-600 font-semibold">Already restricted</span>
                                )}
                              </p>
                              {r.reporterHistory && (
                                <p>
                                  This reporter has filed {r.reporterHistory.totalFiled} report(s) total,
                                  {' '}{r.reporterHistory.dismissed} dismissed.
                                </p>
                              )}
                            </div>
                          )}

                          {type === 'MESSAGE' && (() => {
                            const sender = r.messageSender || r.message?.sender;
                            return (
                              <div className="text-xs text-muted">
                                <p>From: {sender?.name || 'Unknown'} {sender?.email && `(${sender.email})`}</p>
                                <p>To: {r.recipient?.name || 'Unknown'} {r.recipient?.email && `(${r.recipient.email})`}</p>
                                {r.message?.createdAt && <p>Sent: {formatTimeAgo(r.message.createdAt)}</p>}
                                {r.retentionHold && (
                                  <p className="text-amber-700 font-semibold">
                                    Retention hold active{r.retentionHoldReason ? `: ${r.retentionHoldReason}` : ''}
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                          {statusFilter === 'PENDING' && (
                            <button
                              onClick={async () => {
                                await api.patch(`/admin/reports/${r.id}`, { status: 'RESOLVED', resolution: 'Reviewed and dismissed' });
                                setReports(prev => prev.filter(rep => rep.id !== r.id));
                                toast({ title: 'Report dismissed' });
                              }}
                              className="px-3 py-1.5 text-xs font-semibold bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                              Dismiss
                            </button>
                          )}
                          {type === 'MESSAGE' && (
                            <button
                              onClick={() => setMessageDetail(r)}
                              className="px-3 py-1.5 text-xs font-semibold bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                              Reported message
                            </button>
                          )}
                          {type === 'MESSAGE' && (r.conversationId || r.message?.conversationId) && (
                            <Link
                              href={`/messages?conv=${r.conversationId || r.message?.conversationId}`}
                              className="px-3 py-1.5 text-xs font-semibold bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                              Full conversation
                            </Link>
                          )}
                          {type === 'MESSAGE' && (
                            <button
                              onClick={async () => {
                                if (r.retentionHold) {
                                  await api.patch(`/admin/reports/${r.id}`, { retentionHold: false });
                                  setReports(prev => prev.map(rep => rep.id === r.id ? { ...rep, retentionHold: false, retentionHoldReason: undefined } : rep));
                                  toast({ title: 'Retention hold removed' });
                                } else {
                                  const reason = window.prompt('Reason for the retention hold (active investigation, dispute, or legal preservation):');
                                  if (!reason || reason.trim().length < 5) return;
                                  await api.patch(`/admin/reports/${r.id}`, { retentionHold: true, retentionHoldReason: reason.trim() });
                                  setReports(prev => prev.map(rep => rep.id === r.id ? { ...rep, retentionHold: true, retentionHoldReason: reason.trim() } : rep));
                                  toast({ title: 'Retention hold placed' });
                                }
                              }}
                              className="px-3 py-1.5 text-xs font-semibold bg-amber-50 text-amber-700 rounded-full hover:bg-amber-100 transition-colors">
                              {r.retentionHold ? 'Remove retention hold' : 'Place retention hold'}
                            </button>
                          )}
                          {type === 'LISTING' && statusFilter === 'PENDING' && (
                            <button
                              onClick={async () => {
                                if (!r.listing) return;
                                await api.delete(`/admin/listings/${r.listing.id}`);
                                await api.patch(`/admin/reports/${r.id}`, { status: 'RESOLVED', resolution: 'Listing removed' });
                                setReports(prev => prev.filter(rep => rep.id !== r.id));
                                toast({ title: 'Listing removed' });
                              }}
                              className="px-3 py-1.5 text-xs font-semibold bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">
                              Remove listing
                            </button>
                          )}
                          {type === 'USER' && statusFilter === 'PENDING' && r.reportedUser && !r.reportedUser.isBanned && user?.role === 'ADMIN' && (
                            <button
                              onClick={async () => {
                                const reason = window.prompt(`Reason for restricting ${r.reportedUser.name}'s account:`);
                                if (!reason || reason.trim().length < 5) return;
                                await api.patch(`/admin/users/${r.reportedUser.id}/ban`, { reason: reason.trim() });
                                await api.patch(`/admin/reports/${r.id}`, { status: 'RESOLVED', resolution: 'Account restricted' });
                                setReports(prev => prev.filter(rep => rep.id !== r.id));
                                toast({ title: 'User restricted' });
                              }}
                              className="px-3 py-1.5 text-xs font-semibold bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">
                              Restrict user
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {messageDetail && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reported-message-title"
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setMessageDetail(null); }}
        >
          <div className="w-full max-w-md bg-white rounded-3xl shadow-elevated p-6">
            <h3 id="reported-message-title" className="font-serif text-xl mb-1">Reported message</h3>
            <p className="text-xs text-muted mb-3">
              From {messageDetail.messageSender?.name || messageDetail.message?.sender?.name || 'Unknown'}
              {' '}({(messageDetail.messageSender || messageDetail.message?.sender)?.email || 'no email on record'})
              {' '}to {messageDetail.recipient?.name || 'Unknown'}
              {' '}({messageDetail.recipient?.email || 'no email on record'})
              {messageDetail.message?.createdAt && <> · {formatTimeAgo(messageDetail.message.createdAt)}</>}
            </p>
            <p className="italic bg-gray-50 rounded-lg px-3 py-2 mb-4 text-sm">
              &ldquo;{messageDetail.messageSnapshot || (messageDetail.snapshotRedactedAt
                ? 'Message content redacted per the retention policy'
                : 'Message content unavailable')}&rdquo;
            </p>
            <div className="text-xs text-muted mb-4 space-y-0.5">
              <p><span className="font-semibold text-ink">Reason:</span> {messageDetail.reason}</p>
              <p>{messageDetail.description || 'No description'}</p>
              <p>Reporter: {messageDetail.reporter?.name} {messageDetail.reporter?.email && `(${messageDetail.reporter.email})`}</p>
              {messageDetail.resolvedAt && (
                <p>Resolved: {formatTimeAgo(messageDetail.resolvedAt)}{messageDetail.resolution ? ` — ${messageDetail.resolution}` : ''}</p>
              )}
              {messageDetail.retentionHold && (
                <p className="text-amber-700 font-semibold">
                  Retention hold active{messageDetail.retentionHoldReason ? `: ${messageDetail.retentionHoldReason}` : ''}
                </p>
              )}
            </div>
            <button onClick={() => setMessageDetail(null)} className="btn-ghost w-full min-h-[44px] py-2.5 text-sm">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

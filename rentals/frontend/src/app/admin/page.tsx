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

type ReportStatusFilter = 'PENDING' | 'RESOLVED';
const STATUS_TABS: { value: ReportStatusFilter; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'RESOLVED', label: 'Resolved' },
];

export default function AdminPage() {
  const user = useUser();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageDetail, setMessageDetail] = useState<any | null>(null);
  // The backend's Report.status still distinguishes RESOLVED from DISMISSED
  // internally (kept for its own audit trail), but moderators only need two
  // views: still-open, or closed. The Resolved tab merges both backend
  // statuses into one list so there's no separate Dismissed view to check.
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>('PENDING');
  // Reason-collecting confirmations (Ban, Restrict, place-hold) used to go
  // through window.confirm()/window.prompt(). Root-caused as unreliable for
  // a must-work moderation action: some browsers permanently suppress
  // further confirm/prompt calls after a few have fired on the same page
  // (Chrome's "Prevent this page from creating additional dialogs"), which
  // silently no-ops them -- confirm() returns false, prompt() returns null
  // -- with no error and no network request, exactly matching "Ban does
  // nothing." An in-app modal can't be suppressed that way and lets us
  // surface a real error if the follow-up request still fails.
  const [reasonPrompt, setReasonPrompt] = useState<{
    title: string;
    warning?: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: (reason: string) => Promise<void>;
  } | null>(null);
  const [reasonInput, setReasonInput] = useState('');
  const [reasonSubmitting, setReasonSubmitting] = useState(false);
  const { toast } = useToast();

  function openReasonPrompt(prompt: typeof reasonPrompt) {
    setReasonInput('');
    setReasonPrompt(prompt);
  }

  async function submitReasonPrompt() {
    if (!reasonPrompt || reasonInput.trim().length < 5) return;
    setReasonSubmitting(true);
    try {
      await reasonPrompt.onConfirm(reasonInput.trim());
      setReasonPrompt(null);
    } catch (err: any) {
      toast({ title: 'Action failed', description: err?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setReasonSubmitting(false);
    }
  }

  useEffect(() => {
    if (user && user.role === 'USER') { router.push('/'); return; }
    setLoading(true);
    const reportsRequest = statusFilter === 'PENDING'
      ? api.get<any>('/admin/reports?status=PENDING').then(r => r.data || [])
      : Promise.all([
          api.get<any>('/admin/reports?status=RESOLVED'),
          api.get<any>('/admin/reports?status=DISMISSED'),
        ]).then(([resolved, dismissed]) => [...(resolved.data || []), ...(dismissed.data || [])]
          .sort((a: any, b: any) => new Date(b.resolvedAt ?? b.createdAt).getTime() - new Date(a.resolvedAt ?? a.createdAt).getTime()));

    Promise.all([
      api.get<any>('/admin/stats'),
      reportsRequest,
    ]).then(([s, r]) => {
      setStats(s.data);
      setReports(r || []);
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
                            <div className="text-xs mt-1">
                              <p className="font-semibold text-ink">Outcome: {r.resolution || 'No resolution notes recorded'}</p>
                              <p className="text-muted">Resolved {formatTimeAgo(r.resolvedAt)} · {r.status === 'DISMISSED' ? 'Dismissed' : 'Resolved'}</p>
                            </div>
                          )}

                          {type === 'LISTING' && (
                            <div className="text-xs text-muted">
                              <p>Listing: {r.listing?.title || 'Listing no longer available'}</p>
                              {r.listing?.moderationRemovedAt && !r.listing.moderationRestoredAt && (
                                <p className="mt-1">
                                  <span className="font-semibold text-red-600">Removed by moderation</span>
                                  {r.listing.moderationRemovedBy?.name && ` by ${r.listing.moderationRemovedBy.name}`}
                                  {r.listing.moderationRemovalReason && `: ${r.listing.moderationRemovalReason}`}
                                </p>
                              )}
                            </div>
                          )}

                          {type === 'USER' && (
                            <div className="text-xs text-muted">
                              <p>Reported user: {r.reportedUser?.name || 'Unknown'} ({r.reportedUser?.email || 'no email on record'})</p>
                              {r.reporterHistory && (
                                <p>
                                  This reporter has filed {r.reporterHistory.totalFiled} report(s) total,
                                  {' '}{r.reporterHistory.dismissed} dismissed.
                                </p>
                              )}
                            </div>
                          )}

                          {/* Current moderation state for the reported user -- shown for USER and
                              MESSAGE reports alike, since both name a reportedUser. Exactly one of
                              Banned / Restricted / None applies (Ban supersedes Restrict: a banned
                              account can't message anyone at all, so a narrower per-reporter
                              restriction is redundant on top of it). */}
                          {r.reportedUser && (
                            <p className="text-xs mt-1">
                              <span className="font-semibold text-ink">Moderation status: </span>
                              {r.reportedUser.isBanned ? (
                                <span className="text-red-600 font-semibold">Banned{r.reportedUser.banReason ? `: ${r.reportedUser.banReason}` : ''}</span>
                              ) : r.restriction ? (
                                <span className="text-amber-700 font-semibold">
                                  Restricted from messaging {r.reporter?.name || 'the reporter'}{r.restriction.reason ? `: ${r.restriction.reason}` : ''}
                                </span>
                              ) : (
                                <span className="text-muted">None</span>
                              )}
                            </p>
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
                                try {
                                  await api.patch(`/admin/reports/${r.id}`, { status: 'RESOLVED', resolution: 'Reviewed and dismissed' });
                                  setReports(prev => prev.filter(rep => rep.id !== r.id));
                                  toast({ title: 'Report dismissed' });
                                } catch (err: any) {
                                  toast({ title: 'Could not dismiss report', description: err?.message, variant: 'destructive' });
                                }
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
                                  try {
                                    await api.patch(`/admin/reports/${r.id}`, { retentionHold: false });
                                    setReports(prev => prev.map(rep => rep.id === r.id ? { ...rep, retentionHold: false, retentionHoldReason: undefined } : rep));
                                    toast({ title: 'Retention hold removed' });
                                  } catch (err: any) {
                                    toast({ title: 'Could not remove hold', description: err?.message, variant: 'destructive' });
                                  }
                                } else {
                                  openReasonPrompt({
                                    title: 'Place retention hold',
                                    warning: 'Pauses the 90-day message-snapshot retention clock for an active investigation, dispute, or legal-preservation need.',
                                    confirmLabel: 'Place hold',
                                    onConfirm: async (reason) => {
                                      await api.patch(`/admin/reports/${r.id}`, { retentionHold: true, retentionHoldReason: reason });
                                      setReports(prev => prev.map(rep => rep.id === r.id ? { ...rep, retentionHold: true, retentionHoldReason: reason } : rep));
                                      toast({ title: 'Retention hold placed' });
                                    },
                                  });
                                }
                              }}
                              className="px-3 py-1.5 text-xs font-semibold bg-amber-50 text-amber-700 rounded-full hover:bg-amber-100 transition-colors">
                              {r.retentionHold ? 'Remove retention hold' : 'Place retention hold'}
                            </button>
                          )}
                          {/* Remove/Restore act on the listing itself, not the report, so
                              (like Restrict/Ban below) they stay available on the Resolved
                              tab too -- a listing report can be reviewed and the listing
                              still removed or restored well after the report is closed. */}
                          {type === 'LISTING' && r.listing && (
                            r.listing.moderationRemovedAt && !r.listing.moderationRestoredAt ? (
                              <button
                                disabled={r.listing.user?.isBanned}
                                title={r.listing.user?.isBanned ? 'Cannot restore while the owner is banned.' : undefined}
                                onClick={async () => {
                                  try {
                                    await api.patch(`/admin/listings/${r.listing.id}/restore`, {});
                                    setReports(prev => prev.map(rep => rep.id === r.id
                                      ? { ...rep, listing: { ...rep.listing, status: 'ACTIVE', moderationRestoredAt: new Date().toISOString() } }
                                      : rep));
                                    toast({ title: 'Listing restored' });
                                  } catch (err: any) {
                                    toast({ title: 'Could not restore listing', description: err?.message, variant: 'destructive' });
                                  }
                                }}
                                className="px-3 py-1.5 text-xs font-semibold bg-gray-100 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                Restore listing
                              </button>
                            ) : (
                              <button
                                onClick={() => openReasonPrompt({
                                  title: `Remove "${r.listing.title}" from public view?`,
                                  warning: 'This hides the listing from browse, map, search, and its detail page. It stays reversible -- you (or another moderator) can restore it later, unless the owner is banned in the meantime.',
                                  confirmLabel: 'Remove listing',
                                  danger: true,
                                  onConfirm: async (reason) => {
                                    await api.delete(`/admin/listings/${r.listing.id}`, { reason });
                                    const shouldResolve = statusFilter === 'PENDING';
                                    if (shouldResolve) {
                                      await api.patch(`/admin/reports/${r.id}`, { status: 'RESOLVED', resolution: 'Listing removed' });
                                    }
                                    setReports(prev => shouldResolve
                                      ? prev.filter(rep => rep.id !== r.id)
                                      : prev.map(rep => rep.id === r.id
                                          ? { ...rep, listing: { ...rep.listing, status: 'REMOVED', moderationRemovedAt: new Date().toISOString(), moderationRestoredAt: null, moderationRemovalReason: reason, moderationRemovedBy: { name: user?.name } } }
                                          : rep));
                                    toast({ title: 'Listing removed' });
                                  },
                                })}
                                className="px-3 py-1.5 text-xs font-semibold bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">
                                Remove listing
                              </button>
                            )
                          )}
                          {/* Restrict/Unrestrict/Ban/Unban -- act on the reportedUser, not the
                              report, so (unlike Dismiss/Remove-listing) these stay available on
                              the Resolved tab too. Only resolve the report alongside them when
                              acting from Pending, preserving the old one-click convenience there
                              without forcing a re-resolve when revisiting an already-closed report. */}
                          {r.reportedUser && (r.reportedUser.isBanned ? (
                            user?.role === 'ADMIN' && (
                              <button
                                onClick={async () => {
                                  try {
                                    await api.patch(`/admin/users/${r.reportedUser.id}/unban`, {});
                                    setReports(prev => prev.map(rep => rep.id === r.id
                                      ? { ...rep, reportedUser: { ...rep.reportedUser, isBanned: false, banReason: null } }
                                      : rep));
                                    toast({ title: 'User unbanned' });
                                  } catch (err: any) {
                                    toast({ title: 'Could not unban user', description: err?.message, variant: 'destructive' });
                                  }
                                }}
                                className="px-3 py-1.5 text-xs font-semibold bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                                Unban user
                              </button>
                            )
                          ) : (
                            <>
                              {r.restriction ? (
                                <button
                                  onClick={async () => {
                                    try {
                                      await api.patch(`/admin/users/${r.reportedUser.id}/unrestrict`, { protectedUserId: r.reporterId });
                                      setReports(prev => prev.map(rep => rep.id === r.id ? { ...rep, restriction: null } : rep));
                                      toast({ title: 'Restriction removed' });
                                    } catch (err: any) {
                                      toast({ title: 'Could not remove restriction', description: err?.message, variant: 'destructive' });
                                    }
                                  }}
                                  className="px-3 py-1.5 text-xs font-semibold bg-amber-50 text-amber-700 rounded-full hover:bg-amber-100 transition-colors">
                                  Unrestrict user
                                </button>
                              ) : (
                                <button
                                  onClick={() => openReasonPrompt({
                                    title: `Restrict ${r.reportedUser.name} from messaging ${r.reporter?.name || 'the reporter'}`,
                                    confirmLabel: 'Restrict user',
                                    onConfirm: async (reason) => {
                                      await api.post(`/admin/users/${r.reportedUser.id}/restrict`, { protectedUserId: r.reporterId, reason });
                                      const shouldResolve = statusFilter === 'PENDING';
                                      if (shouldResolve) {
                                        await api.patch(`/admin/reports/${r.id}`, { status: 'RESOLVED', resolution: 'User restricted from messaging reporter' });
                                      }
                                      setReports(prev => shouldResolve
                                        ? prev.filter(rep => rep.id !== r.id)
                                        : prev.map(rep => rep.id === r.id ? { ...rep, restriction: { reason } } : rep));
                                      toast({ title: 'User restricted' });
                                    },
                                  })}
                                  className="px-3 py-1.5 text-xs font-semibold bg-amber-50 text-amber-700 rounded-full hover:bg-amber-100 transition-colors">
                                  Restrict user
                                </button>
                              )}
                              {user?.role === 'ADMIN' && (
                                <button
                                  onClick={() => openReasonPrompt({
                                    title: `Ban ${r.reportedUser.name}?`,
                                    warning: "This is more serious than a restriction: it immediately suspends their whole account -- they're logged out, cannot log back in, and cannot send any messages or create listings. Their existing active listings will also be immediately hidden from public view (restored automatically if unbanned).",
                                    confirmLabel: 'Ban user',
                                    danger: true,
                                    onConfirm: async (reason) => {
                                      await api.patch(`/admin/users/${r.reportedUser.id}/ban`, { reason });
                                      const shouldResolve = statusFilter === 'PENDING';
                                      if (shouldResolve) {
                                        await api.patch(`/admin/reports/${r.id}`, { status: 'RESOLVED', resolution: 'Account banned' });
                                      }
                                      setReports(prev => shouldResolve
                                        ? prev.filter(rep => rep.id !== r.id)
                                        : prev.map(rep => rep.id === r.id ? { ...rep, reportedUser: { ...rep.reportedUser, isBanned: true, banReason: reason } } : rep));
                                      toast({ title: 'User banned' });
                                    },
                                  })}
                                  className="px-3 py-1.5 text-xs font-semibold bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors">
                                  Ban user
                                </button>
                              )}
                            </>
                          ))}
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
                <>
                  <p className="font-semibold text-ink">Outcome: {messageDetail.resolution || 'No resolution notes recorded'}</p>
                  <p>Resolved {formatTimeAgo(messageDetail.resolvedAt)} · {messageDetail.status === 'DISMISSED' ? 'Dismissed' : 'Resolved'}</p>
                </>
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

      {reasonPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reason-prompt-title"
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget && !reasonSubmitting) setReasonPrompt(null); }}
        >
          <div className="w-full max-w-md bg-white rounded-3xl shadow-elevated p-6">
            <h3 id="reason-prompt-title" className="font-serif text-xl mb-2">{reasonPrompt.title}</h3>
            {reasonPrompt.warning && (
              <p className={cn('text-sm rounded-lg px-3 py-2 mb-3', reasonPrompt.danger ? 'text-red-700 bg-red-50' : 'text-amber-800 bg-amber-50')}>
                {reasonPrompt.warning}
              </p>
            )}
            <label htmlFor="reason-prompt-input" className="block text-xs font-semibold text-muted mb-1">
              Reason (minimum 5 characters)
            </label>
            <textarea
              id="reason-prompt-input"
              value={reasonInput}
              onChange={e => setReasonInput(e.target.value)}
              rows={3}
              autoFocus
              className="w-full border border-ink/15 rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-brand-700/30"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { if (!reasonSubmitting) setReasonPrompt(null); }}
                disabled={reasonSubmitting}
                className="btn-ghost flex-1 min-h-[44px] py-2.5 text-sm">
                Cancel
              </button>
              <button
                onClick={submitReasonPrompt}
                disabled={reasonSubmitting || reasonInput.trim().length < 5}
                className={cn(
                  'flex-1 min-h-[44px] py-2.5 text-sm font-semibold rounded-full transition-colors disabled:opacity-50',
                  reasonPrompt.danger ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-brand-700 text-white hover:bg-brand-800'
                )}>
                {reasonSubmitting ? 'Working…' : reasonPrompt.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

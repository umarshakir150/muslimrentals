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

export default function AdminPage() {
  const user = useUser();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (user && user.role === 'USER') { router.push('/'); return; }
    Promise.all([
      api.get<any>('/admin/stats'),
      api.get<any>('/admin/reports'),
    ]).then(([s, r]) => {
      setStats(s.data);
      setReports(r.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user]);

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
              <div className="px-6 py-4 border-b border-ink/8">
                <h2 className="font-semibold">Pending Reports</h2>
              </div>
              {reports.length === 0 ? (
                <div className="py-12 text-center text-muted">
                  <Flag size={32} className="mx-auto mb-3 opacity-20" />
                  <p>No pending reports</p>
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
                          <p className="text-xs text-muted mt-1">By: {r.reporter?.name}</p>

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

                          {type === 'MESSAGE' && (
                            <div className="text-xs text-muted">
                              <p>From: {r.messageSender?.name || r.message?.sender?.name || 'Unknown'}</p>
                              <p>To: {r.recipient?.name || 'Unknown'}</p>
                              {r.message?.createdAt && <p>Sent: {formatTimeAgo(r.message.createdAt)}</p>}
                              <p className="italic bg-gray-50 rounded-lg px-2 py-1 mt-1 mb-1">&ldquo;{r.messageSnapshot || 'Message content unavailable'}&rdquo;</p>
                              {(r.conversationId || r.message?.conversationId) && (
                                <Link
                                  href={`/messages?conv=${r.conversationId || r.message?.conversationId}`}
                                  className="text-brand-600 font-semibold hover:underline"
                                >
                                  View conversation
                                </Link>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={async () => {
                              await api.patch(`/admin/reports/${r.id}`, { status: 'RESOLVED', resolution: 'Reviewed and dismissed' });
                              setReports(prev => prev.filter(rep => rep.id !== r.id));
                              toast({ title: 'Report dismissed' });
                            }}
                            className="px-3 py-1.5 text-xs font-semibold bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                            Dismiss
                          </button>
                          {type === 'LISTING' && (
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
                          {type === 'USER' && r.reportedUser && !r.reportedUser.isBanned && user?.role === 'ADMIN' && (
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
    </div>
  );
}

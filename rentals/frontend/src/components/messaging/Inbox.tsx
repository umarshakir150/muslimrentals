'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, ArrowLeft, Loader2, MessageSquare, Flag } from 'lucide-react';
import { Conversation, Message } from '@/types';
import { messagesApi, usersApi } from '@/lib/api';
import { useUser } from '@/store/authStore';
import { formatTimeAgo, cn, initials } from '@/lib/utils';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { useToast } from '@/components/ui/use-toast';
import ReportModal, { ReportTargetType } from '@/components/reports/ReportModal';

interface InboxProps {
  initialConvId?: string;
}

export default function Inbox({ initialConvId }: InboxProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<any>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>();
  // The socket-listener effect below registers its handlers once (empty
  // deps -- re-running it on every activeConv change would mean
  // detaching/reattaching listeners on every conversation switch). Reading
  // `activeConv` directly from those handlers would therefore always see
  // its value from the moment the effect first ran (permanently `null`,
  // since Inbox mounts before any conversation is opened) instead of the
  // real current one. A ref kept in sync via the effect below sidesteps
  // that staleness without needing to churn the listeners themselves.
  const activeConvRef = useRef<Conversation | null>(null);
  const user = useUser();
  const { toast } = useToast();

  const [reportTarget, setReportTarget] = useState<{
    type: ReportTargetType;
    contextLabel: string;
    submit: (reason: string, description?: string) => Promise<void>;
  } | null>(null);

  useEffect(() => {
    activeConvRef.current = activeConv;
  }, [activeConv]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load conversations
  useEffect(() => {
    setLoading(true);
    messagesApi.getConversations()
      .then(res => {
        setConversations(res.data);
        if (initialConvId) {
          const conv = res.data.find((c: Conversation) => c.id === initialConvId);
          if (conv) openConversation(conv);
        }
      })
      .catch(() => toast({ variant: 'destructive', title: 'Could not load conversations' }))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Setup socket. Runs once per Inbox mount (not per conversation switch --
  // openConversation() below handles join/leave for that). Handlers are
  // named functions so the cleanup can .off() the exact instance it
  // registered, rather than relying on the effect never re-running: without
  // this, remounting Inbox (e.g. navigating away from /messages and back)
  // would leave the previous mount's listeners attached to the persistent
  // socket singleton (see lib/socket.ts) and stack a second copy on top.
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;

    // Every insertion here is id-deduped, not just this one -- the sender's
    // own `sendMessage` below inserts from the REST response at the same
    // time this event can deliver the identical row back to them (they're
    // already in the conversation's room from opening it), so both paths
    // have to agree on "already present" the same way or a race between
    // them (whichever resolves first) shows the message twice.
    //
    // Also scoped to the conversation it actually belongs to: this socket
    // still receives 'message:new' for a conversation the user just
    // switched away from until the server processes the fire-and-forget
    // 'conversation:leave' -- without the conversationId check, a message
    // for the conversation you left could land in the thread you switched
    // to. The sidebar preview update isn't scoped the same way, since it
    // should update whichever conversation the message actually belongs
    // to, active or not.
    function handleNewMessage(msg: Message) {
      if (msg.conversationId === activeConvRef.current?.id) {
        setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
        setTimeout(scrollToBottom, 100);
      }
      setConversations(prev => prev.map(c =>
        c.id === msg.conversationId ? { ...c, messages: [msg] } : c
      ));
    }

    function handleTypingStart({ userName }: { userName: string }) {
      setTyping(userName);
    }

    function handleTypingStop() {
      setTyping(null);
    }

    function handleNewConversation(conv: Conversation) {
      setConversations(prev => (prev.some(c => c.id === conv.id) ? prev : [conv, ...prev]));
    }

    socket.on('message:new', handleNewMessage);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);
    socket.on('conversation:new', handleNewConversation);

    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
      socket.off('conversation:new', handleNewConversation);
      if (activeConvRef.current) socket.emit('conversation:leave', activeConvRef.current.id);
    };
  }, [scrollToBottom]);

  async function openConversation(conv: Conversation) {
    if (activeConv) socketRef.current?.emit('conversation:leave', activeConv.id);
    setActiveConv(conv);
    setMessages([]);

    try {
      const res = await messagesApi.getConversation(conv.id);
      setMessages(res.data.messages || []);
      socketRef.current?.emit('conversation:join', conv.id);
      socketRef.current?.emit('messages:read', { conversationId: conv.id });
      setTimeout(scrollToBottom, 150);

      // Mark unread
      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unreadCount: 0 } : c));
    } catch {
      toast({ variant: 'destructive', title: 'Could not load messages' });
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || !activeConv || sending) return;

    const text = body.trim();
    setBody('');
    setSending(true);

    try {
      const res = await messagesApi.sendMessage(activeConv.id, text);
      // The sender is already in this conversation's Socket.IO room (joined
      // when the conversation was opened), and the backend broadcasts
      // 'message:new' to the whole room including the sender -- so this
      // exact message can also arrive via the socket handler above around
      // the same time. Dedupe by id (never by text -- two different real
      // messages can share identical text) so whichever of the two paths
      // resolves first wins and the second is a no-op, instead of the
      // message appearing twice.
      //
      // Compared against the ref, not the `activeConv` this closure
      // captured when the send started: if the user switches to a
      // different conversation while this request is still in flight, the
      // response has to land in whatever is actually open now (or nowhere,
      // if that's no longer this conversation), not wherever it was when
      // the request was made.
      if (res.data.conversationId === activeConvRef.current?.id) {
        setMessages(prev => (prev.some(m => m.id === res.data.id) ? prev : [...prev, res.data]));
        setTimeout(scrollToBottom, 100);
      }
    } catch {
      setBody(text);
      toast({ variant: 'destructive', title: 'Failed to send message' });
    } finally { setSending(false); }
  }

  function handleTyping(e: React.ChangeEvent<HTMLInputElement>) {
    setBody(e.target.value);
    if (activeConv) {
      socketRef.current?.emit('typing:start', { conversationId: activeConv.id });
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        socketRef.current?.emit('typing:stop', { conversationId: activeConv.id });
      }, 1500);
    }
  }

  const otherParticipant = (conv: Conversation) =>
    conv.participants.find(p => p.userId !== user?.id)?.user;

  function reportUser(otherUserId: string, otherUserName: string) {
    setReportTarget({
      type: 'USER',
      contextLabel: otherUserName,
      submit: (reason, description) => usersApi.report(otherUserId, reason, description).then(() => {}),
    });
  }

  function reportMessage(msg: Message) {
    setReportTarget({
      type: 'MESSAGE',
      contextLabel: msg.body,
      submit: (reason, description) => messagesApi.report(msg.id, reason, description).then(() => {}),
    });
  }

  return (
    <div className="flex h-[calc(100dvh-72px)] bg-white rounded-3xl border border-ink/8 shadow-card overflow-hidden">
      {/* Conversations list */}
      <div className={cn(
        'w-full md:w-80 lg:w-96 border-r border-ink/8 flex flex-col',
        activeConv ? 'hidden md:flex' : 'flex'
      )}>
        <div className="px-5 py-4 border-b border-ink/8">
          <h2 className="font-serif text-xl">Messages</h2>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-muted" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <MessageSquare size={48} className="text-muted mb-4 opacity-30" />
            <p className="font-semibold text-ink mb-1">No messages yet</p>
            <p className="text-sm text-muted">Find a listing and message the landlord to get started.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {conversations.map(conv => {
              const other = otherParticipant(conv);
              const lastMsg = conv.messages?.[0];
              return (
                <button
                  key={conv.id}
                  onClick={() => openConversation(conv)}
                  className={cn(
                    'w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-brand-50/60 transition-colors border-b border-ink/5',
                    activeConv?.id === conv.id && 'bg-brand-50'
                  )}
                >
                  <div className="w-11 h-11 rounded-full bg-brand-gradient flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {other?.avatarUrl ? (
                      <img src={other.avatarUrl} className="w-full h-full rounded-full object-cover" alt={other.name} />
                    ) : initials(other?.name || '?')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <span className="font-semibold text-sm truncate">{other?.name || 'Unknown'}</span>
                      {lastMsg && <span className="text-xs text-muted shrink-0 ml-2">{formatTimeAgo(lastMsg.createdAt)}</span>}
                    </div>
                    <p className="text-xs text-brand-600 font-medium truncate mb-0.5">{conv.listing?.title}</p>
                    {lastMsg && (
                      <p className="text-xs text-muted truncate">{lastMsg.sender?.id === user?.id ? 'You: ' : ''}{lastMsg.body}</p>
                    )}
                  </div>
                  {(conv.unreadCount || 0) > 0 && (
                    <span className="w-5 h-5 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                      {conv.unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Message thread */}
      <div className={cn('flex-1 flex flex-col', !activeConv ? 'hidden md:flex' : 'flex')}>
        {activeConv ? (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-ink/8">
              <button onClick={() => setActiveConv(null)} className="md:hidden p-2 rounded-full hover:bg-gray-100">
                <ArrowLeft size={18} />
              </button>
              <div className="w-10 h-10 rounded-full bg-brand-gradient flex items-center justify-center text-white font-bold text-sm shrink-0">
                {(() => {
                  const other = otherParticipant(activeConv);
                  return other?.avatarUrl
                    ? <img src={other.avatarUrl} className="w-full h-full rounded-full object-cover" alt="" />
                    : initials(other?.name || '?');
                })()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{otherParticipant(activeConv)?.name}</p>
                <p className="text-xs text-muted truncate max-w-xs">{activeConv.listing?.title}</p>
              </div>
              {(() => {
                const other = otherParticipant(activeConv);
                if (!other) return null;
                return (
                  <button
                    onClick={() => reportUser(other.id, other.name)}
                    aria-label={`Report ${other.name}`}
                    title={`Report ${other.name}`}
                    className="p-2.5 rounded-full hover:bg-gray-100 text-muted shrink-0"
                  >
                    <Flag size={16} />
                  </button>
                );
              })()}
            </div>

            {/* Messages */}
            <div data-testid="message-thread" className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messages.map((msg, i) => {
                const isMe = msg.sender?.id === user?.id;
                const showDate = i === 0 || new Date(msg.createdAt).toDateString() !== new Date(messages[i-1].createdAt).toDateString();
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div className="text-center text-xs text-muted my-3">
                        {new Date(msg.createdAt).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                    )}
                    <div className={cn('flex items-end gap-0.5', isMe ? 'justify-end' : 'justify-start')}>
                      <div className={cn(
                        'max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
                        isMe ? 'bg-brand-600 text-white rounded-br-sm' : 'bg-gray-100 text-ink rounded-bl-sm'
                      )}>
                        {msg.body}
                        <div className={cn('text-[10px] mt-1', isMe ? 'text-white/60 text-right' : 'text-muted')}>
                          {new Date(msg.createdAt).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      {!isMe && (
                        <button
                          onClick={() => reportMessage(msg)}
                          aria-label="Report message"
                          title="Report message"
                          className="w-[44px] h-[44px] shrink-0 flex items-center justify-center rounded-full text-muted/50 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Flag size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {typing && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1">
                    <span className="text-xs text-muted">{typing} is typing</span>
                    <span className="flex gap-1">{[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: `${i*0.1}s` }} />)}</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendMessage} className="px-4 py-4 border-t border-ink/8 flex gap-3">
              <input
                type="text"
                value={body}
                onChange={handleTyping}
                placeholder="Write a message..."
                className="input-field flex-1"
                disabled={sending}
              />
              <button type="submit" disabled={!body.trim() || sending} className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center transition-all',
                body.trim() ? 'bg-brand-gradient text-white shadow-lg shadow-brand-600/25 hover:-translate-y-px' : 'bg-gray-100 text-muted cursor-not-allowed'
              )}>
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 rounded-2xl bg-brand-50 flex items-center justify-center text-3xl mb-4">💬</div>
            <h3 className="font-serif text-xl mb-2">Select a conversation</h3>
            <p className="text-sm text-muted">Choose a conversation from the list to start messaging.</p>
          </div>
        )}
      </div>

      <ReportModal
        open={!!reportTarget}
        onClose={() => setReportTarget(null)}
        targetType={reportTarget?.type ?? 'USER'}
        contextLabel={reportTarget?.contextLabel ?? ''}
        onSubmit={reportTarget?.submit ?? (async () => {})}
      />
    </div>
  );
}

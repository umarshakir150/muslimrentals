'use client';

import { useState, useCallback } from 'react';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

let listeners: ((toasts: Toast[]) => void)[] = [];
let toasts: Toast[] = [];

function dispatch(action: { type: 'add' | 'remove'; toast?: Toast; id?: string }) {
  if (action.type === 'add' && action.toast) {
    toasts = [...toasts.slice(-4), action.toast];
  } else if (action.type === 'remove') {
    toasts = toasts.filter(t => t.id !== action.id);
  }
  listeners.forEach(l => l([...toasts]));
}

export function toast({ title, description, variant = 'default' }: Omit<Toast, 'id'>) {
  const id = Math.random().toString(36).slice(2);
  dispatch({ type: 'add', toast: { id, title, description, variant } });
  setTimeout(() => dispatch({ type: 'remove', id }), 4000);
}

export function useToast() {
  const [localToasts, setLocalToasts] = useState<Toast[]>(toasts);

  const subscribe = useCallback(() => {
    listeners.push(setLocalToasts);
    return () => { listeners = listeners.filter(l => l !== setLocalToasts); };
  }, []);

  useState(() => { const unsub = subscribe(); return unsub; });

  return { toast, toasts: localToasts, dismiss: (id: string) => dispatch({ type: 'remove', id }) };
}

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCAD(amount: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(amount);
}

export function formatShortCAD(amount: number): string {
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
  return `$${amount}`;
}

export function formatTimeAgo(date: string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function audienceLabel(audience: string): string {
  const map: Record<string, string> = {
    BROTHERS: 'Brothers',
    SISTERS: 'Sisters',
    COUPLES: 'Couples',
    FAMILIES: 'Families',
    ALL: 'Everyone',
  };
  return map[audience] || audience;
}

export function audienceColor(audience: string): string {
  const map: Record<string, string> = {
    BROTHERS: 'bg-blue-100 text-blue-800',
    SISTERS: 'bg-pink-100 text-pink-800',
    COUPLES: 'bg-purple-100 text-purple-800',
    FAMILIES: 'bg-amber-100 text-amber-800',
    ALL: 'bg-brand-100 text-brand-800',
  };
  return map[audience] || 'bg-gray-100 text-gray-800';
}

export function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

// Fuzzy city search
export function fuzzySearch(query: string, options: string[]): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const scored = options.map(opt => {
    const ol = opt.toLowerCase();
    if (ol === q) return { opt, score: 100 };
    if (ol.startsWith(q)) return { opt, score: 80 };
    if (ol.includes(q)) return { opt, score: 60 };

    // Levenshtein-like tolerance for typos (check trigrams)
    let match = 0;
    for (let i = 0; i <= q.length - 2; i++) {
      if (ol.includes(q.slice(i, i + 2))) match++;
    }
    const score = (match / Math.max(q.length - 1, 1)) * 50;
    return { opt, score };
  })
  .filter(x => x.score > 20)
  .sort((a, b) => b.score - a.score)
  .slice(0, 8);

  return scored.map(x => x.opt);
}

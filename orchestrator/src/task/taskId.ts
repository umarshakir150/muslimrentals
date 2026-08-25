function slugify(text: string, maxWords = 6): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  return words.join('-') || 'task';
}

function timestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/** e.g. "20260825-143210-report-roommate-profiles" */
export function generateTaskId(objective: string, now: Date = new Date()): string {
  return `${timestamp(now)}-${slugify(objective)}`;
}

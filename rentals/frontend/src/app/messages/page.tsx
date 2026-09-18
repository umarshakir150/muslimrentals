import { Metadata } from 'next';
import Inbox from '@/components/messaging/Inbox';

export const metadata: Metadata = { title: 'Messages' };

export default function MessagesPage({ searchParams }: { searchParams: { conv?: string } }) {
  return (
    <div className="min-h-dvh">
      <main className="pt-[72px] p-4 max-w-7xl mx-auto">
        <Inbox initialConvId={searchParams.conv} />
      </main>
    </div>
  );
}

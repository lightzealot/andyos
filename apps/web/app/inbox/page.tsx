import { AppShell } from '@/components/AppShell';
import { Inbox } from '@/components/Inbox';

export default function InboxPage() {
  return (
    <AppShell current="/inbox/">
      <Inbox />
    </AppShell>
  );
}

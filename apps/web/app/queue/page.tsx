import { AppShell } from '@/components/AppShell';
import { QueuePanel } from '@/components/QueuePanel';

export default function QueuePage() {
  return (
    <AppShell current="/queue/">
      <QueuePanel />
    </AppShell>
  );
}

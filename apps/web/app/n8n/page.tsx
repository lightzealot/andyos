import { AppShell } from '@/components/AppShell';
import { N8nPanel } from '@/components/N8nPanel';

export default function N8nPage() {
  return (
    <AppShell current="/n8n/">
      <N8nPanel />
    </AppShell>
  );
}

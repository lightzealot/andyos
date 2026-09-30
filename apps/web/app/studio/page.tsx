import { AppShell } from '@/components/AppShell';
import { Studio } from '@/components/Studio';

export default function StudioPage() {
  return (
    <AppShell current="/studio/">
      <Studio />
    </AppShell>
  );
}

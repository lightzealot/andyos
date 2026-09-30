import { AppShell } from '@/components/AppShell';
import { References } from '@/components/References';

export default function ReferencesPage() {
  return (
    <AppShell current="/references/">
      <References />
    </AppShell>
  );
}

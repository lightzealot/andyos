import { AppShell } from '@/components/AppShell';
import { Calendar } from '@/components/Calendar';

export default function CalendarPage() {
  return (
    <AppShell current="/calendar/">
      <Calendar />
    </AppShell>
  );
}

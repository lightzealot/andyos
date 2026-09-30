import { AppShell } from '@/components/AppShell';
import { Board } from '@/components/Board';

export default function Home() {
  return (
    <AppShell current="/">
      <Board />
    </AppShell>
  );
}

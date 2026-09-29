import { describe, expect, it } from 'vitest';
import { dayKey, fromInputValue, monthGrid, moveToDay, parseKey, startOfWeek, toInputValue, weekDays } from '../lib/dates';

describe('dates', () => {
  it('la semana empieza en lunes', () => {
    expect(dayKey(startOfWeek(parseKey('2026-09-28')))).toBe('2026-09-28'); // lunes
    expect(dayKey(startOfWeek(parseKey('2026-10-04')))).toBe('2026-09-28'); // domingo
    expect(weekDays(parseKey('2026-09-30')).map(dayKey)[6]).toBe('2026-10-04');
  });
  it('la cuadrícula del mes son semanas completas', () => {
    const g = monthGrid(parseKey('2026-09-15'));
    expect(g.length % 7).toBe(0);
    expect(dayKey(g[0])).toBe('2026-08-31');
    expect(dayKey(g[g.length - 1])).toBe('2026-10-04');
    expect(g.filter((d) => d.getMonth() === 8)).toHaveLength(30);
  });
  it('moveToDay conserva la hora previa o usa 09:00', () => {
    expect(new Date(moveToDay('2026-10-02', null)).getHours()).toBe(9);
    const prev = new Date(2026, 8, 28, 18, 30).toISOString();
    const moved = new Date(moveToDay('2026-10-02', prev));
    expect([moved.getFullYear(), moved.getMonth(), moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([2026, 9, 2, 18, 30]);
  });
  it('genera ISO con offset válido para la API', () => {
    expect(moveToDay('2026-10-02', null)).toMatch(/^2026-10-02T09:00:00[+-]\d\d:\d\d$/);
  });
  it('ida y vuelta con datetime-local', () => {
    const iso = fromInputValue('2026-10-02T14:15')!;
    expect(toInputValue(iso)).toBe('2026-10-02T14:15');
    expect(fromInputValue('')).toBeNull();
    expect(toInputValue(null)).toBe('');
  });
});

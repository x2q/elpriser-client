import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, isLocalDate, localDayStarts, localParts, offsetMinutes } from '../src/time.js';

const iso = (ms: number) => new Date(ms).toISOString();

test('offsets follow the zone, not the host', () => {
  assert.equal(offsetMinutes('Europe/Berlin', Date.parse('2026-11-03T07:00:00Z')), 60);
  assert.equal(offsetMinutes('Europe/Berlin', Date.parse('2026-07-03T07:00:00Z')), 120);
  assert.equal(offsetMinutes('Europe/London', Date.parse('2026-11-03T07:00:00Z')), 0);
  assert.equal(offsetMinutes('Europe/London', Date.parse('2026-07-03T07:00:00Z')), 60);
  assert.equal(offsetMinutes('Europe/Athens', Date.parse('2026-11-03T07:00:00Z')), 120);
  assert.equal(offsetMinutes('Europe/Athens', Date.parse('2026-07-03T07:00:00Z')), 180);
});

test('localParts gives hour, date and an ISO string with the offset', () => {
  const p = localParts('Europe/Berlin', Date.parse('2026-11-03T23:30:00Z'));
  assert.deepEqual(p, { hour: 0, date: '2026-11-04', offsetMinutes: 60, iso: '2026-11-04T00:30:00+01:00' });
  assert.equal(localParts('Europe/London', Date.parse('2026-07-03T00:00:00Z')).iso, '2026-07-03T01:00:00+01:00');
});

test('a normal day has 24 hours from local midnight', () => {
  const starts = localDayStarts('2026-11-03', 'Europe/Berlin');
  assert.equal(starts.length, 24);
  assert.equal(iso(starts[0]!), '2026-11-02T23:00:00.000Z');
  assert.equal(iso(starts[23]!), '2026-11-03T22:00:00.000Z');
});

test('the autumn change gives a 25-hour day, the spring change a 23-hour day (EU rules)', () => {
  for (const tz of ['Europe/Copenhagen', 'Europe/Berlin', 'Europe/Lisbon', 'Europe/Athens', 'Europe/London']) {
    assert.equal(localDayStarts('2026-10-25', tz).length, 25, tz);
    assert.equal(localDayStarts('2026-03-29', tz).length, 23, tz);
    assert.equal(localDayStarts('2026-10-24', tz).length, 24, tz);
    assert.equal(localDayStarts('2026-10-26', tz).length, 24, tz);
  }
});

test('on the 25-hour day local hour 2 appears twice and starts are consecutive UTC hours', () => {
  const starts = localDayStarts('2026-10-25', 'Europe/Berlin');
  assert.deepEqual(starts.slice(0, 5).map((s) => localParts('Europe/Berlin', s).hour), [0, 1, 2, 2, 3]);
  for (let i = 1; i < starts.length; i++) assert.equal(starts[i]! - starts[i - 1]!, 3_600_000);
});

test('on the 23-hour day there is no local hour 2', () => {
  const hours = localDayStarts('2026-03-29', 'Europe/Berlin').map((s) => localParts('Europe/Berlin', s).hour);
  assert.deepEqual(hours.slice(0, 4), [0, 1, 3, 4]);
  assert.ok(!hours.includes(2));
});

test('addDays and isLocalDate', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.ok(isLocalDate('2026-02-28'));
  assert.ok(!isLocalDate('2026-02-30'));
  assert.ok(!isLocalDate('2026-2-3'));
  assert.ok(!isLocalDate('03-11-2026'));
  assert.ok(!isLocalDate(20261103));
});

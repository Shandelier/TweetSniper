import { parseViews } from '../src/utils';

describe('parseViews', () => {
  test('parses basic numbers', () => {
    expect(parseViews('123')).toBe(123);
    expect(parseViews('1234')).toBe(1234);
  });

  test('parses numbers with commas', () => {
    expect(parseViews('1,234')).toBe(1234);
    expect(parseViews('12,345')).toBe(12345);
    expect(parseViews('1,234,567')).toBe(1234567);
  });

  test('parses K suffix (thousands)', () => {
    expect(parseViews('1K')).toBe(1000);
    expect(parseViews('1k')).toBe(1000);
    expect(parseViews('5.6K')).toBe(5600);
    expect(parseViews('5.6k')).toBe(5600);
    expect(parseViews('10.5 K')).toBe(10500);
    expect(parseViews('1.2 k')).toBe(1200);
  });

  test('parses M suffix (millions)', () => {
    expect(parseViews('1M')).toBe(1000000);
    expect(parseViews('1m')).toBe(1000000);
    expect(parseViews('1.2M')).toBe(1200000);
    expect(parseViews('1.2m')).toBe(1200000);
    expect(parseViews('2.5 M')).toBe(2500000);
    expect(parseViews('3.7 m')).toBe(3700000);
  });

  test('handles decimal numbers correctly', () => {
    expect(parseViews('1.5K')).toBe(1500);
    expect(parseViews('2.7M')).toBe(2700000);
    expect(parseViews('0.5K')).toBe(500);
  });

  test('returns null for invalid input', () => {
    expect(parseViews('')).toBe(null);
    expect(parseViews('abc')).toBe(null);
    expect(parseViews('K')).toBe(null);
    expect(parseViews('M')).toBe(null);
    expect(parseViews('1X')).toBe(null);
  });

  test('returns null for null/undefined input', () => {
    expect(parseViews(null as any)).toBe(null);
    expect(parseViews(undefined as any)).toBe(null);
  });

  test('handles edge cases', () => {
    expect(parseViews('0')).toBe(0);
    expect(parseViews('0K')).toBe(0);
    expect(parseViews('0M')).toBe(0);
  });

  test('handles whitespace variations', () => {
    expect(parseViews('1 K')).toBe(1000);
    expect(parseViews('1  K')).toBe(1000);
    expect(parseViews('1.5 M')).toBe(1500000);
    expect(parseViews('1.5  M')).toBe(1500000);
  });

  test('floors decimal results', () => {
    expect(parseViews('1.7K')).toBe(1700);
    expect(parseViews('1.23K')).toBe(1230);
    expect(parseViews('1.999K')).toBe(1999);
  });
}); 
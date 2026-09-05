import { expect } from 'chai';
import { resolvePeriod } from '../server/pipeline/resolve/dates.js';
import { formatInr } from '../server/pipeline/mask.js';

/**
 * Three checks on the deterministic core: the fiscal calendar, the refusal to
 * guess a window, and money formatting. Broader coverage lives in the eval
 * harness, which scores whole answers against docs/EXAMPLES.md.
 */
describe('swiss cheese deterministic core', () => {
  const asOf = new Date('2026-09-05T00:00:00Z');

  it('reads "this quarter" as the Indian fiscal quarter, not the calendar one', () => {
    const result = resolvePeriod('this quarter', asOf);

    expect(result.ok).to.equal(true);
    if (!result.ok) return;
    expect(result.period.from).to.equal('2026-07-01');
    expect(result.period.to).to.equal('2026-09-30');
    expect(result.period.label).to.equal('Q2 FY26-27');
  });

  it('refuses to turn a vague phrase into a window', () => {
    const result = resolvePeriod('recently', asOf);

    expect(result.ok).to.equal(false);
    if (result.ok) return;
    expect(result.reason).to.equal('vague');
  });

  it('groups money the Indian way and keeps the sign', () => {
    expect(formatInr('231680596.77')).to.equal('23,16,80,596.77');
    expect(formatInr('-81229672.84')).to.equal('-8,12,29,672.84');
    expect(formatInr('110')).to.equal('110.00');
  });
});

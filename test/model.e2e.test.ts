import { expect } from 'chai';
import { ResilientChatModel } from '../server/pipeline/model.js';

/**
 * Live model check. Confirms the configured model returns slots Swiss Cheese can use,
 * without asserting anything about phrasing. Run with `npm run test:e2e` and a
 * reachable Coral Bricks gateway (or another configured provider).
 */
describe('live model slot filling', () => {
  it('extracts intent and the date wording without resolving the date itself', async () => {
    const model = new ResilientChatModel();
    const { slots } = await model.fillSlots('How much did we spend in June?', null);

    expect(slots.intent).to.equal('period_spend');
    expect(slots.txType).to.equal('debit');
    expect((slots.datePhrase ?? '').toLowerCase()).to.include('june');
  });
});

import { pool } from './src/db.js';
import { logEvent } from './src/utils/db.js';
import { PreemptEvent } from '../src/types/Event.js';

async function test() {
  const event = new PreemptEvent(
    'TEST_EVENT',
    { id: '1', type: 'user' },
    ['test-interest'],
    { before: null, after: 'hello topic' },
    'corr-123',
    '1.0',
    'custom-test-topic'
  );
  await logEvent(pool, event);
  console.log('Inserted custom topic event');
  process.exit(0);
}
test();

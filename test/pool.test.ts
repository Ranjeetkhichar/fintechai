import { expect } from 'chai';
import { backoffMs, buildPoolConfig, isRetryable, neonPooledHost } from '../server/db/pool.js';

/**
 * Connection policy against Neon: one client through the pooler, and only
 * retry the errors that mean "the socket died or the compute is full".
 */
describe('postgres pool neon policy', () => {
  it('keeps a single pooled Neon client and strips libpq-only params', () => {
    const previousIdle = process.env.DB_IDLE_TIMEOUT_MS;
    const previousMax = process.env.DB_POOL_MAX;
    delete process.env.DB_IDLE_TIMEOUT_MS;
    delete process.env.DB_POOL_MAX;

    try {
      const config = buildPoolConfig(
        'postgresql://u:p@ep-demo.us-east-2.aws.neon.tech/db?sslmode=require&channel_binding=require'
      );
      const host = new URL(config.connectionString ?? '').hostname;

      expect(config.max).to.equal(1);
      expect(config.idleTimeoutMillis).to.equal(60_000);
      expect(host).to.equal('ep-demo-pooler.us-east-2.aws.neon.tech');
      expect(neonPooledHost(host)).to.equal(host);
      expect(config.connectionString).to.not.include('sslmode');
      expect(config.connectionString).to.not.include('channel_binding');
    } finally {
      if (previousIdle === undefined) delete process.env.DB_IDLE_TIMEOUT_MS;
      else process.env.DB_IDLE_TIMEOUT_MS = previousIdle;
      if (previousMax === undefined) delete process.env.DB_POOL_MAX;
      else process.env.DB_POOL_MAX = previousMax;
    }
  });

  it('retries a dropped socket', () => {
    const error = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

    expect(isRetryable(error)).to.equal(true);
    expect(backoffMs(0)).to.equal(1000);
    expect(backoffMs(1)).to.equal(2000);
  });

  it('does not retry a Postgres query error', () => {
    const error = Object.assign(new Error('syntax error at or near "SELEC"'), { code: '42601' });

    expect(isRetryable(error)).to.equal(false);
  });
});

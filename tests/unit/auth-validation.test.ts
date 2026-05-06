import { describe, it, expect } from 'vitest';
import { CredentialsSchema } from '../../src/lib/server/auth/validation';

describe('CredentialsSchema', () => {
  it('принимает валидный email и пароль ≥ 8 символов', () => {
    const out = CredentialsSchema.parse({ email: 'User@Example.COM', password: 'secret12' });
    // email нормализуется (trim + lowercase)
    expect(out.email).toBe('user@example.com');
    expect(out.password).toBe('secret12');
  });

  it('обрезает пробелы в email', () => {
    const out = CredentialsSchema.parse({ email: '  hi@x.com  ', password: 'secret12' });
    expect(out.email).toBe('hi@x.com');
  });

  it('ругается на пароль короче 8', () => {
    const r = CredentialsSchema.safeParse({ email: 'a@b.com', password: 'short' });
    expect(r.success).toBe(false);
  });

  it('ругается на пароль длиннее 72 (bcrypt limit)', () => {
    const r = CredentialsSchema.safeParse({ email: 'a@b.com', password: 'x'.repeat(73) });
    expect(r.success).toBe(false);
  });

  it('ругается на невалидный email', () => {
    const r = CredentialsSchema.safeParse({ email: 'not-an-email', password: 'secret12' });
    expect(r.success).toBe(false);
  });

  it('ругается на email длиннее 254 (RFC 5321)', () => {
    const long = 'a'.repeat(250) + '@b.com';
    const r = CredentialsSchema.safeParse({ email: long, password: 'secret12' });
    expect(r.success).toBe(false);
  });
});

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { AuthService } from './auth-service.js';

describe('AuthService', () => {
  it('creates and invalidates sessions for the configured password', () => {
    const service = new AuthService('secret-pass');

    expect(service.login('wrong-pass')).toBeNull();

    const token = service.login('secret-pass');

    expect(token).not.toBeNull();
    expect(service.isValid(token)).toBe(true);

    service.logout(token);

    expect(service.isValid(token)).toBe(false);
  });
});
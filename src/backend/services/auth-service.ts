import { randomUUID, timingSafeEqual } from "node:crypto";

export class AuthService {
  private readonly sessions = new Map<string, { createdAt: number }>();

  constructor(private readonly password: string) {}

  login(candidate: string) {
    if (!safeCompare(candidate, this.password)) {
      return null;
    }

    const token = randomUUID();
    this.sessions.set(token, { createdAt: Date.now() });
    return token;
  }

  isValid(token: string | undefined | null) {
    if (!token) {
      return false;
    }

    return this.sessions.has(token);
  }

  logout(token: string | undefined | null) {
    if (!token) {
      return;
    }

    this.sessions.delete(token);
  }
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

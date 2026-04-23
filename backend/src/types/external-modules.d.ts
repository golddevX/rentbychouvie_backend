declare module 'passport-jwt' {
  import { Request } from 'express';

  export interface StrategyOptions {
    jwtFromRequest: (request: Request) => string | null;
    secretOrKey: string;
    ignoreExpiration?: boolean;
    passReqToCallback?: boolean;
    issuer?: string | string[];
    audience?: string | string[];
    algorithms?: string[];
  }

  export class Strategy {
    constructor(
      options: StrategyOptions,
      verify: (payload: any, done: (error: any, user?: any) => void) => void,
    );
  }

  export const ExtractJwt: {
    fromAuthHeaderAsBearerToken(): (request: Request) => string | null;
  };
}

declare module 'qrcode' {
  export function toDataURL(text: string): Promise<string>;
}

declare module 'uuid' {
  export function v4(): string;
}

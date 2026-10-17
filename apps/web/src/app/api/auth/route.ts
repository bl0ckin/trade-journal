import { cookies } from "next/headers";
import {
  AUTH_COOKIE,
  clientKey,
  passwordConfigured,
  recordSignIn,
  SESSION_MAX_AGE,
  sessionToken,
  signInPaused,
  verifyPassword,
} from "@/server/auth";
import { bad, handler, ok } from "@/server/api";

export const POST = handler(
  async (request: Request) => {
    if (!passwordConfigured()) return ok({ authenticated: true });
    const client = clientKey(request);
    if (signInPaused(client))
      return bad("Too many wrong passwords. Wait a few minutes and try again.", 429);
    const { password } = (await request.json()) as { password?: string };
    const valid = typeof password === "string" && password !== "" && verifyPassword(password);
    recordSignIn(client, valid);
    if (!valid) return bad("Wrong password", 401);
    const jar = await cookies();
    jar.set(AUTH_COOKIE, sessionToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return ok({ authenticated: true });
  },
  { public: true },
);

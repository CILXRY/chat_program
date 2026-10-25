import { defineMiddleware } from 'astro:middleware';
import type { User } from './lib/types';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8000';

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const isProtected =
    path === '/' || path === '/app' || path.startsWith('/channels');
  const isAuthPage = path === '/login' || path === '/register';

  if (!isProtected && !isAuthPage) {
    return next();
  }

  let user: User | null = null;
  const cookie = context.request.headers.get('cookie') ?? '';
  if (cookie) {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { cookie },
        cache: 'no-store',
      });
      if (response.ok) {
        user = (await response.json()) as User;
      }
    } catch (error) {
      console.error('[middleware] auth check failed', error);
    }
  }

  if (!user && isProtected) {
    const nextPath = `${path}${context.url.search}`;
    return context.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (user && isAuthPage) {
    return context.redirect('/app');
  }

  context.locals.user = user;
  return next();
});

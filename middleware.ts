import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * By default, clerkMiddleware() does not protect any routes.
 * https://clerk.com/docs/references/nextjs/clerk-middleware
 */

// protecting all routes except for the ones below
const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)']);

export default clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request)) {
    auth().protect();
  }
});

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
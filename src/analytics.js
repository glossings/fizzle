import { inject } from '@vercel/analytics';

// The hash holds the whole sketch (see share.js); it's the user's code, not a page.
inject({
  beforeSend: (event) => ({ ...event, url: event.url.split('#')[0] }),
});

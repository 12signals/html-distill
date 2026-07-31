# html-distill

[![npm](https://img.shields.io/npm/v/@12signals/html-distill.svg)](https://www.npmjs.com/package/@12signals/html-distill)
[![install size](https://packagephobia.com/badge?p=@12signals/html-distill)](https://packagephobia.com/result?p=@12signals/html-distill)
[![license](https://img.shields.io/npm/l/@12signals/html-distill.svg)](./LICENSE)

Clean real-world HTML into stable, LLM-ready markup.

Readability-style extractors hunt for an "article" and throw the rest away. On
landing pages, marketing sites and SPAs, the rest (the hero, the pricing, the
CTAs, the nav) is exactly what you want. html-distill keeps the whole page and
strips the noise instead: cookie banners, hidden nodes, framework cruft and
tracking params go, and a few semantic hints go in so an LLM can tell a headline
from a button.

```bash
npm install @12signals/html-distill
```

```js
import { cleanHtml } from '@12signals/html-distill';

const clean = await cleanHtml(rawHtml);
```

```html
<!-- in -->
<div class="cookie-banner">We value your privacy…</div>
<section><div><div>
  <h1 class="text-6xl font-bold tracking-tight">Ship faster</h1>
  <a class="btn" href="/pricing?utm_source=hn&page=2">See plans</a>
</div></div></section>

<!-- out -->
<section>
  <h1 class="hero">Ship faster</h1>
  <a class="btn" href="/pricing?page=2">See plans</a>
</section>
```

## Why

- **Whole page, not an article.** Nothing is discarded for being "boilerplate".
- **Semantic hints.** Visual hierarchy (big headings, hero sections, category
  kickers) is normalized into stable `hero` / `kicker` cues that survive
  sanitization, so the model reads structure the same way across Tailwind,
  WordPress, Bootstrap, Framer and inline styles.
- **Noise removed, carefully.** Cookie-consent banners, hidden nodes, embedded
  SPA JSON and anti-bot-proxy leakage are stripped by rules hardened on real
  pages (they keep screen-reader content, responsive-shown elements and body
  copy that merely mentions "cookies").
- **Stable output.** Redundant wrappers collapse and tracking params are
  dropped, so the same page cleans to the same markup run to run: good for
  diffing and caching.

## API

### `cleanHtml(html, options?) => Promise<string>`

| option | type | default | |
|--------|------|---------|--|
| `policy` | `object` | `defaultPolicy` | Which classes to keep and how hero/kicker hints are detected. |
| `linkParams` | `string[]` | `defaultLinkParams` | Query params kept on `<a href>`. |
| `schema` | `object` | built-in | rehype-sanitize schema (advanced). |

```js
import { cleanHtml, defaultPolicy } from '@12signals/html-distill';

await cleanHtml(rawHtml, {
  policy: { ...defaultPolicy, allowedClassNames: [...defaultPolicy.allowedClassNames, 'newsletter'] },
  linkParams: ['page', 'q', 'ref'],
});
```

### Composable transforms

Every pipeline stage is also exported as a [unified](https://unifiedjs.com/) /
[rehype](https://github.com/rehypejs/rehype) plugin, so you can build your own
pipeline (e.g. keep the hero detection, skip the cookie-banner removal). See
[`src/transforms.js`](./src/transforms.js) for the full list and per-stage docs.

```js
import { detectHeroFromAttributesAndStyles, filterClassNames } from '@12signals/html-distill';
```

## Markdown

html-distill returns HTML. Pipe it through any HTML-to-Markdown converter for a
Markdown prompt:

```js
import { cleanHtml } from '@12signals/html-distill';
import { htmlToText } from 'html-to-text';

const md = htmlToText(await cleanHtml(rawHtml));
```

## License

MIT © [12signals](https://12signals.com)

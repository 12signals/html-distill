# @12signals/html-distill

**Readability reads articles. html-distill understands landing pages.**

A structure-preserving HTML normalizer that turns real-world marketing pages,
landing pages and single-page-app output into stable, semantically-hinted HTML
that an LLM can reason about reliably.

It is the HTML-cleaning layer behind [12signals](https://12signals.com), where
it prepares thousands of competitor homepages, career pages and product pages
for LLM analysis every day.

```bash
npm install @12signals/html-distill
```

```js
import { cleanHtml } from '@12signals/html-distill';

const cleaned = await cleanHtml(rawHtml);
// -> a compact HTML document: full page structure kept, noise removed,
//    visual-hierarchy hints (hero / kicker) injected, tracking stripped.
```

## Why not just use Readability / turndown / a sanitizer?

Most HTML-for-LLM tooling falls into three buckets, and none of them fit the
job of reasoning about a *whole page* (its hero claim, its CTAs, its pricing,
its banners) rather than a single article body:

| Tool | What it does | Where it falls short here |
|------|--------------|---------------------------|
| Mozilla Readability, Defuddle, Trafilatura | Extract the main article (reader mode) | Discard nav, header, footer, hero, CTA, pricing. On landing pages and SPAs without an "article" they often return nothing. |
| turndown, html-to-text | Convert HTML to Markdown/plain text | No cleaning intelligence: framework noise, cookie banners and hidden nodes flow straight into the prompt. |
| sanitize-html, DOMPurify, rehype-sanitize | Security sanitizing (strip XSS) | Remove dangerous tags, but add no signal and strip the class information that carries visual hierarchy. |

html-distill keeps the whole page and normalizes it instead of extracting from
it. The design goal is a **stable, low-noise representation an LLM can diff and
reason over**, not a human reading experience.

## What makes it different

### 1. Framework-agnostic visual-hierarchy hints

The single most useful thing you can give an LLM about a landing page is *what
looks big*. html-distill collapses framework-specific "this text is huge" cues
into one stable semantic class, `hero`:

| Framework | Signal | Rewritten to |
|-----------|--------|--------------|
| Tailwind | `text-4xl` … `text-9xl` | `hero` |
| WordPress | `has-x-large-font-size`, `has-xxx-large-font-size`, `has-huge-font-size` | `hero` |
| Bootstrap | `display-1` … `display-4` | `hero` |
| Framer | `data-framer-name="HERO …"` | `hero` |
| any | inline `font-size: ≥36px` (incl. CSS custom properties like `--framer-font-size`) | `hero` |

The data-attribute and inline-style detection runs *before* sanitization, so
the hint survives even though the sanitizer strips `data-*` and `style`.

```js
await cleanHtml('<h1 class="text-6xl font-bold tracking-tight">Ship faster</h1>');
// -> <h1 class="hero">Ship faster</h1>
```

### 2. Heading treatment that fixes "claim flapping"

When a page has a bare `<h1>` category label ("RECRUITING SOFTWARE") and a
styled `<h2>` value proposition ("Hire faster."), an LLM asked "what is the main
claim?" flips between them run to run. html-distill makes the structure
deterministic:

- ALL-CAPS `<h1>` immediately followed by an `<h2 class="hero">` becomes
  `<div class="kicker">`, so the real claim is unambiguous.
- Animated word-rotator lists inside a heading (`<h1><ul><li>grow</li>…`) are
  flattened to `grow / scale / close`, with loop-duplicates removed.
- `<br>` inside headings becomes a space; headings longer than 200 chars (a
  paragraph mis-tagged as a heading) are demoted to `<p>`.

### 3. Boilerplate removal calibrated on real production failures

Every removal rule exists because a naive version of it once broke a real page.
The rules are deliberately conservative:

- **Cookie-consent banners** matched by consent-manager class/ID patterns
  (OneTrust, Cookiebot, CookieYes, Klaro, Osano, Termly). No text-density
  heuristic: an earlier "count the word 'analytics'" approach wiped an entire
  Amazon job posting. Class matching requires a token boundary so `cky-` does
  not match Tailwind's `sticky-*`.
- **Hidden nodes** (`hidden`, `inert`, `aria-hidden`, `opacity-0`, `d-none`, …)
  removed, but responsive-shown (`hidden xl:block`), animated (`opacity-0
  animate-*`) and screen-reader-only content is kept.
- **Serialized stripped tags**: anti-bot proxies sometimes turn `<iframe>` into
  `<div data-original-tag="iframe">` and flatten a cross-origin player's DOM
  into it. html-distill drops these so a background video's "Unmute / Add to
  Watch Later" chrome never leaks into your hero.
- **JSON config blobs** in `<pre>`/`<code>` (embedded SPA state) removed.

### 4. Lean, stable structure

- Class names filtered down to a semantic allowlist (`hero`, `cta`, `pricing`,
  `faq`, `testimonial`, `promo`, …); everything else dropped.
- Redundant nesting collapsed (`<div class="x"><div class="x">…` unwrapped,
  prop-less `div`/`span` wrappers removed).
- Tracking params stripped from links (`utm_*`, `gclid`, session tokens, …),
  a configurable allowlist kept.
- Title + description harvested (`<title>` / `meta description` / `og:description`,
  with `<h1>` / first-`<p>` fallbacks) into a minimal document head.

## API

### `cleanHtml(html, options?) => Promise<string>`

The one-call pipeline. Returns a formatted HTML document string.

```js
import { cleanHtml, defaultPolicy } from '@12signals/html-distill';

const cleaned = await cleanHtml(rawHtml, {
  // Class-filtering + hero-detection policy (see defaultPolicy).
  policy: { ...defaultPolicy, allowedClassNames: [...defaultPolicy.allowedClassNames, 'newsletter'] },
  // Query params kept on <a href>.
  linkParams: ['page', 'q', 'ref'],
  // Custom rehype-sanitize schema (advanced).
  // schema: buildSanitizeSchema({ ... }),
});
```

### Composable transforms

Every pipeline stage is exported as a [unified](https://unifiedjs.com/) /
[rehype](https://github.com/rehypejs/rehype) plugin, so you can assemble your
own pipeline. Ordering matters: some stages must run before `rehype-sanitize`
(they read `data-*`, `style` or original class names), some after.

```js
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import {
  removeCookieConsentBanners,
  detectHeroFromAttributesAndStyles,
  filterClassNames,
  sanitizeSchema,
} from '@12signals/html-distill';

const out = await unified()
  .use(rehypeParse, { fragment: true })
  .use(removeCookieConsentBanners())          // before sanitize
  .use(detectHeroFromAttributesAndStyles())   // before sanitize
  .use(rehypeSanitize, sanitizeSchema)
  .use(filterClassNames())                    // after sanitize
  .use(rehypeStringify)
  .process(rawHtml);
```

Exported stages:

**Before sanitize:** `removeDocumentHeadArtifacts`, `removeHiddenNodes`,
`removeCookieConsentBanners`, `removeSerializedStrippedTags`,
`removeJsonCodeBlocks`, `detectHeroFromAttributesAndStyles`

**After sanitize:** `normalizeHeadingBreaks`, `flattenHeadingLists`,
`demoteOverlongHeadings`, `filterClassNames`, `stripLinkTrackingParams`,
`unwrapRedundantDivs`, `demoteKickerHeadings`

**Document assembly + helpers:** `wrapDocument`, `extractMetadata`,
`textContent`, `buildSanitizeSchema`, `sanitizeSchema`, `defaultPolicy`,
`defaultLinkParams`, `defaultStrippedTags`

## Pipeline order

```
pre-sanitize   removeDocumentHeadArtifacts
               removeHiddenNodes
               removeCookieConsentBanners
               removeSerializedStrippedTags
               removeJsonCodeBlocks
               detectHeroFromAttributesAndStyles
sanitize       rehype-sanitize (content-oriented allowlist, keeps className)
post-sanitize  normalizeHeadingBreaks
               flattenHeadingLists
               demoteOverlongHeadings
               filterClassNames        (allowlist + font-size → hero)
               stripLinkTrackingParams
               wrapDocument            (build <html><head><body>)
               unwrapRedundantDivs
               demoteKickerHeadings    (ALL-CAPS h1 → div.kicker)
               format
```

## Output to Markdown

html-distill returns HTML. To feed an LLM Markdown, pipe the result through any
HTML-to-Markdown converter (the semantic classes are lost in Markdown, but the
cleaned structure and hierarchy survive):

```js
import { cleanHtml } from '@12signals/html-distill';
import { htmlToText } from 'html-to-text'; // or turndown, etc.

const md = htmlToText(await cleanHtml(rawHtml));
```

## License

MIT © [12signals](https://12signals.com)

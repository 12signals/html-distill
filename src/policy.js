import { defaultSchema } from 'hast-util-sanitize';

/**
 * @typedef {Object} DistillPolicy
 * @property {string[]} allowedClassNames - Exact class names to keep (case-insensitive).
 * @property {RegExp[]} heroFontSizePatterns - Class patterns for visually large text; matches are rewritten to `hero`.
 * @property {{attr: string, pattern: RegExp}[]} heroDataAttributePatterns - data-* attribute patterns that mark a node as `hero` (checked pre-sanitize). `attr: '*'` tests every data-* attribute.
 * @property {RegExp[]} kickerClassPatterns - Class patterns for eyebrow/kicker labels; matches are rewritten to `kicker` and their headings demoted to `<div class="kicker">`.
 * @property {number} heroInlineFontSizeMin - Inline font-size (px) at/above which a node is marked `hero`.
 * @property {string[]} allowedClassPrefixes - Class prefixes to keep (e.g. `hero-`, `cta-`).
 * @property {boolean} expandHyphenVariants - When true, keep `hero-*` variants of allowlisted base names.
 * @property {number} headingMaxLength - Headings longer than this are demoted to `<p>`.
 */

/**
 * Default class-filtering policy.
 * Tuned for landing-page / marketing-page change detection: it keeps the
 * classes that carry marketing signal (hero, cta, pricing, promo, ...) and
 * drops everything else. Override or replace it via `cleanHtml(html, { policy })`.
 *
 * @type {DistillPolicy}
 */
export const defaultPolicy = {
  allowedClassNames: [
    // Core content structure
    'hero', 'cta', 'feature', 'benefit', 'pricing', 'faq', 'lead',
    'testimonial', 'review', 'rating', 'quote',

    // Social proof & trust
    'logo', 'client', 'case-study', 'guarantee', 'badge',
    'certification', 'security',

    // Content status markers
    'note', 'warning', 'info', 'success', 'error',
    'caption', 'summary', 'abstract',

    // Dynamic content markers (flag as frequently changing)
    'dynamic', 'live', 'counter', 'ticker', 'timestamp', 'updated',
    'banner', 'promo', 'campaign', 'announcement', 'seasonal',

    // A/B testing & versioning
    'variant', 'v1', 'v2', 'test',

    // Structural semantic markers
    'article', 'section', 'aside', 'header', 'footer',

    // Task/interaction elements
    'task-list-item', 'checklist', 'accordion', 'tab', 'collapse',

    // Common utility classes worth tracking
    'btn',
  ],

  // CSS class patterns indicating visually large/hero text. Matched classes
  // are translated to `hero` during cleaning, giving a framework-agnostic
  // visual-hierarchy signal.
  heroFontSizePatterns: [
    /^has-(?:x{1,3}-large|huge)-font-size$/, // WordPress
    /^text-[4-9]xl$/,                         // Tailwind >= 4xl
    /^display-[1-4]$/,                        // Bootstrap display headings
  ],

  // Pre-sanitize hero detection (runs BEFORE the sanitizer strips data-* and
  // inline styles). Framework-specific semantic labels that name a section
  // as "hero"; checked against lowercased attribute values.
  heroDataAttributePatterns: [
    { attr: 'dataFramerName', pattern: /hero/i }, // Framer: data-framer-name="HERO TEXT"
    { attr: 'dataTestid', pattern: /hero/i },     // data-testid="hero-banner" (Autodesk, MUI apps)
    { attr: '*', pattern: /hero/i },              // any other data-* attribute (wildcard)
  ],

  // Class patterns indicating an eyebrow/kicker line (small ALL-CAPS label
  // above the real headline). Matched classes are rewritten to `kicker`, and
  // headings carrying them are demoted to <div class="kicker"> so they never
  // surface as h1.
  kickerClassPatterns: [
    /eyebrow/, // MUI: MuiTypography-eyebrow-large
    /kicker/,
  ],

  // Inline font-size threshold (px). Elements whose CSS style contains
  // font-size >= this value get class="hero". Catches Framer
  // (--framer-font-size: 48px), inline styles, etc.
  heroInlineFontSizeMin: 36,

  allowedClassPrefixes: [
    'variant-', // variant-a, variant-b
    'v-',       // v-1, v-2
    'cta-',     // cta-primary, cta-secondary
    'feature-', // feature-1, feature-list
    'hero-',    // hero-title, hero-subtitle
    'price-',   // price-tier, price-annual
    'test-',    // test-group-a
  ],

  // When true, also keep variants like `hero-*` if `hero` is allowlisted.
  expandHyphenVariants: true,

  // Headings whose text exceeds this length are demoted to <p>.
  headingMaxLength: 200,
};

/**
 * Query parameters kept on `<a href>` by default. Everything else (utm_*,
 * gclid, session tokens, ...) is dropped so links stay stable across scrapes.
 * @type {string[]}
 */
export const defaultLinkParams = [
  'page', 'p', 'q', 'query', 'search', 's', 'sort', 'order',
  'lang', 'locale', 'hl', 'category', 'tag', 'tags', 'id', 'slug',
];

/**
 * Tags serialized-away by anti-bot proxies that must be dropped when they
 * reappear as `<div data-original-tag="...">`. Symmetric to the sanitize
 * schema's `strip` list.
 * @type {string[]}
 */
export const defaultStrippedTags = ['script', 'style', 'iframe', 'noscript'];

/**
 * Build the rehype-sanitize schema. Keeps a content-oriented tag allowlist
 * and the `className` attribute (needed for the semantic hints), on top of
 * hast-util-sanitize's safe defaults.
 *
 * @param {Object} [overrides] - Shallow-merged onto the base schema.
 * @returns {Object} sanitize schema
 */
export function buildSanitizeSchema(overrides = {}) {
  return {
    ...defaultSchema,
    tagNames: [
      'html', 'head', 'body',
      'article', 'section', 'header', 'footer', 'nav', 'main', 'aside',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div',
      'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sup', 'sub', 'br', 'hr',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'a', 'img', 'figure', 'figcaption',
      'pre', 'code', 'kbd', 'samp',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'blockquote', 'cite',
      'time',
    ],
    attributes: {
      a: ['href', 'title', 'className'],
      img: ['alt', 'className'],
      th: ['scope'],
      td: [], tr: [], table: [], thead: [], tbody: [], tfoot: [],
      code: ['className'], pre: ['className'], blockquote: ['className'], cite: ['className'],
      time: ['dateTime', 'className'],
      '*': ['className'],
    },
    protocols: { href: ['http', 'https', 'mailto', 'tel'] },
    clobberPrefix: 'data-',
    strip: [...defaultStrippedTags],
    ...overrides,
  };
}

/** Default sanitize schema instance. */
export const sanitizeSchema = buildSanitizeSchema();

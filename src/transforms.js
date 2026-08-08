import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import { defaultPolicy, defaultLinkParams, defaultStrippedTags } from './policy.js';

/**
 * Every transform in this file is a unified/rehype plugin factory: calling it
 * returns an attacher `() => (tree) => void` you can pass to `.use(...)`.
 * They are exported individually so you can assemble your own pipeline. The
 * ordering constraints (which run before vs after `rehype-sanitize`) are
 * documented in the README and encoded in `cleanHtml`.
 */

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** @param {any} node @returns {string} */
export function textContent(node) {
  if (!node) return '';
  if (node.type === 'element' && node.tagName === 'br') return ' ';
  if (node.type === 'text') return node.value || '';
  const children = node.children || [];
  return children.map(textContent).join('');
}

function toClassList(props) {
  const raw = props?.className;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.split(/\s+/g);
  return [];
}

/**
 * Remove nodes that are visually hidden: the `hidden` attribute, presentation
 * clones, and hidden utility classes (`hidden`, `invisible`, `opacity-0`,
 * `d-none`, ...). Screen-reader-only content, `inert` subtrees and
 * responsively-shown / animated nodes are deliberately kept.
 *
 * Run BEFORE sanitize (needs the original class names).
 * @returns {() => (tree: any) => void}
 */
export function removeHiddenNodes() {
  return () => {
    const shouldSkip = (node) => {
      if (!node || node.type !== 'element') return false;
      const props = node.properties || {};
      const classList = toClassList(props);
      const hasScreenReaderClass = classList.some((cls) => /sr-only|visually-hidden/i.test(cls || ''));
      // opacity-0 with an animate class = CSS animation (starts invisible, fades in), not hidden
      const hasAnimateClass = classList.some((cls) => /animate/i.test(cls || ''));
      // Responsive Tailwind: element with `hidden xl:block` is visible at xl, not permanently hidden
      const hasResponsiveShow = classList.some((cls) => {
        const token = String(cls || '').trim().toLowerCase();
        return /^(sm|md|lg|xl|2xl):(?:block|flex|grid|inline|table|contents)/.test(token);
      });
      const hasHiddenUtilityClass = !hasResponsiveShow && classList.some((cls) => {
        const token = String(cls || '').trim().toLowerCase();
        if (!token || /sr-only|visually-hidden/.test(token)) return false;
        if (token === 'hidden' || token === 'invisible') return true;
        if (token.includes(':hidden')) return true; // tailwind utilities like lg:hidden
        if (token.includes('opacity-0') && !hasAnimateClass) return true;
        if (token.includes('display-none')) return true;
        if (token.includes('d-none')) return true;
        return false;
      });

      // Dead branch: hast normalizes the attribute to `ariaHidden`, so this
      // lookup never resolves. Left inactive on purpose — enabling it would
      // newly delete every aria-hidden subtree, including the modal backdrops
      // that the `inert` case above showed to be visible content.
      const ariaHiddenRaw = props['aria-hidden'];
      const ariaHidden = typeof ariaHiddenRaw === 'string'
        ? ariaHiddenRaw.toLowerCase() === 'true'
        : ariaHiddenRaw === true;
      // `inert` is NOT hidden: it marks a subtree non-interactive while a modal
      // is open. The content stays fully visible, so treating it as hidden
      // deletes the entire page behind any consent/login dialog and leaves only
      // the dialog itself.
      const hasBooleanHidden = 'hidden' in props;
      const role = typeof props.role === 'string' ? props.role.toLowerCase() : '';
      const tabIndexRaw = props.tabindex ?? props.tabIndex;
      const tabIndex = typeof tabIndexRaw === 'string' ? tabIndexRaw.trim() : tabIndexRaw;
      const isPresentationClone = role === 'presentation' && (tabIndex === -1 || tabIndex === '-1');

      const shouldRemove = ariaHidden || hasBooleanHidden || isPresentationClone || hasHiddenUtilityClass;
      return shouldRemove && !hasScreenReaderClass;
    };

    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      const next = [];
      for (const child of node.children) {
        if (shouldSkip(child)) continue;
        if (child && child.children) walk(child);
        next.push(child);
      }
      node.children = next;
    };

    return (tree) => walk(tree);
  };
}

/**
 * Remove `<code>`/`<pre>` elements whose text content is a JSON data blob
 * (embedded SPA config/state that pollutes the content).
 * @returns {() => (tree: any) => void}
 */
export function removeJsonCodeBlocks() {
  const getText = (node) => {
    if (!node) return '';
    if (node.type === 'text') return node.value || '';
    if (node.children) return node.children.map(getText).join('');
    return '';
  };

  const looksLikeJson = (text) => {
    const trimmed = text.trim();
    if (trimmed.length < 50) return false;
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
    if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) return false;
    if (!/["'][^"']+["']\s*:/.test(trimmed)) return false;
    return true;
  };

  return () => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      const next = [];
      for (const child of node.children) {
        if (child.type === 'element' && (child.tagName === 'code' || child.tagName === 'pre')) {
          if (looksLikeJson(getText(child))) continue;
        }
        if (child && child.children) walk(child);
        next.push(child);
      }
      node.children = next;
    };
    return (tree) => walk(tree);
  };
}

/**
 * Remove document-head elements (`head`, `title`, `base`, `meta`, `link`) and
 * their subtrees. When a full HTML document is parsed in fragment mode, a
 * stray `<title>` floats into the body and the sanitizer later unwraps it,
 * leaking the title string as body text. The real metadata is harvested
 * separately by `extractMetadata`, so dropping these here is safe.
 *
 * Run BEFORE sanitize.
 * @returns {() => (tree: any) => void}
 */
export function removeDocumentHeadArtifacts() {
  const HEAD_TAGS = new Set(['head', 'title', 'base', 'meta', 'link']);
  return () => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      const next = [];
      for (const child of node.children) {
        if (child.type === 'element' && HEAD_TAGS.has(child.tagName)) continue;
        if (child && child.children) walk(child);
        next.push(child);
      }
      node.children = next;
    };
    return (tree) => walk(tree);
  };
}

/**
 * Remove cookie-consent banners by class/ID patterns from popular consent
 * managers (CookieYes, OneTrust, Cookiebot, Klaro, Osano, Termly, ...).
 *
 * Class matching requires a non-alphanumeric boundary in front of each token
 * so consent tokens don't collide with utility-class fragments (e.g. `cky-`
 * inside Tailwind's `sticky-*`). ID matching is a plain substring (IDs are
 * camelCase like `CybotCookiebotDialog`). No text-density heuristic.
 *
 * Run BEFORE sanitize (needs original class names / IDs).
 * @returns {() => (tree: any) => void}
 */
export function removeCookieConsentBanners() {
  const CLASS_PATTERN = /(?:^|[^a-z0-9])(?:cookie|consent|gdpr|cky-|onetrust|cookiebot|klaro|osano|termly)/i;
  const ID_PATTERN = /cookie|consent|gdpr|cky-|onetrust|cookiebot|klaro|osano|termly/i;

  const isBanner = (node) => {
    if (node.type !== 'element') return false;
    const props = node.properties || {};
    const classes = Array.isArray(props.className)
      ? props.className.join(' ')
      : typeof props.className === 'string' ? props.className : '';
    const id = typeof props.id === 'string' ? props.id : '';
    if (classes && CLASS_PATTERN.test(' ' + classes)) return true;
    if (id && ID_PATTERN.test(id)) return true;
    return false;
  };

  return () => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      const next = [];
      for (const child of node.children) {
        if (child.type === 'element' && isBanner(child)) continue;
        if (child && child.children) walk(child);
        next.push(child);
      }
      node.children = next;
    };
    return (tree) => walk(tree);
  };
}

/**
 * Remove `<div data-original-tag="...">` nodes that anti-bot proxies (e.g.
 * Firecrawl Cloud) leave behind after serializing stripped tags like iframe/
 * script/style into divs (and flattening cross-origin iframe DOM into them).
 *
 * Run BEFORE sanitize (which drops the data-original-tag attribute).
 * @param {string[]} [strippedTags]
 * @returns {() => (tree: any) => void}
 */
export function removeSerializedStrippedTags(strippedTags = defaultStrippedTags) {
  const stripSet = new Set(strippedTags.map((t) => String(t).toLowerCase()));
  return () => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      const next = [];
      for (const child of node.children) {
        if (child.type === 'element') {
          const orig = child.properties?.dataOriginalTag; // rehype parses data-original-tag as dataOriginalTag
          if (typeof orig === 'string' && stripSet.has(orig.toLowerCase())) continue;
        }
        if (child && child.children) walk(child);
        next.push(child);
      }
      node.children = next;
    };
    return (tree) => walk(tree);
  };
}

/**
 * Harvest hero signals from data-* attributes and inline font-size styles,
 * adding `class="hero"` so the hint survives sanitization.
 *
 * Run BEFORE sanitize (which strips data-* and inline styles).
 * @param {import('./policy.js').DistillPolicy} [policy]
 * @returns {() => (tree: any) => void}
 */
export function detectHeroFromAttributesAndStyles(policy = defaultPolicy) {
  const dataPatterns = policy.heroDataAttributePatterns || [];
  const minFontSize = policy.heroInlineFontSizeMin || 0;
  const fontSizeRe = /(?:^|;|\s)(?:--[\w-]+-)?font-size\s*:\s*(\d+(?:\.\d+)?)px/i;

  return () => {
    const walk = (node) => {
      if (!node) return;
      if (node.type === 'element') {
        const props = node.properties || {};
        let isHero = false;

        for (const { attr, pattern } of dataPatterns) {
          const val = props[attr];
          if (typeof val === 'string' && pattern.test(val)) { isHero = true; break; }
        }

        if (!isHero && minFontSize > 0) {
          const style = props.style;
          if (typeof style === 'string') {
            const m = fontSizeRe.exec(style);
            if (m && parseFloat(m[1]) >= minFontSize) isHero = true;
          }
        }

        if (isHero) {
          const existing = toClassList(props);
          if (!existing.includes('hero')) {
            node.properties.className = [...existing, 'hero'];
          }
        }
      }
      (node.children || []).forEach(walk);
    };
    return (tree) => walk(tree);
  };
}

/**
 * Convert `<br>` inside headings to a space (headings are single-line signals).
 * @returns {() => (tree: any) => void}
 */
export function normalizeHeadingBreaks() {
  const visit = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    node.children = node.children.map((child) => {
      if (child?.type === 'element') {
        if (HEADING_TAGS.has(child.tagName)) {
          child.children = (child.children || []).map((gc) =>
            gc?.type === 'element' && gc.tagName === 'br' ? { type: 'text', value: ' ' } : gc);
        }
        visit(child);
      }
      return child;
    });
  };
  return () => (tree) => visit(tree);
}

/**
 * Flatten `<ul>`/`<ol>` inside headings into inline text joined by " / ".
 * Animated word rotators (HubSpot etc.) use lists inside `<h1>`; duplicate
 * items (added for seamless looping) are removed.
 * @returns {() => (tree: any) => void}
 */
export function flattenHeadingLists() {
  const flattenList = (listNode) => {
    const items = (listNode.children || [])
      .filter((li) => li.type === 'element' && li.tagName === 'li')
      .map((li) => textContent(li).trim())
      .filter(Boolean);
    const seen = new Set();
    const unique = items.filter((item) => (seen.has(item) ? false : (seen.add(item), true)));
    if (unique.length === 0) return null;
    return { type: 'text', value: unique.join(' / ') };
  };

  const visit = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child?.type === 'element' && HEADING_TAGS.has(child.tagName)) {
        const replaced = [];
        for (const gc of child.children || []) {
          if (gc?.type === 'element' && (gc.tagName === 'ul' || gc.tagName === 'ol')) {
            const flat = flattenList(gc);
            if (flat) replaced.push(flat);
          } else if (gc?.type === 'element' && gc.tagName === 'span') {
            const innerList = (gc.children || []).find(
              (n) => n?.type === 'element' && (n.tagName === 'ul' || n.tagName === 'ol'));
            if (innerList) {
              const flat = flattenList(innerList);
              if (flat) replaced.push(flat);
            } else {
              replaced.push(gc);
            }
          } else {
            replaced.push(gc);
          }
        }
        child.children = replaced;
      }
      visit(child);
    }
  };
  return () => (tree) => visit(tree);
}

/**
 * Demote headings (h1-h6) to `<p>` when their text exceeds `maxLength`
 * (misused heading tags wrapping paragraph-length text).
 * @param {number} [maxLength]
 * @returns {() => (tree: any) => void}
 */
export function demoteOverlongHeadings(maxLength = defaultPolicy.headingMaxLength) {
  return () => {
    const visit = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      for (const child of node.children) {
        if (child?.type === 'element' && HEADING_TAGS.has(child.tagName)) {
          if (textContent(child).trim().length > maxLength) child.tagName = 'p';
        }
        if (child?.children) visit(child);
      }
    };
    return (tree) => visit(tree);
  };
}

/**
 * Filter class names down to the semantic allowlist, rewrite large-font-size
 * classes to `hero`, drop classes already inherited from an ancestor.
 *
 * Run AFTER sanitize.
 * @param {import('./policy.js').DistillPolicy} [policy]
 * @returns {() => (tree: any) => void}
 */
export function filterClassNames(policy = defaultPolicy) {
  return () => (tree) => {
    const allowedNameList = (policy.allowedClassNames || [])
      .map((s) => (s || '').trim().toLowerCase()).filter(Boolean);
    const allowedNames = new Set(allowedNameList);
    const allowedPrefixes = (policy.allowedClassPrefixes || [])
      .map((s) => (s || '').trim().toLowerCase()).filter(Boolean);
    const expandHyphen = !!policy.expandHyphenVariants;
    const heroPatterns = policy.heroFontSizePatterns || [];

    const visit = (node, inherited = new Set()) => {
      if (!node) return;
      let nextAncestors = inherited;
      if (node.type === 'element') {
        const props = node.properties || {};
        let classes = props.className;
        if (classes) {
          if (typeof classes === 'string') classes = classes.split(/\s+/g);
          if (Array.isArray(classes)) {
            const kept = new Set();
            for (const cls of classes) {
              const c = String(cls || '').trim();
              if (!c) continue;
              const lower = c.toLowerCase();

              if (heroPatterns.some((re) => re.test(lower))) { kept.add('hero'); continue; }

              const matchedTokens = new Set();
              if (allowedNames.has(lower)) matchedTokens.add(lower);
              if (expandHyphen) {
                for (const base of allowedNameList) {
                  if (base && lower.startsWith(base + '-')) matchedTokens.add(base);
                }
              }
              if (matchedTokens.size === 0) {
                for (const token of allowedNameList) {
                  if (token && lower.includes(token)) matchedTokens.add(token);
                }
              }

              if (matchedTokens.size > 0) { matchedTokens.forEach((t) => kept.add(t)); continue; }

              for (const p of allowedPrefixes) {
                if (lower.startsWith(p)) { kept.add(c); break; }
              }
            }

            if (kept.size > 0 && inherited.size > 0) {
              for (const val of Array.from(kept)) if (inherited.has(val)) kept.delete(val);
            }

            if (kept.size > 0) {
              node.properties.className = Array.from(kept);
              nextAncestors = new Set([...inherited, ...kept]);
            } else {
              delete node.properties.className;
              if (Object.keys(node.properties).length === 0) node.properties = {};
            }
          }
        }
      }
      for (const child of node.children || []) visit(child, nextAncestors);
    };

    visit(tree, new Set());
  };
}

/**
 * Strip tracking query params from `<a href>`, keeping only `allowedParams`.
 * mailto:/tel:/# links pass through untouched.
 *
 * Run AFTER sanitize.
 * @param {string[]} [allowedParams]
 * @returns {() => (tree: any) => void}
 */
export function stripLinkTrackingParams(allowedParams = defaultLinkParams) {
  const allowSet = new Set(allowedParams.map((s) => String(s).toLowerCase()));
  const isHttpLike = (href) =>
    /^https?:\/\//i.test(href) || href.startsWith('/') || href.startsWith('./') ||
    href.startsWith('../') || href.startsWith('?');

  return () => (tree) => {
    const visit = (node) => {
      if (node.type === 'element' && node.tagName === 'a') {
        const href = node.properties?.href;
        if (typeof href === 'string') {
          const lower = href.toLowerCase();
          if (!(lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('#')) && isHttpLike(href)) {
            try {
              const base = 'http://local';
              const isAbsolute = /^https?:\/\//i.test(href);
              const u = new URL(href, base);
              const kept = new URLSearchParams();
              for (const [k, v] of u.searchParams.entries()) {
                if (allowSet.has(String(k).toLowerCase())) kept.append(k, v);
              }
              const query = kept.toString();
              const hash = u.hash || '';
              node.properties.href = isAbsolute
                ? u.origin + u.pathname + (query ? `?${query}` : '') + hash
                : u.pathname + (query ? `?${query}` : '') + hash;
            } catch {
              // leave href as-is on parse failure
            }
          }
        }
      }
      (node.children || []).forEach(visit);
    };
    visit(tree);
  };
}

/**
 * Collapse redundant nesting inside `<body>`: unwrap chains of identical
 * same-class divs and prop-less div/span wrappers, compact whitespace.
 *
 * Run AFTER `wrapDocument` (needs the html/body structure).
 * @returns {() => (tree: any) => void}
 */
export function unwrapRedundantDivs() {
  return () => (tree) => {
    const htmlEl = (tree.children || []).find((n) => n.type === 'element' && n.tagName === 'html');
    const bodyEl = htmlEl?.children?.find((n) => n.type === 'element' && n.tagName === 'body');

    const isEmptyText = (n) => n.type === 'text' && (!n.value || /^\s*$/.test(n.value));
    const hasNoProps = (node) => !node.properties || Object.keys(node.properties).length === 0;
    const getClassList = (node) => toClassList(node?.properties).map((s) => String(s || '').trim()).filter(Boolean);
    const sameClassList = (a, b) => {
      const ca = getClassList(a); const cb = getClassList(b);
      if (ca.length !== cb.length) return false;
      const sa = [...ca].sort(); const sb = [...cb].sort();
      return sa.every((val, idx) => val === sb[idx]);
    };
    const hasOnlyClassProps = (node) => {
      const props = node?.properties;
      if (!props) return true;
      const keys = Object.keys(props);
      return keys.length === 0 || (keys.length === 1 && keys[0] === 'className');
    };
    const getSingleElementChild = (node) => {
      if (!Array.isArray(node?.children)) return null;
      let candidate = null;
      for (const ch of node.children) {
        if (isEmptyText(ch)) continue;
        if (ch.type !== 'element') return null;
        if (candidate) return null;
        candidate = ch;
      }
      return candidate;
    };
    const collapseDuplicateChild = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      while (true) {
        const onlyChild = getSingleElementChild(node);
        if (onlyChild && onlyChild.tagName === node.tagName &&
          hasOnlyClassProps(node) && hasOnlyClassProps(onlyChild) && sameClassList(node, onlyChild)) {
          node.children = onlyChild.children || [];
        } else {
          break;
        }
      }
    };

    function unwrapIn(parent) {
      if (!parent || !Array.isArray(parent.children)) return;
      collapseDuplicateChild(parent);
      const next = [];
      for (const child of parent.children) {
        if (child.type === 'element') {
          unwrapIn(child);
          collapseDuplicateChild(child);
          if ((child.tagName === 'div' || child.tagName === 'span') && hasNoProps(child)) {
            const kids = child.children || [];
            const meaningfulText = kids.some((c) => c.type === 'text' && !/^\s*$/.test(c.value || ''));
            if (!meaningfulText) {
              if (kids.length === 0) continue;
              next.push(...kids);
              continue;
            }
          }
        }
        next.push(child);
      }
      const compact = [];
      for (const n of next) {
        if (isEmptyText(n)) {
          const prev = compact[compact.length - 1];
          if (!prev || isEmptyText(prev)) continue;
        }
        compact.push(n);
      }
      parent.children = compact;
      collapseDuplicateChild(parent);
    }

    if (bodyEl) unwrapIn(bodyEl);
  };
}

/**
 * Demote an ALL-CAPS `<h1>` to `<div class="kicker">` when it is immediately
 * followed by an `<h2 class="hero">` (category label above the real claim).
 *
 * Run AFTER `unwrapRedundantDivs` so the headings are siblings.
 * @returns {() => (tree: any) => void}
 */
export function demoteKickerHeadings() {
  const isAllCaps = (text) => {
    const letters = text.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ]/g, '');
    return letters.length >= 3 && letters === letters.toUpperCase();
  };
  const hasClass = (node, cls) =>
    Array.isArray(node.properties?.className) && node.properties.className.includes(cls);

  return () => (tree) => {
    const visit = (node) => {
      const children = node.children || [];
      for (let i = 0; i < children.length - 1; i++) {
        const cur = children[i];
        if (cur.type !== 'element' || cur.tagName !== 'h1') continue;
        let next = null;
        for (let j = i + 1; j < children.length; j++) {
          if (children[j].type === 'element') { next = children[j]; break; }
          if (children[j].type === 'text' && children[j].value?.trim()) break;
        }
        if (next && next.tagName === 'h2' && hasClass(next, 'hero') && isAllCaps(textContent(cur))) {
          cur.tagName = 'div';
          cur.properties = { className: ['kicker'] };
        }
      }
      for (const child of children) visit(child);
    };
    visit(tree);
  };
}

/**
 * Normalize the tree into `<!doctype html><html><head>…</head><body>…</body>`:
 * lift body children, drop the original head, inject a minimal head built from
 * the extracted metadata.
 *
 * @param {{title?: string, description?: string}} metadata
 * @returns {() => (tree: any) => void}
 */
export function wrapDocument(metadata) {
  return function attacher() {
    return function transformer(tree) {
      const bodyChildren = [];
      const rootChildren = Array.isArray(tree?.children) ? tree.children : [];
      for (const child of rootChildren) {
        if (child.type === 'element' && child.tagName === 'html') {
          for (const hk of child.children || []) {
            if (hk.type === 'element' && hk.tagName === 'body') {
              (hk.children || []).forEach((n) => bodyChildren.push(n));
            }
          }
        } else if (child.type === 'element' && child.tagName === 'body') {
          (child.children || []).forEach((n) => bodyChildren.push(n));
        } else if (child.type === 'element' && child.tagName === 'head') {
          // ignore; metadata is injected explicitly
        } else {
          bodyChildren.push(child);
        }
      }

      const headChildren = [
        { type: 'element', tagName: 'meta', properties: { charset: 'utf-8' }, children: [] },
      ];
      if (metadata.title) {
        headChildren.push({ type: 'element', tagName: 'title', properties: {}, children: [{ type: 'text', value: metadata.title }] });
      }
      if (metadata.description) {
        headChildren.push({ type: 'element', tagName: 'meta', properties: { name: 'description', content: metadata.description }, children: [] });
      }

      tree.children = [
        { type: 'doctype', name: 'html' },
        {
          type: 'element', tagName: 'html', properties: {},
          children: [
            { type: 'element', tagName: 'head', properties: {}, children: headChildren },
            { type: 'element', tagName: 'body', properties: {}, children: bodyChildren },
          ],
        },
      ];
    };
  };
}

function decodeHtmlEntities(value) {
  if (!value || !value.includes('&')) return value || '';
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, token) => {
    if (token[0] === '#') {
      const hex = token[1].toLowerCase() === 'x';
      const num = parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : match;
    }
    switch (token.toLowerCase()) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return '\'';
      case 'nbsp': return ' ';
      default: return match;
    }
  });
}

function parseTagAttributes(tagSource) {
  const attrs = {};
  const attrPattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = attrPattern.exec(tagSource))) {
    const name = match[1].toLowerCase();
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

/**
 * Extract a title + description from raw HTML: `<title>` / `<meta name=description>`
 * / `og:description`, with fallbacks to the first `<h1>` / first `<p>`.
 *
 * @param {string} html
 * @returns {{title: string, description: string}}
 */
export function extractMetadata(html) {
  const source = html || '';
  let title = '';
  let description = '';
  let titleFound = false;
  let descriptionFound = false;

  const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) { titleFound = true; title = decodeHtmlEntities(titleMatch[1]); }

  const metaPattern = /<meta\b[^>]*>/gi;
  let metaMatch;
  while (!descriptionFound && (metaMatch = metaPattern.exec(source))) {
    const attrs = parseTagAttributes(metaMatch[0]);
    if ((attrs.name || '').toLowerCase() === 'description') {
      descriptionFound = true;
      description = decodeHtmlEntities(attrs.content || '');
    }
  }
  if (!descriptionFound) {
    metaPattern.lastIndex = 0;
    while (!descriptionFound && (metaMatch = metaPattern.exec(source))) {
      const attrs = parseTagAttributes(metaMatch[0]);
      if ((attrs.property || '').toLowerCase() === 'og:description') {
        descriptionFound = true;
        description = decodeHtmlEntities(attrs.content || '');
      }
    }
  }

  const tree = unified().use(rehypeParse, { fragment: true }).parse(source);
  const visit = (node, fn) => { fn(node); (node.children || []).forEach((c) => visit(c, fn)); };

  if (!titleFound || !descriptionFound) {
    visit(tree, (node) => {
      if (!titleFound && !title && node.type === 'element' && node.tagName === 'title') {
        title = textContent(node).trim();
      }
      if (!descriptionFound && !description && node.type === 'element' && node.tagName === 'meta') {
        const name = typeof node.properties?.name === 'string' ? node.properties.name.toLowerCase() : '';
        const property = typeof node.properties?.property === 'string' ? node.properties.property.toLowerCase() : '';
        if (name === 'description' || property === 'og:description') {
          const c = node.properties?.content;
          if (typeof c === 'string') description = c.trim();
        }
      }
    });
  }
  if (!titleFound && !title) {
    visit(tree, (node) => {
      if (!title && node.type === 'element' && node.tagName === 'h1') title = textContent(node).trim();
    });
  }
  if (!descriptionFound && !description) {
    visit(tree, (node) => {
      if (!description && node.type === 'element' && node.tagName === 'p') description = textContent(node).trim();
    });
  }
  if (!descriptionFound && description.length > 300) description = description.slice(0, 300).trim();
  return { title, description };
}

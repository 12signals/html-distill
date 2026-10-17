import { describe, it, expect } from 'vitest';
import { cleanHtml } from '../src/index.js';

describe('cleanHtml', () => {
  describe('cookie consent banner removal', () => {
    it('removes Cookiebot dialog', async () => {
      const html = `<html><body>
        <div id="CybotCookiebotDialog" role="dialog">Cookie consent text</div>
        <main><h1>Real content</h1></main>
      </body></html>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).not.toContain('Cookie consent text');
      expect(cleaned).toContain('Real content');
    });

    it('removes OneTrust banner', async () => {
      const html = `<html><body>
        <div id="onetrust-banner-sdk">We use cookies</div>
        <main><h1>Page title</h1></main>
      </body></html>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).not.toContain('We use cookies');
      expect(cleaned).toContain('Page title');
    });

    it('does NOT remove Webflow cc- component classes', async () => {
      const html = `<html><body>
        <main class="c-main">
          <section class="c-section cc-home">
            <div class="c-flow cc-home-hero">
              <h1 class="cc-new-hero">Buchhaltung für smarte Gründer</h1>
              <p class="cc-homepage">Die beste Software für Selbstständige</p>
            </div>
          </section>
        </main>
      </body></html>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('Buchhaltung für smarte Gründer');
      expect(cleaned).toContain('Die beste Software für Selbstständige');
    });

    // Regression: OpenAI career pages use Tailwind v4 utility classes containing
    // `sticky-*` (e.g. `[--sticky-top:var(--header-h)]`). A naive cookie pattern
    // matched `cky-` as a substring of `sticky-`, removing the entire <main>.
    it('does NOT remove Tailwind sticky-* utility classes (cky- substring trap)', async () => {
      const html = `<html><body>
        <div class="[--sticky-top:var(--header-h)] pt-(--page-top-space)">
          <main>
            <h1>AI Success Engineer - Tokyo</h1>
            <p>About the Team description.</p>
          </main>
        </div>
      </body></html>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('AI Success Engineer - Tokyo');
      expect(cleaned).toContain('About the Team description');
    });

    // Regression: amazon.jobs postings have a page-wide wrapper whose descendant
    // text contains "analytics"/"consent"/"preferences" many times. A text-density
    // heuristic removed any ancestor with enough such signals, wiping real content.
    // The class/id-only check must keep body content even when those words recur.
    it('keeps body content that incidentally mentions cookie/analytics/consent words', async () => {
      const html = `<html><body>
        <div class="page-wrapper">
          <nav>Analytics • Consent management • Preferences • Cookie policy • Analytics dashboard</nav>
          <main>
            <h1>Working Student - Original Productions</h1>
            <h2>Description</h2>
            <p>ABOUT THIS ROLE — we're looking for a committed working student.
               Our analytics team collaborates with editorial. You'll interact with
               user preferences, consent flows, and advertisement pipelines.</p>
            <p>Additional analytics and consent-related work is part of this role.</p>
          </main>
        </div>
      </body></html>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('Working Student - Original Productions');
      expect(cleaned).toContain('ABOUT THIS ROLE');
      expect(cleaned).toContain('Description');
    });
  });

  describe('kicker demotion (ALL-CAPS h1 before h2.hero)', () => {
    it('demotes ALL-CAPS h1 to div.kicker when followed by h2.hero', async () => {
      const html = '<main><h1><strong>RECRUITING SOFTWARE VON SOFTGARDEN</strong></h1><h2 class="wp-block-heading has-xxx-large-font-size">Schneller finden. Besser einstellen.</h2></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="kicker"');
      expect(cleaned).toContain('class="hero"');
      expect(cleaned).not.toContain('<h1>');
    });

    it('demotes when whitespace text nodes separate h1 and h2', async () => {
      const html = '<main>\n  <h1>ALL CAPS BRAND</h1>\n  <h2 class="hero">The real claim</h2>\n</main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="kicker"');
      expect(cleaned).not.toContain('<h1>');
    });

    it('keeps h1 when text is mixed case', async () => {
      const html = '<main><h1>Welcome to Softgarden</h1><h2 class="hero">Schneller finden.</h2></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('<h1>');
      expect(cleaned).not.toContain('kicker');
    });

    it('keeps h1 when no h2.hero follows', async () => {
      const html = '<main><h1>ALL CAPS TITLE</h1><h2>Some subtitle</h2></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('<h1>');
      expect(cleaned).not.toContain('kicker');
    });

    it('keeps h1 when separated by non-whitespace content', async () => {
      const html = '<main><h1>ALL CAPS TITLE</h1><p>Spacer paragraph</p><h2 class="hero">Claim</h2></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('<h1>');
      expect(cleaned).not.toContain('kicker');
    });

    it('works when h1 and h2 are in wrapper divs that get unwrapped', async () => {
      const html = '<main><div><h1><strong>RECRUITING SOFTWARE VON SOFTGARDEN</strong></h1></div><div><h2 class="wp-block-heading has-xxx-large-font-size">Schneller finden.</h2></div></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="kicker"');
      expect(cleaned).not.toContain('<h1>');
    });
  });

  describe('flatten animated lists in headings', () => {
    it('flattens ul inside h1 into slash-separated text (HubSpot pattern)', async () => {
      const html = `<h1 class="wf-page-header_heading cl-h1 -custom-font-size">Where go-to-market<span class="-break"> </span>teams go to <span class="wf-page-header_heading-animated-wrapper">
        <ul class="wf-page-header_heading-animated-list" style="transition: none; transform: translateY(0px);">
          <li class="wf-page-header_heading-animated-list-item cl-h1 -brand"> grow</li>
          <li class="wf-page-header_heading-animated-list-item cl-h1 -brand"> scale</li>
          <li class="wf-page-header_heading-animated-list-item cl-h1 -brand"> close</li>
          <li class="wf-page-header_heading-animated-list-item cl-h1 -brand"> retain</li>
          <li class="wf-page-header_heading-animated-list-item cl-h1 -brand"> grow</li>
        </ul>
      </span></h1>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('grow / scale / close / retain');
      expect(cleaned).not.toContain('<ul');
      expect(cleaned).not.toContain('<li');
    });

    it('deduplicates repeated items (animation loop)', async () => {
      const html = '<h2><ul><li>fast</li><li>smart</li><li>fast</li></ul></h2>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('fast / smart');
      const matches = cleaned.match(/fast/g);
      expect(matches).toHaveLength(1);
    });

    it('does not touch lists outside headings', async () => {
      const html = '<div><ul><li>one</li><li>two</li></ul></div>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('<li>');
    });
  });

  describe('pre-sanitize hero detection (data attributes + inline font-size)', () => {
    it('detects Framer data-framer-name="HERO TEXT" and adds class="hero"', async () => {
      const html = `<html><body>
        <div data-framer-name="HERO TEXT">
          <p style="--framer-font-size: 48px;">Understand what people want.</p>
        </div>
        <h2>Customer research,</h2>
        <h2>streamlined</h2>
      </body></html>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="hero"');
      expect(cleaned).not.toMatch(/<h2[^>]*class="hero"[^>]*>streamlined/);
    });

    it('detects inline font-size >= 36px and adds class="hero"', async () => {
      const html = '<html><body><p style="font-size: 48px;">Big headline</p><p>Small text</p></body></html>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="hero"');
      expect(cleaned).toContain('Big headline');
    });

    it('detects CSS custom property font-size (--framer-font-size: 48px)', async () => {
      const html = '<html><body><p style="--framer-font-size: 48px;">Framer headline</p></body></html>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="hero"');
    });

    it('ignores font-size below threshold', async () => {
      const html = '<html><body><p style="font-size: 14px;">Small text</p></body></html>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).not.toContain('hero');
    });

    it('does not duplicate hero class when data-attr and font-size both match', async () => {
      const html = '<html><body><div data-framer-name="Hero Section" style="font-size: 48px;"><p>Claim</p></div></body></html>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).not.toContain('hero hero');
    });

    it('data-framer-name hero detection is case-insensitive', async () => {
      const html = '<html><body><div data-framer-name="hero text"><p>Claim</p></div></body></html>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="hero"');
    });
  });

  describe('inline formatting tag stripping', () => {
    it('strips <mark> tags, keeping their text content', async () => {
      const html = '<main><h1>Wir schaffen <mark>Freiraum</mark> für die Immobilienwirtschaft.</h1></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('Freiraum');
      expect(cleaned).not.toContain('<mark>');
      expect(cleaned).not.toContain('</mark>');
    });
  });

  describe('serialized stripped-tags removal (anti-bot proxy leakage)', () => {
    it('removes a serialized Vimeo iframe and its flattened player DOM, keeping the hero', async () => {
      const html = `<main>
        <section class="header">
          <div class="header__text">
            <h1>Een breed aanbod kwalitatieve pompen</h1>
            <p>Een goed werkende pomp is van essentieel belang.</p>
            <a class="btn" href="https://www.rentalpumps.eu/contact">NEEM CONTACT OP</a>
          </div>
          <div class="header__video">
            <div class="header__video-content" src="https://player.vimeo.com/video/1117053692" data-original-tag="iframe">
              <div>waterflow2 from adv on Vimeo
                <div>Playing in picture-in-picture</div><span>Unmute</span>
                <span>Add to Watch Later</span><span>Show controls</span>
              </div>
            </div>
          </div>
        </section>
      </main>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('Een breed aanbod kwalitatieve pompen');
      expect(cleaned).toContain('NEEM CONTACT OP');
      expect(cleaned).not.toContain('Vimeo');
      expect(cleaned).not.toContain('Unmute');
      expect(cleaned).not.toContain('Add to Watch Later');
      expect(cleaned).not.toContain('Playing in picture-in-picture');
    });

    it('removes the failed-embed connection-error overlay variant', async () => {
      const html = `<main>
        <section class="header">
          <h1>Real headline</h1>
          <div class="header__video-content" src="https://player.vimeo.com/video/123" data-original-tag="iframe">
            <div>Vimeo
              <div class="error">
                <h1>We couldn't verify the security of your connection.</h1>
                <h2>Access to this content has been restricted.</h2>
              </div>
            </div>
          </div>
        </section>
      </main>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('Real headline');
      expect(cleaned).not.toContain('verify the security');
      expect(cleaned).not.toContain('Access to this content has been restricted');
    });

    it('removes a serialized <script> div (data-original-tag="script")', async () => {
      const html = `<main>
        <h1>Page content</h1>
        <div data-original-tag="script">window.__DATA__ = {"foo":"bar"};</div>
      </main>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('Page content');
      expect(cleaned).not.toContain('__DATA__');
    });

    it('keeps a normal div that merely has a data-original-tag of a non-stripped tag', async () => {
      const html = `<main>
        <div data-original-tag="section"><h1>Kept content</h1></div>
      </main>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('Kept content');
    });
  });

  describe('semantic hero hints (framework-agnostic)', () => {
    it('rewrites Tailwind text-6xl to class="hero"', async () => {
      const html = '<main><h1 class="text-6xl font-bold tracking-tight">The claim</h1></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="hero"');
      expect(cleaned).not.toContain('text-6xl');
    });

    it('rewrites Bootstrap display-1 to class="hero"', async () => {
      const html = '<main><h1 class="display-1">The claim</h1></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="hero"');
      expect(cleaned).not.toContain('display-1');
    });
  });

  describe('hidden-node removal', () => {
    it('keeps content behind an inert modal backdrop', async () => {
      // Consent/login modals mark the rest of the page `inert` for a11y. The
      // content stays visible, so treating inert as hidden wipes the whole page
      // and leaves only the dialog (candis.io, 2026-08-08).
      const html = `<html><body>
        <div class="header" inert=""><nav><a href="/pricing">Pricing</a></nav></div>
        <main inert=""><h1>Volle Kontrolle über dein Rechnungsmanagement</h1></main>
        <div role="dialog"><h3>Privacy settings</h3></div>
      </body></html>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('Volle Kontrolle über dein Rechnungsmanagement');
      expect(cleaned).toContain('Pricing');
    });

    it('still removes the hidden attribute', async () => {
      const html = '<html><body><main><p hidden>Gone</p><p>Kept</p></main></body></html>';
      const cleaned = await cleanHtml(html);
      const body = cleaned.slice(cleaned.indexOf('<body'));
      expect(body).not.toContain('Gone');
      expect(body).toContain('Kept');
    });

    it('keeps an app root whose ::before scrim is opacity-0', async () => {
      // `before:opacity-0` styles the overlay pseudo-element, not the element
      // itself. Substring-matching it deleted the whole app root (staffbase.com,
      // 2026-08-08).
      const html = `<html><body>
        <div class="app flex flex-col min-h-screen relative before:absolute before:inset-0 before:opacity-0">
          <main><h1>Finally, one platform to reach every employee.</h1></main>
        </div>
      </body></html>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('Finally, one platform to reach every employee.');
    });

    it('keeps an element that only turns transparent on hover', async () => {
      const html = '<html><body><main class="hover:opacity-0"><p>Kept</p></main></body></html>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('Kept');
    });

    it('still removes a bare opacity-0 element', async () => {
      const html = '<html><body><main><div class="opacity-0">Gone</div><p>Kept</p></main></body></html>';
      const cleaned = await cleanHtml(html);
      const body = cleaned.slice(cleaned.indexOf('<body'));
      expect(body).not.toContain('Gone');
      expect(body).toContain('Kept');
    });

    it('still removes a breakpoint-scoped opacity-0 element', async () => {
      const html = '<html><body><main><div class="lg:opacity-0">Gone</div><p>Kept</p></main></body></html>';
      const cleaned = await cleanHtml(html);
      const body = cleaned.slice(cleaned.indexOf('<body'));
      expect(body).not.toContain('Gone');
      expect(body).toContain('Kept');
    });

    it('still removes hidden utility classes', async () => {
      const html = '<html><body><main><p class="d-none">Gone</p><p>Kept</p></main></body></html>';
      const cleaned = await cleanHtml(html);
      const body = cleaned.slice(cleaned.indexOf('<body'));
      expect(body).not.toContain('Gone');
      expect(body).toContain('Kept');
    });
  });

  describe('document assembly + metadata', () => {
    it('extracts <title> and meta description into a clean head', async () => {
      const html = `<html><head>
        <title>Acme — Pumps</title>
        <meta name="description" content="Rental pumps for every site.">
      </head><body><main><h1>Hello</h1></main></body></html>`;
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('<title>Acme');
      expect(cleaned).toContain('Rental pumps for every site.');
    });

    it('does not leak the document title as body text (fragment-parse artifact)', async () => {
      const html = `<html><head><title>Acme Pumps</title></head><body><main><h1>Water, moved.</h1></main></body></html>`;
      const cleaned = await cleanHtml(html);
      const body = cleaned.slice(cleaned.indexOf('<body'));
      expect(body).not.toContain('Acme Pumps');
      expect(cleaned).toContain('Water, moved.');
    });

    it('keeps the leaked title in the body when removeHeadArtifacts is false', async () => {
      const html = `<html><head><title>Acme Pumps</title></head><body><main><h1>Water, moved.</h1></main></body></html>`;
      const cleaned = await cleanHtml(html, { removeHeadArtifacts: false });
      const body = cleaned.slice(cleaned.indexOf('<body'));
      expect(body).toContain('Acme Pumps');
    });
  });

  describe('link tracking-param stripping', () => {
    it('drops utm_* but keeps allowlisted params', async () => {
      const html = '<main><a href="https://acme.com/pricing?utm_source=news&page=2">Pricing</a></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).not.toContain('utm_source');
      expect(cleaned).toContain('page=2');
    });
  });

  describe('eyebrow/kicker class demotion (Autodesk, MUI)', () => {
    it('demotes MUI eyebrow h1 to div.kicker and marks the real h2 as hero (2026-10-13 snapshot)', async () => {
      const html = [
        '<main><div>',
        '<h1 class="MuiTypography-root MuiTypography-eyebrow-large css-1xy2z3">Autodesk Fusion</h1>',
        '<h2 data-testid="hero-banner" class="MuiTypography-root MuiTypography-h2Large">What are Design and Make leaders doing differently?</h2>',
        '</div></main>',
      ].join('');
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="kicker"');
      expect(cleaned).not.toContain('<h1');
      expect(cleaned).toContain('<h2 class="hero"');
      expect(cleaned).toContain('What are Design and Make leaders doing differently?');
    });

    it('demotes the report eyebrow h1 via ALL-CAPS fallback even without hero markers (2026-10-09 snapshot)', async () => {
      const html = '<main><h1>AUTODESK 2027 STATE OF DESIGN &amp; MAKE REPORT</h1><h2>What are Design and Make leaders doing differently?</h2></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="kicker"');
      expect(cleaned).not.toContain('<h1');
      expect(cleaned).toContain('<h2');
    });

    it('demotes any heading with a kicker class, regardless of case', async () => {
      const html = '<main><h3 class="kicker-label">Up next</h3><h2 class="hero">The real claim</h2></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="kicker"');
      expect(cleaned).not.toContain('<h3');
    });

    it('recognizes hero via wildcard data-* attributes', async () => {
      const html = '<main><h2 data-component="hero-headline">Design it once</h2></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('class="hero"');
    });

    it('fallback does not demote an ALL-CAPS h1 when the next heading is not longer', async () => {
      const html = '<main><h1>ALL CAPS TITLE</h1><h2>Some subtitle</h2></main>';
      const cleaned = await cleanHtml(html);
      expect(cleaned).toContain('<h1>');
      expect(cleaned).not.toContain('kicker');
    });
  });

  describe('options', () => {
    it('honors a custom linkParams allowlist', async () => {
      const html = '<main><a href="https://acme.com/x?ref=abc&page=2">Link</a></main>';
      const cleaned = await cleanHtml(html, { linkParams: ['ref'] });
      expect(cleaned).toContain('ref=abc');
      expect(cleaned).not.toContain('page=2');
    });
  });
});

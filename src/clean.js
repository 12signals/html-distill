import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import rehypeFormat from 'rehype-format';

import { defaultPolicy, defaultLinkParams, buildSanitizeSchema } from './policy.js';
import {
  removeDocumentHeadArtifacts,
  removeHiddenNodes,
  removeCookieConsentBanners,
  removeSerializedStrippedTags,
  removeJsonCodeBlocks,
  detectHeroFromAttributesAndStyles,
  normalizeHeadingBreaks,
  flattenHeadingLists,
  demoteOverlongHeadings,
  filterClassNames,
  stripLinkTrackingParams,
  unwrapRedundantDivs,
  demoteKickerHeadings,
  wrapDocument,
  extractMetadata,
} from './transforms.js';

/**
 * @typedef {Object} CleanOptions
 * @property {import('./policy.js').DistillPolicy} [policy] - Class-filtering + hero-detection policy. Defaults to `defaultPolicy`.
 * @property {string[]} [linkParams] - Query params kept on `<a href>`. Defaults to `defaultLinkParams`.
 * @property {Object} [schema] - rehype-sanitize schema. Defaults to the built-in content schema.
 * @property {boolean} [removeHeadArtifacts=true] - Drop document-head elements (title/meta/link) that fragment-parsing leaves floating in the body, so a leaked `<title>` never surfaces as body text. Set `false` to keep them.
 */

/**
 * Turn raw, real-world HTML (marketing pages, landing pages, SPA output) into
 * stable, semantically-hinted HTML that an LLM can reason about. Unlike an
 * article extractor, the full page structure is preserved; the noise is
 * normalized away and visual-hierarchy hints (`hero`, `kicker`) are injected.
 *
 * Pipeline order (the pre/post-sanitize split matters):
 *   pre-sanitize:  removeHiddenNodes → removeCookieConsentBanners →
 *                  removeSerializedStrippedTags → removeJsonCodeBlocks →
 *                  detectHeroFromAttributesAndStyles
 *   sanitize:      rehype-sanitize
 *   post-sanitize: normalizeHeadingBreaks → flattenHeadingLists →
 *                  demoteOverlongHeadings → filterClassNames →
 *                  stripLinkTrackingParams → wrapDocument →
 *                  unwrapRedundantDivs → demoteKickerHeadings → format
 *
 * @param {string} inputHtml - Raw HTML.
 * @param {CleanOptions} [options]
 * @returns {Promise<string>} Cleaned, formatted HTML document.
 */
export async function cleanHtml(inputHtml, options = {}) {
  const policy = options.policy || defaultPolicy;
  const linkParams = options.linkParams || defaultLinkParams;
  const schema = options.schema || buildSanitizeSchema();
  const removeHeadArtifacts = options.removeHeadArtifacts !== false; // default on

  const meta = extractMetadata(inputHtml || '');

  const processor = unified().use(rehypeParse, { fragment: true });
  if (removeHeadArtifacts) processor.use(removeDocumentHeadArtifacts());
  processor
    .use(removeHiddenNodes())
    .use(removeCookieConsentBanners())
    .use(removeSerializedStrippedTags(schema.strip))
    .use(removeJsonCodeBlocks())
    .use(detectHeroFromAttributesAndStyles(policy))
    .use(rehypeSanitize, schema)
    .use(normalizeHeadingBreaks())
    .use(flattenHeadingLists())
    .use(demoteOverlongHeadings(policy.headingMaxLength))
    .use(filterClassNames(policy))
    .use(stripLinkTrackingParams(linkParams))
    .use(wrapDocument(meta))
    .use(unwrapRedundantDivs())
    .use(demoteKickerHeadings())
    .use(rehypeFormat)
    .use(rehypeStringify, { allowParseErrors: true, closeSelfClosing: true });

  const file = await processor.process(inputHtml ?? '');

  // Collapse excessive blank lines (3+ -> single blank line)
  return String(file).replace(/\n{3,}/g, '\n\n').trim();
}

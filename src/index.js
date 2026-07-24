// @12signals/html-distill
// Structure-preserving HTML normalizer for LLM input.

export { cleanHtml } from './clean.js';

export {
  defaultPolicy,
  defaultLinkParams,
  defaultStrippedTags,
  buildSanitizeSchema,
  sanitizeSchema,
} from './policy.js';

export {
  // pre-sanitize
  removeDocumentHeadArtifacts,
  removeHiddenNodes,
  removeCookieConsentBanners,
  removeSerializedStrippedTags,
  removeJsonCodeBlocks,
  detectHeroFromAttributesAndStyles,
  // post-sanitize
  normalizeHeadingBreaks,
  flattenHeadingLists,
  demoteOverlongHeadings,
  filterClassNames,
  stripLinkTrackingParams,
  unwrapRedundantDivs,
  demoteKickerHeadings,
  // document assembly + helpers
  wrapDocument,
  extractMetadata,
  textContent,
} from './transforms.js';

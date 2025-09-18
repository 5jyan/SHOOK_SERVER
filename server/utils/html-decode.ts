/**
 * Universal HTML entity decoder utility
 * Handles common HTML entities that appear in YouTube titles and descriptions
 */

import { logWithTimestamp } from "./timestamp.js";

// Common HTML entity mappings
const HTML_ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&#39;': "'",
  '&#x27;': "'",
  '&#x2F;': '/',
  '&#47;': '/',
  '&#x3A;': ':',
  '&#58;': ':',
  '&#x60;': '`',
  '&#96;': '`',
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201c',
  '&rdquo;': '\u201d',
  '&bull;': '•',
  '&middot;': '·',
  '&deg;': '°',
  '&plusmn;': '±',
  '&times;': '×',
  '&divide;': '÷',
  '&frac12;': '½',
  '&frac14;': '¼',
  '&frac34;': '¾',
  '&alpha;': 'α',
  '&beta;': 'β',
  '&gamma;': 'γ',
  '&delta;': 'δ',
  '&epsilon;': 'ε',
  '&pi;': 'π',
  '&sigma;': 'σ',
  '&phi;': 'φ',
  '&chi;': 'χ',
  '&psi;': 'ψ',
  '&omega;': 'ω',
};

/**
 * Decode HTML entities in a string
 * Handles both named entities (&quot;) and numeric entities (&#34; &#x22;)
 */
export function decodeHtmlEntities(str: string): string {
  if (!str || typeof str !== 'string') {
    return str;
  }

  let decoded = str;

  // First, replace named entities
  for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), replacement);
  }

  // Then handle numeric entities (decimal)
  decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
    try {
      const codePoint = parseInt(dec, 10);
      return String.fromCharCode(codePoint);
    } catch {
      return match; // Return original if conversion fails
    }
  });

  // Handle hexadecimal numeric entities
  decoded = decoded.replace(/&#[xX]([0-9a-fA-F]+);/g, (match, hex) => {
    try {
      const codePoint = parseInt(hex, 16);
      return String.fromCharCode(codePoint);
    } catch {
      return match; // Return original if conversion fails
    }
  });

  return decoded;
}

/**
 * Decode HTML entities for YouTube video titles
 * Specifically optimized for common YouTube title patterns
 */
export function decodeYouTubeTitle(title: string): string {
  if (!title) return title;

  //logWithTimestamp(`[html-decode] Original title: "${title}"`);
  const decoded = decodeHtmlEntities(title);
  logWithTimestamp(`[html-decode] Decoded title: "${decoded}"`);
  
  return decoded;
}

/**
 * Decode HTML entities for YouTube video summaries
 * Handles multi-line content and preserves formatting
 */
export function decodeYouTubeSummary(summary: string): string {
  if (!summary) return summary;

  // Decode entities but preserve line breaks and formatting
  const decoded = decodeHtmlEntities(summary);
  
  // Log only first 100 chars to avoid spam
  logWithTimestamp(`[html-decode] Summary decoded: "${decoded.substring(0, 100)}${decoded.length > 100 ? '...' : ''}"`);
  
  return decoded;
}

/**
 * Bulk decode HTML entities for an array of video objects
 * Modifies title and summary fields in place
 */
export function decodeVideoHtmlEntities<T extends { title: string; summary?: string | null }>(videos: T[]): T[] {
  return videos.map(video => ({
    ...video,
    title: decodeYouTubeTitle(video.title),
    summary: video.summary ? decodeYouTubeSummary(video.summary) : video.summary,
  }));
}
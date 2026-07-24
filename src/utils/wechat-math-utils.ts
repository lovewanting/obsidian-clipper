/**
 * Preprocess WeChat (微信公众号) math formulas before Defuddle extraction.
 *
 * WeChat has used two rendering schemes:
 *
 * **Legacy** (server-side MathJax SVGs):
 *   - `<span data-math-raw="LATEX" data-math-display="true|false">`
 *   - LaTeX may include `$` / `$$` delimiters (stripped during preprocessing).
 *
 * **Current** (native MathML `<math>` elements):
 *   - `<math data-latex="LATEX" display="block">` for block formulas
 *   - `<math data-latex="LATEX">` for inline formulas
 *   - LaTeX stored WITH `$...$` or `$$...$$` delimiters.
 *
 * Defuddle's content scoring removes low-word-count containers, stripping
 * formula-only sections and `<math>` elements.  Strategy: replace each
 * formula with a `<code>` placeholder that survives Defuddle, then restore
 * after markdown conversion.
 */

import { debugLog } from './debug';

// Unique prefix/suffix for placeholders — chosen to be extremely unlikely
// in real article text and to survive both defuddle and turndown.
const PLACEHOLDER_PREFIX = '\u27E6WCMATH';
const PLACEHOLDER_SUFFIX = '\u27E7';

/** Serializable formula entry (plain object for chrome messaging). */
export interface WechatMathFormula {
	latex: string;
	isBlock: boolean;
}

/** Formula map keyed by placeholder string. Serializable via chrome messaging. */
export type WechatMathFormulaMap = Record<string, WechatMathFormula>;

// Module-level cache to survive repeated getPageContent calls.
// preprocessWechatMath irreversibly replaces formula elements with
// <code> placeholders, so subsequent calls find no containers and return an
// empty map.  The cache ensures the formula map is still available for
// Phase 2 restoration.
const formulaMapCache = new Map<string, WechatMathFormulaMap>();

/**
 * Strip `$...$` or `$$...$$` delimiters from a LaTeX string.
 * Returns the inner LaTeX and whether it was block-level.
 */
function stripLatexDelimiters(raw: string): { latex: string; isBlock: boolean } {
	const trimmed = raw.trim();
	if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
		return { latex: trimmed.slice(2, -2).trim(), isBlock: true };
	}
	if (trimmed.startsWith('$') && trimmed.endsWith('$')) {
		return { latex: trimmed.slice(1, -1).trim(), isBlock: false };
	}
	if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) {
		return { latex: trimmed.slice(2, -2).trim(), isBlock: true };
	}
	if (trimmed.startsWith('\\(') && trimmed.endsWith('\\)')) {
		return { latex: trimmed.slice(2, -2).trim(), isBlock: false };
	}
	return { latex: trimmed, isBlock: false };
}

/**
 * Phase 1: Replace WeChat math containers with <code> placeholders.
 * Returns a serializable map of placeholder → { latex, isBlock } for Phase 2 restoration.
 *
 * Supports both legacy (`data-math-raw`) and current (`data-latex`) formats.
 * The result is cached per document URL so that repeated calls on an
 * already-preprocessed DOM still return the formula map.
 */
export function preprocessWechatMath(
	doc: Document
): WechatMathFormulaMap {
	const startTime = Date.now();
	const cacheKey = doc.URL || '';

	// Collect formula containers from both legacy and current formats.
	const legacyContainers = Array.from(doc.querySelectorAll('[data-math-raw]'));
	const modernContainers = Array.from(doc.querySelectorAll('math[data-latex]'));

	if (legacyContainers.length === 0 && modernContainers.length === 0) {
		// DOM already preprocessed — return cached map if available.
		const cached = formulaMapCache.get(cacheKey);
		if (cached && Object.keys(cached).length > 0) {
			debugLog('WechatMath', `DOM already preprocessed, returning cached map (${Object.keys(cached).length} formulas)`);
			return cached;
		}
		return {};
	}

	const formulaMap: WechatMathFormulaMap = {};
	let convertedCount = 0;

	// --- Legacy format: <span/section data-math-raw="$$LATEX$$" data-math-display="true"> ---
	for (const container of legacyContainers) {
		const rawLatex = container.getAttribute('data-math-raw')?.trim();
		if (!rawLatex) continue;

		// The data-math-raw value may or may not include $...$ / $$...$$
		// delimiters depending on the WeChat rendering version.
		const { latex, isBlock: delimBlock } = stripLatexDelimiters(rawLatex);
		// Prefer the explicit display attribute; fall back to delimiter detection.
		const isBlock = container.getAttribute('data-math-display') === 'true' || delimBlock;
		const placeholder = `${PLACEHOLDER_PREFIX}${convertedCount}${PLACEHOLDER_SUFFIX}`;

		const codeEl = doc.createElement('code');
		codeEl.setAttribute('data-wechat-math', 'placeholder');
		codeEl.textContent = placeholder;

		container.parentNode?.replaceChild(codeEl, container);
		formulaMap[placeholder] = { latex, isBlock };
		convertedCount++;
	}

	// --- Current format: <math data-latex="$$LATEX$$" display="block"> ---
	for (const container of modernContainers) {
		const rawLatex = container.getAttribute('data-latex')?.trim();
		if (!rawLatex) continue;

		// Strip $...$ or $$...$$ delimiters; the restore step adds them back.
		const { latex, isBlock: delimBlock } = stripLatexDelimiters(rawLatex);
		// Prefer the display attribute; fall back to delimiter-based detection.
		const isBlock = container.getAttribute('display') === 'block' || delimBlock;

		const placeholder = `${PLACEHOLDER_PREFIX}${convertedCount}${PLACEHOLDER_SUFFIX}`;

		const codeEl = doc.createElement('code');
		codeEl.setAttribute('data-wechat-math', 'placeholder');
		codeEl.textContent = placeholder;

		container.parentNode?.replaceChild(codeEl, container);
		formulaMap[placeholder] = { latex, isBlock };
		convertedCount++;
	}

	if (convertedCount > 0) {
		console.log(`[Obsidian Clipper] WechatMath: Stored ${convertedCount} formulas as placeholders in ${Date.now() - startTime}ms`);
		debugLog('WechatMath', `Stored ${convertedCount} formulas as placeholders in ${Date.now() - startTime}ms`);
	}

	// Cache the result for subsequent calls on the same document.
	if (Object.keys(formulaMap).length > 0) {
		formulaMapCache.set(cacheKey, formulaMap);
	}

	return formulaMap;
}

/**
 * Phase 2: After defuddle + createMarkdownContent, restore the placeholders
 * in the final markdown with proper LaTeX delimiters.
 *
 * - Inline formulas → `$LaTeX$`
 * - Block formulas → `\n$$\nLaTeX\n$$\n`
 *
 * The turndown output wraps `<code>` content in backticks like `` `⟦WCMATH0⟧` ``.
 * We strip those backticks when replacing.
 */
export function restoreWechatMathInMarkdown(
	markdown: string,
	formulaMap: WechatMathFormulaMap
): string {
	const keys = Object.keys(formulaMap);
	if (keys.length === 0) return markdown;

	let result = markdown;
	let restoredCount = 0;

	for (const placeholder of keys) {
		const { latex, isBlock } = formulaMap[placeholder];

		// The placeholder may appear:
		//   as-is:  ⟦WCMATH0⟧
		//   in backticks (turndown code): `⟦WCMATH0⟧`
		// Strip surrounding backticks if present.
		const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const backtickPattern = new RegExp(
			'`?' + escaped + '`?',
			'g'
		);

		let replacement: string;
		if (isBlock) {
			replacement = `\n$$\n${latex}\n$$\n`;
		} else {
			replacement = `$${latex}$`;
		}

		const before = result;
		// Use a callback to avoid String.replace() interpreting `$$` as a
		// literal `$` in the replacement string (block formulas use `$$`).
		result = result.replace(backtickPattern, () => replacement);
		if (result !== before) restoredCount++;
	}

	console.log(`[Obsidian Clipper] WechatMath: Restored ${restoredCount}/${keys.length} formulas in markdown`);
	return result;
}

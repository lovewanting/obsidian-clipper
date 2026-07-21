/**
 * Preprocess carousel/slider elements before Defuddle extraction.
 *
 * Many web articles use image carousels (Swiper, Slick, Owl Carousel, etc.)
 * where only the active slide is visible and the rest are hidden via
 * display:none / visibility:hidden / opacity:0. Defuddle's hidden-element
 * removal strips these slides, losing all images except the first one.
 *
 * Strategy:
 * 1. Detect carousel root containers by class/id patterns and structure
 * 2. Collect ALL images from within each carousel (regardless of visibility)
 * 3. Replace the hidden carousel with a simple visible <div> containing
 *    all extracted images — this bypasses Defuddle's hidden-element removal
 * 4. De-duplicate when multiple carousel elements share the same images
 */

import { debugLog } from './debug';

// Class/id patterns that indicate a carousel/slider container
const CAROUSEL_PATTERNS = [
	'swiper', 'carousel', 'slider', 'slick', 'owl-', 'splide',
	'glide', 'flickity', 'keen-slider', 'embla', 'tns-',
	'slideshow', 'slide-show', 'image-gallery', 'photo-gallery',
	'photo-swipe', 'lightgallery', 'blueimp-gallery',
	'flexslider', 'revslider', 'layerslider',
];

// Combined regex for carousel detection (case-insensitive)
const CAROUSEL_REGEX = new RegExp(
	CAROUSEL_PATTERNS.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
	'i'
);

// Selectors for elements to skip when looking for carousel roots
// (navigation controls, dots, arrows, etc.)
const SKIP_CHILD_SELECTORS = [
	'nav', 'pagination', 'bullet', 'button', 'arrow', 'control',
	'indicator', 'dot', 'switch', 'tips', 'counter',
	'thumbnail', 'thumb',
];

/**
 * Check if a class/id string matches carousel patterns.
 */
function matchesCarouselPattern(classOrId: string): boolean {
	return CAROUSEL_REGEX.test(classOrId);
}

/**
 * Check if an element or its class/id indicates a carousel container.
 */
function isCarouselRoot(el: Element): boolean {
	const cls = (el.getAttribute('class') || '');
	const id = (el.id || '');
	return matchesCarouselPattern(cls) || matchesCarouselPattern(id);
}

/**
 * Check if a class name indicates a navigation/control element.
 */
function isNavigationElement(cls: string): boolean {
	const lower = cls.toLowerCase();
	return SKIP_CHILD_SELECTORS.some(s => lower.includes(s));
}

// Common selectors for article body containers (ordered by priority)
const ARTICLE_BODY_SELECTORS = [
	'#js_content',                    // WeChat articles
	'#js_image_content',              // WeChat image articles
	'.rich_media_content',            // WeChat rich media
	'.article-content',               // Generic
	'#article-content',               // Generic
	'.js-article-content',            // Generic
	'.post-content',                  // WordPress etc
	'.post-body',                     // Blogger etc
	'.entry-content',                 // WordPress
	'.article_post',                  // Generic
	'.markdown-body',                 // GitHub
	'[role="article"]',               // ARIA
	'article',                        // HTML5 semantic
];

/**
 * Find the most likely article body container.
 * Uses a combination of known selectors and text-density heuristics.
 */
function findArticleBody(doc: Document, carouselRoot: Element): Element | null {
	// First try known selectors
	for (const selector of ARTICLE_BODY_SELECTORS) {
		const candidate = doc.querySelector(selector);
		if (candidate && candidate !== carouselRoot && !carouselRoot.contains(candidate)) {
			const textLen = (candidate.textContent || '').trim().length;
			if (textLen > 100) {
				debugLog('Carousel', `Found article body via selector: ${selector}`);
				return candidate;
			}
		}
	}

	// Fallback: find the deepest element with high text density that is NOT
	// inside the carousel itself
	const candidates = doc.querySelectorAll('div, article, main, section');
	let best: Element | null = null;
	let bestScore = 0;

	for (const el of Array.from(candidates)) {
		if (el === carouselRoot || carouselRoot.contains(el)) continue;
		const text = (el.textContent || '').trim();
		const textLen = text.length;
		if (textLen < 200) continue;

		// Count paragraphs and headings as content signals
		const paragraphs = el.querySelectorAll('p').length;
		const headings = el.querySelectorAll('h1,h2,h3,h4,h5,h6').length;
		const images = el.querySelectorAll('img').length;

		// Score: text length + structural signals, penalize very large containers
		const score = textLen + paragraphs * 50 + headings * 100 + images * 20;

		// Prefer deeper (more specific) elements over shallow ones
		let depth = 0;
		let parent = el.parentElement;
		while (parent && parent.tagName !== 'BODY') {
			depth++;
			parent = parent.parentElement;
		}
		const depthBonus = depth * 30;

		const totalScore = score + depthBonus;
		if (totalScore > bestScore) {
			bestScore = totalScore;
			best = el;
		}
	}

	if (best) {
		debugLog('Carousel', `Found article body via heuristic (score: ${bestScore})`);
	}
	return best;
}

/**
 * Collect all unique image URLs from within a container.
 * Traverses deeply to find <img> elements regardless of visibility.
 * Also handles background-image on elements and data-src on non-img elements.
 *
 * Priority: data-src (original quality) > img src (thumbnail).
 * When a non-<img> element (e.g. WeChat .swiper_item) carries a data-src
 * pointing to the original image, child <img> thumbnails are skipped to
 * avoid collecting both the watermark-free original and the compressed
 * thumbnail for the same visual image.
 */
function collectImageUrls(container: Element): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();

	function addUrl(url: string): boolean {
		if (!url || url.length < 10) return false;
		if (url.startsWith('data:image/svg') || url.startsWith('data:image/gif')) return false;
		const normalized = url.split('?')[0].split('#')[0];
		if (seen.has(normalized)) return false;
		seen.add(normalized);
		urls.push(url);
		return true;
	}

	// --- Pass 1: Collect data-src from non-<img> elements first ---
	// Many carousels (WeChat swiper_item, Slick slides, etc.) store the
	// original/full-quality image URL on a wrapper div via data-src.
	const dataSrcElements = container.querySelectorAll('[data-src]');
	for (const el of Array.from(dataSrcElements)) {
		if (el.tagName === 'IMG') continue; // handle <img data-src> in pass 2
		addUrl(el.getAttribute('data-src') || '');
	}

	/**
	 * Check if an element is inside a navigation/thumbnail container
	 * (dots, arrows, indicator strips, thumbnail lists, etc.).
	 */
	function isInsideNavigationElement(el: Element): boolean {
		let current: Element | null = el;
		while (current && current !== container) {
			const cls = (current.getAttribute('class') || '') + ' ' + (current.id || '');
			if (isNavigationElement(cls)) return true;
			current = current.parentElement;
		}
		return false;
	}

	// --- Pass 2: Collect from <img> elements ---
	const imgs = container.querySelectorAll('img');
	for (const img of Array.from(imgs)) {
		// Skip images inside navigation/thumbnail containers
		if (isInsideNavigationElement(img)) continue;

		// If an ancestor has a data-src already collected, skip the <img src>
		// thumbnail — the ancestor's data-src is the higher-quality original.
		let ancestorHasDataSrc = false;
		let ancestor: Element | null = img.parentElement;
		while (ancestor && ancestor !== container) {
			if (ancestor.tagName !== 'IMG' && ancestor.hasAttribute('data-src')) {
				const normalized = (ancestor.getAttribute('data-src') || '').split('?')[0].split('#')[0];
				if (seen.has(normalized)) {
					ancestorHasDataSrc = true;
					break;
				}
			}
			ancestor = ancestor.parentElement;
		}

		if (!ancestorHasDataSrc) {
			// Prefer data-src over src on the <img> itself
			const dataSrc = img.getAttribute('data-src') || '';
			const src = img.getAttribute('src') || '';
			const dataSrcset = img.getAttribute('data-srcset') || '';
			const srcset = img.getAttribute('srcset') || '';

			// Add data-src first (higher quality); fall back to src
			if (dataSrc) {
				addUrl(dataSrc);
			} else if (src) {
				addUrl(src);
			}

			// Also collect srcset / data-srcset variants
			if (dataSrcset) addUrl(dataSrcset);
			else if (srcset) addUrl(srcset);
		}
	}

	// --- Pass 3: background-image on elements ---
	const bgElements = container.querySelectorAll('[style*="background"]');
	for (const el of Array.from(bgElements)) {
		// Skip thumbnail indicators and navigation elements
		if (isInsideNavigationElement(el)) continue;
		const style = el.getAttribute('style') || '';
		const match = style.match(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/i);
		if (match && match[1]) {
			addUrl(match[1]);
		}
	}

	// --- Pass 4: data-bg / data-background attributes ---
	const dataBgElements = container.querySelectorAll('[data-bg], [data-background]');
	for (const el of Array.from(dataBgElements)) {
		const url = el.getAttribute('data-bg') || el.getAttribute('data-background') || '';
		addUrl(url);
	}

	return urls;
}

/**
 * Find the outermost carousel root for a given element.
 * Walks up the DOM tree to find the highest carousel-related container.
 */
function findOutermostCarousel(el: Element): Element {
	let outermost = el;
	let current: Element | null = el;

	while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
		if (isCarouselRoot(current)) {
			outermost = current;
		}
		// Also check parent for hidden wrapper patterns
		const parent = current.parentElement;
		if (parent) {
			const parentCls = (parent.getAttribute('class') || '').toLowerCase();
			const parentId = (parent.id || '').toLowerCase();
			if (matchesCarouselPattern(parentCls) || matchesCarouselPattern(parentId)) {
				outermost = parent;
			}
		}
		current = current.parentElement;
	}

	return outermost;
}

/**
 * Find all carousel root containers in the document.
 * Returns the outermost containers to avoid double-processing nested ones.
 */
function findCarouselRoots(doc: Document): Element[] {
	const roots = new Set<Element>();

	// Find elements matching carousel patterns
	const allElements = doc.querySelectorAll('*');
	for (const el of Array.from(allElements)) {
		if (isCarouselRoot(el)) {
			const outermost = findOutermostCarousel(el);
			roots.add(outermost);
		}
	}

	// Structural heuristic: find containers with multiple children
	// where some children have images and are hidden
	const slideSelectors = [
		'[class*="slide" i]', '[class*="swiper_item" i]',
		'[class*="carousel-item" i]', '[class*="slick-slide" i]',
	];
	for (const selector of slideSelectors) {
		const slides = doc.querySelectorAll(selector);
		const parentMap = new Map<Element, { total: number; withImages: number }>();

		for (const slide of Array.from(slides)) {
			const parent = slide.parentElement;
			if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') continue;

			if (!parentMap.has(parent)) {
				parentMap.set(parent, { total: 0, withImages: 0 });
			}
			const info = parentMap.get(parent)!;
			info.total++;
			if (slide.querySelectorAll('img').length > 0) {
				info.withImages++;
			}
		}

		for (const [parent, info] of parentMap) {
			if (info.total >= 2 && info.withImages >= 2) {
				const outermost = findOutermostCarousel(parent);
				roots.add(outermost);
			}
		}
	}

	return Array.from(roots);
}

/**
 * Replace a carousel container with a simple visible div containing all its images.
 * This ensures Defuddle can see and extract all carousel images.
 */
function replaceCarouselWithImages(
	carousel: Element,
	imageUrls: string[],
	doc: Document
): Element | null {
	if (imageUrls.length === 0) return null;

	// Create a simple visible container
	const wrapper = doc.createElement('div');
	wrapper.setAttribute('data-defuddle-carousel', 'true');
	wrapper.setAttribute('class', 'defuddle-carousel-images');
	wrapper.setAttribute('style', 'display: block;');

	for (const url of imageUrls) {
		const img = doc.createElement('img');
		img.setAttribute('src', url);
		img.setAttribute('style', 'display: block; width: 100%;');
		wrapper.appendChild(img);
	}

	// Replace the carousel with our simple wrapper
	if (carousel.parentNode) {
		carousel.parentNode.insertBefore(wrapper, carousel);
		carousel.remove();
		return wrapper;
	}

	return null;
}

/**
 * Main entry point: preprocess all carousel elements in the document
 * before passing it to Defuddle for content extraction.
 */
export function preprocessCarousels(doc: Document): void {
	const startTime = Date.now();
	const roots = findCarouselRoots(doc);

	if (roots.length === 0) {
		return;
	}

	let totalImages = 0;
	const processedUrls = new Set<string>(); // Track across all carousels to deduplicate

	// Process from innermost to outermost to avoid stale references.
	// Sort roots so that descendants are processed before ancestors.
	const sortedRoots = roots.sort((a, b) => {
		if (a.contains(b)) return 1;  // a is ancestor, process b first
		if (b.contains(a)) return -1; // b is ancestor, process a first
		return 0;
	});

	// Collect all replacement wrappers and their source carousel roots
	const replacements: Array<{ wrapper: Element; sourceRoot: Element }> = [];

	for (const root of sortedRoots) {
		// Skip if already removed by a previous iteration
		if (!root.parentNode) continue;

		const imageUrls = collectImageUrls(root);

		// Filter out images already processed by another carousel
		const newUrls = imageUrls.filter(url => {
			const normalized = url.split('?')[0].split('#')[0];
			return !processedUrls.has(normalized);
		});

		if (newUrls.length === 0) continue;

		// Mark these URLs as processed
		for (const url of newUrls) {
			processedUrls.add(url.split('?')[0].split('#')[0]);
		}

		const replaced = replaceCarouselWithImages(root, newUrls, doc);
		if (replaced) {
			totalImages += newUrls.length;
			replacements.push({ wrapper: replaced, sourceRoot: root });
		}
	}

	// Post-process: if any replacement wrapper ended up outside the article body,
	// relocate it into the article body so Defuddle can extract it.
	// This handles cases like WeChat articles where the carousel is in a
	// "page header" section (#js_share_content_page_hd) that is a sibling
	// of the article body (#js_content).
	for (const { wrapper, sourceRoot } of replacements) {
		const articleBody = findArticleBody(doc, sourceRoot);
		if (articleBody && !articleBody.contains(wrapper)) {
			debugLog('Carousel', 'Relocating carousel images into article body');
			articleBody.insertBefore(wrapper, articleBody.firstChild);
		}
	}

	const elapsed = Date.now() - startTime;
	debugLog('Carousel', `Preprocessed ${roots.length} carousel(s), extracted ${totalImages} unique image(s) in ${elapsed}ms`);
}

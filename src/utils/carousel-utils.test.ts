// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import { preprocessCarousels } from './carousel-utils';

/**
 * Helper: build a minimal WeChat-style carousel DOM.
 *
 * Structure:
 *   div.img_swiper_area
 *     div.share_media_swiper_wrp  (visible)
 *       div.share_media_swiper
 *         div.share_media_swiper_content
 *           div.share_media
 *             div.swiper_item[data-src=original1] > div.swiper_item_img > img[src=thumb1]
 *             div.swiper_item[data-src=original2] > div.swiper_item_img > img[src=thumb2]
 *             ...
 *       ol.swiper_indicator_list_pc
 *         li.swiper_indicator_item_pc[style="background-image:url(thumb1)"]
 *         li.swiper_indicator_item_pc[style="background-image:url(thumb2)"]
 */
function buildWeChatCarousel(imageCount: number = 4) {
	const originals: string[] = [];
	const thumbnails: string[] = [];

	for (let i = 1; i <= imageCount; i++) {
		originals.push(`https://mmbiz.qpic.cn/sz_mmbiz_png/image${i}/0?wx_fmt=png`);
		thumbnails.push(`https://mmbiz.qpic.cn/mmbiz_png/image${i}/0?wxfrom=12&wx_fmt=png&tp=webp&usePicPrefetch=1&watermark=1`);
	}

	const items = originals.map((orig, i) => `
		<div class="swiper_item" data-src="${orig}" data-status="1">
			<div class="swiper_item_img">
				<img role="none" src="${thumbnails[i]}" style="width: 100%;${i >= 2 ? ' display: none;' : ''}">
			</div>
			<div class="swiper_item_icon swiper_item_loading" style="display: none;"></div>
		</div>
	`).join('');

	const indicators = thumbnails.map(thumb =>
		`<li class="swiper_indicator_item_pc" style="background-image: url(${thumb});"></li>`
	).join('');

	document.body.innerHTML = `
		<div id="js_content">
			<p>Some article text content here for the article body.</p>
		</div>
		<div class="img_swiper_area">
			<div class="share_media_swiper_wrp" style="visibility: visible;">
				<div class="share_media_swiper">
					<div class="share_media_swiper_content">
						<div class="share_media" style="height: 800px;">
							<div style="display:flex; transform:translate3d(0px,0px,0px);">
								${items}
							</div>
						</div>
					</div>
				</div>
				<ol class="swiper_indicator_list_pc">
					${indicators}
				</ol>
				<div id="img_list_indicator_wrp">
					<span class="swiper_tips_left">1</span>
					<span class="swiper_tips_right">${imageCount}</span>
				</div>
			</div>
		</div>
	`;
}

/**
 * Helper: extract all img src from the defuddle-carousel wrapper after preprocessing.
 */
function getExtractedImages(): string[] {
	const wrapper = document.querySelector('[data-defuddle-carousel]');
	if (!wrapper) return [];
	return Array.from(wrapper.querySelectorAll('img')).map(img => img.getAttribute('src') || '');
}

describe('preprocessCarousels — WeChat carousel', () => {
	test('extracts only original data-src images, not thumbnails', () => {
		buildWeChatCarousel(4);
		preprocessCarousels(document);

		const images = getExtractedImages();

		// Should have exactly 4 images (the originals)
		expect(images.length).toBe(4);

		// All should be original quality (sz_mmbiz_png), not thumbnails
		for (const src of images) {
			expect(src).toContain('sz_mmbiz_png');
			expect(src).not.toContain('watermark');
			// Thumbnail URLs use /mmbiz_png/ without the sz_ prefix
			expect(src).not.toMatch(/(?<!sz_)mmbiz_png\//);
		}
	});

	test('does not include indicator thumbnail background-images', () => {
		buildWeChatCarousel(4);
		preprocessCarousels(document);

		const images = getExtractedImages();

		// No thumbnail URLs from indicators
		for (const src of images) {
			expect(src).not.toContain('wxfrom=12');
			expect(src).not.toContain('tp=webp');
		}
	});

	test('replaces carousel with a visible wrapper div', () => {
		buildWeChatCarousel(3);
		preprocessCarousels(document);

		// Original carousel should be removed
		expect(document.querySelector('.share_media_swiper_wrp')).toBeNull();

		// New wrapper should exist
		const wrapper = document.querySelector('[data-defuddle-carousel]');
		expect(wrapper).not.toBeNull();
		expect(wrapper!.getAttribute('style')).toContain('display: block');
	});

	test('handles carousel with no data-src (falls back to img src)', () => {
		document.body.innerHTML = `
			<div class="swiper-container">
				<div class="swiper-wrapper">
					<div class="swiper-slide"><img src="https://example.com/img1.jpg"></div>
					<div class="swiper-slide"><img src="https://example.com/img2.jpg" style="display:none"></div>
				</div>
			</div>
		`;
		preprocessCarousels(document);

		const images = getExtractedImages();
		expect(images.length).toBe(2);
		expect(images).toContain('https://example.com/img1.jpg');
		expect(images).toContain('https://example.com/img2.jpg');
	});

	test('prefers img data-src over img src when no ancestor data-src', () => {
		document.body.innerHTML = `
			<div class="carousel">
				<div class="slide">
					<img data-src="https://example.com/original.jpg" src="https://example.com/thumb.jpg">
				</div>
				<div class="slide">
					<img data-src="https://example.com/original2.jpg" src="https://example.com/thumb2.jpg" style="display:none">
				</div>
			</div>
		`;
		preprocessCarousels(document);

		const images = getExtractedImages();
		expect(images.length).toBe(2);
		expect(images).toContain('https://example.com/original.jpg');
		expect(images).toContain('https://example.com/original2.jpg');
		// Should NOT contain thumbnails
		expect(images).not.toContain('https://example.com/thumb.jpg');
		expect(images).not.toContain('https://example.com/thumb2.jpg');
	});

	test('skips images inside navigation/indicator elements', () => {
		document.body.innerHTML = `
			<div class="carousel">
				<div class="slide"><img src="https://example.com/real.jpg"></div>
				<div class="pagination">
					<img src="https://example.com/dot1.jpg">
					<img src="https://example.com/dot2.jpg">
				</div>
				<div class="thumbnails">
					<img src="https://example.com/thumb1.jpg">
				</div>
			</div>
		`;
		preprocessCarousels(document);

		const images = getExtractedImages();
		expect(images.length).toBe(1);
		expect(images[0]).toBe('https://example.com/real.jpg');
	});

	test('does nothing when no carousel is present', () => {
		document.body.innerHTML = `
			<div class="article">
				<p>Hello world</p>
				<img src="https://example.com/photo.jpg">
			</div>
		`;
		preprocessCarousels(document);

		expect(document.querySelector('[data-defuddle-carousel]')).toBeNull();
		expect(document.querySelector('.article')).not.toBeNull();
	});

	test('deduplicates images across multiple carousels', () => {
		const orig = 'https://mmbiz.qpic.cn/sz_mmbiz_png/shared/0?wx_fmt=png';
		const thumb = 'https://mmbiz.qpic.cn/mmbiz_png/shared/0?wxfrom=12&tp=webp';

		document.body.innerHTML = `
			<div class="swiper-container">
				<div class="swiper_item" data-src="${orig}">
					<div class="swiper_item_img"><img src="${thumb}"></div>
				</div>
			</div>
			<div class="swiper-container">
				<div class="swiper_item" data-src="${orig}">
					<div class="swiper_item_img"><img src="${thumb}"></div>
				</div>
			</div>
		`;
		preprocessCarousels(document);

		const wrappers = document.querySelectorAll('[data-defuddle-carousel]');
		// Only one wrapper should have images (the other is deduplicated)
		const allImages = Array.from(wrappers).flatMap(w =>
			Array.from(w.querySelectorAll('img')).map(img => img.getAttribute('src'))
		);
		// The original URL should appear only once
		expect(allImages.filter(src => src === orig).length).toBe(1);
	});
});

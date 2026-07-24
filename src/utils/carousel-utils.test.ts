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

/**
 * Helper: build a WeChat image-share article DOM (page_share_img).
 * This is a special article type where the entire content is carousel images.
 */
function buildWeChatImageArticle(imageCount: number = 5) {
	const originals: string[] = [];
	const thumbnails: string[] = [];

	for (let i = 1; i <= imageCount; i++) {
		originals.push(`https://mmbiz.qpic.cn/sz_mmbiz_png/article_img${i}/0?wx_fmt=png&from=appmsg`);
		thumbnails.push(`https://mmbiz.qpic.cn/mmbiz_png/article_img${i}/0?wxfrom=12&wx_fmt=png&tp=webp&watermark=1`);
	}

	// First swiper (in header) has 1 preview item
	const previewItem = `
		<div class="swiper_item" data-status="1">
			<div class="swiper_item_img">
				<img src="${thumbnails[0]}" style="width:100%">
			</div>
		</div>`;

	// Second swiper has all items with data-src originals
	const mainItems = originals.map((orig, i) => `
		<div class="swiper_item" data-src="${orig}" data-status="1">
			<div class="swiper_item_img">
				<img src="${thumbnails[i]}" style="width:100%">
			</div>
		</div>`).join('');

	document.body.className = 'page_share_img pages_skin_default';
	document.body.innerHTML = `
		<div id="js_article" class="share_content_page">
			<div id="js_share_content_page_hd" class="share_content_page_hd">
				<div class="img_swiper_area">
					<div class="share_media_swiper_wrp">
						<div id="img_swiper" class="share_media_swiper">
							<div class="share_media_swiper_content">
								<div class="share_media">
									${previewItem}
								</div>
							</div>
						</div>
						<div class="share_media_swiper">
							<div class="share_media_swiper_content">
								<div class="share_media">
									${mainItems}
								</div>
							</div>
						</div>
						<ol class="swiper_indicator_list_pc">
							${thumbnails.map(t => `<li class="swiper_indicator_item_pc" style="background-image:url(${t})"></li>`).join('')}
						</ol>
					</div>
				</div>
			</div>
			<div id="js_base_container" class="share_content_page_bd">
				<div id="js_content_container" class="rich_media_area">
					<div id="js_article_content" class="rich_media_area_primary">
						<div class="rich_media_area_primary_inner">
							<div id="js_content">
								<div id="js_image_content" class="image_content">
									<h1 class="rich_media_title no_desc_title">Web开发者又多了个提效神器</h1>
									<div class="rich_media_meta_list image_rich_media_meta_list">
										<span>北京</span>
										<span>5月2日 08:55</span>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	`;
}

describe('preprocessCarousels — WeChat image-share article (page_share_img)', () => {
	test('detects page_share_img and replaces body with clean article', () => {
		buildWeChatImageArticle(5);
		preprocessCarousels(document);

		const article = document.body.querySelector('article');
		expect(article).not.toBeNull();
		expect(article!.id).toBe('js_content');
		expect(article!.getAttribute('class')).toBe('rich_media_content');
	});

	test('extracts all original carousel images (not thumbnails)', () => {
		buildWeChatImageArticle(5);
		preprocessCarousels(document);

		const article = document.body.querySelector('article');
		const wrapper = article!.querySelector('[data-defuddle-carousel]');
		expect(wrapper).not.toBeNull();

		const images = Array.from(wrapper!.querySelectorAll('img'))
			.map(img => img.getAttribute('src') || '');

		expect(images.length).toBe(5);
		for (const src of images) {
			expect(src).toContain('sz_mmbiz_png');
			expect(src).not.toContain('watermark');
		}
	});

	test('includes title in the article', () => {
		buildWeChatImageArticle(5);
		preprocessCarousels(document);

		const h1 = document.body.querySelector('article h1');
		expect(h1).not.toBeNull();
		expect(h1!.textContent).toBe('Web开发者又多了个提效神器');
	});

	test('includes metadata text for Defuddle scoring', () => {
		buildWeChatImageArticle(5);
		preprocessCarousels(document);

		const article = document.body.querySelector('article');
		const p = article!.querySelector('p');
		expect(p).not.toBeNull();
		expect(p!.textContent).toContain('北京');
		expect(p!.textContent).toContain('5月2日');
	});

	test('removes all original page elements', () => {
		buildWeChatImageArticle(5);
		preprocessCarousels(document);

		expect(document.querySelector('#js_article')).toBeNull();
		expect(document.querySelector('#js_share_content_page_hd')).toBeNull();
		expect(document.querySelector('#js_base_container')).toBeNull();
		expect(document.querySelector('.share_media_swiper')).toBeNull();

		expect(document.body.children.length).toBe(1);
		expect(document.body.firstElementChild!.tagName).toBe('ARTICLE');
	});

	test('does not trigger for normal articles', () => {
		buildWeChatCarousel(3);
		document.body.className = 'rich_media';

		preprocessCarousels(document);

		const article = document.body.querySelector('article');
		expect(article).toBeNull();
		expect(document.querySelector('#js_content')).not.toBeNull();
		expect(document.querySelector('[data-defuddle-carousel]')).not.toBeNull();
	});
});

/**
 * Helper: build a WeChat image-share article DOM (page_share_img) WITH description text.
 * This variant has #js_image_desc containing article summary/description,
 * similar to real articles like the "motion-anything" post.
 */
function buildWeChatImageArticleWithDesc(imageCount: number = 9) {
	const originals: string[] = [];
	const thumbnails: string[] = [];

	for (let i = 1; i <= imageCount; i++) {
		originals.push(`https://mmbiz.qpic.cn/sz_mmbiz_png/desc_img${i}/0?wx_fmt=png&from=appmsg`);
		thumbnails.push(`https://mmbiz.qpic.cn/mmbiz_png/desc_img${i}/0?wxfrom=12&wx_fmt=png&tp=webp&watermark=1`);
	}

	const previewItem = `
		<div class="swiper_item" data-status="1">
			<div class="swiper_item_img">
				<img src="${thumbnails[0]}" style="width:100%">
			</div>
		</div>`;

	const mainItems = originals.map((orig, i) => `
		<div class="swiper_item" data-src="${orig}" data-status="1">
			<div class="swiper_item_img">
				<img src="${thumbnails[i]}" style="width:100%">
			</div>
		</div>`).join('');

	document.body.className = 'page_share_img pages_skin_default';
	document.body.innerHTML = `
		<div id="js_article" class="share_content_page">
			<div id="js_share_content_page_hd" class="share_content_page_hd">
				<div class="img_swiper_area">
					<div class="share_media_swiper_wrp">
						<div id="img_swiper" class="share_media_swiper">
							<div class="share_media_swiper_content">
								<div class="share_media">
									${previewItem}
								</div>
							</div>
						</div>
						<div class="share_media_swiper">
							<div class="share_media_swiper_content">
								<div class="share_media">
									${mainItems}
								</div>
							</div>
						</div>
						<ol class="swiper_indicator_list_pc">
							${thumbnails.map(t => `<li class="swiper_indicator_item_pc" style="background-image:url(${t})"></li>`).join('')}
						</ol>
					</div>
				</div>
			</div>
			<div id="js_base_container" class="share_content_page_bd">
				<div id="js_content_container" class="rich_media_area">
					<div id="js_article_content" class="rich_media_area_primary">
						<div class="rich_media_area_primary_inner">
							<div id="js_content">
								<div id="js_image_content" class="image_content">
									<h1 class="rich_media_title">motion-anything正式开源：免费Figma Moti</h1>
									<p id="js_image_desc" class="share_notice js_underline_content">motion-anything 的重点不是“又一个动效工具”，而是把动效放回真实网页里：你看到的是 HTML + CSS + JavaScript，能运行、能部署、还能回来继续逐组件编辑。<br><br>它自带 403 个策展动效配方、230 套 Skills、59 套设计系统、58 套 HyperFrames 视频模板、2680 枚图标。<br><br><span class="wx_english_text_left">GitHub 地址：https://github.com/nexu-io/motion-anything</span></p>
									<div class="rich_media_meta_list image_rich_media_meta_list">
										<span>广东</span>
										<span>7月12日 15:38</span>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	`;
}

describe('preprocessCarousels — WeChat image-share article with description', () => {
	test('extracts #js_image_desc text as paragraphs', () => {
		buildWeChatImageArticleWithDesc(9);
		preprocessCarousels(document);

		const article = document.body.querySelector('article');
		expect(article).not.toBeNull();

		const paragraphs = Array.from(article!.querySelectorAll('p'));
		const texts = paragraphs.map(p => p.textContent || '');

		// Should contain the description paragraphs
		expect(texts.some(t => t.includes('motion-anything 的重点不是'))).toBe(true);
		expect(texts.some(t => t.includes('403 个策展动效配方'))).toBe(true);
		expect(texts.some(t => t.includes('GitHub 地址'))).toBe(true);
	});

	test('splits <br><br> into separate paragraphs', () => {
		buildWeChatImageArticleWithDesc(9);
		preprocessCarousels(document);

		const article = document.body.querySelector('article');
		const paragraphs = Array.from(article!.querySelectorAll('p'));

		// The description has 3 text segments separated by <br><br>
		// Plus the metadata paragraph — so at least 4 <p> elements
		expect(paragraphs.length).toBeGreaterThanOrEqual(4);
	});

	test('still extracts all carousel images', () => {
		buildWeChatImageArticleWithDesc(9);
		preprocessCarousels(document);

		const article = document.body.querySelector('article');
		const wrapper = article!.querySelector('[data-defuddle-carousel]');
		expect(wrapper).not.toBeNull();

		const images = Array.from(wrapper!.querySelectorAll('img'))
			.map(img => img.getAttribute('src') || '');

		expect(images.length).toBe(9);
		for (const src of images) {
			expect(src).toContain('sz_mmbiz_png');
		}
	});

	test('includes title, description, and metadata in correct order', () => {
		buildWeChatImageArticleWithDesc(9);
		preprocessCarousels(document);

		const article = document.body.querySelector('article')!;
		const children = Array.from(article.children);

		// Order: h1 (title) → p* (description) → div (images) → p (metadata)
		expect(children[0].tagName).toBe('H1');
		expect(children[0].textContent).toBe('motion-anything正式开源：免费Figma Moti');

		// Last element should be metadata
		const lastChild = children[children.length - 1];
		expect(lastChild.tagName).toBe('P');
		expect(lastChild.textContent).toContain('广东');
	});
});

import { decode } from "html-entities";
const SEARCH_REGEX = /DDG\.pageLayout\.load\('d',(\[.+\])\);DDG\.duckbar\.load\('images'/;
const IMAGES_REGEX = /;DDG\.duckbar\.load\('images', ({"ads":.+"vqd":{".+":"\d-\d+-\d+"}})\);DDG\.duckbar\.load\('news/;
const NEWS_REGEX = /;DDG\.duckbar\.load\('news', ({"ads":.+"vqd":{".+":"\d-\d+-\d+"}})\);DDG\.duckbar\.load\('videos/;
const VIDEOS_REGEX = /;DDG\.duckbar\.load\('videos', ({"ads":.+"vqd":{".+":"\d-\d+-\d+"}})\);DDG\.duckbar\.loadModule\('related_searches/;
const RELATED_SEARCHES_REGEX = /DDG\.duckbar\.loadModule\('related_searches', ({"ads":.+"vqd":{".+":"\d-\d+-\d+"}})\);DDG\.duckbar\.load\('products/;
const VQD_REGEX = /vqd=['"](\d+-\d+(?:-\d+)?)['"]/;
var SearchTimeType;
(function (SearchTimeType) {
    /** From any time. */
    SearchTimeType["ALL"] = "a";
    /** From the past day. */
    SearchTimeType["DAY"] = "d";
    /** From the past week. */
    SearchTimeType["WEEK"] = "w";
    /** From the past month. */
    SearchTimeType["MONTH"] = "m";
    /** From the past year. */
    SearchTimeType["YEAR"] = "y";
})(SearchTimeType || (SearchTimeType = {}));
var SafeSearchType;
(function (SafeSearchType) {
    /** Strict filtering, no NSFW content. */
    SafeSearchType[SafeSearchType["STRICT"] = 0] = "STRICT";
    /** Moderate filtering. */
    SafeSearchType[SafeSearchType["MODERATE"] = -1] = "MODERATE";
    /** No filtering. */
    SafeSearchType[SafeSearchType["OFF"] = -2] = "OFF";
})(SafeSearchType || (SafeSearchType = {}));
const defaultOptions = {
    safeSearch: SafeSearchType.OFF,
    time: SearchTimeType.ALL,
    locale: "en-us",
    region: "wt-wt",
    offset: 0,
    marketRegion: "us",
};
export async function search(query, options) {
    if (!query)
        throw new Error("Query cannot be empty!");
    if (!options)
        options = defaultOptions;
    else
        options = sanityCheck(options);
    let vqd = options.vqd;
    if (!vqd)
        vqd = await getVQD(query, "web");
    const queryObject = {
        q: query,
        ...(options.safeSearch !== SafeSearchType.STRICT ? { t: "D" } : {}),
        l: options.locale,
        ...(options.safeSearch === SafeSearchType.STRICT ? { p: "1" } : {}),
        kl: options.region || "wt-wt",
        s: String(options.offset),
        dl: "en",
        ct: "US",
        ss_mkt: options.marketRegion,
        df: options.time,
        vqd,
        ...(options.safeSearch !== SafeSearchType.STRICT
            ? { ex: String(options.safeSearch) }
            : {}),
        sp: "1",
        bpa: "1",
        biaexp: "b",
        msvrtexp: "b",
        ...(options.safeSearch === SafeSearchType.STRICT
            ? {
                videxp: "a",
                nadse: "b",
                eclsexp: "a",
                stiaexp: "a",
                tjsexp: "b",
                related: "b",
                msnexp: "a",
            }
            : {
                nadse: "b",
                eclsexp: "b",
                tjsexp: "b",
                // cdrexp: 'b'
            }),
    };
    const response = await fetch(`https://links.duckduckgo.com/d.js?${queryString(queryObject)}`);
    const data = await response.text();
    if (data.includes("DDG.deep.is506"))
        throw new Error("A server error occurred!");
    const searchResults = JSON.parse(SEARCH_REGEX.exec(data)[1].replace(/\t/g, "    "));
    if (searchResults.length === 1 && !("n" in searchResults[0])) {
        const onlyResult = searchResults[0];
        /* istanbul ignore next */
        if ((!onlyResult.da && onlyResult.t === "EOF") ||
            !onlyResult.a ||
            onlyResult.d === "google.com search")
            return {
                noResults: true,
                vqd,
                results: [],
            };
    }
    const results = {
        noResults: false,
        vqd,
        results: [],
    };
    for (const search of searchResults) {
        if ("n" in search)
            continue;
        let bang;
        if (search.b) {
            const [prefix, title, domain] = search.b.split("\t");
            bang = { prefix, title, domain };
        }
        results.results.push({
            title: search.t,
            description: decode(search.a),
            rawDescription: search.a,
            hostname: search.i,
            icon: `https://external-content.duckduckgo.com/ip3/${search.i}.ico`,
            url: search.u,
            bang,
        });
    }
    // Images
    const imagesMatch = IMAGES_REGEX.exec(data);
    if (imagesMatch) {
        const imagesResult = JSON.parse(imagesMatch[1].replace(/\t/g, "    "));
        results.images = imagesResult.results.map((i) => {
            i.title = decode(i.title);
            return i;
        });
    }
    // News
    const newsMatch = NEWS_REGEX.exec(data);
    if (newsMatch) {
        const newsResult = JSON.parse(newsMatch[1].replace(/\t/g, "    "));
        results.news = newsResult.results.map((article) => ({
            date: article.date,
            excerpt: decode(article.excerpt),
            image: article.image,
            relativeTime: article.relative_time,
            syndicate: article.syndicate,
            title: decode(article.title),
            url: article.url,
            isOld: !!article.is_old,
        }));
    }
    // Videos
    const videosMatch = VIDEOS_REGEX.exec(data);
    if (videosMatch) {
        const videoResult = JSON.parse(videosMatch[1].replace(/\t/g, "    "));
        results.videos = [];
        /* istanbul ignore next */
        for (const video of videoResult.results) {
            results.videos.push({
                url: video.content,
                title: decode(video.title),
                description: decode(video.description),
                image: video.images.large ||
                    video.images.medium ||
                    video.images.small ||
                    video.images.motion,
                duration: video.duration,
                publishedOn: video.publisher,
                published: video.published,
                publisher: video.uploader,
                viewCount: video.statistics.viewCount || undefined,
            });
        }
    }
    // Related Searches
    const relatedMatch = RELATED_SEARCHES_REGEX.exec(data);
    if (relatedMatch) {
        const relatedResult = JSON.parse(relatedMatch[1].replace(/\t/g, "    "));
        results.related = [];
        for (const related of relatedResult.results) {
            results.related.push({
                text: related.text,
                raw: related.display_text,
            });
        }
    }
    return results;
}
function queryString(query) {
    return new URLSearchParams(query).toString();
}
async function getVQD(query, ia = "web") {
    try {
        const response = await fetch(`https://duckduckgo.com/?${queryString({ q: query, ia })}`);
        const data = await response.text();
        return VQD_REGEX.exec(data)[1];
    }
    catch (e) {
        throw new Error(`Failed to get the VQD for query "${query}".`);
    }
}
function sanityCheck(options) {
    options = Object.assign({}, defaultOptions, options);
    if (!(options.safeSearch in SafeSearchType))
        throw new TypeError(`${options.safeSearch} is an invalid safe search type!`);
    /* istanbul ignore next */
    if (typeof options.safeSearch === "string")
        options.safeSearch = SafeSearchType[options.safeSearch];
    if (typeof options.offset !== "number")
        throw new TypeError(`Search offset is not a number!`);
    if (options.offset < 0)
        throw new RangeError("Search offset cannot be below zero!");
    if (options.time &&
        !Object.values(SearchTimeType).includes(options.time) &&
        !/\d{4}-\d{2}-\d{2}..\d{4}-\d{2}-\d{2}/.test(options.time))
        throw new TypeError(`${options.time} is an invalid search time!`);
    if (!options.locale || typeof options.locale !== "string")
        throw new TypeError("Search locale must be a string!");
    if (!options.region || typeof options.region !== "string")
        throw new TypeError("Search region must be a string!");
    if (!options.marketRegion || typeof options.marketRegion !== "string")
        throw new TypeError("Search market region must be a string!");
    if (options.vqd && !/\d-\d+-\d+/.test(options.vqd))
        throw new Error(`${options.vqd} is an invalid VQD!`);
    return options;
}
export const duckduckgo_search = {
    schema: {
        'name': 'duckduckgo_search',
        'description': 'Use DuckDuckGo search engine to find information. You can search for the latest news, articles, blogs and other content.',
        'parameters': {
            'type': 'object',
            'properties': {
                'keywords': {
                    'type': 'array',
                    "items": { 'type': "string" },
                    'description': "搜索的关键词列表。例如：['Python', '机器学习', '最新进展']。",
                },
            },
            'required': ['keywords'],
        },
    },
    func: async ({ keywords }) => {
        if (!keywords || keywords.length === 0 ) throw new Error('无参数');
        console.log('开始查询: ', keywords);
        const startTime = Date.now();
        const searchResults = await search(keywords.join(' '), {
            safeSearch: SafeSearchType.STRICT,
            offset: 0,
            region: 'cn-zh'
        });
        const max_length = 8;
        const content = searchResults.results
            .slice(0, max_length)
            .map((d) => `title: ` + d.title + `\ndescription: ` + d.description + `\nurl: ` + d.url)
            .join('\n---\n');
        const time = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
        console.log(content);
        return { content, time };
    },
    settings: {
        after_prompt: "作为智能助手，请按照以下步骤有效分析并提取我提供的搜索结果，以简洁明了的方式回答我的问题：\n\n1. 阅读和评估：仔细阅读所有搜索结果，识别并优先获取来自可靠和最新来源的信息。考虑因素包括官方来源、知名机构以及信息的更新时间。\n\n2. 提取关键信息：\n   • *汇率查询*：提供最新汇率并进行必要的换算。\n   • *天气查询*：提供具体地点和时间的天气预报。\n   • *事实性问题*：找出权威回答。\n\n3. 简洁回答：对提取的信息进行综合分析，给出简明扼要的回答。\n\n4. 识别不确定性：如果信息存在矛盾或不确定性，请解释可能原因。\n\n5. 说明信息不足：如果搜索结果无法完全回答问题，指出需要的额外信息。\n\n6. 用户友好：使用简单易懂的语言，必要时提供简短解释，确保回答易于理解。\n\n7. 附加信息：根据需要提供额外相关信息或建议，以增强回答的价值。\n\n8. 来源标注：在回答中清晰标注信息来源，包括来源网站或机构名称及数据的发布或更新时间。\n\n9. 参考列表：如果引用了多个来源，在回答最后提供简短的参考列表，列出主要信息来源。\n\n请确保目标是提供最新、最相关和最有用的信息，直接回应我的问题。避免冗长的细节，聚焦于我最关心的核心答案，并通过可靠的来源增强回答的可信度。",
        after_render: (question, result) => `问题：${question}\n\n搜索结果：${result}`,
    },
    // after_history_length: 0,
};

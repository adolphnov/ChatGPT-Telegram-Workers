/* eslint-disable no-cond-assign */
/* eslint-disable style/brace-style */
interface Node {
    tag: string;
    attrs?: Record<string, any>;
    children?: (Node | string)[];
};

/**
 * @description: markdown 转 nodes
 * 支持 #标题, * - 无序列表, 有序列表, 加粗, 斜体, 下划线, 链接, 分割线, 行内代码块, 跨行代码块
 * @param {string} markdown
 * @return {object[]}
 */
function markdownToTelegraphNodes(markdown: string): Node[] {
    const lines = markdown.split('\n');
    const nodes = [];
    // let currentList = null;
    let inCodeBlock = 0;
    let codeBlockLanguage = '';
    let codeBlockContent = '';
    let codeMatch: RegExpMatchArray | null;

    for (let line of lines) {
        const codeRegex = /^```(.*)/;
        if ((codeMatch = codeRegex.exec(line.trim()))) {
            if (inCodeBlock === 1 && codeMatch[1] === '') {
                nodes.push({
                    tag: 'pre',
                    children: [
                        {
                            tag: 'code',
                            // attrs: codeBlockLanguage ? { class: `language-${codeBlockLanguage}` } : {},
                            attrs: codeBlockLanguage ? { class: codeBlockLanguage } : {},
                            children: [codeBlockContent.trim()],
                        },
                    ],
                });
                inCodeBlock--;
                codeBlockContent = '';
                codeBlockLanguage = '';
            } else if (inCodeBlock > 1 && codeMatch[1] === '') {
                inCodeBlock--;
                codeBlockContent += `${line}\n`;
            } else if (inCodeBlock > 0 && codeMatch[1] !== '') {
                inCodeBlock++;
                codeBlockContent += `${line}\n`;
            } else {
                // 开始代码块
                inCodeBlock++;
                codeBlockLanguage = codeMatch[1];
            }
            continue;
        }

        if (inCodeBlock > 0) {
            codeBlockContent += `${line}\n`;
            continue;
        }

        const _line = line.trim();
        if (!_line)
            continue;

        // 标题
        if (_line.startsWith('#')) {
            const titleRegex = /^#+/;
            const match = titleRegex.exec(_line);
            let level = match ? match[0].length : 0;
            level = level <= 2 ? 3 : 4; // telegraph 仅支持h3 h4
            const text = line.replace(/^#+\s*/, '');
            nodes.push({ tag: `h${level}`, children: processInlineElements(text) });
            // nodes.push({ tag: `h${level}`, children: [text] }); // 简化处理
        }
        // 引用
        else if (_line.startsWith('> ')) {
            const text = line.slice(2);
            nodes.push({ tag: 'blockquote', children: processInlineElements(text) });
        }
        // 无序列表
        // else if (line.startsWith('- ') || line.startsWith('* ')) {
        //   const text = line.slice(2);
        //   if (!currentList) {
        //     currentList = { tag: 'ul', children: [] };
        //     nodes.push(currentList);
        //   }
        //   currentList.children.push({ tag: 'li', children: processInlineElements(text) });
        // }
        // 有序列表
        // else if (/^\d+\.\s/.test(line)) {
        //   const text = line.replace(/^\d+\.\s/, '');
        //   if (!currentList) {
        //     currentList = { tag: 'ol', children: [] };
        //     nodes.push(currentList);
        //   }
        //   currentList.children.push({ tag: 'li', children: processInlineElements(text) });
        // }
        // 分割线
        else if (_line === '---' || _line === '***') {
            nodes.push({ tag: 'hr' });
        }
        // 段落
        else {
            const matches = /^(\s*)(?:-|\*)\s/.exec(line);
            if (matches) {
                line = `${matches[1]}• ${line.slice(matches[0].length)}`;
            }
            nodes.push({ tag: 'p', children: processInlineElements(line) });
        }
    }

    // 处理可能的未闭合代码块
    if (inCodeBlock > 0) {
        nodes.push({
            tag: 'pre',
            children: [
                {
                    tag: 'code',
                    attrs: codeBlockLanguage ? { class: codeBlockLanguage } : {},
                    children: [codeBlockContent.trim() + (inCodeBlock > 1 ? '```\n'.repeat(inCodeBlock - 1) : '')],
                },
            ],
        });
    }

    return nodes;
}

function processInlineElementsHelper(text: string) {
    const children = [];

    // 处理链接
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match = null;
    let index = 0;

    while (true) {
        match = linkRegex.exec(text);
        if (match === null)
            break;

        if (match.index > index) {
            children.push(...processInlineStyles(text.slice(index, match.index)));
        }
        children.push({
            tag: 'a',
            attrs: { href: match[2] },
            children: [match[1]],
        });
        index = match.index + match[0].length;
    }

    if (index < text.length) {
        children.push(...processInlineStyles(text.slice(index)));
    }

    return children;
}

function processInlineStyles(text: string): (string | { tag: string; children: any[] })[] {
    const children = [];

    // 处理粗体 下划线 斜体 删除线
    const styleRegex = /(^|[^\\])(\*\*|__|_|~~)(.*?[^\\]?)\2/g;
    let lastIndex = 0;
    let match;
    while (true) {
        match = styleRegex.exec(text);
        if (match === null)
            break;

        if (match.index + match[1].length > lastIndex) {
            children.push(text.slice(lastIndex, match.index + match[1].length));
        }
        let tag = '';
        switch (match[2]) {
            case '**':
                tag = 'strong';
                break;
            case '__':
                tag = 'u';
                break;
            case '_':
                tag = 'i';
                break;
            case '~~':
                tag = 's';
                break;
            default:
                tag = 'span';
                break;
        }
        children.push({
            tag,
            children: [...processInlineStyles(match[3])],
        });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        children.push(text.slice(lastIndex));
    }

    return children;
}

function processInlineElements(text: string) {
    const children = [];
    const codeRegex = /(^|[^\\])`(.*?[^\\]?)`/g;
    let codeMatch: RegExpExecArray | null;
    let lastIndex = 0;

    while ((codeMatch = codeRegex.exec(text)) !== null) {
        if (codeMatch.index + codeMatch[1].length > lastIndex) {
            children.push(...processInlineElementsHelper(text.slice(lastIndex, codeMatch.index + codeMatch[1].length)));
        }
        children.push({
            tag: 'code',
            children: [codeMatch[2]],
        });
        lastIndex = codeMatch.index + codeMatch[0].length;
    }

    if (lastIndex < text.length) {
        children.push(...processInlineElementsHelper(text.slice(lastIndex)));
    }

    return children;
}

export default markdownToTelegraphNodes;

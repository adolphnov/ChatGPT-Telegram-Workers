/**
 * @description: markdown 转 nodes
 * 简单支持 #标题, * - 无序列表, 有序列表, 加粗, 斜体, 下划线, 链接, 分割线, 行内代码块, 跨行代码块
 * @param {string} markdown
 * @return {object[]}
 */
function markdownToTelegraphNodes(markdown) {
  const lines = markdown.split('\n');
  const nodes = [];
  // let currentList = null;
  let inCodeBlock = false;
  let codeBlockContent = '';
  let codeBlockLanguage = '';

  for (let line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // 结束代码块
        nodes.push({
          tag: 'pre',
          children: [
            {
              tag: 'code',
              attrs: codeBlockLanguage ? { class: `language-${codeBlockLanguage}` } : {},
              children: [codeBlockContent.trim()],
            },
          ],
        });
        inCodeBlock = false;
        codeBlockContent = '';
        codeBlockLanguage = '';
      } else {
        // 开始代码块
        inCodeBlock = true;
        codeBlockLanguage = line.trim().slice(3).trim(); // 获取语言标识符
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      continue;
    }

    const _line = line.trim();
    if (!_line) continue;

    // 标题
    if (_line.startsWith('#')) {
      let level = line.match(/^#+/)[0].length;
      level = level <= 2 ? 3 : 4; // telegram 仅支持h3 h4
      const text = line.replace(/^#+\s*/, '');
      nodes.push({ tag: `h${level}`, children: processInlineElements(text) });
      // nodes.push({ tag: `h${level}`, children: [text] }); // 简化处理
    }
    // 引用
    else if (_line.startsWith("> ")) {
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
    nodes.push({ tag: "hr" });
    }
    // 段落
    else {
      const matches = RegExp(/^(\s*)(-|\*)\s/).exec(line);
      if (matches) {
        line = matches[1] + '• ' + line.slice(matches[0].length);
      }
      nodes.push({ tag: 'p', children: processInlineElements(line) });
    }
  }

  // 处理可能的未闭合代码块
  if (inCodeBlock) {
    nodes.push({
      tag: 'pre',
      children: [
        {
          tag: 'code',
          attrs: codeBlockLanguage ? { class: `language-${codeBlockLanguage}` } : {},
          children: [codeBlockContent.trim()],
        },
      ],
    });
  }

  return nodes;
}

function processInlineElementsHelper(text) {
  let children = [];

  // 处理粗体 下划线 斜体 删除线
  const boldRegex = /\*\*(.+?)\*\*/g;
  const underlineRegex = /__(.+?)__/g;
  const italicRegex = /_(.+?)_/g;
  const strikethroughRegex = /~~(.+?)~~/g;
  let tagMatch = null;
  let lastIndex = 0;

  while (
    (tagMatch =
      boldRegex.exec(text) || underlineRegex.exec(text) || italicRegex.exec(text) || strikethroughRegex.exec(text)) !==
    null
  ) {
    if (tagMatch.index > lastIndex) {
      children.push(text.slice(lastIndex, tagMatch.index));
    }
    let tag = '';
    if (tagMatch[0].startsWith('**')) {
      tag = 'strong';
    } else if (tagMatch[0].startsWith('__')) {
      tag = 'u';
    } else if (tagMatch[0].startsWith('_')) {
      tag = 'i';
    } else if (tagMatch[0].startsWith('~~')) {
      tag = 's';
    }
    children.push({
      tag: tag,
      children: [tagMatch[1]],
    });
    lastIndex = tagMatch.index + tagMatch[0].length;
    boldRegex.lastIndex = underlineRegex.lastIndex = italicRegex.lastIndex = strikethroughRegex.lastIndex = lastIndex;
  }

  if (lastIndex < text.length) {
    children.push(text.slice(lastIndex));
  }

  // 处理链接
  children = children.map((child) => {
    if (typeof child === 'string') {
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let linkMatch;
      let linkChildren = [];
      let lastLinkIndex = 0;

      while ((linkMatch = linkRegex.exec(child)) !== null) {
        if (linkMatch.index > lastLinkIndex) {
          linkChildren.push(child.slice(lastLinkIndex, linkMatch.index));
        }
        linkChildren.push({
          tag: 'a',
          attrs: { href: linkMatch[2] },
          children: [linkMatch[1]],
        });
        lastLinkIndex = linkMatch.index + linkMatch[0].length;
      }

      if (lastLinkIndex < child.length) {
        linkChildren.push(child.slice(lastLinkIndex));
      }

      return linkChildren.length >= 1 ? linkChildren : child;
    }
    return child;
  });

  return children.flat();
}

function processInlineElements(text) {
  let children = [];

  // 处理行内代码块
  const codeRegex = /`([^`]+)`/g;
  let codeMatch;
  let lastIndex = 0;

  while ((codeMatch = codeRegex.exec(text)) !== null) {
    if (codeMatch.index > lastIndex) {
      children.push(...processInlineElementsHelper(text.slice(lastIndex, codeMatch.index)));
    }
    children.push({
      tag: 'code',
      children: [codeMatch[1]],
    });
    lastIndex = codeMatch.index + codeMatch[0].length;
  }

  if (lastIndex < text.length) {
    children.push(...processInlineElementsHelper(text.slice(lastIndex)));
  }

  return children.flat();
}

export default markdownToTelegraphNodes;
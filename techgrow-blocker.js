// ==UserScript==
// @name         TechGrow 请求拦截器
// @namespace    http://tampermonkey.net/
// @version      0.8
// @description  阻止特定的 TechGrow 文件请求，自动展开全文并隐藏公众号引流窗口
// @author       iTang
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const blockedUrls = [
        'https://qiniu.techgrow.cn/readmore/dist/readmore.js',
        'https://qiniu.techgrow.cn/readmore/dist/vuepress.css'
    ];

    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        if (blockedUrls.some(url => args[0].includes(url))) {
            console.log('拦截 fetch 请求:', args[0]);
            return new Promise(() => {
                throw new Error('请求被拦截');
            });
        }
        return originalFetch.apply(this, args);
    };

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (blockedUrls.some(blockedUrl => url.includes(blockedUrl))) {
            console.log('拦截 XMLHttpRequest 请求:', url);
            return;
        }
        return originalXhrOpen.apply(this, [method, url, ...rest]);
    };

    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.tagName === 'SCRIPT' && blockedUrls.includes(node.src)) {
                    console.log('拦截 script 标签:', node.src);
                    node.parentNode.removeChild(node);
                }
                if (node.tagName === 'LINK' && blockedUrls.includes(node.href)) {
                    console.log('拦截 link 标签:', node.href);
                    node.parentNode.removeChild(node);
                }
            });
        });
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    const originalDocumentWrite = document.write;
    document.write = function(content) {
        if (blockedUrls.some(url => content.includes(url))) {
            console.log('拦截 document.write 内容:', content);
            return;
        }
        return originalDocumentWrite.apply(this, arguments);
    };

    const originalCreateElement = document.createElement;
    document.createElement = function(tagName) {
        const element = originalCreateElement.call(document, tagName);
        if (tagName.toLowerCase() === 'script' || tagName.toLowerCase() === 'link') {
            const originalSetAttribute = element.setAttribute;
            element.setAttribute = function(name, value) {
                if ((name === 'src' || name === 'href') && blockedUrls.includes(value)) {
                    console.log(`拦截 ${tagName} 标签:`, value);
                    return;
                }
                originalSetAttribute.call(this, name, value);
            };
        }
        return element;
    };

    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        if ((name === 'src' || name === 'href') && blockedUrls.includes(value)) {
            console.log(`拦截 setAttribute: ${name} = ${value}`);
            return;
        }
        originalSetAttribute.call(this, name, value);
    };

    if (typeof self.importScripts === 'function') {
        const originalImportScripts = self.importScripts;
        self.importScripts = function(...urls) {
            if (urls.some(url => blockedUrls.includes(url))) {
                console.log('拦截 importScripts 请求:', urls);
                return;
            }
            return originalImportScripts.apply(this, urls);
        };
    }

    const originalAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function(node) {
        if (node.tagName === 'SCRIPT' && blockedUrls.includes(node.src)) {
            console.log('拦截 appendChild script:', node.src);
            return;
        }
        return originalAppendChild.call(this, node);
    };
})(); 

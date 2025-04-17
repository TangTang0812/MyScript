// ==UserScript==
// @name         Aliyun_video
// @namespace    https://bbs.tampermonkey.net.cn/
// @version      8.1.0
// @description  创建了一个无干扰的视频观看环境，让用户可以不受弹窗打扰和自动暂停影响，完全掌控视频播放体验。
// @author       You
// @match        https://www.alipan.com/*
// @match        https://www.aliyundrive.com/*
// @connect      alipan.com
// @connect      aliyundrive.com
// @connect      lc-cn-n1-shared.com
// @connect      *
// @require      https://scriptcat.org/lib/950/^1.0.1/Joysound.js
// @require      https://scriptcat.org/lib/2163/^1.0.0/alipanThirdParty.js
// @require      https://scriptcat.org/lib/2164/^1.0.0/alipanArtPlugins.js
// @require      https://cdn.staticfile.org/hls.js/1.5.15/hls.min.js
// @require      https://cdn.staticfile.org/artplayer/5.1.7/artplayer.min.js
// @require      https://cdn.staticfile.org/m3u8-parser/7.1.0/m3u8-parser.min.js
// @require      https://cdn.staticfile.org/jquery/3.6.0/jquery.min.js
// @require      https://cdn.staticfile.org/localforage/1.10.0/localforage.min.js
// @icon         https://gw.alicdn.com/imgextra/i3/O1CN01aj9rdD1GS0E8io11t_!!6000000000620-73-tps-16-16.ico
// @antifeature  ads
// @antifeature  membership
// @antifeature  payment
// @antifeature  referral-link
// @antifeature  tracking
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
    'use strict';

    // 立即添加CSS规则，预防弹窗显示
    const injectEarlyCSS = () => {
        const style = document.createElement('style');
        style.textContent = `
            /* 立即隐藏爱发电相关弹窗 */
            [class*="dialog"],
            [class*="modal"],
            [class*="popup"],
            [role="dialog"],
            [class*="modal-container"],
            [class*="dialog-container"] {
                visibility: hidden !important;
            }
            
            /* 遮罩层 */
            body > [class*="mask"],
            body > [class*="overlay"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
        `;
        
        // 尽早添加样式
        if (document.head) {
            document.head.appendChild(style);
        } else {
            // 如果head还不存在，等待DOM加载
            document.addEventListener('DOMContentLoaded', () => {
                document.head.appendChild(style);
            });
        }
    };
    
    // 尽早注入CSS
    injectEarlyCSS();

    // 视频播放保护 - 添加全局错误捕获
    const originalErrorHandler = window.onerror;
    window.onerror = function(message, source, lineno, colno, error) {
        // 如果是removeChild错误，阻止它中断播放
        if (message && message.toString().includes('removeChild')) {
            console.warn('已拦截removeChild错误，防止影响视频播放');
            return true; // 防止错误冒泡
        }
        // 否则调用原始错误处理
        return originalErrorHandler ? originalErrorHandler.apply(this, arguments) : false;
    };

    // 更精确的用户操作跟踪
    const userAction = {
        lastClickTime: 0,
        lastKeyTime: 0,
        videoClickTime: 0,
        controlsClickTime: 0,
        
        // 保存用户上次操作时间并记录操作类型
        recordAction: function(type) {
            const now = Date.now();
            this[`last${type}Time`] = now;
            return now;
        },
        
        // 判断是否是用户最近操作
        isRecentUserAction: function(maxAge = 1000) {
            const now = Date.now();
            return (now - this.lastClickTime < maxAge) || 
                   (now - this.lastKeyTime < maxAge) ||
                   (now - this.videoClickTime < maxAge) ||
                   (now - this.controlsClickTime < maxAge);
        }
    };
    
    // 跟踪视频状态
    const videoState = {
        // 存储每个视频的播放状态
        playbackStates: new WeakMap(),
        
        // 记录视频状态
        saveState: function(video, playing) {
            if (!video) return;
            this.playbackStates.set(video, {
                playing,
                timestamp: Date.now(),
                userInitiated: userAction.isRecentUserAction(2000)
            });
        },
        
        // 获取视频状态
        getState: function(video) {
            return this.playbackStates.get(video) || { playing: false, timestamp: 0, userInitiated: false };
        },
        
        // 判断当前状态变化是否用户发起的
        isUserInitiated: function(video) {
            const state = this.getState(video);
            return state.userInitiated;
        }
    };
    
    // 添加全局事件监听，记录用户操作
    document.addEventListener('click', () => {
        userAction.recordAction('Click');
    }, true);
    
    document.addEventListener('keydown', () => {
        userAction.recordAction('Key');
    }, true);
    
    document.addEventListener('mousedown', () => {
        userAction.recordAction('Click');
    }, true);
    
    // 完全重写的视频保护函数
    const protectVideoPlayer = () => {
        try {
            // 查找所有视频元素
            const videoElements = document.querySelectorAll('video');
            
            videoElements.forEach(video => {
                // 为视频元素添加点击事件监听器
                if (!video._clickListenerAdded) {
                    video.addEventListener('click', () => {
                        userAction.recordAction('VideoClick');
                    }, true);
                    
                    // 为视频控制器添加点击事件
                    const controls = video.parentElement?.querySelectorAll?.('button, [role="button"]') || [];
                    controls.forEach(control => {
                        control.addEventListener('click', () => {
                            userAction.recordAction('ControlsClick');
                        }, true);
                    });
                    
                    video._clickListenerAdded = true;
                }
                
                // 如果视频已经有保护，不重复设置
                if (video._protectedV2) return;
                
                // 保存原方法
                const originalPause = video.pause;
                const originalPlay = video.play;
                
                // 监听视频播放状态变化
                if (!video._playListenerAdded) {
                    video.addEventListener('play', () => {
                        videoState.saveState(video, true);
                    });
                    
                    video.addEventListener('pause', (event) => {
                        // 记录暂停状态
                        videoState.saveState(video, false);
                        
                        // 判断是否是自然暂停
                        const isUserAction = userAction.isRecentUserAction(2000);
                        if (!isUserAction) {
                            console.warn('检测到非用户触发的暂停:', event);
                            
                            // 跟踪堆栈以便调试
                            console.log('Pause stack:', new Error().stack);

                            // 获取视频信息
                            const { currentTime, duration, paused, ended } = video;
                            console.log('Video state:', { currentTime, duration, paused, ended });
                            
                            // 如果不是因为结束或缓冲而暂停，则尝试恢复播放
                            if (!ended && currentTime < duration - 0.5) {
                                setTimeout(() => {
                                    // 再次检查状态确保它仍然是暂停的并恢复播放
                                    if (video.paused && !video.ended && document.visibilityState !== 'hidden') {
                                        console.log('检测到自动暂停，恢复播放...');
                                        video._ignoreNextPause = true;
                                        originalPlay.apply(video).catch(e => {
                                            console.error('恢复播放失败:', e);
                                        });
                                    }
                                }, 100);
                            }
                        }
                    });
                    
                    video._playListenerAdded = true;
                }
                
                // 完全重写暂停方法
                video.pause = function() {
                    // 如果是要忽略的暂停操作，直接返回
                    if (video._ignoreNextPause) {
                        video._ignoreNextPause = false;
                        console.log('忽略预期的暂停操作');
                        return Promise.resolve();
                    }
                    
                    // 1. 检查是否有直接用户操作痕迹
                    const isRecentUserAction = userAction.isRecentUserAction();
                    
                    // 2. 检查调用堆栈
                    const stack = new Error().stack || '';
                    
                    // 3. 识别用户界面相关的调用
                    const isUIAction = stack.includes('click') || 
                                       stack.includes('touch') || 
                                       stack.includes('mouse') ||
                                       stack.includes('key') ||
                                       stack.includes('input') ||
                                       stack.includes('button') ||
                                       stack.includes('user');
                    
                    // 4. 识别控制器相关的调用
                    const isControlsAction = stack.includes('controls') || 
                                            stack.includes('Controls') || 
                                            stack.includes('player') || 
                                            stack.includes('Player') ||
                                            stack.includes('button') || 
                                            stack.includes('Button');
                    
                    // 5. 识别可能的合法系统操作
                    const isLegitSystemAction = stack.includes('visibilitychange') || 
                                               stack.includes('beforeunload') ||
                                               stack.includes('unload') || 
                                               stack.includes('hidden') ||
                                               video.ended || 
                                               document.visibilityState === 'hidden';
                    
                    // 6. 识别爱发电相关操作
                    const isPossibleAdAction = stack.toLowerCase().includes('aifadian') || 
                                             stack.toLowerCase().includes('dialog') || 
                                             stack.toLowerCase().includes('popup') || 
                                             stack.toLowerCase().includes('modal') ||
                                             stack.toLowerCase().includes('vip');
                    
                    // 组合判断 - 允许暂停的条件
                    const allowPause = isRecentUserAction || 
                                      isUIAction || 
                                      isControlsAction || 
                                      isLegitSystemAction;
                    
                    if (allowPause) {
                        console.log('允许暂停视频 - 合法操作');
                        return originalPause.apply(this);
                    } 
                    else if (isPossibleAdAction) {
                        console.warn('阻止爱发电相关暂停');
                        return Promise.resolve();
                    }
                    else {
                        console.warn('阻止可疑的自动暂停操作:', stack.split('\n')[1]);
                        return Promise.resolve();
                    }
                };
                
                // 增强播放方法
                video.play = function() {
                    try {
                        return originalPlay.apply(this).catch(e => {
                            console.warn('播放视频时出错，尝试重试:', e);
                            // 出错时等待短暂时间后重试
                            return new Promise(resolve => {
                                setTimeout(() => {
                                    originalPlay.apply(this).then(resolve).catch(() => resolve());
                                }, 300);
                            });
                        });
                    } catch(err) {
                        console.error('增强的play方法出错:', err);
                        return originalPlay.apply(this);
                    }
                };
                
                // 标记视频已保护
                video._protectedV2 = true;
                console.log('已强化视频播放器保护 V2');
            });
            
            // 主动检查并恢复异常暂停的视频
            setTimeout(() => {
                videoElements.forEach(video => {
                    // 如果视频未结束但暂停了，且最近没有用户操作，可能是被异常暂停
                    if (video.paused && !video.ended && 
                        !userAction.isRecentUserAction(3000) && 
                        document.visibilityState === 'visible') {
                        
                        // 获取视频播放状态历史
                        const state = videoState.getState(video);
                        
                        // 如果之前是播放状态，且不是用户主动暂停的，尝试恢复播放
                        if (state.playing && !state.userInitiated) {
                            console.log('检测到异常暂停，尝试恢复播放...');
                            
                            // 避免触发暂停保护逻辑
                            video._ignoreNextPause = true;
                            
                            // 恢复播放
                            video.play().catch(e => {
                                console.warn('恢复异常暂停视频失败:', e);
                            });
                        }
                    }
                });
            }, 1000);
        } catch(err) {
            console.error('保护视频播放器时出错:', err);
        }
    };
    
    // 每2秒检查一次视频播放状态
    setInterval(protectVideoPlayer, 2000);
    
    // 页面可见性变化时也检查
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            protectVideoPlayer();
        }
    });

    // 全局定义VIP状态常量，用于统一返回VIP状态
    const FAKE_VIP_INFO = {
        thirdPartyVip: true,
        thirdPartyVipExpire: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    };

    // 创建一个防抖函数，避免频繁操作DOM
    const debounce = (fn, wait) => {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), wait);
        };
    };

    var obj = {
        file_page: {
            root_info: {},
            send_params: {},
            file_items: []
        },
        video_page: {
            video_info: {},
            video_file: {},
            video_items: [],
            subtitle_items: []
        }
    };

    // 重写原生方法，避免错误
    try {
        // 保存原始方法
        const originalRemoveChild = Node.prototype.removeChild;
        
        // 重写removeChild方法，添加错误保护
        Node.prototype.removeChild = function(child) {
            try {
                // 检查子节点是否真的是当前节点的子节点
                if (child && this.contains(child)) {
                    return originalRemoveChild.call(this, child);
                } else {
                    console.warn('安全地跳过无效的removeChild操作');
                    return child; // 返回节点但不执行移除
                }
            } catch(err) {
                console.warn('removeChild操作失败，已安全处理', err);
                return child;
            }
        };
    } catch(e) {
        console.error('重写DOM方法失败', e);
    }

    obj.httpListener = function () {
        (function(send) {
            XMLHttpRequest.prototype.send = function (sendParams) {
                this.addEventListener("load", function(event) {
                    if (this.readyState == 4 && this.status == 200) {
                        var response = this.response || this.responseText || "", responseURL = this.responseURL;
                        if (responseURL.indexOf("/file/list") > 0 || responseURL.indexOf("/file/search") > 0) {
                            obj.initFilesInfo(sendParams, response);
                        }
                        else if (responseURL.indexOf("/file/get_video_preview_play_info") > 0) {
                            obj.initVideoPlayInfo(response);
                            obj.initVideoPlayer();
                        }
                    }
                }, false);
                send.apply(this, arguments);
            };
        })(XMLHttpRequest.prototype.send);
    };

    obj.initFilesInfo = function (sendParams, response) {
        const { send_params, } = obj.file_page;
        try { sendParams = JSON.parse(sendParams) } catch (error) { };
        try { response = JSON.parse(response) } catch (error) { };
        if (sendParams instanceof Object && response instanceof Object) {
            const { order_by, order_direction, parent_file_id } = sendParams || {};
            if (!(order_by === send_params.order_by && order_direction === send_params.order_direction && parent_file_id === send_params.parent_file_id)) {
                obj.file_page.file_items = [];
            }
            obj.file_page.send_params = sendParams;
            obj.file_page.file_items.find((item) => item?.file_id === response.items[0]?.file_id) || (obj.file_page.file_items = obj.file_page.file_items.concat(response.items));
            obj.showTipSuccess("文件列表获取完成 共：" + obj.file_page.file_items.length + "项");

            if (obj.file_page.file_items.length) {
                // obj.isHomePage() ? obj.initDownloadHomePage() : obj.initDownloadSharePage;
            }
        }
    };

    obj.initVideoPlayInfo = function (response) {
        try { response = JSON.parse(response) } catch (error) { };
        if (response instanceof Object) {
            obj.video_page.video_info = response;
            obj.video_page.video_items = obj.file_page.file_items.filter(function (item, index) {
                return item.type == "file" && item.category == "video";
            });
            obj.video_page.video_file = obj.file_page.file_items.find(function (item, index) {
                return item.type == "file" && item.file_id == response.file_id;
            });
            obj.video_page.subtitle_items = obj.file_page.file_items.filter(function (item, index) {
                return item.type == "file" && item.category === "others" && ["webvtt", "vtt", "srt", "ass", "ssa"].includes(item.file_extension.toLowerCase());
            });
        }
    };

    obj.initVideoPlayer = function () {
        obj.getVideoPreviewPlayInfo().then((response) => {
            Object.assign(obj.video_page.video_info, response);
            obj.replaceVideoPlayer().then(() => {
                const options = Object.assign({}, obj.video_page);
                window.alipanArtPlugins.init(options).then((art) => {
                    art.on('reload-start', (quality) => {
                        const defaultIndex = quality.findIndex((item) => item.default);
                        obj.getVideoPreviewPlayInfo().then((response) => {
                            const { live_transcoding_task_list } = response?.video_preview_play_info || {};
                            live_transcoding_task_list[defaultIndex].default = !0;
                            art.emit('reload-can', live_transcoding_task_list);
                        });
                    });

                    art.on('playlist-switch-start', (fileOption) => {
                        obj.video_page.video_file = fileOption;
                        obj.getVideoPreviewPlayInfo().then((response) => {
                            art.emit('playlist-switch-can', response);
                        });
                    });

                    const closeNode = document.querySelector('[class^="header-left"] [data-icon-type="PDSClose"]');
                    closeNode && closeNode.addEventListener('click', art.destroy, {once: true});
                });
            });
        });
    };

    obj.replaceVideoPlayer = function () {
        var container, videoNode = document.querySelector("video");
        if (videoNode) {
            container = document.getElementById("artplayer");
            if (container) {
                return Promise.resolve();
            }

            container = document.createElement("div");
            container.setAttribute("id", "artplayer");
            container.setAttribute("style", "width: 100%; height: 100%;");
            var videoParentNode = videoNode.parentNode.parentNode;
            videoParentNode.parentNode.replaceChild(container, videoParentNode);
            return Promise.resolve();
        }
        else {
            obj.showTipLoading("正在替换视频播放器 ...", 1e3);
            return obj.delay().then(function () {
                return obj.replaceVideoPlayer();
            });
        }
    };

    obj.getVideoPreviewPlayInfo = function () {
        // 直接返回模拟的VIP状态，跳过第三方VIP检查
        return Promise.resolve(FAKE_VIP_INFO).then((info) => {
            const { thirdPartyVip, thirdPartyVipExpire } = info || {};
            if (thirdPartyVip) {
                return obj.getVideoPreviewPlayInfoThirdParty();
            }
            else {
                return Promise.reject();
            }
        }).catch(() => {
            return obj.getVideoPreviewPlayInfoWeb();
        });
    };

    obj.getVideoPreviewPlayInfoThirdParty = function () {
        const { drive_id, file_id, share_id } = obj.video_page.video_file;
        if (share_id) {
            return obj.saveFile(file_id, share_id).then((response) => {
                const { responses: [{ body, status }] } = response;
                if (status === 201) {
                    const { drive_id, file_id } = body;
                    return window.alipanThirdParty.getVideoPreviewPlayInfo(drive_id, file_id).finally(() => {
                        window.alipanThirdParty.delete(drive_id, file_id);
                    });
                }
                else {
                    obj.showTipError("文件缓存失败，可能网盘存储空间已满 ...", 5e3);
                    return Promise.reject();
                }
            });
        }
        return window.alipanThirdParty.getVideoPreviewPlayInfo(drive_id, file_id);
    };

    obj.getVideoPreviewPlayInfoWeb = function () {
        return obj.refresh().then (() => {
            const { drive_id, file_id, share_id } = obj.video_page.video_file || obj.video_page.video_info;
            if (share_id) {
                return obj.saveFile(file_id, share_id).then((response) => {
                    const { responses: [{ body, status }] } = response;
                    if (status === 201) {
                        const { drive_id, file_id } = body;
                        return obj.get_video_preview_play_info(drive_id, file_id).finally(() => {
                            obj.deleteFile(drive_id, file_id);
                        });
                    }
                    else {
                        obj.showTipError("文件缓存失败，可能网盘存储空间已满 ...", 5e3);
                        return Promise.reject();
                    }
                });
            }
            return obj.get_video_preview_play_info(drive_id, file_id);
        });
    };

    obj.get_video_preview_play_info = function (drive_id, file_id) {
        const { token_type, access_token } = obj.getItem("token");
        return fetch("https://api.aliyundrive.com/v2/file/get_video_preview_play_info", {
            body: JSON.stringify({
                category: "live_transcoding",
                drive_id: drive_id,
                file_id: file_id,
                template_id: "",
                get_subtitle_info: !0,
                mode: "high_res",
                url_expire_sec: 14400
            }),
            headers: {
                "authorization": "".concat(token_type || "", " ").concat(access_token || ""),
                "content-type": "application/json;charset=UTF-8",
            },
            method: "POST"
        }).then((response) => {
            return response.ok ? response.json() : Promise.reject();
        });
    };

    obj.saveFile = function (file_id, share_id) {
        const { token_type, access_token, default_drive_id } = obj.getItem("token");
        const { share_token } = obj.getItem("shareToken");
        return fetch("https://api.aliyundrive.com/adrive/v4/batch", {
            body: JSON.stringify({
                requests: [
                    {
                        body: {
                            auto_rename: true,
                            file_id: file_id,
                            share_id: share_id,
                            to_parent_file_id: "root",
                            to_drive_id: default_drive_id
                        },
                        headers: {
                            "Content-Type": "application/json"
                        },
                        id: "0",
                        method: "POST",
                        url: "/file/copy"
                    }
                ],
                resource: "file"
            }),
            headers: {
                "authorization": "".concat(token_type || "", " ").concat(access_token || ""),
                "content-type": "application/json;charset=UTF-8",
                "x-share-token": share_token
            },
            method: "POST"
        }).then((response) => {
            return response.ok ? response.json() : Promise.reject();
        });
    };

    obj.deleteFile = function (drive_id, file_id) {
        const { token_type, access_token } = obj.getItem("token");
        return fetch("https://api.aliyundrive.com/v3/file/delete", {
            body: JSON.stringify({
                drive_id: drive_id,
                file_id: file_id
            }),
            headers: {
                "authorization": "".concat(token_type || "", " ").concat(access_token || ""),
                "content-type": "application/json;charset=UTF-8",
            },
            method: "POST"
        });
    };

    obj.refresh = function () {
        const token = obj.getItem("token") || {};
        if (obj.tokenExpires(token)) {
            return Promise.resolve();
        }
        return fetch("https://api.aliyundrive.com/token/refresh", {
            body: JSON.stringify({
                refresh_token: token.refresh_token
            }),
            headers: {
                "accept": "application/json, text/plain, */*",
                "content-type": "application/json",
            },
            method: "POST"
        }).then((response) => {
            return response.ok ? response.json() : Promise.reject();
        }).then((response) => {
            obj.setItem("token", response);
            return response;
        });
    };

    obj.tokenExpires = function (file) {
        var t = file.expire_time, i = Number(file.expires_in), e = Date.parse(t) - Date.now();
        if (0 < e && e < 1e3 * i) return !0;
        return !1;
    };

    obj.getItem = function (n) {
        n = localStorage.getItem(n);
        if (!n) return null;
        try {
            return JSON.parse(n);
        } catch (e) {
            return n;
        }
    };

    obj.setItem = function (n, t) {
        n && t != undefined && localStorage.setItem(n, t instanceof Object ? JSON.stringify(t) : t);
    };

    obj.removeItem = function (n) {
        n != undefined && localStorage.removeItem(n);
    };

    obj.isSharePage = function () {
        return location.href.indexOf("aliyundrive.com/s/") > 0 || location.href.indexOf("alipan.com/s/") > 0;
    };

    obj.delay = function (ms = 500) {
        return new Promise(resolve => setTimeout(resolve, ms));
    };

    obj.showTipSuccess = function (message, time) {
        obj.showNotify({
            type: "success",
            message: message,
            time: time
        });
    };

    obj.showTipError = function (message, time) {
        obj.showNotify({
            type: "fail",
            message: message,
            time: time
        });
    };

    obj.showTipLoading = function (message, time) {
        obj.showNotify({
            type: "loading",
            message: message,
            time: time
        });
    };

    obj.showNotify = function (opts) {
        if (unsafeWindow.application) {
            unsafeWindow.application.showNotify(opts);
        }
        else {
            var $ = $ || window.$;
            var css = [
                ".notify{display:none;position:absolute;top:0;left:25%;width:50%;text-align:center;overflow:hidden;z-index:1010}",
                ".notify .alert{display:inline-block;*display:inline;*zoom:1;min-width:110px;white-space:nowrap}",
                ".alert-success,.alert-fail,.alert-loading{padding:0 20px;line-height:34px;font-size:14px;color:#ffffff}",
                ".alert-success,.alert-loading{background:#36be63}",
                ".alert-fail{background:#ff794a}",
                ".fade{opacity:0;-webkit-transition:opacity .15s linear;-o-transition:opacity .15s linear;transition:opacity .15s linear}",
                ".fade.in{opacity:1}"
            ];
            $("<style></style>").text(css.join(" ")).appendTo(document.head || document.documentElement);
            $("body").append('<div id="J_Notify" class="notify" style="width: 650px; margin: 10px auto; display: none;"></div>');
            unsafeWindow.application = {
                notifySets: {
                    type_class_obj: {success: "alert-success", fail: "alert-fail", loading: "alert-loading"},
                    count: 0,
                    delay: 3e3
                },
                showNotify: function(opts) {
                    var that = this, class_obj = that.notifySets.type_class_obj, count = that.notifySets.count;
                    opts.type == "loading" && (delay *= 5);
                    if ($(".alert").length == 0) {
                        $("#J_Notify").empty().append('<div class="alert in fade"></div>').show();
                    }
                    else {
                        Object.keys(class_obj).forEach(function(key) {
                            $("#J_Notify").toggleClass(class_obj[key], false);
                        });
                    }
                    $(".alert").text(opts.message).addClass(class_obj[opts.type]);
                    that.notifySets.count += 1;

                    var delay = opts.time || that.notifySets.delay;
                    setTimeout(function() {
                        if (++count == that.notifySets.count) {
                            that.hideNotify();
                        }
                    }, delay);
                },
                hideNotify: function() {
                    $("#J_Notify").empty();
                }
            };
            obj.showNotify(opts);
        }
    };

    obj.hideNotify = function () {
        if (unsafeWindow.application) {
            unsafeWindow.application.hideNotify();
        }
    };

    obj.run = function () {
        obj.httpListener();
        
        // 重写第三方VIP检查方法，防止弹窗
        if (window.alipanThirdParty) {
            // 重写所有可能触发弹窗的方法
            window.alipanThirdParty.getVipInfo = function() {
                return Promise.resolve(FAKE_VIP_INFO);
            };
            
            // 如果存在checkVip方法，也重写它
            if (window.alipanThirdParty.checkVip) {
                window.alipanThirdParty.checkVip = function() {
                    return Promise.resolve(true);
                };
            }
            
            // 重写弹窗显示方法(如果存在)
            if (window.alipanThirdParty.showVipDialog) {
                window.alipanThirdParty.showVipDialog = function() {
                    return Promise.resolve(true);
                };
            }
            
            console.log("已完全禁用爱发电弹窗 - 初始化时");
        }
    }();

    console.log("=== Aliyun_video 好棒棒！===");

    // 增强版阻止弹窗函数
    (function preventPopup() {
        // 跟踪已处理过的弹窗，避免重复处理
        const processedPopups = new WeakSet();
        
        // 将弹窗阻止函数提前到全局变量，以便后续多处使用
        const blockAllPopups = function() {
            // 1. 重写alipanThirdParty中所有与VIP相关的方法
            if (window.alipanThirdParty) {
                const methods = ["getVipInfo", "checkVip", "showVipDialog", "checkOrder", "validateOrder"];
                methods.forEach(method => {
                    if (typeof window.alipanThirdParty[method] === 'function') {
                        window.alipanThirdParty[method] = function() {
                            return method.includes("check") || method.includes("validate") ? 
                                Promise.resolve(true) : Promise.resolve(FAKE_VIP_INFO);
                        };
                    }
                });
                
                // 2. 如果有showDialog方法，重写它
                if (typeof window.alipanThirdParty.showDialog === 'function') {
                    window.alipanThirdParty.showDialog = function() {
                        return Promise.resolve(true);
                    };
                }
                
                // 3. 如果有render或mount方法，也拦截它们
                ["render", "mount", "show"].forEach(method => {
                    if (typeof window.alipanThirdParty[method] === 'function') {
                        const original = window.alipanThirdParty[method];
                        window.alipanThirdParty[method] = function(...args) {
                            // 检查是否与VIP相关
                            const argsStr = JSON.stringify(args);
                            if (argsStr.includes('vip') || 
                                argsStr.includes('dialog') || 
                                argsStr.includes('爱发电') ||
                                argsStr.includes('赞助')) {
                                console.log(`已拦截alipanThirdParty.${method}调用`);
                                return Promise.resolve(true);
                            }
                            return original.apply(this, args);
                        };
                    }
                });
                
                // 4. 彻底阻止任何暂停视频的尝试
                if (typeof window.alipanThirdParty.pauseVideo === 'function') {
                    window.alipanThirdParty.pauseVideo = function() {
                        console.log('已阻止alipanThirdParty暂停视频的尝试');
                        return Promise.resolve();
                    };
                }
                
                console.log("已完全禁用爱发电弹窗 - 方法重写");
                return true;
            }
            return false;
        };

        // 检测并重写方法
        blockAllPopups();
        
        // 如果立即重写失败，设置定期检查
        const intervalId = setInterval(function() {
            if (blockAllPopups()) {
                clearInterval(intervalId);
            }
        }, 500);

        // 安全地获取节点文本内容
        const safeGetNodeText = (node) => {
            try {
                return node && node.textContent ? node.textContent : '';
            } catch(e) {
                return '';
            }
        };
        
        // 判断元素是否为爱发电弹窗 - 增加更多关键词检测
        const isAifadianPopup = (element) => {
            try {
                const text = safeGetNodeText(element);
                return text.includes("爱发电") || 
                       text.includes("赞助") ||
                       text.includes("订单号") ||
                       text.includes("请输入爱发电订单号") ||
                       (text.includes("订单") && text.includes("确认")) ||
                       (text.includes("支持") && text.includes("创作"));
            } catch(e) {
                return false;
            }
        };
        
        // 安全处理弹窗样式
        const safeSetStyles = (element, styles) => {
            try {
                if (!element || !element.style) return;
                Object.entries(styles).forEach(([prop, value]) => {
                    try {
                        element.style.setProperty(prop, value, 'important');
                    } catch(e) {}
                });
            } catch(e) {}
        };
        
        // 立即处理当前DOM中的弹窗 - 不使用防抖，立即执行
        const handlePopupsImmediately = () => {
            try {
                // 识别爱发电弹窗
                const popupSelectors = [
                    'div[class*="dialog"]', 
                    'div[class*="modal"]', 
                    'div[class*="popup"]',
                    '[role="dialog"]',
                    '[class*="modal-container"]',
                    '[class*="dialog-container"]'
                ];
                
                // 收集所有弹窗元素
                popupSelectors.forEach(selector => {
                    try {
                        document.querySelectorAll(selector).forEach(el => {
                            if (!processedPopups.has(el)) {
                                if (isAifadianPopup(el)) {
                                    // 立即隐藏爱发电弹窗
                                    safeSetStyles(el, {
                                        'display': 'none',
                                        'visibility': 'hidden',
                                        'opacity': '0',
                                        'pointer-events': 'none',
                                        'width': '0px',
                                        'height': '0px',
                                        'position': 'absolute',
                                        'z-index': '-9999'
                                    });
                                    processedPopups.add(el);
                                } else {
                                    // 恢复非爱发电弹窗的可见性
                                    safeSetStyles(el, {
                                        'visibility': 'visible'
                                    });
                                }
                            }
                        });
                    } catch(e) {}
                });
                
                // 处理遮罩层
                document.querySelectorAll('[class*="mask"], [class*="overlay"]').forEach(mask => {
                    if (!processedPopups.has(mask)) {
                        // 如果附近有爱发电弹窗，隐藏遮罩
                        const siblings = mask.parentNode ? mask.parentNode.children : [];
                        for (let i = 0; i < siblings.length; i++) {
                            if (siblings[i] !== mask && isAifadianPopup(siblings[i])) {
                                safeSetStyles(mask, {
                                    'display': 'none',
                                    'visibility': 'hidden',
                                    'opacity': '0',
                                    'pointer-events': 'none'
                                });
                                processedPopups.add(mask);
                                break;
                            }
                        }
                    }
                });
            } catch (error) {
                console.error("立即处理弹窗错误:", error);
            }
        };
        
        // 防抖版弹窗处理函数 - 用于MutationObserver
        const handlePopups = debounce(() => {
            handlePopupsImmediately();
            
            // 处理完毕后，恢复所有非爱发电弹窗的可见性
            setTimeout(() => {
                const style = document.createElement('style');
                style.textContent = `
                    /* 恢复非爱发电弹窗的可见性 */
                    [class*="dialog"]:not([style*="display: none"]),
                    [class*="modal"]:not([style*="display: none"]),
                    [class*="popup"]:not([style*="display: none"]),
                    [role="dialog"]:not([style*="display: none"]) {
                        visibility: visible !important;
                    }
                `;
                document.head.appendChild(style);
            }, 100);
        }, 100);

        // 使用MutationObserver，降低CPU使用率
        try {
            // 观察DOM变化
            const observer = new MutationObserver((mutations) => {
                let hasNewNodes = false;
                
                // 快速检查是否有新节点添加
                for (let i = 0; i < mutations.length; i++) {
                    if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
                        hasNewNodes = true;
                        break;
                    }
                }
                
                // 只在有新节点时处理
                if (hasNewNodes) {
                    // 立即执行一次，然后防抖执行一次
                    handlePopupsImmediately();
                    handlePopups();
                    
                    // 新节点添加后，检查并保护视频播放器
                    setTimeout(protectVideoPlayer, 500);
                }
            });
            
            // 监听DOM变化
            observer.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true
            });
            
            // 立即执行一次
            setTimeout(handlePopupsImmediately, 0);
            // 文档加载完成后再执行一次
            document.addEventListener('DOMContentLoaded', () => {
                handlePopupsImmediately();
                protectVideoPlayer();
            });
            // 页面加载完成后再执行一次
            window.addEventListener('load', () => {
                handlePopupsImmediately();
                protectVideoPlayer();
            });
            
        } catch (e) {
            console.error("设置MutationObserver失败:", e);
            // 备用方案：定期检查
            setInterval(handlePopupsImmediately, 500);
        }
        
        // 添加精确的CSS规则
        try {
            const style = document.createElement('style');
            style.textContent = `
                /* 隐藏爱发电相关弹窗 */
                [class*="dialog"]:has(div:contains("爱发电")),
                [class*="modal"]:has(div:contains("赞助")),
                [class*="popup"]:has(div:contains("订单号")),
                [role="dialog"]:has(div:contains("爱发电")),
                [class*="dialog"]:has(span:contains("爱发电")),
                [class*="modal"]:has(span:contains("赞助")),
                [class*="popup"]:has(span:contains("订单号")),
                [role="dialog"]:has(span:contains("爱发电")),
                [class*="dialog"]:has(button:contains("爱发电")),
                [class*="dialog"]:has(a:contains("爱发电")) {
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                    width: 0 !important;
                    height: 0 !important;
                    position: absolute !important;
                    z-index: -9999 !important;
                    transform: translateX(-99999px) !important;
                }
                
                /* 隐藏与爱发电相关的按钮 */
                a[href*="afdian"],
                button:has(span:contains("爱发电")),
                div:has(> span:contains("爱发电")) {
                    display: none !important;
                }
            `;
            
            // 安全添加样式
            if (document.head) {
                document.head.appendChild(style);
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    document.head.appendChild(style);
                });
            }
        } catch(e) {
            console.error("添加CSS规则失败:", e);
        }
        
        // 预先拦截可能的弹窗API
        try {
            // 创建拦截器
            const createAPIInterceptor = (obj, methodName, predicate) => {
                if (!obj || typeof obj[methodName] !== 'function') return;
                
                try {
                    const original = obj[methodName];
                    obj[methodName] = function(...args) {
                        if (predicate(...args)) {
                            console.log(`已拦截${methodName}调用`);
                            return methodName.includes('get') ? 
                                Promise.resolve(FAKE_VIP_INFO) : 
                                methodName.includes('show') ? 
                                    undefined : Promise.resolve(true);
                        }
                        return original.apply(this, args);
                    };
                } catch(e) {
                    console.error(`拦截${methodName}失败:`, e);
                }
            };
            
            // 判断是否与爱发电相关
            const isAifadianAPI = (...args) => {
                try {
                    const content = JSON.stringify(args).toLowerCase();
                    return content.includes('爱发电') || 
                        content.includes('aifadian') ||
                        content.includes('dialog') ||
                        content.includes('modal') ||
                        content.includes('popup') ||
                        content.includes('vip') ||
                        content.includes('订单') ||
                        content.includes('赞助');
                } catch(e) {
                    return false;
                }
            };
            
            // 全局Dialog拦截
            if (window.Dialog || unsafeWindow.Dialog) {
                const dialog = window.Dialog || unsafeWindow.Dialog;
                ['show', 'alert', 'confirm'].forEach(method => {
                    createAPIInterceptor(dialog, method, isAifadianAPI);
                });
            }
            
            // 全局Modal拦截
            if (window.Modal || unsafeWindow.Modal) {
                const modal = window.Modal || unsafeWindow.Modal;
                ['show', 'open'].forEach(method => {
                    createAPIInterceptor(modal, method, isAifadianAPI);
                });
            }
            
            // 全局API拦截
            [window, unsafeWindow].forEach(context => {
                if (!context) return;
                
                // 常用弹窗方法
                ['alert', 'confirm', 'prompt'].forEach(method => {
                    createAPIInterceptor(context, method, isAifadianAPI);
                });
                
                // 框架特有方法
                ['showModal', 'openDialog', 'showDialog'].forEach(method => {
                    createAPIInterceptor(context, method, isAifadianAPI);
                });
            });
        } catch(e) {
            console.error("设置API拦截器失败:", e);
        }
        
        // 增强视频播放功能而不干扰暂停能力
        const enhanceVideoPlayback = () => {
            const videos = document.querySelectorAll('video');
            videos.forEach(video => {
                if (!video._playbackEnhanced) {
                    const originalPlay = video.play;
                    video.play = function() {
                        try {
                            return originalPlay.apply(this).catch(e => {
                                console.warn('视频播放被阻止，尝试重新启用:', e);
                                setTimeout(() => originalPlay.apply(this), 300);
                            });
                        } catch(err) {
                            console.error('增强视频播放时出错:', err);
                            return originalPlay.apply(this);
                        }
                    };
                    video._playbackEnhanced = true;
                }
            });
        };
        
        // 定期增强视频播放和检查暂停问题
        setInterval(() => {
            enhanceVideoPlayback();
            
            // 主动检查所有暂停的视频
            const videos = document.querySelectorAll('video');
            videos.forEach(video => {
                if (video.paused && !video.ended && document.visibilityState === 'visible') {
                    // 检查是否可能是异常暂停
                    const state = videoState.getState(video);
                    const now = Date.now();
                    
                    // 如果上次状态是播放，且不是用户暂停的，且距今不超过10秒
                    if (state.playing && !state.userInitiated && (now - state.timestamp < 10000)) {
                        console.log('尝试恢复异常暂停的视频...');
                        video._ignoreNextPause = true;
                        video.play().catch(() => {});
                    }
                }
            });
        }, 2000);
        
        // 添加防御性措施：拦截所有可能停止视频的API
        try {
            // 全局级别防护
            const protectGlobalVideoApi = () => {
                if (window.HTMLMediaElement && window.HTMLMediaElement.prototype) {
                    // 加强对原生视频API的保护
                    if (!window.HTMLMediaElement.prototype._pauseProtected) {
                        const origPause = window.HTMLMediaElement.prototype.pause;
                        window.HTMLMediaElement.prototype.pause = function() {
                            // 检测是否是爱发电相关操作
                            const stack = new Error().stack || '';
                            if (stack.toLowerCase().includes('aifadian') || 
                                stack.toLowerCase().includes('dialog') || 
                                stack.toLowerCase().includes('modal') ||
                                stack.toLowerCase().includes('popup') ||
                                stack.toLowerCase().includes('vip')) {
                                console.warn('全局拦截: 阻止爱发电相关暂停');
                                return;
                            }
                            
                            // 用户最近有操作，允许暂停
                            if (userAction.isRecentUserAction(2000)) {
                                return origPause.apply(this);
                            }
                            
                            // 特殊情况和页面切换，允许暂停
                            if (document.visibilityState === 'hidden' || 
                                this.ended || 
                                stack.includes('visibilitychange')) {
                                return origPause.apply(this);
                            }
                            
                            // 记录拦截并处理其他情况
                            console.warn('全局拦截: 可疑暂停操作', stack.split('\n')[1]);
                            return;
                        };
                        window.HTMLMediaElement.prototype._pauseProtected = true;
                    }
                }
            };
            
            // 立即执行一次
            protectGlobalVideoApi();
            
            // 定期检查以防被覆盖
            setInterval(protectGlobalVideoApi, 5000);
        } catch(e) {
            console.error('设置全局视频API拦截失败:', e);
        }
    })();

    // Your code here...
})();

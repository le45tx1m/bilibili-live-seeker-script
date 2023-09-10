// ==UserScript==
// @name         Bilibili直播自动追帧
// @namespace    https://space.bilibili.com/521676
// @version      0.7.0
// @description  自动追帧bilibili直播至设定的buffer length
// @author       c_b
// @match        https://live.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @license      GPLv3 License
// @homepageURL  https://github.com/c-basalt/bilibili-live-seeker-script/
// @supportURL   https://space.bilibili.com/521676
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// ==/UserScript==

(function () {
    'use strict';
    const window = unsafeWindow;
    const W = unsafeWindow;

    const migrateConfig = () => {
        const version = GM_getValue('version', 0);
        if (version < 1) {
            Object.entries({
                'auto-AV-sync': 'boolean',
                'hide-stats': 'boolean',
                'auto-reload': 'boolean',
                'force-flv': 'boolean',
                'prevent-pause': 'boolean',
                'force-raw': 'boolean',
                'auto-quality': 'boolean',
                'auto-speedup': 'boolean',
                'auto-slowdown': 'boolean',
                'block-roundplay': 'boolean',
                'buffer-threshold': 'number',
                'AV-resync-step': 'number',
                'AV-resync-interval': 'number',
                'speedup-thres': 'object',
                'speeddown-thres': 'object',
                'playurl-custom-endpoint': 'string',
                'hide-seeker-control-panel': 'boolean',
            }).forEach(([key, typeName]) => {
                try {
                    const value = typeName === 'string' ? localStorage.getItem(key) : JSON.parse(localStorage.getItem(key));
                    console.log('migrate', key, value);
                    if (typeof value === typeName) GM_setValue(key, value);
                } catch (e) {
                    console.error('[bililive-seeker] Failed to migrate setting for ' + key + '\n', e);
                }
            });
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.match(/^playurl-\d+$/)) {
                    try {
                        const value = JSON.parse(localStorage.getItem(key));
                        console.log('migrate', key, value);
                        GM_setValue(key, value);
                    } catch (e) {
                        console.error('[bililive-seeker] Failed to migrate setting for ' + key + '\n', e);
                    }
                }
            }
        }
        GM_setValue('version', 1);
    }
    migrateConfig();

    if (!location.href.match(/https:\/\/live\.bilibili\.com\/(blanc\/)?\d+/)) return;
    // 仅对直播间生效


    // ----------------------- 播放器追帧 -----------------------

    const getVideoElement = () => {
        return document.getElementsByTagName('video')[0];
    }

    const updatePlaybackRateDisplay = (retries = 3) => {
        const v = getVideoElement();
        if (!v) {
            if (retries > 0) {
                console.debug('[bililive-seeker] Failed to find video element, update rate later');
                setTimeout(() => { updatePlaybackRateDisplay(retries - 1) }, 100);
            }
        } else {
            const usernameRate = document.querySelector('#playback-rate-username');
            if (!usernameRate) {
                const e = document.querySelector('.room-owner-username');
                if (e) {
                    e.style.lineHeight = 'normal';
                    e.innerHTML = e.innerHTML.match(/^([^<]+)(<|$)/)[1] + '<span id="playback-rate-username">　@' + v.playbackRate.toFixed(2) + '</span>'
                }
            } else {
                usernameRate.innerText = '　@' + v.playbackRate.toFixed(2);
            }
            const titleRate = document.querySelector('#playback-rate-title');
            if (!titleRate) {
                const e2 = document.querySelector('.live-title .text');
                if (e2) {
                    e2.innerHTML = e2.innerHTML.match(/^([^<]+)(<|$)/)[1] + '<br><span id="playback-rate-title" style="display:none">@' + v.playbackRate.toFixed(2) + '</span>'
                }
            } else {
                titleRate.innerText = '@' + v.playbackRate.toFixed(2);
            }
        }
    }

    const setRate = (rate) => {
        const e = getVideoElement()
        if (!e) return
        if (e.playbackRate.toFixed(2) === Number(rate).toFixed(2)) return;
        e.playbackRate = Number(rate).toFixed(2);
        console.debug('[bililive-seeker] playback rate set to ' + e.playbackRate.toFixed(2));
        updatePlaybackRateDisplay();
    }

    const resetRate = () => {
        setRate(1);
    }

    const bufferlen = () => {
        const e = getVideoElement();
        if (!e) return null;
        try {
            const buffer_len = Number(e.buffered.end(0) - e.currentTime);
            return (!Number.isNaN(buffer_len))? buffer_len : null;
        } catch (e) {
            console.error('[bililive-seeker] failed to get buffer length\n', e);
            return null;
        }
    }

    const adjustSpeedup = () => {
        const thres = getValue('buffer-threshold');
        if (!thres) return;
        try {
            if (!isLiveStream()) return;
            const speedUpChecked = isChecked('auto-speedup');
            if (!speedUpChecked) {
                if (speedUpChecked === false && getVideoElement()?.playbackRate > 1) resetRate();
                return;
            }
            const bufferLen = bufferlen()
            if (bufferLen === null) return;
            let diffThres, rate;
            const speedupThres = getStoredValue('speedup-thres');
            for (let i = 0; i < speedupThres.length; i++) {
                [diffThres, rate] = speedupThres[i];
                if (bufferLen - thres > diffThres) {
                    setRate(rate);
                    return;
                }
            }
            if (getVideoElement()?.playbackRate > 1) resetRate();
        } catch (e) {
            console.error('[bililive-seeker] Unexpected error when speeding up:\n', e)
        }
    }

    const adjustSpeeddown = () => {
        try {
            if (!isLiveStream()) return;
            const slowDownChecked = isChecked('auto-slowdown');
            if (!slowDownChecked) {
                if (slowDownChecked === false && getVideoElement()?.playbackRate < 1) resetRate();
                return;
            }
            const bufferLen = bufferlen()
            if (bufferLen === null) return;
            let thres, rate;
            const speeddownThres = getStoredValue('speeddown-thres');
            for (let i = 0; i < speeddownThres.length; i++) {
                [thres, rate] = speeddownThres[i];
                if (bufferLen < thres) {
                    setRate(rate);
                    return;
                }
            }
            if (getVideoElement()?.playbackRate < 1) resetRate();
        } catch (e) {
            console.error('[bililive-seeker] Unexpected error when speeding down:\n', e)
        }
    }
    window.speedUpIntervalId = setInterval(() => { adjustSpeedup() }, 300)
    window.speedDownIntervalId = setInterval(() => { adjustSpeeddown() }, 50)


    // ----------------------- 获取参数 -----------------------

    const defaultValues = {
        'auto-AV-sync': false,
        'hide-stats': false,
        'auto-reload': true,
        'force-flv': true,
        'prevent-pause': false,
        'force-raw': false,
        'auto-quality': true,
        'auto-speedup': true,
        'auto-slowdown': true,
        'block-roundplay': false,
        'buffer-threshold': 1.5,
        'AV-resync-step': 0.05,
        'AV-resync-interval': 300,
        'speedup-thres': [[2, 1.3], [1, 1.2], [0, 1.1]],
        'speeddown-thres': [[0.2, 0.1], [0.3, 0.3], [0.6, 0.6]],
        'hide-seeker-control-panel': false,
    };

    const getStoredValue = (key) => {
        return GM_getValue(key, defaultValues[key])
    };
    const setStoredValue = (key, value) => {
        GM_setValue(key, value);
    };
    const deleteStoredValue = (key) => {
        GM_deleteValue(key);
    };
    const listStoredKeys = (func) => {
        return GM_listValues();
    };
    const clearStoredValues = () => {
        listStoredKeys().forEach(key => { deleteStoredValue(key) });
        setStoredValue('version', 1);
    }

    const isChecked = (key, fallback) => {
        const e = document.querySelector('#' + key);
        if (e && (typeof e?.checked === 'boolean')) return e.checked;
        if (fallback) {
            const value = getStoredValue(key);
            return (typeof value === 'boolean')? value : defaultValues[key];
        }
        return null;
    };
    const getValue = (key, fallback) => {
        const e = document.querySelector('#' + key);
        let value = Number(e?.value);
        if (!Number.isNaN(value)) return value;
        if (fallback) {
            value = Number(getStoredValue(key));
            return (!Number.isNaN(value))? value : defaultValues[key];
        }
        return null;
    };
    const isLiveStream = () => {
        if (document.querySelector('.web-player-round-title')?.innerText) return false; // 轮播
        if (document.querySelector('.web-player-ending-panel')?.innerText) return false; // 闲置或轮播阻断
        const e = document.querySelector('video');
        if (!e) return undefined; // 网页加载
        return true; // 直播
    };
    const getRoomId = () => {
        const _getRoomId = () => window.__NEPTUNE_IS_MY_WAIFU__?.roomInitRes?.data?.room_id || window.__roomInitRes?.data?.room_id;
        if (!_getRoomId()) getRoomInit();
        try {
            return _getRoomId() || Number(location.href.match(/\/(\d+)/)[1]);
        } catch (e) {
            console.error('[bililive-seeker] Failed to get room id\n', e)
            return null;
        }
    };


    // ----------------------- 音画同步重置 -----------------------

    window.AVResync = () => {
        console.debug("[bililive-seeker] enforce AV sync")
        const v = getVideoElement();
        const step = getValue('AV-resync-step', true);
        if (!v || step === null) return;
        v.currentTime = v.currentTime + step;
    }
    const stopAutoResync = () => {
        console.debug("[bililive-seeker] clear AV sync interval")
        clearInterval(window.AVResyncIntervalId);
    }
    const startAutoResync = () => {
        stopAutoResync();
        console.debug("[bililive-seeker] start AV sync interval")
        window.AVResyncIntervalId = setInterval(() => { window.AVResync() }, getValue("AV-resync-interval", true) * 1000);
    }


    // ----------------------- 项目检查循环 -----------------------

    const checkPaused = () => {
        if (!isChecked('prevent-pause')) return
        const v = getVideoElement();
        if (v && isLiveStream()) {
            if (v.paused) {
                const thres = getValue('buffer-threshold');
                const bufferLen = bufferlen();
                if (thres && bufferLen && thres > bufferLen) return;
                v.play();
            }
        }
    }
    window.checkPausedIntervalId = setInterval(() => { checkPaused() }, 500)


    const offLiveAutoReload = ({ timeout, lastChat }) => {
        if (!isChecked('auto-reload')) return;
        if (isLiveStream() === false && isChecked('block-roundplay') && getStoredValue('block-roundplay')) {
            const chatHistory = document.querySelector('.chat-history-panel').innerText;
            if (timeout) {
                setTimeout(() => { offLiveAutoReload({ lastChat: chatHistory }) }, timeout)
            } else {
                if (chatHistory === lastChat) {
                    document.querySelector('label[for="auto-reload"]').classList.add('danmaku-lost');
                    setTimeout(() => { window.location.reload(); }, 5000);
                } else {
                    console.debug('[bililive-seeker] chat history changed');
                }
            }
        }
    }
    const checkIsLiveReload = (timeout) => {
        if (!isChecked('auto-reload')) return
        if (isLiveStream() === false) {
            window.fetch("https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=" + getRoomId() + "&protocol=0&format=0,1,2&codec=0&qn=10000&platform=web")
                .then(r => r.json())
                .then(r => {
                    console.debug('[bililive-seeker] live status', r.data?.live_status);
                    if (r.data?.live_status === 1) {
                        // 0: 闲置，1: 直播，2: 轮播
                        if (timeout) {
                            setTimeout(() => { checkIsLiveReload() }, timeout);
                            document.querySelector('label[for="auto-reload"]').classList.add('live-on');
                            return;
                        } else {
                            document.querySelector('label[for="auto-reload"]').classList.add('reload');
                            window.location.reload();
                        }
                    }
                });
        }
        document.querySelector('label[for="auto-reload"]').classList.remove('live-on');
    }
    const checkErrorReload = (timeout) => {
        if (!isChecked('auto-reload')) return;
        const error = document.querySelector('.web-player-error-panel');
        if (error) {
            if (timeout) {
                setTimeout(() => { checkErrorReload() }, timeout);
                document.querySelector('label[for="auto-reload"]').classList.add('video-error');
                return;
            } else {
                document.querySelector('label[for="auto-reload"]').classList.add('reload');
                window.location.reload();
            }
        }
        document.querySelector('label[for="auto-reload"]').classList.remove('video-error');
    }
    window.offLiveReloadIntervalId = setInterval(() => { offLiveAutoReload({ timeout: 3600 * 1000 }) }, 600 * 1000);
    window.checkLiveReloadIntervalId = setInterval(() => { checkIsLiveReload(10 * 1000) }, 60 * 1000);
    window.checkErrorReloadIntervalId = setInterval(() => { checkErrorReload(2000) }, 3000);


    // ----------------------- 网络请求 -----------------------

    const xhrGetApi = (url) => {
        const request = new XMLHttpRequest();
        request.open('GET', url, false);
        request.withCredentials = true;
        request.send(null);
        if (request.status === 200) {
            return JSON.parse(request.responseText);
        }
    }
    const getPlayUrl = (room_id) => {
        console.debug('[bililive-seeker] request playurl');
        const rsp = xhrGetApi("https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=" + room_id + "&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&dolby=5&panorama=1");
        return rsp.data?.playurl_info?.playurl;
    }
    const getRoomInit = () => {
        const roomId = location.href.match(/\/(\d+)(\?|$)/)[1];
        const rsp = xhrGetApi("https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=" + roomId + "&protocol=0,1&format=0,1,2&codec=0,1&qn=10000&platform=web&dolby=5&panorama=1");
        cacheRoomInit(rsp);
    }


    // ----------------------- 网络请求hook -----------------------

    const cacheRoomInit = (roomInitRsp) => {
        if (window.__NEPTUNE_IS_MY_WAIFU__?.roomInitRes?.data) return;
        if (window.__roomInitRes?.data) return;
        window.__roomInitRes = roomInitRsp;
    }
    const cachePlayUrl = (playurl) => {
        if (!playurl?.stream) return;
        try {
            console.debug('[bililive-seeker] playurl', playurl);
            const baseurl = playurl.stream[0].format[0].codec[0].base_url;
            const qn = playurl.stream[0].format[0].codec[0].current_qn;
            if (qn === 10000 && baseurl.match(/\/live_\d+(?:_bs)?_\d+(?:_[0-9a-f]{8})?\.flv/)) {
                // 未二压的链接格式
                console.debug('[bililive-seeker] caching raw stream url', baseurl);
                setStoredValue('playurl-' + playurl.cid, playurl);
            }
        } catch (e) {
            console.error('[bililive-seeker] Unexpected error when caching playurl:\n', e);
        }
    }

    const expiredPlayurlChecker = () => {
        listStoredKeys().filter(key => key.match(/^playurl-\d+$/)).forEach(key => {
            try {
                const expireTs = getStoredValue(key).stream[0].format[0].codec[0].url_info[0].extra.match(/expires=(\d+)/)[1];
                if (!(Date.now() / 1000 < Number(expireTs))) {
                    console.log('[bililive-seeker] remove expired playurl');
                    deleteStoredValue(key);
                }
            } catch (e) {
                console.warn('[bililive-seeker] Failed to validate cached playurl. Removing from cache.\n', e);
                deleteStoredValue(key);
            }
        });
        setTimeout(() => {
            const room_id = getRoomId();
            if (!getStoredValue('playurl-' + room_id)) {
                document.querySelector('#force-raw').style = 'filter: grayscale(1) brightness(1.5)';
            } else {
                document.querySelector('#force-raw').style = '';
            }
        }, 200);
    }
    window.checkPlayurlIntervalId = setInterval(() => { expiredPlayurlChecker() }, 600 * 1000);

    const interceptPlayurl = (r) => {
        const playurl = r.data?.playurl_info?.playurl;
        if (!playurl) return r;
        cachePlayUrl(playurl);
        console.debug('[bililive-seeker] got playinfo', r);
        if (!isChecked('force-raw', true)) return r;
        expiredPlayurlChecker();
        const cachedUrl = getStoredValue('playurl-' + playurl.cid);
        console.debug('[bililive-seeker] load cached url', cachedUrl);
        if (cachedUrl) r.data.playurl_info.playurl = cachedUrl;
        return r;
    }

    const replaceRoomplayReqUrl = (url) => {
        if (isChecked('auto-quality', true)) {
            url = url.replace(/qn=0\b/, 'qn=10000');
        }
        if (isChecked('force-flv', true)) {
            url = url.replace(/protocol=0,[^&]+/, 'protocol=0');
            url = url.replace(/codec=0,[^&]+/, 'codec=0');
        }
        if (getStoredValue('playurl-custom-endpoint')) {
            url = url.replace(/^\/\//, 'https://');
            url = url.replace('https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo', getStoredValue('playurl-custom-endpoint'));
            console.debug('[bililive-seeker] replacing API endpoint', url);
        }
        return url;
    }

    const hookFetch = () => {
        const origFetch = window.fetch;
        window.fetch = async function () {
            try {
                const resource = arguments[0];
                let url;
                if (resource instanceof Request) {
                    url = resource.url;
                } else {
                    url = resource
                }
                if (url.match('api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo')) {
                    url = replaceRoomplayReqUrl(url);
                    if (resource instanceof Request) {
                        arguments[0] = new Request(url, resource);
                    } else {
                        arguments[0] = url;
                    }
                    console.debug('[bililive-seeker] fetch request', arguments);
                    const response = await origFetch.apply(this, arguments);
                    const r = interceptPlayurl(await response.clone().json());
                    return new Response(JSON.stringify(r), response);
                } else if (url.match('api.live.bilibili.com/live/getRoundPlayVideo') && isChecked('block-roundplay', true)) {
                    console.debug('[bililive-seeker] block roundplay');
                    return new Response('{"code":0,"data":{"cid":-3}}');
                } else if (url === '//_test_hook_alive_dummy_url/') {
                    return new Response('success');
                }
            } catch (e) {
                console.error('[bililive-seeker] error from hooked fetch request\n', e);
            }
            return origFetch.apply(this, arguments);
        }
        console.debug('[bililive-seeker] `window.fetch` hooked');
    }
    hookFetch();
    const checkHookAlive = async () => {
        for (let i = 0; i < 50; i++) {
            await window.fetch('//_test_hook_alive_dummy_url/').catch(e => { hookFetch(); });
            await new Promise(r => setTimeout(r, 100));
        }
    }
    checkHookAlive();

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
        try {
            let url = arguments[1];
            if (url.match('api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo')) {
                url = replaceRoomplayReqUrl(url);
                arguments[1] = url;
            }
        } catch (e) {
            console.error('[bililive-seeker] error from hooked `xhr.open`\n', e);
        }
        return origOpen.apply(this, arguments);
    }

    try {
        const xhrAccessor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
        Object.defineProperty(XMLHttpRequest.prototype, 'responseText', {
            get: function () {
                try {
                    if (this.responseURL.match('api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo') || this.responseURL.match(getStoredValue('playurl-custom-endpoint') || null)) {
                        const rsp = JSON.parse(xhrAccessor.get.call(this));
                        cacheRoomInit(rsp);
                        return JSON.stringify(interceptPlayurl(rsp));
                    }
                } catch (e) {
                    console.error('[bililive-seeker] error from hooked xhr.responseText\n', e);
                }
                return xhrAccessor.get.call(this);
            },
            set: function (str) {
                return xhrAccessor.set.call(this, str);
            },
            configurable: true
        });
    } catch (e) {
        console.error('[bililive-seeker] Falied to hook `XMLHttpRequest.responseText`, possibly due to effect of another script. auto-quality and force-flv may not work as intended:\n', e);
    }

    try {
        Object.defineProperty(window, '__NEPTUNE_IS_MY_WAIFU__', {
            get: function () { return this._init_data_neptune },
            set: function (newdata) {
                if (newdata.roomInitRes.data?.playurl_info?.playurl?.stream) {
                    let playurl = newdata.roomInitRes.data.playurl_info.playurl;
                    if (getStoredValue('auto-quality')) {
                        if (playurl.stream[0].format[0].codec[0].current_qn < 10000) {
                            playurl = getPlayUrl(newdata.roomInitRes.data.room_id) || playurl;
                            newdata.roomInitRes.data.playurl_info.playurl = playurl;
                        }
                    }
                    if (getStoredValue('force-flv')) {
                        const filteredStream = playurl.stream.filter(i => i.protocol_name !== "http_hls");
                        if (filteredStream.length) playurl.stream = filteredStream;
                        playurl.stream.forEach(i => {
                            i.format.forEach(j => {
                                const filteredCodec = j.codec.filter(k => k.codec_name !== "hevc");
                                if (filteredCodec.length) j.codec = filteredCodec;
                            })
                        });
                    }
                }
                if (newdata.roomInitRes) {
                    newdata.roomInitRes = interceptPlayurl(newdata.roomInitRes);
                }
                this._init_data_neptune = newdata;
                console.debug('[bililive-seeker] init data', newdata);
            },
            configurable: true,
        });
    } catch (e) {
        console.error('[bililive-seeker] Falied to hook `__NEPTUNE_IS_MY_WAIFU__`, possibly due to effect of another script. auto-quality and force-flv may not work as intended:\n', e);
    }


    // ----------------------- 选项UI -----------------------

    window.saveConfig = () => {
        console.debug('[bililive-seeker] config changed');
        Array.prototype.slice.call(document.querySelectorAll('#seeker-control-panel input[type=checkbox]')).forEach(e => {
            setStoredValue(e.id, Boolean(e.checked));
        });
        Array.prototype.slice.call(document.querySelectorAll('#seeker-control-panel input[type=number]')).forEach(e => {
            setStoredValue(e.id, Number(e.value));
        });
    }
    window.copyPlayurl = () => {
        const room_id = getRoomId();
        if (!room_id) return;
        const value = JSON.stringify(getStoredValue('playurl-' + room_id));
        const e = document.querySelector('#copy-playurl');
        if (!value) {
            e.innerText = '无原画';
        } else {
            navigator.clipboard.writeText(value);
            e.innerText = '已复制';
        }
        setTimeout(() => { e.innerText = '复制推流链接' }, 1000);
    }
    window.setPlayurl = () => {
        const value = prompt("请输入playurl json字符串或带query string的完整flv网址\n如出错请取消勾选强制原画；留空点击确定清除当前直播间设置");
        if (value === null) return;
        const room_id = getRoomId();
        if (value === "") {
            deleteStoredValue('playurl-' + room_id);
            expiredPlayurlChecker();
        } else {
            try {
                let data;
                if (value.match(/^(https:\/\/[^\/]+)(\/live-bvc\/\d+\/live_[^\/]+flv\?)(expires=\d+.*)/)) {
                    const m = value.match(/^(https:\/\/[^\/]+)(\/live-bvc\/\d+\/live_[^\/]+flv\?)(expires=\d+.*)/);
                    data = getPlayUrl(getRoomId());
                    data.stream.forEach(i => {
                        i.format.forEach(j => {
                            j.codec.forEach(k => {
                                k.base_url = m[2];
                                k.url_info.forEach(u => {
                                    u.extra = m[3];
                                    u.host = m[1];
                                })
                                k.url_info = [k.url_info[0]];
                            })
                        })
                    });
                    console.debug('[bililive-seeker] parsed stream url to playurl', data);
                } else {
                    console.debug('[bililive-seeker] parsing playurl as json', value);
                    data = JSON.parse(value);
                }
                if (data.cid !== room_id) {
                    if (!confirm("json的房间号" + data.cid + "可能不符，是否依然为当前房间" + room_id + "设置？")) return
                }
                setStoredValue('playurl-' + room_id, data);
                expiredPlayurlChecker();
            } catch (e) {
                alert('json字符串/flv链接解析失败\n' + e);
                console.error(e);
            }
        }
    }
    window.setEndpoint = () => {
        const url = getStoredValue('playurl-custom-endpoint') || "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo";
        const value = prompt("请输入获取playurl所用的自定义API endpoint，用以替换默认的`https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo`\n如出错请留空点击确定恢复默认API", url);
        if (value === null || value === url) return;
        if (value === "") {
            deleteStoredValue('playurl-custom-endpoint');
        } else {
            setStoredValue('playurl-custom-endpoint', value);
        }
    }
    window.setSpeedUpThres = () => {
        const storedThres = JSON.stringify(getStoredValue('speedup-thres'));
        const value = prompt("请输入想要设定的追帧加速阈值\nJSON格式为[[缓冲长度阈值(秒), 播放速率],...]\n留空点击确定以恢复默认值", storedThres);
        if (value === null || value === storedThres) return;
        if (value === "") {
            deleteStoredValue('speedup-thres');
        } else {
            try {
                const newThres = JSON.parse(value);
                setStoredValue('speedup-thres', newThres);
            } catch (e) {
                alert("设置失败\n" + e);
                console.error(e);
            }
        }
    }
    window.setSlowdownThres = () => {
        const storedThres = JSON.stringify(getStoredValue('speeddown-thres'));
        const value = prompt("请输入想要设定的自动减速阈值\nJSON格式为[[缓冲长度阈值(秒), 播放速率],...]\n留空点击确定以恢复默认值", storedThres);
        if (value === null || value === storedThres) return;
        if (value === "") {
            deleteStoredValue('speeddown-thres');
        } else {
            try {
                const newThres = JSON.parse(value);
                setStoredValue('speeddown-thres', newThres);
            } catch (e) {
                alert("设置失败\n" + e);
                console.error(e);
            }
        }
    }

    const waitForElement = (checker, exec, timeout) => {
        const node = checker();
        if (node) {
            exec(node);
        } else {
            if (timeout !== undefined) {
                timeout -= 100;
                if (timeout > 0) setTimeout(() => waitForElement(checker, exec, timeout), 100);
            } else {
                setTimeout(() => waitForElement(checker, exec), 100);
            }
        }
    }

    const waitForQuery = (query, exec, timeout) => {
        waitForElement(() => document.querySelector(query), exec, timeout)
    }

    waitForQuery('#head-info-vm .lower-row', (node) => {
        const e = document.createElement("span");
        e.innerHTML = (
            '<span id="basic-settings-page">' +
            '  <span title="重新从当前的位置开始播放直播来重置音视频的同步，以应对音视频的不同步  &#13;&#10;重置时会有一瞬的卡顿  &#13;&#10;勾选后自动每隔一段时间执行一次重置，重置间隔可以在高级选项中设置">' +
            '<button id="reset-AV-sync" type="button" onclick="AVResync()" style="width:7em">重置音画同步</button><input type="checkbox" id="auto-AV-sync">' +
            '  </span><span title="隐藏播放器右键菜单中的“视频统计信息”悬浮窗  &#13;&#10;悬浮窗未开启时会自动取消勾选">' +
            '<label for="hide-stats">隐藏统计</label><input type="checkbox" id="hide-stats">' +
            '  </span><span title="当检测到播放器暂停，且缓冲长度超过“追帧秒数”时，自动恢复播放器播放">' +
            '<label for="prevent-pause">避免暂停</label><input type="checkbox" id="prevent-pause" onchange="saveConfig()">' +
            '  </span><span title="直播状态下，检测到错误时自动刷新页面  &#13;&#10;或在下播状态下，弹幕服务器疑似断连时，自动刷新页面  &#13;&#10;刷新页面前文字会变为橙色">' +
            '<label for="auto-reload">自动刷新</label><input type="checkbox" id="auto-reload" onchange="saveConfig()">' +
            '  </span>' +
            '<br>' +
            '  <span title="尝试去除视频流中的HEVC(“PRO”画质)和HLS流，让播放器优先使用FLV协议的AVC流，以降低延迟">' +
            '<label for="force-flv">强制avc+flv</label><input type="checkbox" id="force-flv" onchange="saveConfig()">' +
            '  </span><span title="当获取的直播视频流为延迟更高的二压视频时，尝试替换为保存的原画流，以降低延迟  &#13;&#10;当前直播间没有保存原画流/原画流已过期时，选择框为灰色  &#13;&#10;主播网络卡顿/重开推流后可能出现一直重复最后几秒的情况，需取消该选项后切换一次画质或刷新">' +
            '<label for="force-raw">强制原画</label><input type="checkbox" id="force-raw" onchange="saveConfig()">' +
            '  </span><span title="进入直播间时自动切换右下角的“原画”画质。和手动切换效果相同">' +
            '<label for="auto-quality">自动原画</label><input type="checkbox" id="auto-quality" onchange="saveConfig()">' +
            '  </span><span title="阻止直播间进行轮播">' +
            '<label for="block-roundplay">阻止轮播</label><input type="checkbox" id="block-roundplay" onchange="saveConfig()">' +
            '  </span>' +
            '<br>' +
            '  <span title="跳转至非活动页面的常规直播间">' +
            '<a id="go-to-blanc-room" style="display: none; text-align: center; width: 7.5em" target="_parent">转至常规直播间</a>' +
            '  </span>' +
            '<button id="go-to-adv-settings" type="button" style="width: 7em">转到高级选项</button>' +
            '  <span title="本地播放器追帧的目标缓冲长度，单位为秒（播放器缓冲的长度1：1等于播放器产生的延迟）  &#13;&#10;过小容易导致卡顿甚至丢失原画的连接  &#13;&#10;需根据自己的网络情况选择合适的值  &#13;&#10;可在高级选项中关闭追帧">' +
            '<label for="buffer-threshold">追帧秒数</label><input type="number" id="buffer-threshold" onchange="saveConfig()" step="0.1" style="width: 3em;">' +
            '  </span>' +
            '</span>' +

            '<span id="adv-settings-page" style="display:none">' +
            '  <span title="复制当前直播间保存的原画流链接到剪贴板，可用于“设置连接”">' +
            '<button id="copy-playurl" type="button" style="width: 7em" onclick="copyPlayurl()">复制推流链接</button>' +
            '  </span><span title="手动设置当前直播间保存的原画流链接，用于“强制原画”选项让播放器加载延迟更低的原画流  &#13;&#10;错误的配置可能导致无法正常观看直播！">' +
            '<button id="set-playurl" type="button" onclick="setPlayurl()">设置链接!</button>' +
            '  </span><span title="设置获取视频流链接的API，详见说明中的链接  &#13;&#10;使用后可能无法观看各种限定直播！  &#13;&#10;错误的配置可能导致无法正常观看直播！">' +
            '<button id="set-endpoint" type="button" style="width: 8em" onclick="setEndpoint()">设置视频流API !</button>' +
            '  </span>' +
            '<br>' +
            '  <span title="设置缓冲时长超过追帧秒数时，缓冲长度和追帧秒数的差值的各级阶梯阈值，以及各级阶梯要加快到的播放速度  &#13;&#10;错误的配置可能导致播放不正常！">' +
            '<button id="set-speedup-thres" type="button" style="width: 7.5em" onclick="setSpeedUpThres()">设置加速阈值!</button>' +
            '  </span><span title="取消勾选后将不会在缓冲时长超过追帧秒数时自动加速追帧">' +
            '<label for="auto-speedup">追帧加速</label><input type="checkbox" id="auto-speedup" onchange="saveConfig()">' +
            '  </span>' +
            '  <span title="设置缓冲时长极低时，降低播放速度的各级阶梯的缓冲时长阈值，以及各级阶梯要降低到的播放速度  &#13;&#10;错误的配置可能导致播放不正常！">' +
            '<button id="set-slowdown-thres" type="button" style="width: 7.5em" onclick="setSlowdownThres()">设置减速阈值!</button>' +
            '  </span><span title="取消勾选后将不会在缓冲时长降低至减速阈值后自动降低播放速度">' +
            '<label for="auto-slowdown">自动减速</label><input type="checkbox" id="auto-slowdown" onchange="saveConfig()">' +
            '  </span>' +
            '<br>' +
            '<button id="go-to-basic-settings" type="button" style="width: 7em">转到基础选项</button>' +
            '  <span title="重置音画同步时，重新开始位置相对现在的秒数  &#13;&#10;合适的值可以减轻重置时的卡顿感">' +
            '<label for="AV-resync-step">音画同步重置步进</label><input type="number" id="AV-resync-step" onchange="saveConfig()" step="0.01" style="width: 3.5em;">' +
            '  </span><span title="勾选“重置音画同步”后，自动进行音画同步重置的间隔时长，单位为秒">' +
            '<label for="AV-resync-interval">间隔</label><input type="number" id="AV-resync-interval" onchange="saveConfig()" step="1" style="width: 3.5em;">' +
            '  </span>' +
            '</span>' +

            '<style>#seeker-control-panel button, #seeker-control-panel a { width:5.5em;padding:1px;background: transparent; border: 1.5px solid #999; border-radius: 4px; color: #999; filter: contrast(0.6);}' +
            '#seeker-control-panel input[type="number"] { border: 1.5px solid #999; border-radius: 2px; }'+
            '#seeker-control-panel button:hover, #seeker-control-panel a:hover { filter: none; } #seeker-control-panel button:active { filter: none; transform: translate(0.3px, 0.3px); }' +
            '#seeker-control-panel label { pointer-events: none; margin:1px 2px; color: #999; filter: contrast(0.6);} #seeker-control-panel input { vertical-align: middle; margin:1px; }' +
            '#seeker-control-panel label.danmaku-lost, #seeker-control-panel label.live-on, #seeker-control-panel label.video-error, #seeker-control-panel label.reload { color: orange!important; filter: none; }</style>'
        );
        e.style = 'text-align: right; flex: 0 0 fit-content; margin-left: 5px; margin-top: -5px;';
        e.id = 'seeker-control-panel';
        node.appendChild(e);

        const updateInfoPanelStyle = (node) => {
            const infoPanel = document.querySelector('.web-player-video-info-panel');
            if (!infoPanel) {
                node.checked = false;
                return;
            }
            if (node.checked) {
                if (infoPanel.style.display === 'none') {
                    infoPanel.style.opacity = '';
                    node.checked = false;
                    return;
                } else {
                    Array.prototype.filter.call(infoPanel.querySelectorAll('div'), i => i.innerText === '[x]').forEach(i => { i.style.display = 'none'; });
                    infoPanel.style.opacity = '0';
                    infoPanel.style.userSelect = 'none';
                }
            } else {
                infoPanel.style.userSelect = 'text';
                infoPanel.style.opacity = '';
                Array.prototype.filter.call(infoPanel.querySelectorAll('div'), i => i.innerText === '[x]').forEach(i => { i.style.display = ''; });
            }
        }
        const updateThresInputStyle = (node) => {
            if (!node.checked) {
                document.querySelector('label[for="buffer-threshold"]').style.textDecoration = 'line-through black solid 2px';
                document.querySelector('#buffer-threshold').style.background = '#feee';
            } else {
                document.querySelector('label[for="buffer-threshold"]').style.textDecoration = '';
                document.querySelector('#buffer-threshold').style.background = '';
            }
        }

        document.querySelector('#hide-stats').onchange = (e) => {
            window.saveConfig();
            updateInfoPanelStyle(e.target);
        }

        if (window.self !== window.top) {
            document.querySelector('#go-to-blanc-room').style.display = "inline-block";
            document.querySelector('#go-to-blanc-room').href = location.href;
        }

        document.querySelector('#go-to-adv-settings').onclick = (e) => {
            document.querySelector('#basic-settings-page').style.display = "none";
            document.querySelector('#adv-settings-page').style.display = "";
        }

        document.querySelector('#go-to-basic-settings').onclick = (e) => {
            document.querySelector('#basic-settings-page').style.display = "";
            document.querySelector('#adv-settings-page').style.display = "none";
        }

        document.querySelector('#auto-AV-sync').onchange = (e) => {
            window.saveConfig();
            if (e.target.checked) {
                startAutoResync();
            } else {
                stopAutoResync();
            }
        }
        document.querySelector('#AV-resync-interval').onchange = (e) => {
            window.saveConfig();
            if (getValue('auto-AV-sync', true)) startAutoResync();
        }

        document.querySelector('#auto-speedup').onchange = (e) => {
            window.saveConfig();
            updateThresInputStyle(e.target);
        }

        Array.prototype.slice.call(document.querySelectorAll('#seeker-control-panel label, #seeker-control-panel button, #seeker-control-panel a')).forEach(e => {
            e.className += ' live-skin-normal-a-text';
        })

        Array.prototype.slice.call(document.querySelectorAll('#seeker-control-panel input[type=checkbox]')).forEach(e => {
            if (e.id === "hide-stats" || e.id === 'auto-AV-sync') return (getStoredValue(e.id) && setTimeout(() => { e.click() }, 100));
            e.checked = getStoredValue(e.id);
            if (e.id === 'auto-speedup') updateThresInputStyle(e);
        })
        Array.prototype.slice.call(document.querySelectorAll('#seeker-control-panel input[type=number]')).forEach(e => {
            e.value = getStoredValue(e.id);
        })
        expiredPlayurlChecker();
    })

    waitForQuery('#head-info-vm .lower-row .right-ctnr', node => {
        const getBottom = (e) => { const rect = e.getBoundingClientRect(); return rect.y + rect.height; }
        const getTop = (e) => { const rect = e.getBoundingClientRect(); return rect.y }
        const observer = new ResizeObserver((entries) => {
            if (node.children.length <= 1) return;
            if (getTop(node.children[node.children.length - 1]) >= getBottom(node.children[0])) {
                node.style.marginTop = '-20px';
                node.style.alignItems = 'flex-end';
                waitForQuery('#playback-rate-username', node => { node.style.display = 'none'; }, 100);
                waitForQuery('#playback-rate-title', node => { node.style.display = ''; }, 100);
            } else {
                node.style.marginTop = '';
                node.style.alignItems = '';
                waitForQuery('#playback-rate-username', node => { node.style.display = ''; }, 100);
                waitForQuery('#playback-rate-title', node => { node.style.display = 'none'; }, 100);
            }
        });
        observer.observe(node);
    });

    const updatePanelHideState = () => {
        if (getStoredValue('hide-seeker-control-panel')) {
            waitForQuery('#seeker-control-panel', node => { node.style.display = 'none'; });
            waitForQuery('#control-panel-showhide span', node => { node.innerText = '显示追帧'; });
            waitForQuery('#head-info-vm .upper-row .right-ctnr', node => { node.style.marginTop = ''; });
            waitForQuery('#head-info-vm .lower-row', node => { node.style.marginTop = ''; });
            waitForQuery('#head-info-vm .lower-row .right-ctnr', node => { node.style.flex = ''; node.style.flexWrap = ''; node.style.placeContent = ''; node.style.rowGap = ''; });

            waitForQuery('#head-info-vm .lower-row .pk-act-left-distance', node => { node.style.maxWidth = ''; }, 15000);
            waitForQuery('#head-info-vm .lower-row .act-left-distance', node => { node.style.maxWidth = ''; }, 15000);
            waitForQuery('#head-info-vm .lower-row .gift-planet-entry', node => { node.style.marginLeft = ''; }, 15000);
        } else {
            waitForQuery('#seeker-control-panel', node => { node.style.display = ''; });
            waitForQuery('#control-panel-showhide span', node => { node.innerText = '隐藏追帧'; });
            waitForQuery('#head-info-vm .upper-row .right-ctnr', node => { node.style.marginTop = '-7px'; });
            waitForQuery('#head-info-vm .lower-row', node => { node.style.marginTop = '0px'; });
            waitForQuery('#head-info-vm .lower-row .right-ctnr', node => { node.style.flex = '100 1 auto'; node.style.flexWrap = 'wrap'; node.style.placeContent = 'space-around center'; node.style.rowGap = '5px'; });

            waitForQuery('#head-info-vm .lower-row .pk-act-left-distance', node => { node.style.maxWidth = '3px'; }, 15000);
            waitForQuery('#head-info-vm .lower-row .act-left-distance', node => { node.style.maxWidth = '3px'; }, 15000);
            waitForQuery('#head-info-vm .lower-row .gift-planet-entry', node => { node.style.marginLeft = '5px'; }, 15000);
        }
    }

    waitForQuery('#head-info-vm .upper-row .right-ctnr', node => {
        const e = document.createElement("div");
        e.id = 'control-panel-showhide';
        e.className = "icon-ctnr live-skin-normal-a-text pointer";
        e.innerHTML = '<i class="v-middle icon-font icon-danmu-a" style="margin-left:16px; font-size:16px;"></i><span class="action-text v-middle" style="margin-left:8px; font-size:12px;"></span>';
        e.onclick = () => {
            setStoredValue('hide-seeker-control-panel', !getStoredValue('hide-seeker-control-panel'));
            updatePanelHideState();
        }
        node.appendChild(e);
        updatePanelHideState();
    })


})();

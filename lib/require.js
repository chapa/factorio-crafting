/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.22 Copyright (c) 2010-2015, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.22',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value === 'object' && value &&
                        !isArray(value) && !isFunction(value) &&
                        !(value instanceof RegExp)) {

                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that is expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite an existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                bundles: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            bundlesMap = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; i < ary.length; i++) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    // If at the start, or previous value is still ..,
                    // keep them so that when converted to a path it may
                    // still work when converted to a path, even though
                    // as an ID it is less than ideal. In larger point
                    // releases, may be better to just kick out an error.
                    if (i === 0 || (i === 1 && ary[2] === '..') || ary[i - 1] === '..') {
                        continue;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgMain, mapValue, nameParts, i, j, nameSegment, lastIndex,
                foundMap, foundI, foundStarMap, starI, normalizedBaseParts,
                baseParts = (baseName && baseName.split('/')),
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // If wanting node ID compatibility, strip .js from end
                // of IDs. Have to do this here, and not in nameToUrl
                // because node allows either .js or non .js to map
                // to same file.
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                // Starts with a '.' so need the baseName
                if (name[0].charAt(0) === '.' && baseParts) {
                    //Convert baseName to array, and lop off the last part,
                    //so that . matches that 'directory' and not name of the baseName's
                    //module. For instance, baseName of 'one/two/three', maps to
                    //'one/two/three.js', but we want the directory, 'one/two' for
                    //this normalization.
                    normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    name = normalizedBaseParts.concat(name);
                }

                trimDots(name);
                name = name.join('/');
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                outerLoop: for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break outerLoop;
                                }
                            }
                        }
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            // If the name points to a package's name, use
            // the package main instead.
            pkgMain = getOwn(config.pkgs, name);

            return pkgMain ? pkgMain : name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);

                //Custom require that does not do map translation, since
                //ID is "absolute", already mapped/resolved.
                context.makeRequire(null, {
                    skipMap: true
                })([id]);

                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        // If nested plugin references, then do not try to
                        // normalize, as it will not normalize correctly. This
                        // places a restriction on resourceIds, and the longer
                        // term solution is not to normalize until plugins are
                        // loaded and all normalizations to allow for async
                        // loading of a loader plugin. But for now, fixes the
                        // common uses. Details in #1131
                        normalizedName = name.indexOf('!') === -1 ?
                                         normalize(name, parentName, applyMap) :
                                         name;
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                each(globalDefQueue, function(queueItem) {
                    var id = queueItem[0];
                    if (typeof id === 'string') {
                        context.defQueueMap[id] = true;
                    }
                    defQueue.push(queueItem);
                });
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return (defined[mod.map.id] = mod.exports);
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            return getOwn(config.config, mod.map.id) || {};
                        },
                        exports: mod.exports || (mod.exports = {})
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                var map = mod.map,
                    modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    // Only fetch if not already in the defQueue.
                    if (!hasProp(context.defQueueMap, id)) {
                        this.fetch();
                    }
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            try {
                                exports = context.execCb(id, factory, depExports, exports);
                            } catch (e) {
                                err = e;
                            }

                            // Favor return value over exports. If node/cjs in play,
                            // then will not have a return value anyway. Favor
                            // module.exports assignment over exports object.
                            if (this.map.isDefine && exports === undefined) {
                                cjsModule = this.module;
                                if (cjsModule) {
                                    exports = cjsModule.exports;
                                } else if (this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                // If there is an error listener, favor passing
                                // to that instead of throwing an error. However,
                                // only do it for define()'d  modules. require
                                // errbacks should not be called for failures in
                                // their callbacks (#699). However if a global
                                // onError is set, use that.
                                if ((this.events.error && this.map.isDefine) ||
                                    req.onError !== defaultOnError) {
                                    err.requireMap = this.map;
                                    err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                    err.requireType = this.map.isDefine ? 'define' : 'require';
                                    return onError((this.error = err));
                                } else if (typeof console !== 'undefined' &&
                                           console.error) {
                                    // Log the error for debugging. If promises could be
                                    // used, this would be different, but making do.
                                    console.error(err);
                                } else {
                                    // Do not want to completely lose the error. While this
                                    // will mess up processing and lead to similar results
                                    // as bug 1440, it at least surfaces the error.
                                    req.onError(err);
                                }
                            }
                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                var resLoadMaps = [];
                                each(this.depMaps, function (depMap) {
                                    resLoadMaps.push(depMap.normalizedMap || depMap);
                                });
                                req.onResourceLoad(context, this.map, resLoadMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        bundleId = getOwn(bundlesMap, this.map.id),
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.map.normalizedMap = normalizedMap;
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    //If a paths config, then just load that file instead to
                    //resolve the plugin, as it is built into that paths layer.
                    if (bundleId) {
                        this.map.url = context.nameToUrl(bundleId);
                        this.load();
                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            if (this.undefed) {
                                return;
                            }
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        } else if (this.events.error) {
                            // No direct errback on this module, but something
                            // else is listening for errors, so be sure to
                            // propagate the error correctly.
                            on(depMap, 'error', bind(this, function(err) {
                                this.emit('error', err);
                            }));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' +
                        args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
            context.defQueueMap = {};
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            defQueueMap: {},
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths since they require special processing,
                //they are additive.
                var shim = config.shim,
                    objs = {
                        paths: true,
                        bundles: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (!config[prop]) {
                            config[prop] = {};
                        }
                        mixin(config[prop], value, true, true);
                    } else {
                        config[prop] = value;
                    }
                });

                //Reverse map the bundles
                if (cfg.bundles) {
                    eachProp(cfg.bundles, function (value, prop) {
                        each(value, function (v) {
                            if (v !== prop) {
                                bundlesMap[v] = prop;
                            }
                        });
                    });
                }

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location, name;

                        pkgObj = typeof pkgObj === 'string' ? {name: pkgObj} : pkgObj;

                        name = pkgObj.name;
                        location = pkgObj.location;
                        if (location) {
                            config.paths[name] = pkgObj.location;
                        }

                        //Save pointer to main module ID for pkg name.
                        //Remove leading dot in main, so main paths are normalized,
                        //and remove any trailing .js, since different package
                        //envs have different conventions: some use a module name,
                        //some use a file name.
                        config.pkgs[name] = pkgObj.name + '/' + (pkgObj.main || 'main')
                                     .replace(currDirRegExp, '')
                                     .replace(jsSuffixRegExp, '');
                    });
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id, null, true);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        mod.undefed = true;
                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        //Clean queued defines too. Go backwards
                        //in array so that the splices do not
                        //mess up the iteration.
                        eachReverse(defQueue, function(args, i) {
                            if (args[0] === id) {
                                defQueue.splice(i, 1);
                            }
                        });
                        delete context.defQueueMap[id];

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overridden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }
                context.defQueueMap = {};

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, syms, i, parentModule, url,
                    parentPath, bundleId,
                    pkgMain = getOwn(config.pkgs, moduleName);

                if (pkgMain) {
                    moduleName = pkgMain;
                }

                bundleId = getOwn(bundlesMap, moduleName);

                if (bundleId) {
                    return context.nameToUrl(bundleId, ext, skipExt);
                }

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');

                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    var parents = [];
                    eachProp(registry, function(value, key) {
                        if (key.indexOf('_@r') !== 0) {
                            each(value.depMaps, function(depMap) {
                                if (depMap.id === data.id) {
                                    parents.push(key);
                                }
                                return true;
                            });
                        }
                    });
                    return onError(makeError('scripterror', 'Script error for "' + data.id +
                                             (parents.length ?
                                             '", needed by: ' + parents.join(', ') :
                                             '"'), evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);
            if (config.onNodeCreated) {
                config.onNodeCreated(node, config, moduleName, url);
            }

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation is that a build has been done so
                //that only one script needs to be loaded anyway. This may need
                //to be reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        if (context) {
            context.defQueue.push([name, deps, callback]);
            context.defQueueMap[name] = true;
        } else {
            globalDefQueue.push([name, deps, callback]);
        }
    };

    define.amd = {
        jQuery: true
    };

    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiIiwic291cmNlcyI6WyJyZXF1aXJlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKiB2aW06IGV0OnRzPTQ6c3c9NDpzdHM9NFxuICogQGxpY2Vuc2UgUmVxdWlyZUpTIDIuMS4yMiBDb3B5cmlnaHQgKGMpIDIwMTAtMjAxNSwgVGhlIERvam8gRm91bmRhdGlvbiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICogQXZhaWxhYmxlIHZpYSB0aGUgTUlUIG9yIG5ldyBCU0QgbGljZW5zZS5cbiAqIHNlZTogaHR0cDovL2dpdGh1Yi5jb20vanJidXJrZS9yZXF1aXJlanMgZm9yIGRldGFpbHNcbiAqL1xuLy9Ob3QgdXNpbmcgc3RyaWN0OiB1bmV2ZW4gc3RyaWN0IHN1cHBvcnQgaW4gYnJvd3NlcnMsICMzOTIsIGFuZCBjYXVzZXNcbi8vcHJvYmxlbXMgd2l0aCByZXF1aXJlanMuZXhlYygpL3RyYW5zcGlsZXIgcGx1Z2lucyB0aGF0IG1heSBub3QgYmUgc3RyaWN0LlxuLypqc2xpbnQgcmVnZXhwOiB0cnVlLCBub21lbjogdHJ1ZSwgc2xvcHB5OiB0cnVlICovXG4vKmdsb2JhbCB3aW5kb3csIG5hdmlnYXRvciwgZG9jdW1lbnQsIGltcG9ydFNjcmlwdHMsIHNldFRpbWVvdXQsIG9wZXJhICovXG5cbnZhciByZXF1aXJlanMsIHJlcXVpcmUsIGRlZmluZTtcbihmdW5jdGlvbiAoZ2xvYmFsKSB7XG4gICAgdmFyIHJlcSwgcywgaGVhZCwgYmFzZUVsZW1lbnQsIGRhdGFNYWluLCBzcmMsXG4gICAgICAgIGludGVyYWN0aXZlU2NyaXB0LCBjdXJyZW50bHlBZGRpbmdTY3JpcHQsIG1haW5TY3JpcHQsIHN1YlBhdGgsXG4gICAgICAgIHZlcnNpb24gPSAnMi4xLjIyJyxcbiAgICAgICAgY29tbWVudFJlZ0V4cCA9IC8oXFwvXFwqKFtcXHNcXFNdKj8pXFwqXFwvfChbXjpdfF4pXFwvXFwvKC4qKSQpL21nLFxuICAgICAgICBjanNSZXF1aXJlUmVnRXhwID0gL1teLl1cXHMqcmVxdWlyZVxccypcXChcXHMqW1wiJ10oW14nXCJcXHNdKylbXCInXVxccypcXCkvZyxcbiAgICAgICAganNTdWZmaXhSZWdFeHAgPSAvXFwuanMkLyxcbiAgICAgICAgY3VyckRpclJlZ0V4cCA9IC9eXFwuXFwvLyxcbiAgICAgICAgb3AgPSBPYmplY3QucHJvdG90eXBlLFxuICAgICAgICBvc3RyaW5nID0gb3AudG9TdHJpbmcsXG4gICAgICAgIGhhc093biA9IG9wLmhhc093blByb3BlcnR5LFxuICAgICAgICBhcCA9IEFycmF5LnByb3RvdHlwZSxcbiAgICAgICAgaXNCcm93c2VyID0gISEodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIG5hdmlnYXRvciAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LmRvY3VtZW50KSxcbiAgICAgICAgaXNXZWJXb3JrZXIgPSAhaXNCcm93c2VyICYmIHR5cGVvZiBpbXBvcnRTY3JpcHRzICE9PSAndW5kZWZpbmVkJyxcbiAgICAgICAgLy9QUzMgaW5kaWNhdGVzIGxvYWRlZCBhbmQgY29tcGxldGUsIGJ1dCBuZWVkIHRvIHdhaXQgZm9yIGNvbXBsZXRlXG4gICAgICAgIC8vc3BlY2lmaWNhbGx5LiBTZXF1ZW5jZSBpcyAnbG9hZGluZycsICdsb2FkZWQnLCBleGVjdXRpb24sXG4gICAgICAgIC8vIHRoZW4gJ2NvbXBsZXRlJy4gVGhlIFVBIGNoZWNrIGlzIHVuZm9ydHVuYXRlLCBidXQgbm90IHN1cmUgaG93XG4gICAgICAgIC8vdG8gZmVhdHVyZSB0ZXN0IHcvbyBjYXVzaW5nIHBlcmYgaXNzdWVzLlxuICAgICAgICByZWFkeVJlZ0V4cCA9IGlzQnJvd3NlciAmJiBuYXZpZ2F0b3IucGxhdGZvcm0gPT09ICdQTEFZU1RBVElPTiAzJyA/XG4gICAgICAgICAgICAgICAgICAgICAgL15jb21wbGV0ZSQvIDogL14oY29tcGxldGV8bG9hZGVkKSQvLFxuICAgICAgICBkZWZDb250ZXh0TmFtZSA9ICdfJyxcbiAgICAgICAgLy9PaCB0aGUgdHJhZ2VkeSwgZGV0ZWN0aW5nIG9wZXJhLiBTZWUgdGhlIHVzYWdlIG9mIGlzT3BlcmEgZm9yIHJlYXNvbi5cbiAgICAgICAgaXNPcGVyYSA9IHR5cGVvZiBvcGVyYSAhPT0gJ3VuZGVmaW5lZCcgJiYgb3BlcmEudG9TdHJpbmcoKSA9PT0gJ1tvYmplY3QgT3BlcmFdJyxcbiAgICAgICAgY29udGV4dHMgPSB7fSxcbiAgICAgICAgY2ZnID0ge30sXG4gICAgICAgIGdsb2JhbERlZlF1ZXVlID0gW10sXG4gICAgICAgIHVzZUludGVyYWN0aXZlID0gZmFsc2U7XG5cbiAgICBmdW5jdGlvbiBpc0Z1bmN0aW9uKGl0KSB7XG4gICAgICAgIHJldHVybiBvc3RyaW5nLmNhbGwoaXQpID09PSAnW29iamVjdCBGdW5jdGlvbl0nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzQXJyYXkoaXQpIHtcbiAgICAgICAgcmV0dXJuIG9zdHJpbmcuY2FsbChpdCkgPT09ICdbb2JqZWN0IEFycmF5XSc7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSGVscGVyIGZ1bmN0aW9uIGZvciBpdGVyYXRpbmcgb3ZlciBhbiBhcnJheS4gSWYgdGhlIGZ1bmMgcmV0dXJuc1xuICAgICAqIGEgdHJ1ZSB2YWx1ZSwgaXQgd2lsbCBicmVhayBvdXQgb2YgdGhlIGxvb3AuXG4gICAgICovXG4gICAgZnVuY3Rpb24gZWFjaChhcnksIGZ1bmMpIHtcbiAgICAgICAgaWYgKGFyeSkge1xuICAgICAgICAgICAgdmFyIGk7XG4gICAgICAgICAgICBmb3IgKGkgPSAwOyBpIDwgYXJ5Lmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgaWYgKGFyeVtpXSAmJiBmdW5jKGFyeVtpXSwgaSwgYXJ5KSkge1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBIZWxwZXIgZnVuY3Rpb24gZm9yIGl0ZXJhdGluZyBvdmVyIGFuIGFycmF5IGJhY2t3YXJkcy4gSWYgdGhlIGZ1bmNcbiAgICAgKiByZXR1cm5zIGEgdHJ1ZSB2YWx1ZSwgaXQgd2lsbCBicmVhayBvdXQgb2YgdGhlIGxvb3AuXG4gICAgICovXG4gICAgZnVuY3Rpb24gZWFjaFJldmVyc2UoYXJ5LCBmdW5jKSB7XG4gICAgICAgIGlmIChhcnkpIHtcbiAgICAgICAgICAgIHZhciBpO1xuICAgICAgICAgICAgZm9yIChpID0gYXJ5Lmxlbmd0aCAtIDE7IGkgPiAtMTsgaSAtPSAxKSB7XG4gICAgICAgICAgICAgICAgaWYgKGFyeVtpXSAmJiBmdW5jKGFyeVtpXSwgaSwgYXJ5KSkge1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBoYXNQcm9wKG9iaiwgcHJvcCkge1xuICAgICAgICByZXR1cm4gaGFzT3duLmNhbGwob2JqLCBwcm9wKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBnZXRPd24ob2JqLCBwcm9wKSB7XG4gICAgICAgIHJldHVybiBoYXNQcm9wKG9iaiwgcHJvcCkgJiYgb2JqW3Byb3BdO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEN5Y2xlcyBvdmVyIHByb3BlcnRpZXMgaW4gYW4gb2JqZWN0IGFuZCBjYWxscyBhIGZ1bmN0aW9uIGZvciBlYWNoXG4gICAgICogcHJvcGVydHkgdmFsdWUuIElmIHRoZSBmdW5jdGlvbiByZXR1cm5zIGEgdHJ1dGh5IHZhbHVlLCB0aGVuIHRoZVxuICAgICAqIGl0ZXJhdGlvbiBpcyBzdG9wcGVkLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uIGVhY2hQcm9wKG9iaiwgZnVuYykge1xuICAgICAgICB2YXIgcHJvcDtcbiAgICAgICAgZm9yIChwcm9wIGluIG9iaikge1xuICAgICAgICAgICAgaWYgKGhhc1Byb3Aob2JqLCBwcm9wKSkge1xuICAgICAgICAgICAgICAgIGlmIChmdW5jKG9ialtwcm9wXSwgcHJvcCkpIHtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2ltcGxlIGZ1bmN0aW9uIHRvIG1peCBpbiBwcm9wZXJ0aWVzIGZyb20gc291cmNlIGludG8gdGFyZ2V0LFxuICAgICAqIGJ1dCBvbmx5IGlmIHRhcmdldCBkb2VzIG5vdCBhbHJlYWR5IGhhdmUgYSBwcm9wZXJ0eSBvZiB0aGUgc2FtZSBuYW1lLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uIG1peGluKHRhcmdldCwgc291cmNlLCBmb3JjZSwgZGVlcFN0cmluZ01peGluKSB7XG4gICAgICAgIGlmIChzb3VyY2UpIHtcbiAgICAgICAgICAgIGVhY2hQcm9wKHNvdXJjZSwgZnVuY3Rpb24gKHZhbHVlLCBwcm9wKSB7XG4gICAgICAgICAgICAgICAgaWYgKGZvcmNlIHx8ICFoYXNQcm9wKHRhcmdldCwgcHJvcCkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRlZXBTdHJpbmdNaXhpbiAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAhaXNBcnJheSh2YWx1ZSkgJiYgIWlzRnVuY3Rpb24odmFsdWUpICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAhKHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwKSkge1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRhcmdldFtwcm9wXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldFtwcm9wXSA9IHt9O1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgbWl4aW4odGFyZ2V0W3Byb3BdLCB2YWx1ZSwgZm9yY2UsIGRlZXBTdHJpbmdNaXhpbik7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXRbcHJvcF0gPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0YXJnZXQ7XG4gICAgfVxuXG4gICAgLy9TaW1pbGFyIHRvIEZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kLCBidXQgdGhlICd0aGlzJyBvYmplY3QgaXMgc3BlY2lmaWVkXG4gICAgLy9maXJzdCwgc2luY2UgaXQgaXMgZWFzaWVyIHRvIHJlYWQvZmlndXJlIG91dCB3aGF0ICd0aGlzJyB3aWxsIGJlLlxuICAgIGZ1bmN0aW9uIGJpbmQob2JqLCBmbikge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGZuLmFwcGx5KG9iaiwgYXJndW1lbnRzKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzY3JpcHRzKCkge1xuICAgICAgICByZXR1cm4gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3NjcmlwdCcpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlZmF1bHRPbkVycm9yKGVycikge1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgfVxuXG4gICAgLy9BbGxvdyBnZXR0aW5nIGEgZ2xvYmFsIHRoYXQgaXMgZXhwcmVzc2VkIGluXG4gICAgLy9kb3Qgbm90YXRpb24sIGxpa2UgJ2EuYi5jJy5cbiAgICBmdW5jdGlvbiBnZXRHbG9iYWwodmFsdWUpIHtcbiAgICAgICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICB9XG4gICAgICAgIHZhciBnID0gZ2xvYmFsO1xuICAgICAgICBlYWNoKHZhbHVlLnNwbGl0KCcuJyksIGZ1bmN0aW9uIChwYXJ0KSB7XG4gICAgICAgICAgICBnID0gZ1twYXJ0XTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBnO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENvbnN0cnVjdHMgYW4gZXJyb3Igd2l0aCBhIHBvaW50ZXIgdG8gYW4gVVJMIHdpdGggbW9yZSBpbmZvcm1hdGlvbi5cbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gaWQgdGhlIGVycm9yIElEIHRoYXQgbWFwcyB0byBhbiBJRCBvbiBhIHdlYiBwYWdlLlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlIGh1bWFuIHJlYWRhYmxlIGVycm9yLlxuICAgICAqIEBwYXJhbSB7RXJyb3J9IFtlcnJdIHRoZSBvcmlnaW5hbCBlcnJvciwgaWYgdGhlcmUgaXMgb25lLlxuICAgICAqXG4gICAgICogQHJldHVybnMge0Vycm9yfVxuICAgICAqL1xuICAgIGZ1bmN0aW9uIG1ha2VFcnJvcihpZCwgbXNnLCBlcnIsIHJlcXVpcmVNb2R1bGVzKSB7XG4gICAgICAgIHZhciBlID0gbmV3IEVycm9yKG1zZyArICdcXG5odHRwOi8vcmVxdWlyZWpzLm9yZy9kb2NzL2Vycm9ycy5odG1sIycgKyBpZCk7XG4gICAgICAgIGUucmVxdWlyZVR5cGUgPSBpZDtcbiAgICAgICAgZS5yZXF1aXJlTW9kdWxlcyA9IHJlcXVpcmVNb2R1bGVzO1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICBlLm9yaWdpbmFsRXJyb3IgPSBlcnI7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGU7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBkZWZpbmUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIC8vSWYgYSBkZWZpbmUgaXMgYWxyZWFkeSBpbiBwbGF5IHZpYSBhbm90aGVyIEFNRCBsb2FkZXIsXG4gICAgICAgIC8vZG8gbm90IG92ZXJ3cml0ZS5cbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgcmVxdWlyZWpzICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICBpZiAoaXNGdW5jdGlvbihyZXF1aXJlanMpKSB7XG4gICAgICAgICAgICAvL0RvIG5vdCBvdmVyd3JpdGUgYW4gZXhpc3RpbmcgcmVxdWlyZWpzIGluc3RhbmNlLlxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNmZyA9IHJlcXVpcmVqcztcbiAgICAgICAgcmVxdWlyZWpzID0gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vQWxsb3cgZm9yIGEgcmVxdWlyZSBjb25maWcgb2JqZWN0XG4gICAgaWYgKHR5cGVvZiByZXF1aXJlICE9PSAndW5kZWZpbmVkJyAmJiAhaXNGdW5jdGlvbihyZXF1aXJlKSkge1xuICAgICAgICAvL2Fzc3VtZSBpdCBpcyBhIGNvbmZpZyBvYmplY3QuXG4gICAgICAgIGNmZyA9IHJlcXVpcmU7XG4gICAgICAgIHJlcXVpcmUgPSB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbmV3Q29udGV4dChjb250ZXh0TmFtZSkge1xuICAgICAgICB2YXIgaW5DaGVja0xvYWRlZCwgTW9kdWxlLCBjb250ZXh0LCBoYW5kbGVycyxcbiAgICAgICAgICAgIGNoZWNrTG9hZGVkVGltZW91dElkLFxuICAgICAgICAgICAgY29uZmlnID0ge1xuICAgICAgICAgICAgICAgIC8vRGVmYXVsdHMuIERvIG5vdCBzZXQgYSBkZWZhdWx0IGZvciBtYXBcbiAgICAgICAgICAgICAgICAvL2NvbmZpZyB0byBzcGVlZCB1cCBub3JtYWxpemUoKSwgd2hpY2hcbiAgICAgICAgICAgICAgICAvL3dpbGwgcnVuIGZhc3RlciBpZiB0aGVyZSBpcyBubyBkZWZhdWx0LlxuICAgICAgICAgICAgICAgIHdhaXRTZWNvbmRzOiA3LFxuICAgICAgICAgICAgICAgIGJhc2VVcmw6ICcuLycsXG4gICAgICAgICAgICAgICAgcGF0aHM6IHt9LFxuICAgICAgICAgICAgICAgIGJ1bmRsZXM6IHt9LFxuICAgICAgICAgICAgICAgIHBrZ3M6IHt9LFxuICAgICAgICAgICAgICAgIHNoaW06IHt9LFxuICAgICAgICAgICAgICAgIGNvbmZpZzoge31cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZWdpc3RyeSA9IHt9LFxuICAgICAgICAgICAgLy9yZWdpc3RyeSBvZiBqdXN0IGVuYWJsZWQgbW9kdWxlcywgdG8gc3BlZWRcbiAgICAgICAgICAgIC8vY3ljbGUgYnJlYWtpbmcgY29kZSB3aGVuIGxvdHMgb2YgbW9kdWxlc1xuICAgICAgICAgICAgLy9hcmUgcmVnaXN0ZXJlZCwgYnV0IG5vdCBhY3RpdmF0ZWQuXG4gICAgICAgICAgICBlbmFibGVkUmVnaXN0cnkgPSB7fSxcbiAgICAgICAgICAgIHVuZGVmRXZlbnRzID0ge30sXG4gICAgICAgICAgICBkZWZRdWV1ZSA9IFtdLFxuICAgICAgICAgICAgZGVmaW5lZCA9IHt9LFxuICAgICAgICAgICAgdXJsRmV0Y2hlZCA9IHt9LFxuICAgICAgICAgICAgYnVuZGxlc01hcCA9IHt9LFxuICAgICAgICAgICAgcmVxdWlyZUNvdW50ZXIgPSAxLFxuICAgICAgICAgICAgdW5ub3JtYWxpemVkQ291bnRlciA9IDE7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRyaW1zIHRoZSAuIGFuZCAuLiBmcm9tIGFuIGFycmF5IG9mIHBhdGggc2VnbWVudHMuXG4gICAgICAgICAqIEl0IHdpbGwga2VlcCBhIGxlYWRpbmcgcGF0aCBzZWdtZW50IGlmIGEgLi4gd2lsbCBiZWNvbWVcbiAgICAgICAgICogdGhlIGZpcnN0IHBhdGggc2VnbWVudCwgdG8gaGVscCB3aXRoIG1vZHVsZSBuYW1lIGxvb2t1cHMsXG4gICAgICAgICAqIHdoaWNoIGFjdCBsaWtlIHBhdGhzLCBidXQgY2FuIGJlIHJlbWFwcGVkLiBCdXQgdGhlIGVuZCByZXN1bHQsXG4gICAgICAgICAqIGFsbCBwYXRocyB0aGF0IHVzZSB0aGlzIGZ1bmN0aW9uIHNob3VsZCBsb29rIG5vcm1hbGl6ZWQuXG4gICAgICAgICAqIE5PVEU6IHRoaXMgbWV0aG9kIE1PRElGSUVTIHRoZSBpbnB1dCBhcnJheS5cbiAgICAgICAgICogQHBhcmFtIHtBcnJheX0gYXJ5IHRoZSBhcnJheSBvZiBwYXRoIHNlZ21lbnRzLlxuICAgICAgICAgKi9cbiAgICAgICAgZnVuY3Rpb24gdHJpbURvdHMoYXJ5KSB7XG4gICAgICAgICAgICB2YXIgaSwgcGFydDtcbiAgICAgICAgICAgIGZvciAoaSA9IDA7IGkgPCBhcnkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICBwYXJ0ID0gYXJ5W2ldO1xuICAgICAgICAgICAgICAgIGlmIChwYXJ0ID09PSAnLicpIHtcbiAgICAgICAgICAgICAgICAgICAgYXJ5LnNwbGljZShpLCAxKTtcbiAgICAgICAgICAgICAgICAgICAgaSAtPSAxO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGFydCA9PT0gJy4uJykge1xuICAgICAgICAgICAgICAgICAgICAvLyBJZiBhdCB0aGUgc3RhcnQsIG9yIHByZXZpb3VzIHZhbHVlIGlzIHN0aWxsIC4uLFxuICAgICAgICAgICAgICAgICAgICAvLyBrZWVwIHRoZW0gc28gdGhhdCB3aGVuIGNvbnZlcnRlZCB0byBhIHBhdGggaXQgbWF5XG4gICAgICAgICAgICAgICAgICAgIC8vIHN0aWxsIHdvcmsgd2hlbiBjb252ZXJ0ZWQgdG8gYSBwYXRoLCBldmVuIHRob3VnaFxuICAgICAgICAgICAgICAgICAgICAvLyBhcyBhbiBJRCBpdCBpcyBsZXNzIHRoYW4gaWRlYWwuIEluIGxhcmdlciBwb2ludFxuICAgICAgICAgICAgICAgICAgICAvLyByZWxlYXNlcywgbWF5IGJlIGJldHRlciB0byBqdXN0IGtpY2sgb3V0IGFuIGVycm9yLlxuICAgICAgICAgICAgICAgICAgICBpZiAoaSA9PT0gMCB8fCAoaSA9PT0gMSAmJiBhcnlbMl0gPT09ICcuLicpIHx8IGFyeVtpIC0gMV0gPT09ICcuLicpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGkgPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhcnkuc3BsaWNlKGkgLSAxLCAyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGkgLT0gMjtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBHaXZlbiBhIHJlbGF0aXZlIG1vZHVsZSBuYW1lLCBsaWtlIC4vc29tZXRoaW5nLCBub3JtYWxpemUgaXQgdG9cbiAgICAgICAgICogYSByZWFsIG5hbWUgdGhhdCBjYW4gYmUgbWFwcGVkIHRvIGEgcGF0aC5cbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgdGhlIHJlbGF0aXZlIG5hbWVcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGJhc2VOYW1lIGEgcmVhbCBuYW1lIHRoYXQgdGhlIG5hbWUgYXJnIGlzIHJlbGF0aXZlXG4gICAgICAgICAqIHRvLlxuICAgICAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IGFwcGx5TWFwIGFwcGx5IHRoZSBtYXAgY29uZmlnIHRvIHRoZSB2YWx1ZS4gU2hvdWxkXG4gICAgICAgICAqIG9ubHkgYmUgZG9uZSBpZiB0aGlzIG5vcm1hbGl6YXRpb24gaXMgZm9yIGEgZGVwZW5kZW5jeSBJRC5cbiAgICAgICAgICogQHJldHVybnMge1N0cmluZ30gbm9ybWFsaXplZCBuYW1lXG4gICAgICAgICAqL1xuICAgICAgICBmdW5jdGlvbiBub3JtYWxpemUobmFtZSwgYmFzZU5hbWUsIGFwcGx5TWFwKSB7XG4gICAgICAgICAgICB2YXIgcGtnTWFpbiwgbWFwVmFsdWUsIG5hbWVQYXJ0cywgaSwgaiwgbmFtZVNlZ21lbnQsIGxhc3RJbmRleCxcbiAgICAgICAgICAgICAgICBmb3VuZE1hcCwgZm91bmRJLCBmb3VuZFN0YXJNYXAsIHN0YXJJLCBub3JtYWxpemVkQmFzZVBhcnRzLFxuICAgICAgICAgICAgICAgIGJhc2VQYXJ0cyA9IChiYXNlTmFtZSAmJiBiYXNlTmFtZS5zcGxpdCgnLycpKSxcbiAgICAgICAgICAgICAgICBtYXAgPSBjb25maWcubWFwLFxuICAgICAgICAgICAgICAgIHN0YXJNYXAgPSBtYXAgJiYgbWFwWycqJ107XG5cbiAgICAgICAgICAgIC8vQWRqdXN0IGFueSByZWxhdGl2ZSBwYXRocy5cbiAgICAgICAgICAgIGlmIChuYW1lKSB7XG4gICAgICAgICAgICAgICAgbmFtZSA9IG5hbWUuc3BsaXQoJy8nKTtcbiAgICAgICAgICAgICAgICBsYXN0SW5kZXggPSBuYW1lLmxlbmd0aCAtIDE7XG5cbiAgICAgICAgICAgICAgICAvLyBJZiB3YW50aW5nIG5vZGUgSUQgY29tcGF0aWJpbGl0eSwgc3RyaXAgLmpzIGZyb20gZW5kXG4gICAgICAgICAgICAgICAgLy8gb2YgSURzLiBIYXZlIHRvIGRvIHRoaXMgaGVyZSwgYW5kIG5vdCBpbiBuYW1lVG9VcmxcbiAgICAgICAgICAgICAgICAvLyBiZWNhdXNlIG5vZGUgYWxsb3dzIGVpdGhlciAuanMgb3Igbm9uIC5qcyB0byBtYXBcbiAgICAgICAgICAgICAgICAvLyB0byBzYW1lIGZpbGUuXG4gICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5ub2RlSWRDb21wYXQgJiYganNTdWZmaXhSZWdFeHAudGVzdChuYW1lW2xhc3RJbmRleF0pKSB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWVbbGFzdEluZGV4XSA9IG5hbWVbbGFzdEluZGV4XS5yZXBsYWNlKGpzU3VmZml4UmVnRXhwLCAnJyk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gU3RhcnRzIHdpdGggYSAnLicgc28gbmVlZCB0aGUgYmFzZU5hbWVcbiAgICAgICAgICAgICAgICBpZiAobmFtZVswXS5jaGFyQXQoMCkgPT09ICcuJyAmJiBiYXNlUGFydHMpIHtcbiAgICAgICAgICAgICAgICAgICAgLy9Db252ZXJ0IGJhc2VOYW1lIHRvIGFycmF5LCBhbmQgbG9wIG9mZiB0aGUgbGFzdCBwYXJ0LFxuICAgICAgICAgICAgICAgICAgICAvL3NvIHRoYXQgLiBtYXRjaGVzIHRoYXQgJ2RpcmVjdG9yeScgYW5kIG5vdCBuYW1lIG9mIHRoZSBiYXNlTmFtZSdzXG4gICAgICAgICAgICAgICAgICAgIC8vbW9kdWxlLiBGb3IgaW5zdGFuY2UsIGJhc2VOYW1lIG9mICdvbmUvdHdvL3RocmVlJywgbWFwcyB0b1xuICAgICAgICAgICAgICAgICAgICAvLydvbmUvdHdvL3RocmVlLmpzJywgYnV0IHdlIHdhbnQgdGhlIGRpcmVjdG9yeSwgJ29uZS90d28nIGZvclxuICAgICAgICAgICAgICAgICAgICAvL3RoaXMgbm9ybWFsaXphdGlvbi5cbiAgICAgICAgICAgICAgICAgICAgbm9ybWFsaXplZEJhc2VQYXJ0cyA9IGJhc2VQYXJ0cy5zbGljZSgwLCBiYXNlUGFydHMubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICAgICAgICAgIG5hbWUgPSBub3JtYWxpemVkQmFzZVBhcnRzLmNvbmNhdChuYW1lKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0cmltRG90cyhuYW1lKTtcbiAgICAgICAgICAgICAgICBuYW1lID0gbmFtZS5qb2luKCcvJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vQXBwbHkgbWFwIGNvbmZpZyBpZiBhdmFpbGFibGUuXG4gICAgICAgICAgICBpZiAoYXBwbHlNYXAgJiYgbWFwICYmIChiYXNlUGFydHMgfHwgc3Rhck1hcCkpIHtcbiAgICAgICAgICAgICAgICBuYW1lUGFydHMgPSBuYW1lLnNwbGl0KCcvJyk7XG5cbiAgICAgICAgICAgICAgICBvdXRlckxvb3A6IGZvciAoaSA9IG5hbWVQYXJ0cy5sZW5ndGg7IGkgPiAwOyBpIC09IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZVNlZ21lbnQgPSBuYW1lUGFydHMuc2xpY2UoMCwgaSkuam9pbignLycpO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChiYXNlUGFydHMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vRmluZCB0aGUgbG9uZ2VzdCBiYXNlTmFtZSBzZWdtZW50IG1hdGNoIGluIHRoZSBjb25maWcuXG4gICAgICAgICAgICAgICAgICAgICAgICAvL1NvLCBkbyBqb2lucyBvbiB0aGUgYmlnZ2VzdCB0byBzbWFsbGVzdCBsZW5ndGhzIG9mIGJhc2VQYXJ0cy5cbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoaiA9IGJhc2VQYXJ0cy5sZW5ndGg7IGogPiAwOyBqIC09IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXBWYWx1ZSA9IGdldE93bihtYXAsIGJhc2VQYXJ0cy5zbGljZSgwLCBqKS5qb2luKCcvJykpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy9iYXNlTmFtZSBzZWdtZW50IGhhcyBjb25maWcsIGZpbmQgaWYgaXQgaGFzIG9uZSBmb3JcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL3RoaXMgbmFtZS5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobWFwVmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFwVmFsdWUgPSBnZXRPd24obWFwVmFsdWUsIG5hbWVTZWdtZW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG1hcFZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL01hdGNoLCB1cGRhdGUgbmFtZSB0byB0aGUgbmV3IHZhbHVlLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZm91bmRNYXAgPSBtYXBWYWx1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kSSA9IGk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhayBvdXRlckxvb3A7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvL0NoZWNrIGZvciBhIHN0YXIgbWFwIG1hdGNoLCBidXQganVzdCBob2xkIG9uIHRvIGl0LFxuICAgICAgICAgICAgICAgICAgICAvL2lmIHRoZXJlIGlzIGEgc2hvcnRlciBzZWdtZW50IG1hdGNoIGxhdGVyIGluIGEgbWF0Y2hpbmdcbiAgICAgICAgICAgICAgICAgICAgLy9jb25maWcsIHRoZW4gZmF2b3Igb3ZlciB0aGlzIHN0YXIgbWFwLlxuICAgICAgICAgICAgICAgICAgICBpZiAoIWZvdW5kU3Rhck1hcCAmJiBzdGFyTWFwICYmIGdldE93bihzdGFyTWFwLCBuYW1lU2VnbWVudCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvdW5kU3Rhck1hcCA9IGdldE93bihzdGFyTWFwLCBuYW1lU2VnbWVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGFySSA9IGk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWZvdW5kTWFwICYmIGZvdW5kU3Rhck1hcCkge1xuICAgICAgICAgICAgICAgICAgICBmb3VuZE1hcCA9IGZvdW5kU3Rhck1hcDtcbiAgICAgICAgICAgICAgICAgICAgZm91bmRJID0gc3Rhckk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKGZvdW5kTWFwKSB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWVQYXJ0cy5zcGxpY2UoMCwgZm91bmRJLCBmb3VuZE1hcCk7XG4gICAgICAgICAgICAgICAgICAgIG5hbWUgPSBuYW1lUGFydHMuam9pbignLycpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gSWYgdGhlIG5hbWUgcG9pbnRzIHRvIGEgcGFja2FnZSdzIG5hbWUsIHVzZVxuICAgICAgICAgICAgLy8gdGhlIHBhY2thZ2UgbWFpbiBpbnN0ZWFkLlxuICAgICAgICAgICAgcGtnTWFpbiA9IGdldE93bihjb25maWcucGtncywgbmFtZSk7XG5cbiAgICAgICAgICAgIHJldHVybiBwa2dNYWluID8gcGtnTWFpbiA6IG5hbWU7XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiByZW1vdmVTY3JpcHQobmFtZSkge1xuICAgICAgICAgICAgaWYgKGlzQnJvd3Nlcikge1xuICAgICAgICAgICAgICAgIGVhY2goc2NyaXB0cygpLCBmdW5jdGlvbiAoc2NyaXB0Tm9kZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoc2NyaXB0Tm9kZS5nZXRBdHRyaWJ1dGUoJ2RhdGEtcmVxdWlyZW1vZHVsZScpID09PSBuYW1lICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2NyaXB0Tm9kZS5nZXRBdHRyaWJ1dGUoJ2RhdGEtcmVxdWlyZWNvbnRleHQnKSA9PT0gY29udGV4dC5jb250ZXh0TmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgc2NyaXB0Tm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHNjcmlwdE5vZGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIGhhc1BhdGhGYWxsYmFjayhpZCkge1xuICAgICAgICAgICAgdmFyIHBhdGhDb25maWcgPSBnZXRPd24oY29uZmlnLnBhdGhzLCBpZCk7XG4gICAgICAgICAgICBpZiAocGF0aENvbmZpZyAmJiBpc0FycmF5KHBhdGhDb25maWcpICYmIHBhdGhDb25maWcubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgICAgIC8vUG9wIG9mZiB0aGUgZmlyc3QgYXJyYXkgdmFsdWUsIHNpbmNlIGl0IGZhaWxlZCwgYW5kXG4gICAgICAgICAgICAgICAgLy9yZXRyeVxuICAgICAgICAgICAgICAgIHBhdGhDb25maWcuc2hpZnQoKTtcbiAgICAgICAgICAgICAgICBjb250ZXh0LnJlcXVpcmUudW5kZWYoaWQpO1xuXG4gICAgICAgICAgICAgICAgLy9DdXN0b20gcmVxdWlyZSB0aGF0IGRvZXMgbm90IGRvIG1hcCB0cmFuc2xhdGlvbiwgc2luY2VcbiAgICAgICAgICAgICAgICAvL0lEIGlzIFwiYWJzb2x1dGVcIiwgYWxyZWFkeSBtYXBwZWQvcmVzb2x2ZWQuXG4gICAgICAgICAgICAgICAgY29udGV4dC5tYWtlUmVxdWlyZShudWxsLCB7XG4gICAgICAgICAgICAgICAgICAgIHNraXBNYXA6IHRydWVcbiAgICAgICAgICAgICAgICB9KShbaWRdKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy9UdXJucyBhIHBsdWdpbiFyZXNvdXJjZSB0byBbcGx1Z2luLCByZXNvdXJjZV1cbiAgICAgICAgLy93aXRoIHRoZSBwbHVnaW4gYmVpbmcgdW5kZWZpbmVkIGlmIHRoZSBuYW1lXG4gICAgICAgIC8vZGlkIG5vdCBoYXZlIGEgcGx1Z2luIHByZWZpeC5cbiAgICAgICAgZnVuY3Rpb24gc3BsaXRQcmVmaXgobmFtZSkge1xuICAgICAgICAgICAgdmFyIHByZWZpeCxcbiAgICAgICAgICAgICAgICBpbmRleCA9IG5hbWUgPyBuYW1lLmluZGV4T2YoJyEnKSA6IC0xO1xuICAgICAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgICAgICBwcmVmaXggPSBuYW1lLnN1YnN0cmluZygwLCBpbmRleCk7XG4gICAgICAgICAgICAgICAgbmFtZSA9IG5hbWUuc3Vic3RyaW5nKGluZGV4ICsgMSwgbmFtZS5sZW5ndGgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIFtwcmVmaXgsIG5hbWVdO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENyZWF0ZXMgYSBtb2R1bGUgbWFwcGluZyB0aGF0IGluY2x1ZGVzIHBsdWdpbiBwcmVmaXgsIG1vZHVsZVxuICAgICAgICAgKiBuYW1lLCBhbmQgcGF0aC4gSWYgcGFyZW50TW9kdWxlTWFwIGlzIHByb3ZpZGVkIGl0IHdpbGxcbiAgICAgICAgICogYWxzbyBub3JtYWxpemUgdGhlIG5hbWUgdmlhIHJlcXVpcmUubm9ybWFsaXplKClcbiAgICAgICAgICpcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgdGhlIG1vZHVsZSBuYW1lXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbcGFyZW50TW9kdWxlTWFwXSBwYXJlbnQgbW9kdWxlIG1hcFxuICAgICAgICAgKiBmb3IgdGhlIG1vZHVsZSBuYW1lLCB1c2VkIHRvIHJlc29sdmUgcmVsYXRpdmUgbmFtZXMuXG4gICAgICAgICAqIEBwYXJhbSB7Qm9vbGVhbn0gaXNOb3JtYWxpemVkOiBpcyB0aGUgSUQgYWxyZWFkeSBub3JtYWxpemVkLlxuICAgICAgICAgKiBUaGlzIGlzIHRydWUgaWYgdGhpcyBjYWxsIGlzIGRvbmUgZm9yIGEgZGVmaW5lKCkgbW9kdWxlIElELlxuICAgICAgICAgKiBAcGFyYW0ge0Jvb2xlYW59IGFwcGx5TWFwOiBhcHBseSB0aGUgbWFwIGNvbmZpZyB0byB0aGUgSUQuXG4gICAgICAgICAqIFNob3VsZCBvbmx5IGJlIHRydWUgaWYgdGhpcyBtYXAgaXMgZm9yIGEgZGVwZW5kZW5jeS5cbiAgICAgICAgICpcbiAgICAgICAgICogQHJldHVybnMge09iamVjdH1cbiAgICAgICAgICovXG4gICAgICAgIGZ1bmN0aW9uIG1ha2VNb2R1bGVNYXAobmFtZSwgcGFyZW50TW9kdWxlTWFwLCBpc05vcm1hbGl6ZWQsIGFwcGx5TWFwKSB7XG4gICAgICAgICAgICB2YXIgdXJsLCBwbHVnaW5Nb2R1bGUsIHN1ZmZpeCwgbmFtZVBhcnRzLFxuICAgICAgICAgICAgICAgIHByZWZpeCA9IG51bGwsXG4gICAgICAgICAgICAgICAgcGFyZW50TmFtZSA9IHBhcmVudE1vZHVsZU1hcCA/IHBhcmVudE1vZHVsZU1hcC5uYW1lIDogbnVsbCxcbiAgICAgICAgICAgICAgICBvcmlnaW5hbE5hbWUgPSBuYW1lLFxuICAgICAgICAgICAgICAgIGlzRGVmaW5lID0gdHJ1ZSxcbiAgICAgICAgICAgICAgICBub3JtYWxpemVkTmFtZSA9ICcnO1xuXG4gICAgICAgICAgICAvL0lmIG5vIG5hbWUsIHRoZW4gaXQgbWVhbnMgaXQgaXMgYSByZXF1aXJlIGNhbGwsIGdlbmVyYXRlIGFuXG4gICAgICAgICAgICAvL2ludGVybmFsIG5hbWUuXG4gICAgICAgICAgICBpZiAoIW5hbWUpIHtcbiAgICAgICAgICAgICAgICBpc0RlZmluZSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIG5hbWUgPSAnX0ByJyArIChyZXF1aXJlQ291bnRlciArPSAxKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbmFtZVBhcnRzID0gc3BsaXRQcmVmaXgobmFtZSk7XG4gICAgICAgICAgICBwcmVmaXggPSBuYW1lUGFydHNbMF07XG4gICAgICAgICAgICBuYW1lID0gbmFtZVBhcnRzWzFdO1xuXG4gICAgICAgICAgICBpZiAocHJlZml4KSB7XG4gICAgICAgICAgICAgICAgcHJlZml4ID0gbm9ybWFsaXplKHByZWZpeCwgcGFyZW50TmFtZSwgYXBwbHlNYXApO1xuICAgICAgICAgICAgICAgIHBsdWdpbk1vZHVsZSA9IGdldE93bihkZWZpbmVkLCBwcmVmaXgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvL0FjY291bnQgZm9yIHJlbGF0aXZlIHBhdGhzIGlmIHRoZXJlIGlzIGEgYmFzZSBuYW1lLlxuICAgICAgICAgICAgaWYgKG5hbWUpIHtcbiAgICAgICAgICAgICAgICBpZiAocHJlZml4KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwbHVnaW5Nb2R1bGUgJiYgcGx1Z2luTW9kdWxlLm5vcm1hbGl6ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy9QbHVnaW4gaXMgbG9hZGVkLCB1c2UgaXRzIG5vcm1hbGl6ZSBtZXRob2QuXG4gICAgICAgICAgICAgICAgICAgICAgICBub3JtYWxpemVkTmFtZSA9IHBsdWdpbk1vZHVsZS5ub3JtYWxpemUobmFtZSwgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbm9ybWFsaXplKG5hbWUsIHBhcmVudE5hbWUsIGFwcGx5TWFwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gSWYgbmVzdGVkIHBsdWdpbiByZWZlcmVuY2VzLCB0aGVuIGRvIG5vdCB0cnkgdG9cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIG5vcm1hbGl6ZSwgYXMgaXQgd2lsbCBub3Qgbm9ybWFsaXplIGNvcnJlY3RseS4gVGhpc1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gcGxhY2VzIGEgcmVzdHJpY3Rpb24gb24gcmVzb3VyY2VJZHMsIGFuZCB0aGUgbG9uZ2VyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB0ZXJtIHNvbHV0aW9uIGlzIG5vdCB0byBub3JtYWxpemUgdW50aWwgcGx1Z2lucyBhcmVcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGxvYWRlZCBhbmQgYWxsIG5vcm1hbGl6YXRpb25zIHRvIGFsbG93IGZvciBhc3luY1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gbG9hZGluZyBvZiBhIGxvYWRlciBwbHVnaW4uIEJ1dCBmb3Igbm93LCBmaXhlcyB0aGVcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvbW1vbiB1c2VzLiBEZXRhaWxzIGluICMxMTMxXG4gICAgICAgICAgICAgICAgICAgICAgICBub3JtYWxpemVkTmFtZSA9IG5hbWUuaW5kZXhPZignIScpID09PSAtMSA/XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5vcm1hbGl6ZShuYW1lLCBwYXJlbnROYW1lLCBhcHBseU1hcCkgOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy9BIHJlZ3VsYXIgbW9kdWxlLlxuICAgICAgICAgICAgICAgICAgICBub3JtYWxpemVkTmFtZSA9IG5vcm1hbGl6ZShuYW1lLCBwYXJlbnROYW1lLCBhcHBseU1hcCk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy9Ob3JtYWxpemVkIG5hbWUgbWF5IGJlIGEgcGx1Z2luIElEIGR1ZSB0byBtYXAgY29uZmlnXG4gICAgICAgICAgICAgICAgICAgIC8vYXBwbGljYXRpb24gaW4gbm9ybWFsaXplLiBUaGUgbWFwIGNvbmZpZyB2YWx1ZXMgbXVzdFxuICAgICAgICAgICAgICAgICAgICAvL2FscmVhZHkgYmUgbm9ybWFsaXplZCwgc28gZG8gbm90IG5lZWQgdG8gcmVkbyB0aGF0IHBhcnQuXG4gICAgICAgICAgICAgICAgICAgIG5hbWVQYXJ0cyA9IHNwbGl0UHJlZml4KG5vcm1hbGl6ZWROYW1lKTtcbiAgICAgICAgICAgICAgICAgICAgcHJlZml4ID0gbmFtZVBhcnRzWzBdO1xuICAgICAgICAgICAgICAgICAgICBub3JtYWxpemVkTmFtZSA9IG5hbWVQYXJ0c1sxXTtcbiAgICAgICAgICAgICAgICAgICAgaXNOb3JtYWxpemVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgICAgICAgICB1cmwgPSBjb250ZXh0Lm5hbWVUb1VybChub3JtYWxpemVkTmFtZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvL0lmIHRoZSBpZCBpcyBhIHBsdWdpbiBpZCB0aGF0IGNhbm5vdCBiZSBkZXRlcm1pbmVkIGlmIGl0IG5lZWRzXG4gICAgICAgICAgICAvL25vcm1hbGl6YXRpb24sIHN0YW1wIGl0IHdpdGggYSB1bmlxdWUgSUQgc28gdHdvIG1hdGNoaW5nIHJlbGF0aXZlXG4gICAgICAgICAgICAvL2lkcyB0aGF0IG1heSBjb25mbGljdCBjYW4gYmUgc2VwYXJhdGUuXG4gICAgICAgICAgICBzdWZmaXggPSBwcmVmaXggJiYgIXBsdWdpbk1vZHVsZSAmJiAhaXNOb3JtYWxpemVkID9cbiAgICAgICAgICAgICAgICAgICAgICdfdW5ub3JtYWxpemVkJyArICh1bm5vcm1hbGl6ZWRDb3VudGVyICs9IDEpIDpcbiAgICAgICAgICAgICAgICAgICAgICcnO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHByZWZpeDogcHJlZml4LFxuICAgICAgICAgICAgICAgIG5hbWU6IG5vcm1hbGl6ZWROYW1lLFxuICAgICAgICAgICAgICAgIHBhcmVudE1hcDogcGFyZW50TW9kdWxlTWFwLFxuICAgICAgICAgICAgICAgIHVubm9ybWFsaXplZDogISFzdWZmaXgsXG4gICAgICAgICAgICAgICAgdXJsOiB1cmwsXG4gICAgICAgICAgICAgICAgb3JpZ2luYWxOYW1lOiBvcmlnaW5hbE5hbWUsXG4gICAgICAgICAgICAgICAgaXNEZWZpbmU6IGlzRGVmaW5lLFxuICAgICAgICAgICAgICAgIGlkOiAocHJlZml4ID9cbiAgICAgICAgICAgICAgICAgICAgICAgIHByZWZpeCArICchJyArIG5vcm1hbGl6ZWROYW1lIDpcbiAgICAgICAgICAgICAgICAgICAgICAgIG5vcm1hbGl6ZWROYW1lKSArIHN1ZmZpeFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIGdldE1vZHVsZShkZXBNYXApIHtcbiAgICAgICAgICAgIHZhciBpZCA9IGRlcE1hcC5pZCxcbiAgICAgICAgICAgICAgICBtb2QgPSBnZXRPd24ocmVnaXN0cnksIGlkKTtcblxuICAgICAgICAgICAgaWYgKCFtb2QpIHtcbiAgICAgICAgICAgICAgICBtb2QgPSByZWdpc3RyeVtpZF0gPSBuZXcgY29udGV4dC5Nb2R1bGUoZGVwTWFwKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIG1vZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIG9uKGRlcE1hcCwgbmFtZSwgZm4pIHtcbiAgICAgICAgICAgIHZhciBpZCA9IGRlcE1hcC5pZCxcbiAgICAgICAgICAgICAgICBtb2QgPSBnZXRPd24ocmVnaXN0cnksIGlkKTtcblxuICAgICAgICAgICAgaWYgKGhhc1Byb3AoZGVmaW5lZCwgaWQpICYmXG4gICAgICAgICAgICAgICAgICAgICghbW9kIHx8IG1vZC5kZWZpbmVFbWl0Q29tcGxldGUpKSB7XG4gICAgICAgICAgICAgICAgaWYgKG5hbWUgPT09ICdkZWZpbmVkJykge1xuICAgICAgICAgICAgICAgICAgICBmbihkZWZpbmVkW2lkXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBtb2QgPSBnZXRNb2R1bGUoZGVwTWFwKTtcbiAgICAgICAgICAgICAgICBpZiAobW9kLmVycm9yICYmIG5hbWUgPT09ICdlcnJvcicpIHtcbiAgICAgICAgICAgICAgICAgICAgZm4obW9kLmVycm9yKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBtb2Qub24obmFtZSwgZm4pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIG9uRXJyb3IoZXJyLCBlcnJiYWNrKSB7XG4gICAgICAgICAgICB2YXIgaWRzID0gZXJyLnJlcXVpcmVNb2R1bGVzLFxuICAgICAgICAgICAgICAgIG5vdGlmaWVkID0gZmFsc2U7XG5cbiAgICAgICAgICAgIGlmIChlcnJiYWNrKSB7XG4gICAgICAgICAgICAgICAgZXJyYmFjayhlcnIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBlYWNoKGlkcywgZnVuY3Rpb24gKGlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBtb2QgPSBnZXRPd24ocmVnaXN0cnksIGlkKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1vZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy9TZXQgZXJyb3Igb24gbW9kdWxlLCBzbyBpdCBza2lwcyB0aW1lb3V0IGNoZWNrcy5cbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZC5lcnJvciA9IGVycjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtb2QuZXZlbnRzLmVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbm90aWZpZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZC5lbWl0KCdlcnJvcicsIGVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGlmICghbm90aWZpZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVxLm9uRXJyb3IoZXJyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgICogSW50ZXJuYWwgbWV0aG9kIHRvIHRyYW5zZmVyIGdsb2JhbFF1ZXVlIGl0ZW1zIHRvIHRoaXMgY29udGV4dCdzXG4gICAgICAgICAqIGRlZlF1ZXVlLlxuICAgICAgICAgKi9cbiAgICAgICAgZnVuY3Rpb24gdGFrZUdsb2JhbFF1ZXVlKCkge1xuICAgICAgICAgICAgLy9QdXNoIGFsbCB0aGUgZ2xvYmFsRGVmUXVldWUgaXRlbXMgaW50byB0aGUgY29udGV4dCdzIGRlZlF1ZXVlXG4gICAgICAgICAgICBpZiAoZ2xvYmFsRGVmUXVldWUubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgZWFjaChnbG9iYWxEZWZRdWV1ZSwgZnVuY3Rpb24ocXVldWVJdGVtKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBpZCA9IHF1ZXVlSXRlbVswXTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBpZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRleHQuZGVmUXVldWVNYXBbaWRdID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBkZWZRdWV1ZS5wdXNoKHF1ZXVlSXRlbSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgZ2xvYmFsRGVmUXVldWUgPSBbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGhhbmRsZXJzID0ge1xuICAgICAgICAgICAgJ3JlcXVpcmUnOiBmdW5jdGlvbiAobW9kKSB7XG4gICAgICAgICAgICAgICAgaWYgKG1vZC5yZXF1aXJlKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtb2QucmVxdWlyZTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gKG1vZC5yZXF1aXJlID0gY29udGV4dC5tYWtlUmVxdWlyZShtb2QubWFwKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICdleHBvcnRzJzogZnVuY3Rpb24gKG1vZCkge1xuICAgICAgICAgICAgICAgIG1vZC51c2luZ0V4cG9ydHMgPSB0cnVlO1xuICAgICAgICAgICAgICAgIGlmIChtb2QubWFwLmlzRGVmaW5lKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChtb2QuZXhwb3J0cykge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChkZWZpbmVkW21vZC5tYXAuaWRdID0gbW9kLmV4cG9ydHMpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChtb2QuZXhwb3J0cyA9IGRlZmluZWRbbW9kLm1hcC5pZF0gPSB7fSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgJ21vZHVsZSc6IGZ1bmN0aW9uIChtb2QpIHtcbiAgICAgICAgICAgICAgICBpZiAobW9kLm1vZHVsZSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbW9kLm1vZHVsZTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gKG1vZC5tb2R1bGUgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogbW9kLm1hcC5pZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVyaTogbW9kLm1hcC51cmwsXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25maWc6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZ2V0T3duKGNvbmZpZy5jb25maWcsIG1vZC5tYXAuaWQpIHx8IHt9O1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydHM6IG1vZC5leHBvcnRzIHx8IChtb2QuZXhwb3J0cyA9IHt9KVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgZnVuY3Rpb24gY2xlYW5SZWdpc3RyeShpZCkge1xuICAgICAgICAgICAgLy9DbGVhbiB1cCBtYWNoaW5lcnkgdXNlZCBmb3Igd2FpdGluZyBtb2R1bGVzLlxuICAgICAgICAgICAgZGVsZXRlIHJlZ2lzdHJ5W2lkXTtcbiAgICAgICAgICAgIGRlbGV0ZSBlbmFibGVkUmVnaXN0cnlbaWRdO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gYnJlYWtDeWNsZShtb2QsIHRyYWNlZCwgcHJvY2Vzc2VkKSB7XG4gICAgICAgICAgICB2YXIgaWQgPSBtb2QubWFwLmlkO1xuXG4gICAgICAgICAgICBpZiAobW9kLmVycm9yKSB7XG4gICAgICAgICAgICAgICAgbW9kLmVtaXQoJ2Vycm9yJywgbW9kLmVycm9yKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdHJhY2VkW2lkXSA9IHRydWU7XG4gICAgICAgICAgICAgICAgZWFjaChtb2QuZGVwTWFwcywgZnVuY3Rpb24gKGRlcE1hcCwgaSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGVwSWQgPSBkZXBNYXAuaWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXAgPSBnZXRPd24ocmVnaXN0cnksIGRlcElkKTtcblxuICAgICAgICAgICAgICAgICAgICAvL09ubHkgZm9yY2UgdGhpbmdzIHRoYXQgaGF2ZSBub3QgY29tcGxldGVkXG4gICAgICAgICAgICAgICAgICAgIC8vYmVpbmcgZGVmaW5lZCwgc28gc3RpbGwgaW4gdGhlIHJlZ2lzdHJ5LFxuICAgICAgICAgICAgICAgICAgICAvL2FuZCBvbmx5IGlmIGl0IGhhcyBub3QgYmVlbiBtYXRjaGVkIHVwXG4gICAgICAgICAgICAgICAgICAgIC8vaW4gdGhlIG1vZHVsZSBhbHJlYWR5LlxuICAgICAgICAgICAgICAgICAgICBpZiAoZGVwICYmICFtb2QuZGVwTWF0Y2hlZFtpXSAmJiAhcHJvY2Vzc2VkW2RlcElkXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGdldE93bih0cmFjZWQsIGRlcElkKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZC5kZWZpbmVEZXAoaSwgZGVmaW5lZFtkZXBJZF0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZC5jaGVjaygpOyAvL3Bhc3MgZmFsc2U/XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrQ3ljbGUoZGVwLCB0cmFjZWQsIHByb2Nlc3NlZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBwcm9jZXNzZWRbaWRdID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZ1bmN0aW9uIGNoZWNrTG9hZGVkKCkge1xuICAgICAgICAgICAgdmFyIGVyciwgdXNpbmdQYXRoRmFsbGJhY2ssXG4gICAgICAgICAgICAgICAgd2FpdEludGVydmFsID0gY29uZmlnLndhaXRTZWNvbmRzICogMTAwMCxcbiAgICAgICAgICAgICAgICAvL0l0IGlzIHBvc3NpYmxlIHRvIGRpc2FibGUgdGhlIHdhaXQgaW50ZXJ2YWwgYnkgdXNpbmcgd2FpdFNlY29uZHMgb2YgMC5cbiAgICAgICAgICAgICAgICBleHBpcmVkID0gd2FpdEludGVydmFsICYmIChjb250ZXh0LnN0YXJ0VGltZSArIHdhaXRJbnRlcnZhbCkgPCBuZXcgRGF0ZSgpLmdldFRpbWUoKSxcbiAgICAgICAgICAgICAgICBub0xvYWRzID0gW10sXG4gICAgICAgICAgICAgICAgcmVxQ2FsbHMgPSBbXSxcbiAgICAgICAgICAgICAgICBzdGlsbExvYWRpbmcgPSBmYWxzZSxcbiAgICAgICAgICAgICAgICBuZWVkQ3ljbGVDaGVjayA9IHRydWU7XG5cbiAgICAgICAgICAgIC8vRG8gbm90IGJvdGhlciBpZiB0aGlzIGNhbGwgd2FzIGEgcmVzdWx0IG9mIGEgY3ljbGUgYnJlYWsuXG4gICAgICAgICAgICBpZiAoaW5DaGVja0xvYWRlZCkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaW5DaGVja0xvYWRlZCA9IHRydWU7XG5cbiAgICAgICAgICAgIC8vRmlndXJlIG91dCB0aGUgc3RhdGUgb2YgYWxsIHRoZSBtb2R1bGVzLlxuICAgICAgICAgICAgZWFjaFByb3AoZW5hYmxlZFJlZ2lzdHJ5LCBmdW5jdGlvbiAobW9kKSB7XG4gICAgICAgICAgICAgICAgdmFyIG1hcCA9IG1vZC5tYXAsXG4gICAgICAgICAgICAgICAgICAgIG1vZElkID0gbWFwLmlkO1xuXG4gICAgICAgICAgICAgICAgLy9Ta2lwIHRoaW5ncyB0aGF0IGFyZSBub3QgZW5hYmxlZCBvciBpbiBlcnJvciBzdGF0ZS5cbiAgICAgICAgICAgICAgICBpZiAoIW1vZC5lbmFibGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIW1hcC5pc0RlZmluZSkge1xuICAgICAgICAgICAgICAgICAgICByZXFDYWxscy5wdXNoKG1vZCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFtb2QuZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgLy9JZiB0aGUgbW9kdWxlIHNob3VsZCBiZSBleGVjdXRlZCwgYW5kIGl0IGhhcyBub3RcbiAgICAgICAgICAgICAgICAgICAgLy9iZWVuIGluaXRlZCBhbmQgdGltZSBpcyB1cCwgcmVtZW1iZXIgaXQuXG4gICAgICAgICAgICAgICAgICAgIGlmICghbW9kLmluaXRlZCAmJiBleHBpcmVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaGFzUGF0aEZhbGxiYWNrKG1vZElkKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVzaW5nUGF0aEZhbGxiYWNrID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGlsbExvYWRpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBub0xvYWRzLnB1c2gobW9kSWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbW92ZVNjcmlwdChtb2RJZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoIW1vZC5pbml0ZWQgJiYgbW9kLmZldGNoZWQgJiYgbWFwLmlzRGVmaW5lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGlsbExvYWRpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFtYXAucHJlZml4KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy9ObyByZWFzb24gdG8ga2VlcCBsb29raW5nIGZvciB1bmZpbmlzaGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy9sb2FkaW5nLiBJZiB0aGUgb25seSBzdGlsbExvYWRpbmcgaXMgYVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vcGx1Z2luIHJlc291cmNlIHRob3VnaCwga2VlcCBnb2luZyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL2JlY2F1c2UgaXQgbWF5IGJlIHRoYXQgYSBwbHVnaW4gcmVzb3VyY2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL2lzIHdhaXRpbmcgb24gYSBub24tcGx1Z2luIGN5Y2xlLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAobmVlZEN5Y2xlQ2hlY2sgPSBmYWxzZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKGV4cGlyZWQgJiYgbm9Mb2Fkcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAvL0lmIHdhaXQgdGltZSBleHBpcmVkLCB0aHJvdyBlcnJvciBvZiB1bmxvYWRlZCBtb2R1bGVzLlxuICAgICAgICAgICAgICAgIGVyciA9IG1ha2VFcnJvcigndGltZW91dCcsICdMb2FkIHRpbWVvdXQgZm9yIG1vZHVsZXM6ICcgKyBub0xvYWRzLCBudWxsLCBub0xvYWRzKTtcbiAgICAgICAgICAgICAgICBlcnIuY29udGV4dE5hbWUgPSBjb250ZXh0LmNvbnRleHROYW1lO1xuICAgICAgICAgICAgICAgIHJldHVybiBvbkVycm9yKGVycik7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vTm90IGV4cGlyZWQsIGNoZWNrIGZvciBhIGN5Y2xlLlxuICAgICAgICAgICAgaWYgKG5lZWRDeWNsZUNoZWNrKSB7XG4gICAgICAgICAgICAgICAgZWFjaChyZXFDYWxscywgZnVuY3Rpb24gKG1vZCkge1xuICAgICAgICAgICAgICAgICAgICBicmVha0N5Y2xlKG1vZCwge30sIHt9KTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy9JZiBzdGlsbCB3YWl0aW5nIG9uIGxvYWRzLCBhbmQgdGhlIHdhaXRpbmcgbG9hZCBpcyBzb21ldGhpbmdcbiAgICAgICAgICAgIC8vb3RoZXIgdGhhbiBhIHBsdWdpbiByZXNvdXJjZSwgb3IgdGhlcmUgYXJlIHN0aWxsIG91dHN0YW5kaW5nXG4gICAgICAgICAgICAvL3NjcmlwdHMsIHRoZW4ganVzdCB0cnkgYmFjayBsYXRlci5cbiAgICAgICAgICAgIGlmICgoIWV4cGlyZWQgfHwgdXNpbmdQYXRoRmFsbGJhY2spICYmIHN0aWxsTG9hZGluZykge1xuICAgICAgICAgICAgICAgIC8vU29tZXRoaW5nIGlzIHN0aWxsIHdhaXRpbmcgdG8gbG9hZC4gV2FpdCBmb3IgaXQsIGJ1dCBvbmx5XG4gICAgICAgICAgICAgICAgLy9pZiBhIHRpbWVvdXQgaXMgbm90IGFscmVhZHkgaW4gZWZmZWN0LlxuICAgICAgICAgICAgICAgIGlmICgoaXNCcm93c2VyIHx8IGlzV2ViV29ya2VyKSAmJiAhY2hlY2tMb2FkZWRUaW1lb3V0SWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hlY2tMb2FkZWRUaW1lb3V0SWQgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoZWNrTG9hZGVkVGltZW91dElkID0gMDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoZWNrTG9hZGVkKCk7XG4gICAgICAgICAgICAgICAgICAgIH0sIDUwKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGluQ2hlY2tMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIE1vZHVsZSA9IGZ1bmN0aW9uIChtYXApIHtcbiAgICAgICAgICAgIHRoaXMuZXZlbnRzID0gZ2V0T3duKHVuZGVmRXZlbnRzLCBtYXAuaWQpIHx8IHt9O1xuICAgICAgICAgICAgdGhpcy5tYXAgPSBtYXA7XG4gICAgICAgICAgICB0aGlzLnNoaW0gPSBnZXRPd24oY29uZmlnLnNoaW0sIG1hcC5pZCk7XG4gICAgICAgICAgICB0aGlzLmRlcEV4cG9ydHMgPSBbXTtcbiAgICAgICAgICAgIHRoaXMuZGVwTWFwcyA9IFtdO1xuICAgICAgICAgICAgdGhpcy5kZXBNYXRjaGVkID0gW107XG4gICAgICAgICAgICB0aGlzLnBsdWdpbk1hcHMgPSB7fTtcbiAgICAgICAgICAgIHRoaXMuZGVwQ291bnQgPSAwO1xuXG4gICAgICAgICAgICAvKiB0aGlzLmV4cG9ydHMgdGhpcy5mYWN0b3J5XG4gICAgICAgICAgICAgICB0aGlzLmRlcE1hcHMgPSBbXSxcbiAgICAgICAgICAgICAgIHRoaXMuZW5hYmxlZCwgdGhpcy5mZXRjaGVkXG4gICAgICAgICAgICAqL1xuICAgICAgICB9O1xuXG4gICAgICAgIE1vZHVsZS5wcm90b3R5cGUgPSB7XG4gICAgICAgICAgICBpbml0OiBmdW5jdGlvbiAoZGVwTWFwcywgZmFjdG9yeSwgZXJyYmFjaywgb3B0aW9ucykge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgICAgICAgICAgICAgLy9EbyBub3QgZG8gbW9yZSBpbml0cyBpZiBhbHJlYWR5IGRvbmUuIENhbiBoYXBwZW4gaWYgdGhlcmVcbiAgICAgICAgICAgICAgICAvL2FyZSBtdWx0aXBsZSBkZWZpbmUgY2FsbHMgZm9yIHRoZSBzYW1lIG1vZHVsZS4gVGhhdCBpcyBub3RcbiAgICAgICAgICAgICAgICAvL2Egbm9ybWFsLCBjb21tb24gY2FzZSwgYnV0IGl0IGlzIGFsc28gbm90IHVuZXhwZWN0ZWQuXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuaW5pdGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aGlzLmZhY3RvcnkgPSBmYWN0b3J5O1xuXG4gICAgICAgICAgICAgICAgaWYgKGVycmJhY2spIHtcbiAgICAgICAgICAgICAgICAgICAgLy9SZWdpc3RlciBmb3IgZXJyb3JzIG9uIHRoaXMgbW9kdWxlLlxuICAgICAgICAgICAgICAgICAgICB0aGlzLm9uKCdlcnJvcicsIGVycmJhY2spO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5ldmVudHMuZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgLy9JZiBubyBlcnJiYWNrIGFscmVhZHksIGJ1dCB0aGVyZSBhcmUgZXJyb3IgbGlzdGVuZXJzXG4gICAgICAgICAgICAgICAgICAgIC8vb24gdGhpcyBtb2R1bGUsIHNldCB1cCBhbiBlcnJiYWNrIHRvIHBhc3MgdG8gdGhlIGRlcHMuXG4gICAgICAgICAgICAgICAgICAgIGVycmJhY2sgPSBiaW5kKHRoaXMsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdCgnZXJyb3InLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAvL0RvIGEgY29weSBvZiB0aGUgZGVwZW5kZW5jeSBhcnJheSwgc28gdGhhdFxuICAgICAgICAgICAgICAgIC8vc291cmNlIGlucHV0cyBhcmUgbm90IG1vZGlmaWVkLiBGb3IgZXhhbXBsZVxuICAgICAgICAgICAgICAgIC8vXCJzaGltXCIgZGVwcyBhcmUgcGFzc2VkIGluIGhlcmUgZGlyZWN0bHksIGFuZFxuICAgICAgICAgICAgICAgIC8vZG9pbmcgYSBkaXJlY3QgbW9kaWZpY2F0aW9uIG9mIHRoZSBkZXBNYXBzIGFycmF5XG4gICAgICAgICAgICAgICAgLy93b3VsZCBhZmZlY3QgdGhhdCBjb25maWcuXG4gICAgICAgICAgICAgICAgdGhpcy5kZXBNYXBzID0gZGVwTWFwcyAmJiBkZXBNYXBzLnNsaWNlKDApO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5lcnJiYWNrID0gZXJyYmFjaztcblxuICAgICAgICAgICAgICAgIC8vSW5kaWNhdGUgdGhpcyBtb2R1bGUgaGFzIGJlIGluaXRpYWxpemVkXG4gICAgICAgICAgICAgICAgdGhpcy5pbml0ZWQgPSB0cnVlO1xuXG4gICAgICAgICAgICAgICAgdGhpcy5pZ25vcmUgPSBvcHRpb25zLmlnbm9yZTtcblxuICAgICAgICAgICAgICAgIC8vQ291bGQgaGF2ZSBvcHRpb24gdG8gaW5pdCB0aGlzIG1vZHVsZSBpbiBlbmFibGVkIG1vZGUsXG4gICAgICAgICAgICAgICAgLy9vciBjb3VsZCBoYXZlIGJlZW4gcHJldmlvdXNseSBtYXJrZWQgYXMgZW5hYmxlZC4gSG93ZXZlcixcbiAgICAgICAgICAgICAgICAvL3RoZSBkZXBlbmRlbmNpZXMgYXJlIG5vdCBrbm93biB1bnRpbCBpbml0IGlzIGNhbGxlZC4gU29cbiAgICAgICAgICAgICAgICAvL2lmIGVuYWJsZWQgcHJldmlvdXNseSwgbm93IHRyaWdnZXIgZGVwZW5kZW5jaWVzIGFzIGVuYWJsZWQuXG4gICAgICAgICAgICAgICAgaWYgKG9wdGlvbnMuZW5hYmxlZCB8fCB0aGlzLmVuYWJsZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgLy9FbmFibGUgdGhpcyBtb2R1bGUgYW5kIGRlcGVuZGVuY2llcy5cbiAgICAgICAgICAgICAgICAgICAgLy9XaWxsIGNhbGwgdGhpcy5jaGVjaygpXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW5hYmxlKCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jaGVjaygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIGRlZmluZURlcDogZnVuY3Rpb24gKGksIGRlcEV4cG9ydHMpIHtcbiAgICAgICAgICAgICAgICAvL0JlY2F1c2Ugb2YgY3ljbGVzLCBkZWZpbmVkIGNhbGxiYWNrIGZvciBhIGdpdmVuXG4gICAgICAgICAgICAgICAgLy9leHBvcnQgY2FuIGJlIGNhbGxlZCBtb3JlIHRoYW4gb25jZS5cbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMuZGVwTWF0Y2hlZFtpXSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmRlcE1hdGNoZWRbaV0gPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmRlcENvdW50IC09IDE7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVwRXhwb3J0c1tpXSA9IGRlcEV4cG9ydHM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgZmV0Y2g6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5mZXRjaGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhpcy5mZXRjaGVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgICAgIGNvbnRleHQuc3RhcnRUaW1lID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcblxuICAgICAgICAgICAgICAgIHZhciBtYXAgPSB0aGlzLm1hcDtcblxuICAgICAgICAgICAgICAgIC8vSWYgdGhlIG1hbmFnZXIgaXMgZm9yIGEgcGx1Z2luIG1hbmFnZWQgcmVzb3VyY2UsXG4gICAgICAgICAgICAgICAgLy9hc2sgdGhlIHBsdWdpbiB0byBsb2FkIGl0IG5vdy5cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5zaGltKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRleHQubWFrZVJlcXVpcmUodGhpcy5tYXAsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVuYWJsZUJ1aWxkQ2FsbGJhY2s6IHRydWVcbiAgICAgICAgICAgICAgICAgICAgfSkodGhpcy5zaGltLmRlcHMgfHwgW10sIGJpbmQodGhpcywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1hcC5wcmVmaXggPyB0aGlzLmNhbGxQbHVnaW4oKSA6IHRoaXMubG9hZCgpO1xuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy9SZWd1bGFyIGRlcGVuZGVuY3kuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtYXAucHJlZml4ID8gdGhpcy5jYWxsUGx1Z2luKCkgOiB0aGlzLmxvYWQoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICBsb2FkOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIHVybCA9IHRoaXMubWFwLnVybDtcblxuICAgICAgICAgICAgICAgIC8vUmVndWxhciBkZXBlbmRlbmN5LlxuICAgICAgICAgICAgICAgIGlmICghdXJsRmV0Y2hlZFt1cmxdKSB7XG4gICAgICAgICAgICAgICAgICAgIHVybEZldGNoZWRbdXJsXSA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRleHQubG9hZCh0aGlzLm1hcC5pZCwgdXJsKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIENoZWNrcyBpZiB0aGUgbW9kdWxlIGlzIHJlYWR5IHRvIGRlZmluZSBpdHNlbGYsIGFuZCBpZiBzbyxcbiAgICAgICAgICAgICAqIGRlZmluZSBpdC5cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgY2hlY2s6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMuZW5hYmxlZCB8fCB0aGlzLmVuYWJsaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgZXJyLCBjanNNb2R1bGUsXG4gICAgICAgICAgICAgICAgICAgIGlkID0gdGhpcy5tYXAuaWQsXG4gICAgICAgICAgICAgICAgICAgIGRlcEV4cG9ydHMgPSB0aGlzLmRlcEV4cG9ydHMsXG4gICAgICAgICAgICAgICAgICAgIGV4cG9ydHMgPSB0aGlzLmV4cG9ydHMsXG4gICAgICAgICAgICAgICAgICAgIGZhY3RvcnkgPSB0aGlzLmZhY3Rvcnk7XG5cbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMuaW5pdGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIE9ubHkgZmV0Y2ggaWYgbm90IGFscmVhZHkgaW4gdGhlIGRlZlF1ZXVlLlxuICAgICAgICAgICAgICAgICAgICBpZiAoIWhhc1Byb3AoY29udGV4dC5kZWZRdWV1ZU1hcCwgaWQpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmZldGNoKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KCdlcnJvcicsIHRoaXMuZXJyb3IpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoIXRoaXMuZGVmaW5pbmcpIHtcbiAgICAgICAgICAgICAgICAgICAgLy9UaGUgZmFjdG9yeSBjb3VsZCB0cmlnZ2VyIGFub3RoZXIgcmVxdWlyZSBjYWxsXG4gICAgICAgICAgICAgICAgICAgIC8vdGhhdCB3b3VsZCByZXN1bHQgaW4gY2hlY2tpbmcgdGhpcyBtb2R1bGUgdG9cbiAgICAgICAgICAgICAgICAgICAgLy9kZWZpbmUgaXRzZWxmIGFnYWluLiBJZiBhbHJlYWR5IGluIHRoZSBwcm9jZXNzXG4gICAgICAgICAgICAgICAgICAgIC8vb2YgZG9pbmcgdGhhdCwgc2tpcCB0aGlzIHdvcmsuXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVmaW5pbmcgPSB0cnVlO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmRlcENvdW50IDwgMSAmJiAhdGhpcy5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNGdW5jdGlvbihmYWN0b3J5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydHMgPSBjb250ZXh0LmV4ZWNDYihpZCwgZmFjdG9yeSwgZGVwRXhwb3J0cywgZXhwb3J0cyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnIgPSBlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZhdm9yIHJldHVybiB2YWx1ZSBvdmVyIGV4cG9ydHMuIElmIG5vZGUvY2pzIGluIHBsYXksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlbiB3aWxsIG5vdCBoYXZlIGEgcmV0dXJuIHZhbHVlIGFueXdheS4gRmF2b3JcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBtb2R1bGUuZXhwb3J0cyBhc3NpZ25tZW50IG92ZXIgZXhwb3J0cyBvYmplY3QuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMubWFwLmlzRGVmaW5lICYmIGV4cG9ydHMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjanNNb2R1bGUgPSB0aGlzLm1vZHVsZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNqc01vZHVsZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhwb3J0cyA9IGNqc01vZHVsZS5leHBvcnRzO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMudXNpbmdFeHBvcnRzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL2V4cG9ydHMgYWxyZWFkeSBzZXQgdGhlIGRlZmluZWQgdmFsdWUuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHBvcnRzID0gdGhpcy5leHBvcnRzO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBJZiB0aGVyZSBpcyBhbiBlcnJvciBsaXN0ZW5lciwgZmF2b3IgcGFzc2luZ1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0byB0aGF0IGluc3RlYWQgb2YgdGhyb3dpbmcgYW4gZXJyb3IuIEhvd2V2ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIG9ubHkgZG8gaXQgZm9yIGRlZmluZSgpJ2QgIG1vZHVsZXMuIHJlcXVpcmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZXJyYmFja3Mgc2hvdWxkIG5vdCBiZSBjYWxsZWQgZm9yIGZhaWx1cmVzIGluXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHRoZWlyIGNhbGxiYWNrcyAoIzY5OSkuIEhvd2V2ZXIgaWYgYSBnbG9iYWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gb25FcnJvciBpcyBzZXQsIHVzZSB0aGF0LlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoKHRoaXMuZXZlbnRzLmVycm9yICYmIHRoaXMubWFwLmlzRGVmaW5lKSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVxLm9uRXJyb3IgIT09IGRlZmF1bHRPbkVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnIucmVxdWlyZU1hcCA9IHRoaXMubWFwO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyLnJlcXVpcmVNb2R1bGVzID0gdGhpcy5tYXAuaXNEZWZpbmUgPyBbdGhpcy5tYXAuaWRdIDogbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVyci5yZXF1aXJlVHlwZSA9IHRoaXMubWFwLmlzRGVmaW5lID8gJ2RlZmluZScgOiAncmVxdWlyZSc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gb25FcnJvcigodGhpcy5lcnJvciA9IGVycikpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb25zb2xlICE9PSAndW5kZWZpbmVkJyAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIExvZyB0aGUgZXJyb3IgZm9yIGRlYnVnZ2luZy4gSWYgcHJvbWlzZXMgY291bGQgYmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHVzZWQsIHRoaXMgd291bGQgYmUgZGlmZmVyZW50LCBidXQgbWFraW5nIGRvLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihlcnIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRG8gbm90IHdhbnQgdG8gY29tcGxldGVseSBsb3NlIHRoZSBlcnJvci4gV2hpbGUgdGhpc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gd2lsbCBtZXNzIHVwIHByb2Nlc3NpbmcgYW5kIGxlYWQgdG8gc2ltaWxhciByZXN1bHRzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBhcyBidWcgMTQ0MCwgaXQgYXQgbGVhc3Qgc3VyZmFjZXMgdGhlIGVycm9yLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVxLm9uRXJyb3IoZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy9KdXN0IGEgbGl0ZXJhbCB2YWx1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4cG9ydHMgPSBmYWN0b3J5O1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmV4cG9ydHMgPSBleHBvcnRzO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5tYXAuaXNEZWZpbmUgJiYgIXRoaXMuaWdub3JlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmaW5lZFtpZF0gPSBleHBvcnRzO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlcS5vblJlc291cmNlTG9hZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVzTG9hZE1hcHMgPSBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWFjaCh0aGlzLmRlcE1hcHMsIGZ1bmN0aW9uIChkZXBNYXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc0xvYWRNYXBzLnB1c2goZGVwTWFwLm5vcm1hbGl6ZWRNYXAgfHwgZGVwTWFwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcS5vblJlc291cmNlTG9hZChjb250ZXh0LCB0aGlzLm1hcCwgcmVzTG9hZE1hcHMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgLy9DbGVhbiB1cFxuICAgICAgICAgICAgICAgICAgICAgICAgY2xlYW5SZWdpc3RyeShpZCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZGVmaW5lZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvL0ZpbmlzaGVkIHRoZSBkZWZpbmUgc3RhZ2UuIEFsbG93IGNhbGxpbmcgY2hlY2sgYWdhaW5cbiAgICAgICAgICAgICAgICAgICAgLy90byBhbGxvdyBkZWZpbmUgbm90aWZpY2F0aW9ucyBiZWxvdyBpbiB0aGUgY2FzZSBvZiBhXG4gICAgICAgICAgICAgICAgICAgIC8vY3ljbGUuXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZGVmaW5pbmcgPSBmYWxzZTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5kZWZpbmVkICYmICF0aGlzLmRlZmluZUVtaXR0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZGVmaW5lRW1pdHRlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoJ2RlZmluZWQnLCB0aGlzLmV4cG9ydHMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWZpbmVFbWl0Q29tcGxldGUgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICBjYWxsUGx1Z2luOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIG1hcCA9IHRoaXMubWFwLFxuICAgICAgICAgICAgICAgICAgICBpZCA9IG1hcC5pZCxcbiAgICAgICAgICAgICAgICAgICAgLy9NYXAgYWxyZWFkeSBub3JtYWxpemVkIHRoZSBwcmVmaXguXG4gICAgICAgICAgICAgICAgICAgIHBsdWdpbk1hcCA9IG1ha2VNb2R1bGVNYXAobWFwLnByZWZpeCk7XG5cbiAgICAgICAgICAgICAgICAvL01hcmsgdGhpcyBhcyBhIGRlcGVuZGVuY3kgZm9yIHRoaXMgcGx1Z2luLCBzbyBpdFxuICAgICAgICAgICAgICAgIC8vY2FuIGJlIHRyYWNlZCBmb3IgY3ljbGVzLlxuICAgICAgICAgICAgICAgIHRoaXMuZGVwTWFwcy5wdXNoKHBsdWdpbk1hcCk7XG5cbiAgICAgICAgICAgICAgICBvbihwbHVnaW5NYXAsICdkZWZpbmVkJywgYmluZCh0aGlzLCBmdW5jdGlvbiAocGx1Z2luKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBsb2FkLCBub3JtYWxpemVkTWFwLCBub3JtYWxpemVkTW9kLFxuICAgICAgICAgICAgICAgICAgICAgICAgYnVuZGxlSWQgPSBnZXRPd24oYnVuZGxlc01hcCwgdGhpcy5tYXAuaWQpLFxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZSA9IHRoaXMubWFwLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJlbnROYW1lID0gdGhpcy5tYXAucGFyZW50TWFwID8gdGhpcy5tYXAucGFyZW50TWFwLm5hbWUgOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICAgICAgbG9jYWxSZXF1aXJlID0gY29udGV4dC5tYWtlUmVxdWlyZShtYXAucGFyZW50TWFwLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW5hYmxlQnVpbGRDYWxsYmFjazogdHJ1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy9JZiBjdXJyZW50IG1hcCBpcyBub3Qgbm9ybWFsaXplZCwgd2FpdCBmb3IgdGhhdFxuICAgICAgICAgICAgICAgICAgICAvL25vcm1hbGl6ZWQgbmFtZSB0byBsb2FkIGluc3RlYWQgb2YgY29udGludWluZy5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMubWFwLnVubm9ybWFsaXplZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy9Ob3JtYWxpemUgdGhlIElEIGlmIHRoZSBwbHVnaW4gYWxsb3dzIGl0LlxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBsdWdpbi5ub3JtYWxpemUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lID0gcGx1Z2luLm5vcm1hbGl6ZShuYW1lLCBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbm9ybWFsaXplKG5hbWUsIHBhcmVudE5hbWUsIHRydWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pIHx8ICcnO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAvL3ByZWZpeCBhbmQgbmFtZSBzaG91bGQgYWxyZWFkeSBiZSBub3JtYWxpemVkLCBubyBuZWVkXG4gICAgICAgICAgICAgICAgICAgICAgICAvL2ZvciBhcHBseWluZyBtYXAgY29uZmlnIGFnYWluIGVpdGhlci5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5vcm1hbGl6ZWRNYXAgPSBtYWtlTW9kdWxlTWFwKG1hcC5wcmVmaXggKyAnIScgKyBuYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5tYXAucGFyZW50TWFwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG9uKG5vcm1hbGl6ZWRNYXAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2RlZmluZWQnLCBiaW5kKHRoaXMsIGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLm1hcC5ub3JtYWxpemVkTWFwID0gbm9ybWFsaXplZE1hcDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5pbml0KFtdLCBmdW5jdGlvbiAoKSB7IHJldHVybiB2YWx1ZTsgfSwgbnVsbCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlnbm9yZTogdHJ1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5vcm1hbGl6ZWRNb2QgPSBnZXRPd24ocmVnaXN0cnksIG5vcm1hbGl6ZWRNYXAuaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG5vcm1hbGl6ZWRNb2QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL01hcmsgdGhpcyBhcyBhIGRlcGVuZGVuY3kgZm9yIHRoaXMgcGx1Z2luLCBzbyBpdFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vY2FuIGJlIHRyYWNlZCBmb3IgY3ljbGVzLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZGVwTWFwcy5wdXNoKG5vcm1hbGl6ZWRNYXApO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuZXZlbnRzLmVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5vcm1hbGl6ZWRNb2Qub24oJ2Vycm9yJywgYmluZCh0aGlzLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBub3JtYWxpemVkTW9kLmVuYWJsZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvL0lmIGEgcGF0aHMgY29uZmlnLCB0aGVuIGp1c3QgbG9hZCB0aGF0IGZpbGUgaW5zdGVhZCB0b1xuICAgICAgICAgICAgICAgICAgICAvL3Jlc29sdmUgdGhlIHBsdWdpbiwgYXMgaXQgaXMgYnVpbHQgaW50byB0aGF0IHBhdGhzIGxheWVyLlxuICAgICAgICAgICAgICAgICAgICBpZiAoYnVuZGxlSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubWFwLnVybCA9IGNvbnRleHQubmFtZVRvVXJsKGJ1bmRsZUlkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9hZCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgbG9hZCA9IGJpbmQodGhpcywgZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmluaXQoW10sIGZ1bmN0aW9uICgpIHsgcmV0dXJuIHZhbHVlOyB9LCBudWxsLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIGxvYWQuZXJyb3IgPSBiaW5kKHRoaXMsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuaW5pdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZXJyb3IgPSBlcnI7XG4gICAgICAgICAgICAgICAgICAgICAgICBlcnIucmVxdWlyZU1vZHVsZXMgPSBbaWRdO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvL1JlbW92ZSB0ZW1wIHVubm9ybWFsaXplZCBtb2R1bGVzIGZvciB0aGlzIG1vZHVsZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vc2luY2UgdGhleSB3aWxsIG5ldmVyIGJlIHJlc29sdmVkIG90aGVyd2lzZSBub3cuXG4gICAgICAgICAgICAgICAgICAgICAgICBlYWNoUHJvcChyZWdpc3RyeSwgZnVuY3Rpb24gKG1vZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtb2QubWFwLmlkLmluZGV4T2YoaWQgKyAnX3Vubm9ybWFsaXplZCcpID09PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFuUmVnaXN0cnkobW9kLm1hcC5pZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uRXJyb3IoZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy9BbGxvdyBwbHVnaW5zIHRvIGxvYWQgb3RoZXIgY29kZSB3aXRob3V0IGhhdmluZyB0byBrbm93IHRoZVxuICAgICAgICAgICAgICAgICAgICAvL2NvbnRleHQgb3IgaG93IHRvICdjb21wbGV0ZScgdGhlIGxvYWQuXG4gICAgICAgICAgICAgICAgICAgIGxvYWQuZnJvbVRleHQgPSBiaW5kKHRoaXMsIGZ1bmN0aW9uICh0ZXh0LCB0ZXh0QWx0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvKmpzbGludCBldmlsOiB0cnVlICovXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgbW9kdWxlTmFtZSA9IG1hcC5uYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZHVsZU1hcCA9IG1ha2VNb2R1bGVNYXAobW9kdWxlTmFtZSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFzSW50ZXJhY3RpdmUgPSB1c2VJbnRlcmFjdGl2ZTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgLy9BcyBvZiAyLjEuMCwgc3VwcG9ydCBqdXN0IHBhc3NpbmcgdGhlIHRleHQsIHRvIHJlaW5mb3JjZVxuICAgICAgICAgICAgICAgICAgICAgICAgLy9mcm9tVGV4dCBvbmx5IGJlaW5nIGNhbGxlZCBvbmNlIHBlciByZXNvdXJjZS4gU3RpbGxcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vc3VwcG9ydCBvbGQgc3R5bGUgb2YgcGFzc2luZyBtb2R1bGVOYW1lIGJ1dCBkaXNjYXJkXG4gICAgICAgICAgICAgICAgICAgICAgICAvL3RoYXQgbW9kdWxlTmFtZSBpbiBmYXZvciBvZiB0aGUgaW50ZXJuYWwgcmVmLlxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRleHRBbHQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdGV4dEFsdDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgLy9UdXJuIG9mZiBpbnRlcmFjdGl2ZSBzY3JpcHQgbWF0Y2hpbmcgZm9yIElFIGZvciBhbnkgZGVmaW5lXG4gICAgICAgICAgICAgICAgICAgICAgICAvL2NhbGxzIGluIHRoZSB0ZXh0LCB0aGVuIHR1cm4gaXQgYmFjayBvbiBhdCB0aGUgZW5kLlxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGhhc0ludGVyYWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlSW50ZXJhY3RpdmUgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgLy9QcmltZSB0aGUgc3lzdGVtIGJ5IGNyZWF0aW5nIGEgbW9kdWxlIGluc3RhbmNlIGZvclxuICAgICAgICAgICAgICAgICAgICAgICAgLy9pdC5cbiAgICAgICAgICAgICAgICAgICAgICAgIGdldE1vZHVsZShtb2R1bGVNYXApO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvL1RyYW5zZmVyIGFueSBjb25maWcgdG8gdGhpcyBvdGhlciBtb2R1bGUuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaGFzUHJvcChjb25maWcuY29uZmlnLCBpZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25maWcuY29uZmlnW21vZHVsZU5hbWVdID0gY29uZmlnLmNvbmZpZ1tpZF07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVxLmV4ZWModGV4dCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9uRXJyb3IobWFrZUVycm9yKCdmcm9tdGV4dGV2YWwnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Zyb21UZXh0IGV2YWwgZm9yICcgKyBpZCArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICcgZmFpbGVkOiAnICsgZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBbaWRdKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChoYXNJbnRlcmFjdGl2ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVzZUludGVyYWN0aXZlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgLy9NYXJrIHRoaXMgYXMgYSBkZXBlbmRlbmN5IGZvciB0aGUgcGx1Z2luXG4gICAgICAgICAgICAgICAgICAgICAgICAvL3Jlc291cmNlXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmRlcE1hcHMucHVzaChtb2R1bGVNYXApO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAvL1N1cHBvcnQgYW5vbnltb3VzIG1vZHVsZXMuXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZXh0LmNvbXBsZXRlTG9hZChtb2R1bGVOYW1lKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgLy9CaW5kIHRoZSB2YWx1ZSBvZiB0aGF0IG1vZHVsZSB0byB0aGUgdmFsdWUgZm9yIHRoaXNcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vcmVzb3VyY2UgSUQuXG4gICAgICAgICAgICAgICAgICAgICAgICBsb2NhbFJlcXVpcmUoW21vZHVsZU5hbWVdLCBsb2FkKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy9Vc2UgcGFyZW50TmFtZSBoZXJlIHNpbmNlIHRoZSBwbHVnaW4ncyBuYW1lIGlzIG5vdCByZWxpYWJsZSxcbiAgICAgICAgICAgICAgICAgICAgLy9jb3VsZCBiZSBzb21lIHdlaXJkIHN0cmluZyB3aXRoIG5vIHBhdGggdGhhdCBhY3R1YWxseSB3YW50cyB0b1xuICAgICAgICAgICAgICAgICAgICAvL3JlZmVyZW5jZSB0aGUgcGFyZW50TmFtZSdzIHBhdGguXG4gICAgICAgICAgICAgICAgICAgIHBsdWdpbi5sb2FkKG1hcC5uYW1lLCBsb2NhbFJlcXVpcmUsIGxvYWQsIGNvbmZpZyk7XG4gICAgICAgICAgICAgICAgfSkpO1xuXG4gICAgICAgICAgICAgICAgY29udGV4dC5lbmFibGUocGx1Z2luTWFwLCB0aGlzKTtcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbk1hcHNbcGx1Z2luTWFwLmlkXSA9IHBsdWdpbk1hcDtcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIGVuYWJsZTogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGVuYWJsZWRSZWdpc3RyeVt0aGlzLm1hcC5pZF0gPSB0aGlzO1xuICAgICAgICAgICAgICAgIHRoaXMuZW5hYmxlZCA9IHRydWU7XG5cbiAgICAgICAgICAgICAgICAvL1NldCBmbGFnIG1lbnRpb25pbmcgdGhhdCB0aGUgbW9kdWxlIGlzIGVuYWJsaW5nLFxuICAgICAgICAgICAgICAgIC8vc28gdGhhdCBpbW1lZGlhdGUgY2FsbHMgdG8gdGhlIGRlZmluZWQgY2FsbGJhY2tzXG4gICAgICAgICAgICAgICAgLy9mb3IgZGVwZW5kZW5jaWVzIGRvIG5vdCB0cmlnZ2VyIGluYWR2ZXJ0ZW50IGxvYWRcbiAgICAgICAgICAgICAgICAvL3dpdGggdGhlIGRlcENvdW50IHN0aWxsIGJlaW5nIHplcm8uXG4gICAgICAgICAgICAgICAgdGhpcy5lbmFibGluZyA9IHRydWU7XG5cbiAgICAgICAgICAgICAgICAvL0VuYWJsZSBlYWNoIGRlcGVuZGVuY3lcbiAgICAgICAgICAgICAgICBlYWNoKHRoaXMuZGVwTWFwcywgYmluZCh0aGlzLCBmdW5jdGlvbiAoZGVwTWFwLCBpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBpZCwgbW9kLCBoYW5kbGVyO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgZGVwTWFwID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy9EZXBlbmRlbmN5IG5lZWRzIHRvIGJlIGNvbnZlcnRlZCB0byBhIGRlcE1hcFxuICAgICAgICAgICAgICAgICAgICAgICAgLy9hbmQgd2lyZWQgdXAgdG8gdGhpcyBtb2R1bGUuXG4gICAgICAgICAgICAgICAgICAgICAgICBkZXBNYXAgPSBtYWtlTW9kdWxlTWFwKGRlcE1hcCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHRoaXMubWFwLmlzRGVmaW5lID8gdGhpcy5tYXAgOiB0aGlzLm1hcC5wYXJlbnRNYXApLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIXRoaXMuc2tpcE1hcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmRlcE1hcHNbaV0gPSBkZXBNYXA7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbmRsZXIgPSBnZXRPd24oaGFuZGxlcnMsIGRlcE1hcC5pZCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChoYW5kbGVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5kZXBFeHBvcnRzW2ldID0gaGFuZGxlcih0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZGVwQ291bnQgKz0gMTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgb24oZGVwTWFwLCAnZGVmaW5lZCcsIGJpbmQodGhpcywgZnVuY3Rpb24gKGRlcEV4cG9ydHMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy51bmRlZmVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5kZWZpbmVEZXAoaSwgZGVwRXhwb3J0cyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5jaGVjaygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSkpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5lcnJiYWNrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb24oZGVwTWFwLCAnZXJyb3InLCBiaW5kKHRoaXMsIHRoaXMuZXJyYmFjaykpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLmV2ZW50cy5lcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIE5vIGRpcmVjdCBlcnJiYWNrIG9uIHRoaXMgbW9kdWxlLCBidXQgc29tZXRoaW5nXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZWxzZSBpcyBsaXN0ZW5pbmcgZm9yIGVycm9ycywgc28gYmUgc3VyZSB0b1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHByb3BhZ2F0ZSB0aGUgZXJyb3IgY29ycmVjdGx5LlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uKGRlcE1hcCwgJ2Vycm9yJywgYmluZCh0aGlzLCBmdW5jdGlvbihlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KCdlcnJvcicsIGVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgaWQgPSBkZXBNYXAuaWQ7XG4gICAgICAgICAgICAgICAgICAgIG1vZCA9IHJlZ2lzdHJ5W2lkXTtcblxuICAgICAgICAgICAgICAgICAgICAvL1NraXAgc3BlY2lhbCBtb2R1bGVzIGxpa2UgJ3JlcXVpcmUnLCAnZXhwb3J0cycsICdtb2R1bGUnXG4gICAgICAgICAgICAgICAgICAgIC8vQWxzbywgZG9uJ3QgY2FsbCBlbmFibGUgaWYgaXQgaXMgYWxyZWFkeSBlbmFibGVkLFxuICAgICAgICAgICAgICAgICAgICAvL2ltcG9ydGFudCBpbiBjaXJjdWxhciBkZXBlbmRlbmN5IGNhc2VzLlxuICAgICAgICAgICAgICAgICAgICBpZiAoIWhhc1Byb3AoaGFuZGxlcnMsIGlkKSAmJiBtb2QgJiYgIW1vZC5lbmFibGVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZXh0LmVuYWJsZShkZXBNYXAsIHRoaXMpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSkpO1xuXG4gICAgICAgICAgICAgICAgLy9FbmFibGUgZWFjaCBwbHVnaW4gdGhhdCBpcyB1c2VkIGluXG4gICAgICAgICAgICAgICAgLy9hIGRlcGVuZGVuY3lcbiAgICAgICAgICAgICAgICBlYWNoUHJvcCh0aGlzLnBsdWdpbk1hcHMsIGJpbmQodGhpcywgZnVuY3Rpb24gKHBsdWdpbk1hcCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgbW9kID0gZ2V0T3duKHJlZ2lzdHJ5LCBwbHVnaW5NYXAuaWQpO1xuICAgICAgICAgICAgICAgICAgICBpZiAobW9kICYmICFtb2QuZW5hYmxlZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29udGV4dC5lbmFibGUocGx1Z2luTWFwLCB0aGlzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgICAgIHRoaXMuZW5hYmxpbmcgPSBmYWxzZTtcblxuICAgICAgICAgICAgICAgIHRoaXMuY2hlY2soKTtcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIG9uOiBmdW5jdGlvbiAobmFtZSwgY2IpIHtcbiAgICAgICAgICAgICAgICB2YXIgY2JzID0gdGhpcy5ldmVudHNbbmFtZV07XG4gICAgICAgICAgICAgICAgaWYgKCFjYnMpIHtcbiAgICAgICAgICAgICAgICAgICAgY2JzID0gdGhpcy5ldmVudHNbbmFtZV0gPSBbXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2JzLnB1c2goY2IpO1xuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgZW1pdDogZnVuY3Rpb24gKG5hbWUsIGV2dCkge1xuICAgICAgICAgICAgICAgIGVhY2godGhpcy5ldmVudHNbbmFtZV0sIGZ1bmN0aW9uIChjYikge1xuICAgICAgICAgICAgICAgICAgICBjYihldnQpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIGlmIChuYW1lID09PSAnZXJyb3InKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vTm93IHRoYXQgdGhlIGVycm9yIGhhbmRsZXIgd2FzIHRyaWdnZXJlZCwgcmVtb3ZlXG4gICAgICAgICAgICAgICAgICAgIC8vdGhlIGxpc3RlbmVycywgc2luY2UgdGhpcyBicm9rZW4gTW9kdWxlIGluc3RhbmNlXG4gICAgICAgICAgICAgICAgICAgIC8vY2FuIHN0YXkgYXJvdW5kIGZvciBhIHdoaWxlIGluIHRoZSByZWdpc3RyeS5cbiAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuZXZlbnRzW25hbWVdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBmdW5jdGlvbiBjYWxsR2V0TW9kdWxlKGFyZ3MpIHtcbiAgICAgICAgICAgIC8vU2tpcCBtb2R1bGVzIGFscmVhZHkgZGVmaW5lZC5cbiAgICAgICAgICAgIGlmICghaGFzUHJvcChkZWZpbmVkLCBhcmdzWzBdKSkge1xuICAgICAgICAgICAgICAgIGdldE1vZHVsZShtYWtlTW9kdWxlTWFwKGFyZ3NbMF0sIG51bGwsIHRydWUpKS5pbml0KGFyZ3NbMV0sIGFyZ3NbMl0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gcmVtb3ZlTGlzdGVuZXIobm9kZSwgZnVuYywgbmFtZSwgaWVOYW1lKSB7XG4gICAgICAgICAgICAvL0Zhdm9yIGRldGFjaEV2ZW50IGJlY2F1c2Ugb2YgSUU5XG4gICAgICAgICAgICAvL2lzc3VlLCBzZWUgYXR0YWNoRXZlbnQvYWRkRXZlbnRMaXN0ZW5lciBjb21tZW50IGVsc2V3aGVyZVxuICAgICAgICAgICAgLy9pbiB0aGlzIGZpbGUuXG4gICAgICAgICAgICBpZiAobm9kZS5kZXRhY2hFdmVudCAmJiAhaXNPcGVyYSkge1xuICAgICAgICAgICAgICAgIC8vUHJvYmFibHkgSUUuIElmIG5vdCBpdCB3aWxsIHRocm93IGFuIGVycm9yLCB3aGljaCB3aWxsIGJlXG4gICAgICAgICAgICAgICAgLy91c2VmdWwgdG8ga25vdy5cbiAgICAgICAgICAgICAgICBpZiAoaWVOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuZGV0YWNoRXZlbnQoaWVOYW1lLCBmdW5jKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihuYW1lLCBmdW5jLCBmYWxzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgICogR2l2ZW4gYW4gZXZlbnQgZnJvbSBhIHNjcmlwdCBub2RlLCBnZXQgdGhlIHJlcXVpcmVqcyBpbmZvIGZyb20gaXQsXG4gICAgICAgICAqIGFuZCB0aGVuIHJlbW92ZXMgdGhlIGV2ZW50IGxpc3RlbmVycyBvbiB0aGUgbm9kZS5cbiAgICAgICAgICogQHBhcmFtIHtFdmVudH0gZXZ0XG4gICAgICAgICAqIEByZXR1cm5zIHtPYmplY3R9XG4gICAgICAgICAqL1xuICAgICAgICBmdW5jdGlvbiBnZXRTY3JpcHREYXRhKGV2dCkge1xuICAgICAgICAgICAgLy9Vc2luZyBjdXJyZW50VGFyZ2V0IGluc3RlYWQgb2YgdGFyZ2V0IGZvciBGaXJlZm94IDIuMCdzIHNha2UuIE5vdFxuICAgICAgICAgICAgLy9hbGwgb2xkIGJyb3dzZXJzIHdpbGwgYmUgc3VwcG9ydGVkLCBidXQgdGhpcyBvbmUgd2FzIGVhc3kgZW5vdWdoXG4gICAgICAgICAgICAvL3RvIHN1cHBvcnQgYW5kIHN0aWxsIG1ha2VzIHNlbnNlLlxuICAgICAgICAgICAgdmFyIG5vZGUgPSBldnQuY3VycmVudFRhcmdldCB8fCBldnQuc3JjRWxlbWVudDtcblxuICAgICAgICAgICAgLy9SZW1vdmUgdGhlIGxpc3RlbmVycyBvbmNlIGhlcmUuXG4gICAgICAgICAgICByZW1vdmVMaXN0ZW5lcihub2RlLCBjb250ZXh0Lm9uU2NyaXB0TG9hZCwgJ2xvYWQnLCAnb25yZWFkeXN0YXRlY2hhbmdlJyk7XG4gICAgICAgICAgICByZW1vdmVMaXN0ZW5lcihub2RlLCBjb250ZXh0Lm9uU2NyaXB0RXJyb3IsICdlcnJvcicpO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIG5vZGU6IG5vZGUsXG4gICAgICAgICAgICAgICAgaWQ6IG5vZGUgJiYgbm9kZS5nZXRBdHRyaWJ1dGUoJ2RhdGEtcmVxdWlyZW1vZHVsZScpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gaW50YWtlRGVmaW5lcygpIHtcbiAgICAgICAgICAgIHZhciBhcmdzO1xuXG4gICAgICAgICAgICAvL0FueSBkZWZpbmVkIG1vZHVsZXMgaW4gdGhlIGdsb2JhbCBxdWV1ZSwgaW50YWtlIHRoZW0gbm93LlxuICAgICAgICAgICAgdGFrZUdsb2JhbFF1ZXVlKCk7XG5cbiAgICAgICAgICAgIC8vTWFrZSBzdXJlIGFueSByZW1haW5pbmcgZGVmUXVldWUgaXRlbXMgZ2V0IHByb3Blcmx5IHByb2Nlc3NlZC5cbiAgICAgICAgICAgIHdoaWxlIChkZWZRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhcmdzID0gZGVmUXVldWUuc2hpZnQoKTtcbiAgICAgICAgICAgICAgICBpZiAoYXJnc1swXSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gb25FcnJvcihtYWtlRXJyb3IoJ21pc21hdGNoJywgJ01pc21hdGNoZWQgYW5vbnltb3VzIGRlZmluZSgpIG1vZHVsZTogJyArXG4gICAgICAgICAgICAgICAgICAgICAgICBhcmdzW2FyZ3MubGVuZ3RoIC0gMV0pKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvL2FyZ3MgYXJlIGlkLCBkZXBzLCBmYWN0b3J5LiBTaG91bGQgYmUgbm9ybWFsaXplZCBieSB0aGVcbiAgICAgICAgICAgICAgICAgICAgLy9kZWZpbmUoKSBmdW5jdGlvbi5cbiAgICAgICAgICAgICAgICAgICAgY2FsbEdldE1vZHVsZShhcmdzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250ZXh0LmRlZlF1ZXVlTWFwID0ge307XG4gICAgICAgIH1cblxuICAgICAgICBjb250ZXh0ID0ge1xuICAgICAgICAgICAgY29uZmlnOiBjb25maWcsXG4gICAgICAgICAgICBjb250ZXh0TmFtZTogY29udGV4dE5hbWUsXG4gICAgICAgICAgICByZWdpc3RyeTogcmVnaXN0cnksXG4gICAgICAgICAgICBkZWZpbmVkOiBkZWZpbmVkLFxuICAgICAgICAgICAgdXJsRmV0Y2hlZDogdXJsRmV0Y2hlZCxcbiAgICAgICAgICAgIGRlZlF1ZXVlOiBkZWZRdWV1ZSxcbiAgICAgICAgICAgIGRlZlF1ZXVlTWFwOiB7fSxcbiAgICAgICAgICAgIE1vZHVsZTogTW9kdWxlLFxuICAgICAgICAgICAgbWFrZU1vZHVsZU1hcDogbWFrZU1vZHVsZU1hcCxcbiAgICAgICAgICAgIG5leHRUaWNrOiByZXEubmV4dFRpY2ssXG4gICAgICAgICAgICBvbkVycm9yOiBvbkVycm9yLFxuXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIFNldCBhIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBjb250ZXh0LlxuICAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGNmZyBjb25maWcgb2JqZWN0IHRvIGludGVncmF0ZS5cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgY29uZmlndXJlOiBmdW5jdGlvbiAoY2ZnKSB7XG4gICAgICAgICAgICAgICAgLy9NYWtlIHN1cmUgdGhlIGJhc2VVcmwgZW5kcyBpbiBhIHNsYXNoLlxuICAgICAgICAgICAgICAgIGlmIChjZmcuYmFzZVVybCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY2ZnLmJhc2VVcmwuY2hhckF0KGNmZy5iYXNlVXJsLmxlbmd0aCAtIDEpICE9PSAnLycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNmZy5iYXNlVXJsICs9ICcvJztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vU2F2ZSBvZmYgdGhlIHBhdGhzIHNpbmNlIHRoZXkgcmVxdWlyZSBzcGVjaWFsIHByb2Nlc3NpbmcsXG4gICAgICAgICAgICAgICAgLy90aGV5IGFyZSBhZGRpdGl2ZS5cbiAgICAgICAgICAgICAgICB2YXIgc2hpbSA9IGNvbmZpZy5zaGltLFxuICAgICAgICAgICAgICAgICAgICBvYmpzID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF0aHM6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBidW5kbGVzOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWFwOiB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICBlYWNoUHJvcChjZmcsIGZ1bmN0aW9uICh2YWx1ZSwgcHJvcCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAob2Jqc1twcm9wXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFjb25maWdbcHJvcF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25maWdbcHJvcF0gPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIG1peGluKGNvbmZpZ1twcm9wXSwgdmFsdWUsIHRydWUsIHRydWUpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnW3Byb3BdID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIC8vUmV2ZXJzZSBtYXAgdGhlIGJ1bmRsZXNcbiAgICAgICAgICAgICAgICBpZiAoY2ZnLmJ1bmRsZXMpIHtcbiAgICAgICAgICAgICAgICAgICAgZWFjaFByb3AoY2ZnLmJ1bmRsZXMsIGZ1bmN0aW9uICh2YWx1ZSwgcHJvcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZWFjaCh2YWx1ZSwgZnVuY3Rpb24gKHYpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodiAhPT0gcHJvcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBidW5kbGVzTWFwW3ZdID0gcHJvcDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy9NZXJnZSBzaGltXG4gICAgICAgICAgICAgICAgaWYgKGNmZy5zaGltKSB7XG4gICAgICAgICAgICAgICAgICAgIGVhY2hQcm9wKGNmZy5zaGltLCBmdW5jdGlvbiAodmFsdWUsIGlkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvL05vcm1hbGl6ZSB0aGUgc3RydWN0dXJlXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVwczogdmFsdWVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCh2YWx1ZS5leHBvcnRzIHx8IHZhbHVlLmluaXQpICYmICF2YWx1ZS5leHBvcnRzRm4pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZS5leHBvcnRzRm4gPSBjb250ZXh0Lm1ha2VTaGltRXhwb3J0cyh2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBzaGltW2lkXSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnLnNoaW0gPSBzaGltO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vQWRqdXN0IHBhY2thZ2VzIGlmIG5lY2Vzc2FyeS5cbiAgICAgICAgICAgICAgICBpZiAoY2ZnLnBhY2thZ2VzKSB7XG4gICAgICAgICAgICAgICAgICAgIGVhY2goY2ZnLnBhY2thZ2VzLCBmdW5jdGlvbiAocGtnT2JqKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgbG9jYXRpb24sIG5hbWU7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHBrZ09iaiA9IHR5cGVvZiBwa2dPYmogPT09ICdzdHJpbmcnID8ge25hbWU6IHBrZ09ian0gOiBwa2dPYmo7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWUgPSBwa2dPYmoubmFtZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvY2F0aW9uID0gcGtnT2JqLmxvY2F0aW9uO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGxvY2F0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnLnBhdGhzW25hbWVdID0gcGtnT2JqLmxvY2F0aW9uO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAvL1NhdmUgcG9pbnRlciB0byBtYWluIG1vZHVsZSBJRCBmb3IgcGtnIG5hbWUuXG4gICAgICAgICAgICAgICAgICAgICAgICAvL1JlbW92ZSBsZWFkaW5nIGRvdCBpbiBtYWluLCBzbyBtYWluIHBhdGhzIGFyZSBub3JtYWxpemVkLFxuICAgICAgICAgICAgICAgICAgICAgICAgLy9hbmQgcmVtb3ZlIGFueSB0cmFpbGluZyAuanMsIHNpbmNlIGRpZmZlcmVudCBwYWNrYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAvL2VudnMgaGF2ZSBkaWZmZXJlbnQgY29udmVudGlvbnM6IHNvbWUgdXNlIGEgbW9kdWxlIG5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAvL3NvbWUgdXNlIGEgZmlsZSBuYW1lLlxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlnLnBrZ3NbbmFtZV0gPSBwa2dPYmoubmFtZSArICcvJyArIChwa2dPYmoubWFpbiB8fCAnbWFpbicpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoY3VyckRpclJlZ0V4cCwgJycpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoanNTdWZmaXhSZWdFeHAsICcnKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy9JZiB0aGVyZSBhcmUgYW55IFwid2FpdGluZyB0byBleGVjdXRlXCIgbW9kdWxlcyBpbiB0aGUgcmVnaXN0cnksXG4gICAgICAgICAgICAgICAgLy91cGRhdGUgdGhlIG1hcHMgZm9yIHRoZW0sIHNpbmNlIHRoZWlyIGluZm8sIGxpa2UgVVJMcyB0byBsb2FkLFxuICAgICAgICAgICAgICAgIC8vbWF5IGhhdmUgY2hhbmdlZC5cbiAgICAgICAgICAgICAgICBlYWNoUHJvcChyZWdpc3RyeSwgZnVuY3Rpb24gKG1vZCwgaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgLy9JZiBtb2R1bGUgYWxyZWFkeSBoYXMgaW5pdCBjYWxsZWQsIHNpbmNlIGl0IGlzIHRvb1xuICAgICAgICAgICAgICAgICAgICAvL2xhdGUgdG8gbW9kaWZ5IHRoZW0sIGFuZCBpZ25vcmUgdW5ub3JtYWxpemVkIG9uZXNcbiAgICAgICAgICAgICAgICAgICAgLy9zaW5jZSB0aGV5IGFyZSB0cmFuc2llbnQuXG4gICAgICAgICAgICAgICAgICAgIGlmICghbW9kLmluaXRlZCAmJiAhbW9kLm1hcC51bm5vcm1hbGl6ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZC5tYXAgPSBtYWtlTW9kdWxlTWFwKGlkLCBudWxsLCB0cnVlKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgLy9JZiBhIGRlcHMgYXJyYXkgb3IgYSBjb25maWcgY2FsbGJhY2sgaXMgc3BlY2lmaWVkLCB0aGVuIGNhbGxcbiAgICAgICAgICAgICAgICAvL3JlcXVpcmUgd2l0aCB0aG9zZSBhcmdzLiBUaGlzIGlzIHVzZWZ1bCB3aGVuIHJlcXVpcmUgaXMgZGVmaW5lZCBhcyBhXG4gICAgICAgICAgICAgICAgLy9jb25maWcgb2JqZWN0IGJlZm9yZSByZXF1aXJlLmpzIGlzIGxvYWRlZC5cbiAgICAgICAgICAgICAgICBpZiAoY2ZnLmRlcHMgfHwgY2ZnLmNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRleHQucmVxdWlyZShjZmcuZGVwcyB8fCBbXSwgY2ZnLmNhbGxiYWNrKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICBtYWtlU2hpbUV4cG9ydHM6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgIGZ1bmN0aW9uIGZuKCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgcmV0O1xuICAgICAgICAgICAgICAgICAgICBpZiAodmFsdWUuaW5pdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0ID0gdmFsdWUuaW5pdC5hcHBseShnbG9iYWwsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJldCB8fCAodmFsdWUuZXhwb3J0cyAmJiBnZXRHbG9iYWwodmFsdWUuZXhwb3J0cykpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gZm47XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICBtYWtlUmVxdWlyZTogZnVuY3Rpb24gKHJlbE1hcCwgb3B0aW9ucykge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgICAgICAgICAgICAgZnVuY3Rpb24gbG9jYWxSZXF1aXJlKGRlcHMsIGNhbGxiYWNrLCBlcnJiYWNrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBpZCwgbWFwLCByZXF1aXJlTW9kO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChvcHRpb25zLmVuYWJsZUJ1aWxkQ2FsbGJhY2sgJiYgY2FsbGJhY2sgJiYgaXNGdW5jdGlvbihjYWxsYmFjaykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrLl9fcmVxdWlyZUpzQnVpbGQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBkZXBzID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlzRnVuY3Rpb24oY2FsbGJhY2spKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy9JbnZhbGlkIGNhbGxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gb25FcnJvcihtYWtlRXJyb3IoJ3JlcXVpcmVhcmdzJywgJ0ludmFsaWQgcmVxdWlyZSBjYWxsJyksIGVycmJhY2spO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAvL0lmIHJlcXVpcmV8ZXhwb3J0c3xtb2R1bGUgYXJlIHJlcXVlc3RlZCwgZ2V0IHRoZVxuICAgICAgICAgICAgICAgICAgICAgICAgLy92YWx1ZSBmb3IgdGhlbSBmcm9tIHRoZSBzcGVjaWFsIGhhbmRsZXJzLiBDYXZlYXQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAvL3RoaXMgb25seSB3b3JrcyB3aGlsZSBtb2R1bGUgaXMgYmVpbmcgZGVmaW5lZC5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZWxNYXAgJiYgaGFzUHJvcChoYW5kbGVycywgZGVwcykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gaGFuZGxlcnNbZGVwc10ocmVnaXN0cnlbcmVsTWFwLmlkXSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vU3luY2hyb25vdXMgYWNjZXNzIHRvIG9uZSBtb2R1bGUuIElmIHJlcXVpcmUuZ2V0IGlzXG4gICAgICAgICAgICAgICAgICAgICAgICAvL2F2YWlsYWJsZSAoYXMgaW4gdGhlIE5vZGUgYWRhcHRlciksIHByZWZlciB0aGF0LlxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlcS5nZXQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVxLmdldChjb250ZXh0LCBkZXBzLCByZWxNYXAsIGxvY2FsUmVxdWlyZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vTm9ybWFsaXplIG1vZHVsZSBuYW1lLCBpZiBpdCBjb250YWlucyAuIG9yIC4uXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXAgPSBtYWtlTW9kdWxlTWFwKGRlcHMsIHJlbE1hcCwgZmFsc2UsIHRydWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQgPSBtYXAuaWQ7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghaGFzUHJvcChkZWZpbmVkLCBpZCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gb25FcnJvcihtYWtlRXJyb3IoJ25vdGxvYWRlZCcsICdNb2R1bGUgbmFtZSBcIicgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlkICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnXCIgaGFzIG5vdCBiZWVuIGxvYWRlZCB5ZXQgZm9yIGNvbnRleHQ6ICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRleHROYW1lICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocmVsTWFwID8gJycgOiAnLiBVc2UgcmVxdWlyZShbXSknKSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGRlZmluZWRbaWRdO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgLy9HcmFiIGRlZmluZXMgd2FpdGluZyBpbiB0aGUgZ2xvYmFsIHF1ZXVlLlxuICAgICAgICAgICAgICAgICAgICBpbnRha2VEZWZpbmVzKCk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy9NYXJrIGFsbCB0aGUgZGVwZW5kZW5jaWVzIGFzIG5lZWRpbmcgdG8gYmUgbG9hZGVkLlxuICAgICAgICAgICAgICAgICAgICBjb250ZXh0Lm5leHRUaWNrKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vU29tZSBkZWZpbmVzIGNvdWxkIGhhdmUgYmVlbiBhZGRlZCBzaW5jZSB0aGVcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vcmVxdWlyZSBjYWxsLCBjb2xsZWN0IHRoZW0uXG4gICAgICAgICAgICAgICAgICAgICAgICBpbnRha2VEZWZpbmVzKCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVpcmVNb2QgPSBnZXRNb2R1bGUobWFrZU1vZHVsZU1hcChudWxsLCByZWxNYXApKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgLy9TdG9yZSBpZiBtYXAgY29uZmlnIHNob3VsZCBiZSBhcHBsaWVkIHRvIHRoaXMgcmVxdWlyZVxuICAgICAgICAgICAgICAgICAgICAgICAgLy9jYWxsIGZvciBkZXBlbmRlbmNpZXMuXG4gICAgICAgICAgICAgICAgICAgICAgICByZXF1aXJlTW9kLnNraXBNYXAgPSBvcHRpb25zLnNraXBNYXA7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVpcmVNb2QuaW5pdChkZXBzLCBjYWxsYmFjaywgZXJyYmFjaywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGVja0xvYWRlZCgpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbG9jYWxSZXF1aXJlO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIG1peGluKGxvY2FsUmVxdWlyZSwge1xuICAgICAgICAgICAgICAgICAgICBpc0Jyb3dzZXI6IGlzQnJvd3NlcixcblxuICAgICAgICAgICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAgICAgICAgICogQ29udmVydHMgYSBtb2R1bGUgbmFtZSArIC5leHRlbnNpb24gaW50byBhbiBVUkwgcGF0aC5cbiAgICAgICAgICAgICAgICAgICAgICogKlJlcXVpcmVzKiB0aGUgdXNlIG9mIGEgbW9kdWxlIG5hbWUuIEl0IGRvZXMgbm90IHN1cHBvcnQgdXNpbmdcbiAgICAgICAgICAgICAgICAgICAgICogcGxhaW4gVVJMcyBsaWtlIG5hbWVUb1VybC5cbiAgICAgICAgICAgICAgICAgICAgICovXG4gICAgICAgICAgICAgICAgICAgIHRvVXJsOiBmdW5jdGlvbiAobW9kdWxlTmFtZVBsdXNFeHQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBleHQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXggPSBtb2R1bGVOYW1lUGx1c0V4dC5sYXN0SW5kZXhPZignLicpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlZ21lbnQgPSBtb2R1bGVOYW1lUGx1c0V4dC5zcGxpdCgnLycpWzBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzUmVsYXRpdmUgPSBzZWdtZW50ID09PSAnLicgfHwgc2VnbWVudCA9PT0gJy4uJztcblxuICAgICAgICAgICAgICAgICAgICAgICAgLy9IYXZlIGEgZmlsZSBleHRlbnNpb24gYWxpYXMsIGFuZCBpdCBpcyBub3QgdGhlXG4gICAgICAgICAgICAgICAgICAgICAgICAvL2RvdHMgZnJvbSBhIHJlbGF0aXZlIHBhdGguXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaW5kZXggIT09IC0xICYmICghaXNSZWxhdGl2ZSB8fCBpbmRleCA+IDEpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXh0ID0gbW9kdWxlTmFtZVBsdXNFeHQuc3Vic3RyaW5nKGluZGV4LCBtb2R1bGVOYW1lUGx1c0V4dC5sZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZHVsZU5hbWVQbHVzRXh0ID0gbW9kdWxlTmFtZVBsdXNFeHQuc3Vic3RyaW5nKDAsIGluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRleHQubmFtZVRvVXJsKG5vcm1hbGl6ZShtb2R1bGVOYW1lUGx1c0V4dCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbE1hcCAmJiByZWxNYXAuaWQsIHRydWUpLCBleHQsICB0cnVlKTtcbiAgICAgICAgICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgICAgICAgICBkZWZpbmVkOiBmdW5jdGlvbiAoaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBoYXNQcm9wKGRlZmluZWQsIG1ha2VNb2R1bGVNYXAoaWQsIHJlbE1hcCwgZmFsc2UsIHRydWUpLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgICAgICAgICBzcGVjaWZpZWQ6IGZ1bmN0aW9uIChpZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQgPSBtYWtlTW9kdWxlTWFwKGlkLCByZWxNYXAsIGZhbHNlLCB0cnVlKS5pZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBoYXNQcm9wKGRlZmluZWQsIGlkKSB8fCBoYXNQcm9wKHJlZ2lzdHJ5LCBpZCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIC8vT25seSBhbGxvdyB1bmRlZiBvbiB0b3AgbGV2ZWwgcmVxdWlyZSBjYWxsc1xuICAgICAgICAgICAgICAgIGlmICghcmVsTWFwKSB7XG4gICAgICAgICAgICAgICAgICAgIGxvY2FsUmVxdWlyZS51bmRlZiA9IGZ1bmN0aW9uIChpZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy9CaW5kIGFueSB3YWl0aW5nIGRlZmluZSgpIGNhbGxzIHRvIHRoaXMgY29udGV4dCxcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vZml4IGZvciAjNDA4XG4gICAgICAgICAgICAgICAgICAgICAgICB0YWtlR2xvYmFsUXVldWUoKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIG1hcCA9IG1ha2VNb2R1bGVNYXAoaWQsIHJlbE1hcCwgdHJ1ZSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kID0gZ2V0T3duKHJlZ2lzdHJ5LCBpZCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZC51bmRlZmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlbW92ZVNjcmlwdChpZCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBkZWZpbmVkW2lkXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSB1cmxGZXRjaGVkW21hcC51cmxdO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHVuZGVmRXZlbnRzW2lkXTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgLy9DbGVhbiBxdWV1ZWQgZGVmaW5lcyB0b28uIEdvIGJhY2t3YXJkc1xuICAgICAgICAgICAgICAgICAgICAgICAgLy9pbiBhcnJheSBzbyB0aGF0IHRoZSBzcGxpY2VzIGRvIG5vdFxuICAgICAgICAgICAgICAgICAgICAgICAgLy9tZXNzIHVwIHRoZSBpdGVyYXRpb24uXG4gICAgICAgICAgICAgICAgICAgICAgICBlYWNoUmV2ZXJzZShkZWZRdWV1ZSwgZnVuY3Rpb24oYXJncywgaSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChhcmdzWzBdID09PSBpZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZRdWV1ZS5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWxldGUgY29udGV4dC5kZWZRdWV1ZU1hcFtpZF07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtb2QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL0hvbGQgb24gdG8gbGlzdGVuZXJzIGluIGNhc2UgdGhlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy9tb2R1bGUgd2lsbCBiZSBhdHRlbXB0ZWQgdG8gYmUgcmVsb2FkZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL3VzaW5nIGEgZGlmZmVyZW50IGNvbmZpZy5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobW9kLmV2ZW50cy5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVuZGVmRXZlbnRzW2lkXSA9IG1vZC5ldmVudHM7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xlYW5SZWdpc3RyeShpZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGxvY2FsUmVxdWlyZTtcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogQ2FsbGVkIHRvIGVuYWJsZSBhIG1vZHVsZSBpZiBpdCBpcyBzdGlsbCBpbiB0aGUgcmVnaXN0cnlcbiAgICAgICAgICAgICAqIGF3YWl0aW5nIGVuYWJsZW1lbnQuIEEgc2Vjb25kIGFyZywgcGFyZW50LCB0aGUgcGFyZW50IG1vZHVsZSxcbiAgICAgICAgICAgICAqIGlzIHBhc3NlZCBpbiBmb3IgY29udGV4dCwgd2hlbiB0aGlzIG1ldGhvZCBpcyBvdmVycmlkZGVuIGJ5XG4gICAgICAgICAgICAgKiB0aGUgb3B0aW1pemVyLiBOb3Qgc2hvd24gaGVyZSB0byBrZWVwIGNvZGUgY29tcGFjdC5cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgZW5hYmxlOiBmdW5jdGlvbiAoZGVwTWFwKSB7XG4gICAgICAgICAgICAgICAgdmFyIG1vZCA9IGdldE93bihyZWdpc3RyeSwgZGVwTWFwLmlkKTtcbiAgICAgICAgICAgICAgICBpZiAobW9kKSB7XG4gICAgICAgICAgICAgICAgICAgIGdldE1vZHVsZShkZXBNYXApLmVuYWJsZSgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogSW50ZXJuYWwgbWV0aG9kIHVzZWQgYnkgZW52aXJvbm1lbnQgYWRhcHRlcnMgdG8gY29tcGxldGUgYSBsb2FkIGV2ZW50LlxuICAgICAgICAgICAgICogQSBsb2FkIGV2ZW50IGNvdWxkIGJlIGEgc2NyaXB0IGxvYWQgb3IganVzdCBhIGxvYWQgcGFzcyBmcm9tIGEgc3luY2hyb25vdXNcbiAgICAgICAgICAgICAqIGxvYWQgY2FsbC5cbiAgICAgICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBtb2R1bGVOYW1lIHRoZSBuYW1lIG9mIHRoZSBtb2R1bGUgdG8gcG90ZW50aWFsbHkgY29tcGxldGUuXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGNvbXBsZXRlTG9hZDogZnVuY3Rpb24gKG1vZHVsZU5hbWUpIHtcbiAgICAgICAgICAgICAgICB2YXIgZm91bmQsIGFyZ3MsIG1vZCxcbiAgICAgICAgICAgICAgICAgICAgc2hpbSA9IGdldE93bihjb25maWcuc2hpbSwgbW9kdWxlTmFtZSkgfHwge30sXG4gICAgICAgICAgICAgICAgICAgIHNoRXhwb3J0cyA9IHNoaW0uZXhwb3J0cztcblxuICAgICAgICAgICAgICAgIHRha2VHbG9iYWxRdWV1ZSgpO1xuXG4gICAgICAgICAgICAgICAgd2hpbGUgKGRlZlF1ZXVlLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBhcmdzID0gZGVmUXVldWUuc2hpZnQoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFyZ3NbMF0gPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFyZ3NbMF0gPSBtb2R1bGVOYW1lO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy9JZiBhbHJlYWR5IGZvdW5kIGFuIGFub255bW91cyBtb2R1bGUgYW5kIGJvdW5kIGl0XG4gICAgICAgICAgICAgICAgICAgICAgICAvL3RvIHRoaXMgbmFtZSwgdGhlbiB0aGlzIGlzIHNvbWUgb3RoZXIgYW5vbiBtb2R1bGVcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vd2FpdGluZyBmb3IgaXRzIGNvbXBsZXRlTG9hZCB0byBmaXJlLlxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoYXJnc1swXSA9PT0gbW9kdWxlTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy9Gb3VuZCBtYXRjaGluZyBkZWZpbmUgY2FsbCBmb3IgdGhpcyBzY3JpcHQhXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBjYWxsR2V0TW9kdWxlKGFyZ3MpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjb250ZXh0LmRlZlF1ZXVlTWFwID0ge307XG5cbiAgICAgICAgICAgICAgICAvL0RvIHRoaXMgYWZ0ZXIgdGhlIGN5Y2xlIG9mIGNhbGxHZXRNb2R1bGUgaW4gY2FzZSB0aGUgcmVzdWx0XG4gICAgICAgICAgICAgICAgLy9vZiB0aG9zZSBjYWxscy9pbml0IGNhbGxzIGNoYW5nZXMgdGhlIHJlZ2lzdHJ5LlxuICAgICAgICAgICAgICAgIG1vZCA9IGdldE93bihyZWdpc3RyeSwgbW9kdWxlTmFtZSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoIWZvdW5kICYmICFoYXNQcm9wKGRlZmluZWQsIG1vZHVsZU5hbWUpICYmIG1vZCAmJiAhbW9kLmluaXRlZCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY29uZmlnLmVuZm9yY2VEZWZpbmUgJiYgKCFzaEV4cG9ydHMgfHwgIWdldEdsb2JhbChzaEV4cG9ydHMpKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGhhc1BhdGhGYWxsYmFjayhtb2R1bGVOYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9uRXJyb3IobWFrZUVycm9yKCdub2RlZmluZScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnTm8gZGVmaW5lIGNhbGwgZm9yICcgKyBtb2R1bGVOYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFttb2R1bGVOYW1lXSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy9BIHNjcmlwdCB0aGF0IGRvZXMgbm90IGNhbGwgZGVmaW5lKCksIHNvIGp1c3Qgc2ltdWxhdGVcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vdGhlIGNhbGwgZm9yIGl0LlxuICAgICAgICAgICAgICAgICAgICAgICAgY2FsbEdldE1vZHVsZShbbW9kdWxlTmFtZSwgKHNoaW0uZGVwcyB8fCBbXSksIHNoaW0uZXhwb3J0c0ZuXSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjaGVja0xvYWRlZCgpO1xuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBDb252ZXJ0cyBhIG1vZHVsZSBuYW1lIHRvIGEgZmlsZSBwYXRoLiBTdXBwb3J0cyBjYXNlcyB3aGVyZVxuICAgICAgICAgICAgICogbW9kdWxlTmFtZSBtYXkgYWN0dWFsbHkgYmUganVzdCBhbiBVUkwuXG4gICAgICAgICAgICAgKiBOb3RlIHRoYXQgaXQgKipkb2VzIG5vdCoqIGNhbGwgbm9ybWFsaXplIG9uIHRoZSBtb2R1bGVOYW1lLFxuICAgICAgICAgICAgICogaXQgaXMgYXNzdW1lZCB0byBoYXZlIGFscmVhZHkgYmVlbiBub3JtYWxpemVkLiBUaGlzIGlzIGFuXG4gICAgICAgICAgICAgKiBpbnRlcm5hbCBBUEksIG5vdCBhIHB1YmxpYyBvbmUuIFVzZSB0b1VybCBmb3IgdGhlIHB1YmxpYyBBUEkuXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIG5hbWVUb1VybDogZnVuY3Rpb24gKG1vZHVsZU5hbWUsIGV4dCwgc2tpcEV4dCkge1xuICAgICAgICAgICAgICAgIHZhciBwYXRocywgc3ltcywgaSwgcGFyZW50TW9kdWxlLCB1cmwsXG4gICAgICAgICAgICAgICAgICAgIHBhcmVudFBhdGgsIGJ1bmRsZUlkLFxuICAgICAgICAgICAgICAgICAgICBwa2dNYWluID0gZ2V0T3duKGNvbmZpZy5wa2dzLCBtb2R1bGVOYW1lKTtcblxuICAgICAgICAgICAgICAgIGlmIChwa2dNYWluKSB7XG4gICAgICAgICAgICAgICAgICAgIG1vZHVsZU5hbWUgPSBwa2dNYWluO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGJ1bmRsZUlkID0gZ2V0T3duKGJ1bmRsZXNNYXAsIG1vZHVsZU5hbWUpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGJ1bmRsZUlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjb250ZXh0Lm5hbWVUb1VybChidW5kbGVJZCwgZXh0LCBza2lwRXh0KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAvL0lmIGEgY29sb24gaXMgaW4gdGhlIFVSTCwgaXQgaW5kaWNhdGVzIGEgcHJvdG9jb2wgaXMgdXNlZCBhbmQgaXQgaXMganVzdFxuICAgICAgICAgICAgICAgIC8vYW4gVVJMIHRvIGEgZmlsZSwgb3IgaWYgaXQgc3RhcnRzIHdpdGggYSBzbGFzaCwgY29udGFpbnMgYSBxdWVyeSBhcmcgKGkuZS4gPylcbiAgICAgICAgICAgICAgICAvL29yIGVuZHMgd2l0aCAuanMsIHRoZW4gYXNzdW1lIHRoZSB1c2VyIG1lYW50IHRvIHVzZSBhbiB1cmwgYW5kIG5vdCBhIG1vZHVsZSBpZC5cbiAgICAgICAgICAgICAgICAvL1RoZSBzbGFzaCBpcyBpbXBvcnRhbnQgZm9yIHByb3RvY29sLWxlc3MgVVJMcyBhcyB3ZWxsIGFzIGZ1bGwgcGF0aHMuXG4gICAgICAgICAgICAgICAgaWYgKHJlcS5qc0V4dFJlZ0V4cC50ZXN0KG1vZHVsZU5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vSnVzdCBhIHBsYWluIHBhdGgsIG5vdCBtb2R1bGUgbmFtZSBsb29rdXAsIHNvIGp1c3QgcmV0dXJuIGl0LlxuICAgICAgICAgICAgICAgICAgICAvL0FkZCBleHRlbnNpb24gaWYgaXQgaXMgaW5jbHVkZWQuIFRoaXMgaXMgYSBiaXQgd29ua3ksIG9ubHkgbm9uLS5qcyB0aGluZ3MgcGFzc1xuICAgICAgICAgICAgICAgICAgICAvL2FuIGV4dGVuc2lvbiwgdGhpcyBtZXRob2QgcHJvYmFibHkgbmVlZHMgdG8gYmUgcmV3b3JrZWQuXG4gICAgICAgICAgICAgICAgICAgIHVybCA9IG1vZHVsZU5hbWUgKyAoZXh0IHx8ICcnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvL0EgbW9kdWxlIHRoYXQgbmVlZHMgdG8gYmUgY29udmVydGVkIHRvIGEgcGF0aC5cbiAgICAgICAgICAgICAgICAgICAgcGF0aHMgPSBjb25maWcucGF0aHM7XG5cbiAgICAgICAgICAgICAgICAgICAgc3ltcyA9IG1vZHVsZU5hbWUuc3BsaXQoJy8nKTtcbiAgICAgICAgICAgICAgICAgICAgLy9Gb3IgZWFjaCBtb2R1bGUgbmFtZSBzZWdtZW50LCBzZWUgaWYgdGhlcmUgaXMgYSBwYXRoXG4gICAgICAgICAgICAgICAgICAgIC8vcmVnaXN0ZXJlZCBmb3IgaXQuIFN0YXJ0IHdpdGggbW9zdCBzcGVjaWZpYyBuYW1lXG4gICAgICAgICAgICAgICAgICAgIC8vYW5kIHdvcmsgdXAgZnJvbSBpdC5cbiAgICAgICAgICAgICAgICAgICAgZm9yIChpID0gc3ltcy5sZW5ndGg7IGkgPiAwOyBpIC09IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhcmVudE1vZHVsZSA9IHN5bXMuc2xpY2UoMCwgaSkuam9pbignLycpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJlbnRQYXRoID0gZ2V0T3duKHBhdGhzLCBwYXJlbnRNb2R1bGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBhcmVudFBhdGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL0lmIGFuIGFycmF5LCBpdCBtZWFucyB0aGVyZSBhcmUgYSBmZXcgY2hvaWNlcyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL0Nob29zZSB0aGUgb25lIHRoYXQgaXMgZGVzaXJlZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpc0FycmF5KHBhcmVudFBhdGgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmVudFBhdGggPSBwYXJlbnRQYXRoWzBdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzeW1zLnNwbGljZSgwLCBpLCBwYXJlbnRQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vSm9pbiB0aGUgcGF0aCBwYXJ0cyB0b2dldGhlciwgdGhlbiBmaWd1cmUgb3V0IGlmIGJhc2VVcmwgaXMgbmVlZGVkLlxuICAgICAgICAgICAgICAgICAgICB1cmwgPSBzeW1zLmpvaW4oJy8nKTtcbiAgICAgICAgICAgICAgICAgICAgdXJsICs9IChleHQgfHwgKC9eZGF0YVxcOnxcXD8vLnRlc3QodXJsKSB8fCBza2lwRXh0ID8gJycgOiAnLmpzJykpO1xuICAgICAgICAgICAgICAgICAgICB1cmwgPSAodXJsLmNoYXJBdCgwKSA9PT0gJy8nIHx8IHVybC5tYXRjaCgvXltcXHdcXCtcXC5cXC1dKzovKSA/ICcnIDogY29uZmlnLmJhc2VVcmwpICsgdXJsO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiBjb25maWcudXJsQXJncyA/IHVybCArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKCh1cmwuaW5kZXhPZignPycpID09PSAtMSA/ICc/JyA6ICcmJykgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25maWcudXJsQXJncykgOiB1cmw7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAvL0RlbGVnYXRlcyB0byByZXEubG9hZC4gQnJva2VuIG91dCBhcyBhIHNlcGFyYXRlIGZ1bmN0aW9uIHRvXG4gICAgICAgICAgICAvL2FsbG93IG92ZXJyaWRpbmcgaW4gdGhlIG9wdGltaXplci5cbiAgICAgICAgICAgIGxvYWQ6IGZ1bmN0aW9uIChpZCwgdXJsKSB7XG4gICAgICAgICAgICAgICAgcmVxLmxvYWQoY29udGV4dCwgaWQsIHVybCk7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIEV4ZWN1dGVzIGEgbW9kdWxlIGNhbGxiYWNrIGZ1bmN0aW9uLiBCcm9rZW4gb3V0IGFzIGEgc2VwYXJhdGUgZnVuY3Rpb25cbiAgICAgICAgICAgICAqIHNvbGVseSB0byBhbGxvdyB0aGUgYnVpbGQgc3lzdGVtIHRvIHNlcXVlbmNlIHRoZSBmaWxlcyBpbiB0aGUgYnVpbHRcbiAgICAgICAgICAgICAqIGxheWVyIGluIHRoZSByaWdodCBzZXF1ZW5jZS5cbiAgICAgICAgICAgICAqXG4gICAgICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBleGVjQ2I6IGZ1bmN0aW9uIChuYW1lLCBjYWxsYmFjaywgYXJncywgZXhwb3J0cykge1xuICAgICAgICAgICAgICAgIHJldHVybiBjYWxsYmFjay5hcHBseShleHBvcnRzLCBhcmdzKTtcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogY2FsbGJhY2sgZm9yIHNjcmlwdCBsb2FkcywgdXNlZCB0byBjaGVjayBzdGF0dXMgb2YgbG9hZGluZy5cbiAgICAgICAgICAgICAqXG4gICAgICAgICAgICAgKiBAcGFyYW0ge0V2ZW50fSBldnQgdGhlIGV2ZW50IGZyb20gdGhlIGJyb3dzZXIgZm9yIHRoZSBzY3JpcHRcbiAgICAgICAgICAgICAqIHRoYXQgd2FzIGxvYWRlZC5cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgb25TY3JpcHRMb2FkOiBmdW5jdGlvbiAoZXZ0KSB7XG4gICAgICAgICAgICAgICAgLy9Vc2luZyBjdXJyZW50VGFyZ2V0IGluc3RlYWQgb2YgdGFyZ2V0IGZvciBGaXJlZm94IDIuMCdzIHNha2UuIE5vdFxuICAgICAgICAgICAgICAgIC8vYWxsIG9sZCBicm93c2VycyB3aWxsIGJlIHN1cHBvcnRlZCwgYnV0IHRoaXMgb25lIHdhcyBlYXN5IGVub3VnaFxuICAgICAgICAgICAgICAgIC8vdG8gc3VwcG9ydCBhbmQgc3RpbGwgbWFrZXMgc2Vuc2UuXG4gICAgICAgICAgICAgICAgaWYgKGV2dC50eXBlID09PSAnbG9hZCcgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgIChyZWFkeVJlZ0V4cC50ZXN0KChldnQuY3VycmVudFRhcmdldCB8fCBldnQuc3JjRWxlbWVudCkucmVhZHlTdGF0ZSkpKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vUmVzZXQgaW50ZXJhY3RpdmUgc2NyaXB0IHNvIGEgc2NyaXB0IG5vZGUgaXMgbm90IGhlbGQgb250byBmb3JcbiAgICAgICAgICAgICAgICAgICAgLy90byBsb25nLlxuICAgICAgICAgICAgICAgICAgICBpbnRlcmFjdGl2ZVNjcmlwdCA9IG51bGw7XG5cbiAgICAgICAgICAgICAgICAgICAgLy9QdWxsIG91dCB0aGUgbmFtZSBvZiB0aGUgbW9kdWxlIGFuZCB0aGUgY29udGV4dC5cbiAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGEgPSBnZXRTY3JpcHREYXRhKGV2dCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRleHQuY29tcGxldGVMb2FkKGRhdGEuaWQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogQ2FsbGJhY2sgZm9yIHNjcmlwdCBlcnJvcnMuXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIG9uU2NyaXB0RXJyb3I6IGZ1bmN0aW9uIChldnQpIHtcbiAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IGdldFNjcmlwdERhdGEoZXZ0KTtcbiAgICAgICAgICAgICAgICBpZiAoIWhhc1BhdGhGYWxsYmFjayhkYXRhLmlkKSkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgcGFyZW50cyA9IFtdO1xuICAgICAgICAgICAgICAgICAgICBlYWNoUHJvcChyZWdpc3RyeSwgZnVuY3Rpb24odmFsdWUsIGtleSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGtleS5pbmRleE9mKCdfQHInKSAhPT0gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVhY2godmFsdWUuZGVwTWFwcywgZnVuY3Rpb24oZGVwTWFwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChkZXBNYXAuaWQgPT09IGRhdGEuaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmVudHMucHVzaChrZXkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9uRXJyb3IobWFrZUVycm9yKCdzY3JpcHRlcnJvcicsICdTY3JpcHQgZXJyb3IgZm9yIFwiJyArIGRhdGEuaWQgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHBhcmVudHMubGVuZ3RoID9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdcIiwgbmVlZGVkIGJ5OiAnICsgcGFyZW50cy5qb2luKCcsICcpIDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdcIicpLCBldnQsIFtkYXRhLmlkXSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBjb250ZXh0LnJlcXVpcmUgPSBjb250ZXh0Lm1ha2VSZXF1aXJlKCk7XG4gICAgICAgIHJldHVybiBjb250ZXh0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE1haW4gZW50cnkgcG9pbnQuXG4gICAgICpcbiAgICAgKiBJZiB0aGUgb25seSBhcmd1bWVudCB0byByZXF1aXJlIGlzIGEgc3RyaW5nLCB0aGVuIHRoZSBtb2R1bGUgdGhhdFxuICAgICAqIGlzIHJlcHJlc2VudGVkIGJ5IHRoYXQgc3RyaW5nIGlzIGZldGNoZWQgZm9yIHRoZSBhcHByb3ByaWF0ZSBjb250ZXh0LlxuICAgICAqXG4gICAgICogSWYgdGhlIGZpcnN0IGFyZ3VtZW50IGlzIGFuIGFycmF5LCB0aGVuIGl0IHdpbGwgYmUgdHJlYXRlZCBhcyBhbiBhcnJheVxuICAgICAqIG9mIGRlcGVuZGVuY3kgc3RyaW5nIG5hbWVzIHRvIGZldGNoLiBBbiBvcHRpb25hbCBmdW5jdGlvbiBjYWxsYmFjayBjYW5cbiAgICAgKiBiZSBzcGVjaWZpZWQgdG8gZXhlY3V0ZSB3aGVuIGFsbCBvZiB0aG9zZSBkZXBlbmRlbmNpZXMgYXJlIGF2YWlsYWJsZS5cbiAgICAgKlxuICAgICAqIE1ha2UgYSBsb2NhbCByZXEgdmFyaWFibGUgdG8gaGVscCBDYWphIGNvbXBsaWFuY2UgKGl0IGFzc3VtZXMgdGhpbmdzXG4gICAgICogb24gYSByZXF1aXJlIHRoYXQgYXJlIG5vdCBzdGFuZGFyZGl6ZWQpLCBhbmQgdG8gZ2l2ZSBhIHNob3J0XG4gICAgICogbmFtZSBmb3IgbWluaWZpY2F0aW9uL2xvY2FsIHNjb3BlIHVzZS5cbiAgICAgKi9cbiAgICByZXEgPSByZXF1aXJlanMgPSBmdW5jdGlvbiAoZGVwcywgY2FsbGJhY2ssIGVycmJhY2ssIG9wdGlvbmFsKSB7XG5cbiAgICAgICAgLy9GaW5kIHRoZSByaWdodCBjb250ZXh0LCB1c2UgZGVmYXVsdFxuICAgICAgICB2YXIgY29udGV4dCwgY29uZmlnLFxuICAgICAgICAgICAgY29udGV4dE5hbWUgPSBkZWZDb250ZXh0TmFtZTtcblxuICAgICAgICAvLyBEZXRlcm1pbmUgaWYgaGF2ZSBjb25maWcgb2JqZWN0IGluIHRoZSBjYWxsLlxuICAgICAgICBpZiAoIWlzQXJyYXkoZGVwcykgJiYgdHlwZW9mIGRlcHMgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAvLyBkZXBzIGlzIGEgY29uZmlnIG9iamVjdFxuICAgICAgICAgICAgY29uZmlnID0gZGVwcztcbiAgICAgICAgICAgIGlmIChpc0FycmF5KGNhbGxiYWNrKSkge1xuICAgICAgICAgICAgICAgIC8vIEFkanVzdCBhcmdzIGlmIHRoZXJlIGFyZSBkZXBlbmRlbmNpZXNcbiAgICAgICAgICAgICAgICBkZXBzID0gY2FsbGJhY2s7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2sgPSBlcnJiYWNrO1xuICAgICAgICAgICAgICAgIGVycmJhY2sgPSBvcHRpb25hbDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZGVwcyA9IFtdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNvbmZpZyAmJiBjb25maWcuY29udGV4dCkge1xuICAgICAgICAgICAgY29udGV4dE5hbWUgPSBjb25maWcuY29udGV4dDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRleHQgPSBnZXRPd24oY29udGV4dHMsIGNvbnRleHROYW1lKTtcbiAgICAgICAgaWYgKCFjb250ZXh0KSB7XG4gICAgICAgICAgICBjb250ZXh0ID0gY29udGV4dHNbY29udGV4dE5hbWVdID0gcmVxLnMubmV3Q29udGV4dChjb250ZXh0TmFtZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29uZmlnKSB7XG4gICAgICAgICAgICBjb250ZXh0LmNvbmZpZ3VyZShjb25maWcpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNvbnRleHQucmVxdWlyZShkZXBzLCBjYWxsYmFjaywgZXJyYmFjayk7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFN1cHBvcnQgcmVxdWlyZS5jb25maWcoKSB0byBtYWtlIGl0IGVhc2llciB0byBjb29wZXJhdGUgd2l0aCBvdGhlclxuICAgICAqIEFNRCBsb2FkZXJzIG9uIGdsb2JhbGx5IGFncmVlZCBuYW1lcy5cbiAgICAgKi9cbiAgICByZXEuY29uZmlnID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAgICAgICByZXR1cm4gcmVxKGNvbmZpZyk7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIEV4ZWN1dGUgc29tZXRoaW5nIGFmdGVyIHRoZSBjdXJyZW50IHRpY2tcbiAgICAgKiBvZiB0aGUgZXZlbnQgbG9vcC4gT3ZlcnJpZGUgZm9yIG90aGVyIGVudnNcbiAgICAgKiB0aGF0IGhhdmUgYSBiZXR0ZXIgc29sdXRpb24gdGhhbiBzZXRUaW1lb3V0LlxuICAgICAqIEBwYXJhbSAge0Z1bmN0aW9ufSBmbiBmdW5jdGlvbiB0byBleGVjdXRlIGxhdGVyLlxuICAgICAqL1xuICAgIHJlcS5uZXh0VGljayA9IHR5cGVvZiBzZXRUaW1lb3V0ICE9PSAndW5kZWZpbmVkJyA/IGZ1bmN0aW9uIChmbikge1xuICAgICAgICBzZXRUaW1lb3V0KGZuLCA0KTtcbiAgICB9IDogZnVuY3Rpb24gKGZuKSB7IGZuKCk7IH07XG5cbiAgICAvKipcbiAgICAgKiBFeHBvcnQgcmVxdWlyZSBhcyBhIGdsb2JhbCwgYnV0IG9ubHkgaWYgaXQgZG9lcyBub3QgYWxyZWFkeSBleGlzdC5cbiAgICAgKi9cbiAgICBpZiAoIXJlcXVpcmUpIHtcbiAgICAgICAgcmVxdWlyZSA9IHJlcTtcbiAgICB9XG5cbiAgICByZXEudmVyc2lvbiA9IHZlcnNpb247XG5cbiAgICAvL1VzZWQgdG8gZmlsdGVyIG91dCBkZXBlbmRlbmNpZXMgdGhhdCBhcmUgYWxyZWFkeSBwYXRocy5cbiAgICByZXEuanNFeHRSZWdFeHAgPSAvXlxcL3w6fFxcP3xcXC5qcyQvO1xuICAgIHJlcS5pc0Jyb3dzZXIgPSBpc0Jyb3dzZXI7XG4gICAgcyA9IHJlcS5zID0ge1xuICAgICAgICBjb250ZXh0czogY29udGV4dHMsXG4gICAgICAgIG5ld0NvbnRleHQ6IG5ld0NvbnRleHRcbiAgICB9O1xuXG4gICAgLy9DcmVhdGUgZGVmYXVsdCBjb250ZXh0LlxuICAgIHJlcSh7fSk7XG5cbiAgICAvL0V4cG9ydHMgc29tZSBjb250ZXh0LXNlbnNpdGl2ZSBtZXRob2RzIG9uIGdsb2JhbCByZXF1aXJlLlxuICAgIGVhY2goW1xuICAgICAgICAndG9VcmwnLFxuICAgICAgICAndW5kZWYnLFxuICAgICAgICAnZGVmaW5lZCcsXG4gICAgICAgICdzcGVjaWZpZWQnXG4gICAgXSwgZnVuY3Rpb24gKHByb3ApIHtcbiAgICAgICAgLy9SZWZlcmVuY2UgZnJvbSBjb250ZXh0cyBpbnN0ZWFkIG9mIGVhcmx5IGJpbmRpbmcgdG8gZGVmYXVsdCBjb250ZXh0LFxuICAgICAgICAvL3NvIHRoYXQgZHVyaW5nIGJ1aWxkcywgdGhlIGxhdGVzdCBpbnN0YW5jZSBvZiB0aGUgZGVmYXVsdCBjb250ZXh0XG4gICAgICAgIC8vd2l0aCBpdHMgY29uZmlnIGdldHMgdXNlZC5cbiAgICAgICAgcmVxW3Byb3BdID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGN0eCA9IGNvbnRleHRzW2RlZkNvbnRleHROYW1lXTtcbiAgICAgICAgICAgIHJldHVybiBjdHgucmVxdWlyZVtwcm9wXS5hcHBseShjdHgsIGFyZ3VtZW50cyk7XG4gICAgICAgIH07XG4gICAgfSk7XG5cbiAgICBpZiAoaXNCcm93c2VyKSB7XG4gICAgICAgIGhlYWQgPSBzLmhlYWQgPSBkb2N1bWVudC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnaGVhZCcpWzBdO1xuICAgICAgICAvL0lmIEJBU0UgdGFnIGlzIGluIHBsYXksIHVzaW5nIGFwcGVuZENoaWxkIGlzIGEgcHJvYmxlbSBmb3IgSUU2LlxuICAgICAgICAvL1doZW4gdGhhdCBicm93c2VyIGRpZXMsIHRoaXMgY2FuIGJlIHJlbW92ZWQuIERldGFpbHMgaW4gdGhpcyBqUXVlcnkgYnVnOlxuICAgICAgICAvL2h0dHA6Ly9kZXYuanF1ZXJ5LmNvbS90aWNrZXQvMjcwOVxuICAgICAgICBiYXNlRWxlbWVudCA9IGRvY3VtZW50LmdldEVsZW1lbnRzQnlUYWdOYW1lKCdiYXNlJylbMF07XG4gICAgICAgIGlmIChiYXNlRWxlbWVudCkge1xuICAgICAgICAgICAgaGVhZCA9IHMuaGVhZCA9IGJhc2VFbGVtZW50LnBhcmVudE5vZGU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBBbnkgZXJyb3JzIHRoYXQgcmVxdWlyZSBleHBsaWNpdGx5IGdlbmVyYXRlcyB3aWxsIGJlIHBhc3NlZCB0byB0aGlzXG4gICAgICogZnVuY3Rpb24uIEludGVyY2VwdC9vdmVycmlkZSBpdCBpZiB5b3Ugd2FudCBjdXN0b20gZXJyb3IgaGFuZGxpbmcuXG4gICAgICogQHBhcmFtIHtFcnJvcn0gZXJyIHRoZSBlcnJvciBvYmplY3QuXG4gICAgICovXG4gICAgcmVxLm9uRXJyb3IgPSBkZWZhdWx0T25FcnJvcjtcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgdGhlIG5vZGUgZm9yIHRoZSBsb2FkIGNvbW1hbmQuIE9ubHkgdXNlZCBpbiBicm93c2VyIGVudnMuXG4gICAgICovXG4gICAgcmVxLmNyZWF0ZU5vZGUgPSBmdW5jdGlvbiAoY29uZmlnLCBtb2R1bGVOYW1lLCB1cmwpIHtcbiAgICAgICAgdmFyIG5vZGUgPSBjb25maWcueGh0bWwgP1xuICAgICAgICAgICAgICAgIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94aHRtbCcsICdodG1sOnNjcmlwdCcpIDpcbiAgICAgICAgICAgICAgICBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcbiAgICAgICAgbm9kZS50eXBlID0gY29uZmlnLnNjcmlwdFR5cGUgfHwgJ3RleHQvamF2YXNjcmlwdCc7XG4gICAgICAgIG5vZGUuY2hhcnNldCA9ICd1dGYtOCc7XG4gICAgICAgIG5vZGUuYXN5bmMgPSB0cnVlO1xuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogRG9lcyB0aGUgcmVxdWVzdCB0byBsb2FkIGEgbW9kdWxlIGZvciB0aGUgYnJvd3NlciBjYXNlLlxuICAgICAqIE1ha2UgdGhpcyBhIHNlcGFyYXRlIGZ1bmN0aW9uIHRvIGFsbG93IG90aGVyIGVudmlyb25tZW50c1xuICAgICAqIHRvIG92ZXJyaWRlIGl0LlxuICAgICAqXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGNvbnRleHQgdGhlIHJlcXVpcmUgY29udGV4dCB0byBmaW5kIHN0YXRlLlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBtb2R1bGVOYW1lIHRoZSBuYW1lIG9mIHRoZSBtb2R1bGUuXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHVybCB0aGUgVVJMIHRvIHRoZSBtb2R1bGUuXG4gICAgICovXG4gICAgcmVxLmxvYWQgPSBmdW5jdGlvbiAoY29udGV4dCwgbW9kdWxlTmFtZSwgdXJsKSB7XG4gICAgICAgIHZhciBjb25maWcgPSAoY29udGV4dCAmJiBjb250ZXh0LmNvbmZpZykgfHwge30sXG4gICAgICAgICAgICBub2RlO1xuICAgICAgICBpZiAoaXNCcm93c2VyKSB7XG4gICAgICAgICAgICAvL0luIHRoZSBicm93c2VyIHNvIHVzZSBhIHNjcmlwdCB0YWdcbiAgICAgICAgICAgIG5vZGUgPSByZXEuY3JlYXRlTm9kZShjb25maWcsIG1vZHVsZU5hbWUsIHVybCk7XG4gICAgICAgICAgICBpZiAoY29uZmlnLm9uTm9kZUNyZWF0ZWQpIHtcbiAgICAgICAgICAgICAgICBjb25maWcub25Ob2RlQ3JlYXRlZChub2RlLCBjb25maWcsIG1vZHVsZU5hbWUsIHVybCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5vZGUuc2V0QXR0cmlidXRlKCdkYXRhLXJlcXVpcmVjb250ZXh0JywgY29udGV4dC5jb250ZXh0TmFtZSk7XG4gICAgICAgICAgICBub2RlLnNldEF0dHJpYnV0ZSgnZGF0YS1yZXF1aXJlbW9kdWxlJywgbW9kdWxlTmFtZSk7XG5cbiAgICAgICAgICAgIC8vU2V0IHVwIGxvYWQgbGlzdGVuZXIuIFRlc3QgYXR0YWNoRXZlbnQgZmlyc3QgYmVjYXVzZSBJRTkgaGFzXG4gICAgICAgICAgICAvL2Egc3VidGxlIGlzc3VlIGluIGl0cyBhZGRFdmVudExpc3RlbmVyIGFuZCBzY3JpcHQgb25sb2FkIGZpcmluZ3NcbiAgICAgICAgICAgIC8vdGhhdCBkbyBub3QgbWF0Y2ggdGhlIGJlaGF2aW9yIG9mIGFsbCBvdGhlciBicm93c2VycyB3aXRoXG4gICAgICAgICAgICAvL2FkZEV2ZW50TGlzdGVuZXIgc3VwcG9ydCwgd2hpY2ggZmlyZSB0aGUgb25sb2FkIGV2ZW50IGZvciBhXG4gICAgICAgICAgICAvL3NjcmlwdCByaWdodCBhZnRlciB0aGUgc2NyaXB0IGV4ZWN1dGlvbi4gU2VlOlxuICAgICAgICAgICAgLy9odHRwczovL2Nvbm5lY3QubWljcm9zb2Z0LmNvbS9JRS9mZWVkYmFjay9kZXRhaWxzLzY0ODA1Ny9zY3JpcHQtb25sb2FkLWV2ZW50LWlzLW5vdC1maXJlZC1pbW1lZGlhdGVseS1hZnRlci1zY3JpcHQtZXhlY3V0aW9uXG4gICAgICAgICAgICAvL1VORk9SVFVOQVRFTFkgT3BlcmEgaW1wbGVtZW50cyBhdHRhY2hFdmVudCBidXQgZG9lcyBub3QgZm9sbG93IHRoZSBzY3JpcHRcbiAgICAgICAgICAgIC8vc2NyaXB0IGV4ZWN1dGlvbiBtb2RlLlxuICAgICAgICAgICAgaWYgKG5vZGUuYXR0YWNoRXZlbnQgJiZcbiAgICAgICAgICAgICAgICAgICAgLy9DaGVjayBpZiBub2RlLmF0dGFjaEV2ZW50IGlzIGFydGlmaWNpYWxseSBhZGRlZCBieSBjdXN0b20gc2NyaXB0IG9yXG4gICAgICAgICAgICAgICAgICAgIC8vbmF0aXZlbHkgc3VwcG9ydGVkIGJ5IGJyb3dzZXJcbiAgICAgICAgICAgICAgICAgICAgLy9yZWFkIGh0dHBzOi8vZ2l0aHViLmNvbS9qcmJ1cmtlL3JlcXVpcmVqcy9pc3N1ZXMvMTg3XG4gICAgICAgICAgICAgICAgICAgIC8vaWYgd2UgY2FuIE5PVCBmaW5kIFtuYXRpdmUgY29kZV0gdGhlbiBpdCBtdXN0IE5PVCBuYXRpdmVseSBzdXBwb3J0ZWQuXG4gICAgICAgICAgICAgICAgICAgIC8vaW4gSUU4LCBub2RlLmF0dGFjaEV2ZW50IGRvZXMgbm90IGhhdmUgdG9TdHJpbmcoKVxuICAgICAgICAgICAgICAgICAgICAvL05vdGUgdGhlIHRlc3QgZm9yIFwiW25hdGl2ZSBjb2RlXCIgd2l0aCBubyBjbG9zaW5nIGJyYWNlLCBzZWU6XG4gICAgICAgICAgICAgICAgICAgIC8vaHR0cHM6Ly9naXRodWIuY29tL2pyYnVya2UvcmVxdWlyZWpzL2lzc3Vlcy8yNzNcbiAgICAgICAgICAgICAgICAgICAgIShub2RlLmF0dGFjaEV2ZW50LnRvU3RyaW5nICYmIG5vZGUuYXR0YWNoRXZlbnQudG9TdHJpbmcoKS5pbmRleE9mKCdbbmF0aXZlIGNvZGUnKSA8IDApICYmXG4gICAgICAgICAgICAgICAgICAgICFpc09wZXJhKSB7XG4gICAgICAgICAgICAgICAgLy9Qcm9iYWJseSBJRS4gSUUgKGF0IGxlYXN0IDYtOCkgZG8gbm90IGZpcmVcbiAgICAgICAgICAgICAgICAvL3NjcmlwdCBvbmxvYWQgcmlnaHQgYWZ0ZXIgZXhlY3V0aW5nIHRoZSBzY3JpcHQsIHNvXG4gICAgICAgICAgICAgICAgLy93ZSBjYW5ub3QgdGllIHRoZSBhbm9ueW1vdXMgZGVmaW5lIGNhbGwgdG8gYSBuYW1lLlxuICAgICAgICAgICAgICAgIC8vSG93ZXZlciwgSUUgcmVwb3J0cyB0aGUgc2NyaXB0IGFzIGJlaW5nIGluICdpbnRlcmFjdGl2ZSdcbiAgICAgICAgICAgICAgICAvL3JlYWR5U3RhdGUgYXQgdGhlIHRpbWUgb2YgdGhlIGRlZmluZSBjYWxsLlxuICAgICAgICAgICAgICAgIHVzZUludGVyYWN0aXZlID0gdHJ1ZTtcblxuICAgICAgICAgICAgICAgIG5vZGUuYXR0YWNoRXZlbnQoJ29ucmVhZHlzdGF0ZWNoYW5nZScsIGNvbnRleHQub25TY3JpcHRMb2FkKTtcbiAgICAgICAgICAgICAgICAvL0l0IHdvdWxkIGJlIGdyZWF0IHRvIGFkZCBhbiBlcnJvciBoYW5kbGVyIGhlcmUgdG8gY2F0Y2hcbiAgICAgICAgICAgICAgICAvLzQwNHMgaW4gSUU5Ky4gSG93ZXZlciwgb25yZWFkeXN0YXRlY2hhbmdlIHdpbGwgZmlyZSBiZWZvcmVcbiAgICAgICAgICAgICAgICAvL3RoZSBlcnJvciBoYW5kbGVyLCBzbyB0aGF0IGRvZXMgbm90IGhlbHAuIElmIGFkZEV2ZW50TGlzdGVuZXJcbiAgICAgICAgICAgICAgICAvL2lzIHVzZWQsIHRoZW4gSUUgd2lsbCBmaXJlIGVycm9yIGJlZm9yZSBsb2FkLCBidXQgd2UgY2Fubm90XG4gICAgICAgICAgICAgICAgLy91c2UgdGhhdCBwYXRod2F5IGdpdmVuIHRoZSBjb25uZWN0Lm1pY3Jvc29mdC5jb20gaXNzdWVcbiAgICAgICAgICAgICAgICAvL21lbnRpb25lZCBhYm92ZSBhYm91dCBub3QgZG9pbmcgdGhlICdzY3JpcHQgZXhlY3V0ZSxcbiAgICAgICAgICAgICAgICAvL3RoZW4gZmlyZSB0aGUgc2NyaXB0IGxvYWQgZXZlbnQgbGlzdGVuZXIgYmVmb3JlIGV4ZWN1dGVcbiAgICAgICAgICAgICAgICAvL25leHQgc2NyaXB0JyB0aGF0IG90aGVyIGJyb3dzZXJzIGRvLlxuICAgICAgICAgICAgICAgIC8vQmVzdCBob3BlOiBJRTEwIGZpeGVzIHRoZSBpc3N1ZXMsXG4gICAgICAgICAgICAgICAgLy9hbmQgdGhlbiBkZXN0cm95cyBhbGwgaW5zdGFsbHMgb2YgSUUgNi05LlxuICAgICAgICAgICAgICAgIC8vbm9kZS5hdHRhY2hFdmVudCgnb25lcnJvcicsIGNvbnRleHQub25TY3JpcHRFcnJvcik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG5vZGUuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIGNvbnRleHQub25TY3JpcHRMb2FkLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgbm9kZS5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIGNvbnRleHQub25TY3JpcHRFcnJvciwgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbm9kZS5zcmMgPSB1cmw7XG5cbiAgICAgICAgICAgIC8vRm9yIHNvbWUgY2FjaGUgY2FzZXMgaW4gSUUgNi04LCB0aGUgc2NyaXB0IGV4ZWN1dGVzIGJlZm9yZSB0aGUgZW5kXG4gICAgICAgICAgICAvL29mIHRoZSBhcHBlbmRDaGlsZCBleGVjdXRpb24sIHNvIHRvIHRpZSBhbiBhbm9ueW1vdXMgZGVmaW5lXG4gICAgICAgICAgICAvL2NhbGwgdG8gdGhlIG1vZHVsZSBuYW1lICh3aGljaCBpcyBzdG9yZWQgb24gdGhlIG5vZGUpLCBob2xkIG9uXG4gICAgICAgICAgICAvL3RvIGEgcmVmZXJlbmNlIHRvIHRoaXMgbm9kZSwgYnV0IGNsZWFyIGFmdGVyIHRoZSBET00gaW5zZXJ0aW9uLlxuICAgICAgICAgICAgY3VycmVudGx5QWRkaW5nU2NyaXB0ID0gbm9kZTtcbiAgICAgICAgICAgIGlmIChiYXNlRWxlbWVudCkge1xuICAgICAgICAgICAgICAgIGhlYWQuaW5zZXJ0QmVmb3JlKG5vZGUsIGJhc2VFbGVtZW50KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaGVhZC5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN1cnJlbnRseUFkZGluZ1NjcmlwdCA9IG51bGw7XG5cbiAgICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9IGVsc2UgaWYgKGlzV2ViV29ya2VyKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIC8vSW4gYSB3ZWIgd29ya2VyLCB1c2UgaW1wb3J0U2NyaXB0cy4gVGhpcyBpcyBub3QgYSB2ZXJ5XG4gICAgICAgICAgICAgICAgLy9lZmZpY2llbnQgdXNlIG9mIGltcG9ydFNjcmlwdHMsIGltcG9ydFNjcmlwdHMgd2lsbCBibG9jayB1bnRpbFxuICAgICAgICAgICAgICAgIC8vaXRzIHNjcmlwdCBpcyBkb3dubG9hZGVkIGFuZCBldmFsdWF0ZWQuIEhvd2V2ZXIsIGlmIHdlYiB3b3JrZXJzXG4gICAgICAgICAgICAgICAgLy9hcmUgaW4gcGxheSwgdGhlIGV4cGVjdGF0aW9uIGlzIHRoYXQgYSBidWlsZCBoYXMgYmVlbiBkb25lIHNvXG4gICAgICAgICAgICAgICAgLy90aGF0IG9ubHkgb25lIHNjcmlwdCBuZWVkcyB0byBiZSBsb2FkZWQgYW55d2F5LiBUaGlzIG1heSBuZWVkXG4gICAgICAgICAgICAgICAgLy90byBiZSByZWV2YWx1YXRlZCBpZiBvdGhlciB1c2UgY2FzZXMgYmVjb21lIGNvbW1vbi5cbiAgICAgICAgICAgICAgICBpbXBvcnRTY3JpcHRzKHVybCk7XG5cbiAgICAgICAgICAgICAgICAvL0FjY291bnQgZm9yIGFub255bW91cyBtb2R1bGVzXG4gICAgICAgICAgICAgICAgY29udGV4dC5jb21wbGV0ZUxvYWQobW9kdWxlTmFtZSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgY29udGV4dC5vbkVycm9yKG1ha2VFcnJvcignaW1wb3J0c2NyaXB0cycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdpbXBvcnRTY3JpcHRzIGZhaWxlZCBmb3IgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2R1bGVOYW1lICsgJyBhdCAnICsgdXJsLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBbbW9kdWxlTmFtZV0pKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBmdW5jdGlvbiBnZXRJbnRlcmFjdGl2ZVNjcmlwdCgpIHtcbiAgICAgICAgaWYgKGludGVyYWN0aXZlU2NyaXB0ICYmIGludGVyYWN0aXZlU2NyaXB0LnJlYWR5U3RhdGUgPT09ICdpbnRlcmFjdGl2ZScpIHtcbiAgICAgICAgICAgIHJldHVybiBpbnRlcmFjdGl2ZVNjcmlwdDtcbiAgICAgICAgfVxuXG4gICAgICAgIGVhY2hSZXZlcnNlKHNjcmlwdHMoKSwgZnVuY3Rpb24gKHNjcmlwdCkge1xuICAgICAgICAgICAgaWYgKHNjcmlwdC5yZWFkeVN0YXRlID09PSAnaW50ZXJhY3RpdmUnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIChpbnRlcmFjdGl2ZVNjcmlwdCA9IHNjcmlwdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gaW50ZXJhY3RpdmVTY3JpcHQ7XG4gICAgfVxuXG4gICAgLy9Mb29rIGZvciBhIGRhdGEtbWFpbiBzY3JpcHQgYXR0cmlidXRlLCB3aGljaCBjb3VsZCBhbHNvIGFkanVzdCB0aGUgYmFzZVVybC5cbiAgICBpZiAoaXNCcm93c2VyICYmICFjZmcuc2tpcERhdGFNYWluKSB7XG4gICAgICAgIC8vRmlndXJlIG91dCBiYXNlVXJsLiBHZXQgaXQgZnJvbSB0aGUgc2NyaXB0IHRhZyB3aXRoIHJlcXVpcmUuanMgaW4gaXQuXG4gICAgICAgIGVhY2hSZXZlcnNlKHNjcmlwdHMoKSwgZnVuY3Rpb24gKHNjcmlwdCkge1xuICAgICAgICAgICAgLy9TZXQgdGhlICdoZWFkJyB3aGVyZSB3ZSBjYW4gYXBwZW5kIGNoaWxkcmVuIGJ5XG4gICAgICAgICAgICAvL3VzaW5nIHRoZSBzY3JpcHQncyBwYXJlbnQuXG4gICAgICAgICAgICBpZiAoIWhlYWQpIHtcbiAgICAgICAgICAgICAgICBoZWFkID0gc2NyaXB0LnBhcmVudE5vZGU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vTG9vayBmb3IgYSBkYXRhLW1haW4gYXR0cmlidXRlIHRvIHNldCBtYWluIHNjcmlwdCBmb3IgdGhlIHBhZ2VcbiAgICAgICAgICAgIC8vdG8gbG9hZC4gSWYgaXQgaXMgdGhlcmUsIHRoZSBwYXRoIHRvIGRhdGEgbWFpbiBiZWNvbWVzIHRoZVxuICAgICAgICAgICAgLy9iYXNlVXJsLCBpZiBpdCBpcyBub3QgYWxyZWFkeSBzZXQuXG4gICAgICAgICAgICBkYXRhTWFpbiA9IHNjcmlwdC5nZXRBdHRyaWJ1dGUoJ2RhdGEtbWFpbicpO1xuICAgICAgICAgICAgaWYgKGRhdGFNYWluKSB7XG4gICAgICAgICAgICAgICAgLy9QcmVzZXJ2ZSBkYXRhTWFpbiBpbiBjYXNlIGl0IGlzIGEgcGF0aCAoaS5lLiBjb250YWlucyAnPycpXG4gICAgICAgICAgICAgICAgbWFpblNjcmlwdCA9IGRhdGFNYWluO1xuXG4gICAgICAgICAgICAgICAgLy9TZXQgZmluYWwgYmFzZVVybCBpZiB0aGVyZSBpcyBub3QgYWxyZWFkeSBhbiBleHBsaWNpdCBvbmUuXG4gICAgICAgICAgICAgICAgaWYgKCFjZmcuYmFzZVVybCkge1xuICAgICAgICAgICAgICAgICAgICAvL1B1bGwgb2ZmIHRoZSBkaXJlY3Rvcnkgb2YgZGF0YS1tYWluIGZvciB1c2UgYXMgdGhlXG4gICAgICAgICAgICAgICAgICAgIC8vYmFzZVVybC5cbiAgICAgICAgICAgICAgICAgICAgc3JjID0gbWFpblNjcmlwdC5zcGxpdCgnLycpO1xuICAgICAgICAgICAgICAgICAgICBtYWluU2NyaXB0ID0gc3JjLnBvcCgpO1xuICAgICAgICAgICAgICAgICAgICBzdWJQYXRoID0gc3JjLmxlbmd0aCA/IHNyYy5qb2luKCcvJykgICsgJy8nIDogJy4vJztcblxuICAgICAgICAgICAgICAgICAgICBjZmcuYmFzZVVybCA9IHN1YlBhdGg7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy9TdHJpcCBvZmYgYW55IHRyYWlsaW5nIC5qcyBzaW5jZSBtYWluU2NyaXB0IGlzIG5vd1xuICAgICAgICAgICAgICAgIC8vbGlrZSBhIG1vZHVsZSBuYW1lLlxuICAgICAgICAgICAgICAgIG1haW5TY3JpcHQgPSBtYWluU2NyaXB0LnJlcGxhY2UoanNTdWZmaXhSZWdFeHAsICcnKTtcblxuICAgICAgICAgICAgICAgIC8vSWYgbWFpblNjcmlwdCBpcyBzdGlsbCBhIHBhdGgsIGZhbGwgYmFjayB0byBkYXRhTWFpblxuICAgICAgICAgICAgICAgIGlmIChyZXEuanNFeHRSZWdFeHAudGVzdChtYWluU2NyaXB0KSkge1xuICAgICAgICAgICAgICAgICAgICBtYWluU2NyaXB0ID0gZGF0YU1haW47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy9QdXQgdGhlIGRhdGEtbWFpbiBzY3JpcHQgaW4gdGhlIGZpbGVzIHRvIGxvYWQuXG4gICAgICAgICAgICAgICAgY2ZnLmRlcHMgPSBjZmcuZGVwcyA/IGNmZy5kZXBzLmNvbmNhdChtYWluU2NyaXB0KSA6IFttYWluU2NyaXB0XTtcblxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUaGUgZnVuY3Rpb24gdGhhdCBoYW5kbGVzIGRlZmluaXRpb25zIG9mIG1vZHVsZXMuIERpZmZlcnMgZnJvbVxuICAgICAqIHJlcXVpcmUoKSBpbiB0aGF0IGEgc3RyaW5nIGZvciB0aGUgbW9kdWxlIHNob3VsZCBiZSB0aGUgZmlyc3QgYXJndW1lbnQsXG4gICAgICogYW5kIHRoZSBmdW5jdGlvbiB0byBleGVjdXRlIGFmdGVyIGRlcGVuZGVuY2llcyBhcmUgbG9hZGVkIHNob3VsZFxuICAgICAqIHJldHVybiBhIHZhbHVlIHRvIGRlZmluZSB0aGUgbW9kdWxlIGNvcnJlc3BvbmRpbmcgdG8gdGhlIGZpcnN0IGFyZ3VtZW50J3NcbiAgICAgKiBuYW1lLlxuICAgICAqL1xuICAgIGRlZmluZSA9IGZ1bmN0aW9uIChuYW1lLCBkZXBzLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgbm9kZSwgY29udGV4dDtcblxuICAgICAgICAvL0FsbG93IGZvciBhbm9ueW1vdXMgbW9kdWxlc1xuICAgICAgICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAvL0FkanVzdCBhcmdzIGFwcHJvcHJpYXRlbHlcbiAgICAgICAgICAgIGNhbGxiYWNrID0gZGVwcztcbiAgICAgICAgICAgIGRlcHMgPSBuYW1lO1xuICAgICAgICAgICAgbmFtZSA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICAvL1RoaXMgbW9kdWxlIG1heSBub3QgaGF2ZSBkZXBlbmRlbmNpZXNcbiAgICAgICAgaWYgKCFpc0FycmF5KGRlcHMpKSB7XG4gICAgICAgICAgICBjYWxsYmFjayA9IGRlcHM7XG4gICAgICAgICAgICBkZXBzID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vSWYgbm8gbmFtZSwgYW5kIGNhbGxiYWNrIGlzIGEgZnVuY3Rpb24sIHRoZW4gZmlndXJlIG91dCBpZiBpdCBhXG4gICAgICAgIC8vQ29tbW9uSlMgdGhpbmcgd2l0aCBkZXBlbmRlbmNpZXMuXG4gICAgICAgIGlmICghZGVwcyAmJiBpc0Z1bmN0aW9uKGNhbGxiYWNrKSkge1xuICAgICAgICAgICAgZGVwcyA9IFtdO1xuICAgICAgICAgICAgLy9SZW1vdmUgY29tbWVudHMgZnJvbSB0aGUgY2FsbGJhY2sgc3RyaW5nLFxuICAgICAgICAgICAgLy9sb29rIGZvciByZXF1aXJlIGNhbGxzLCBhbmQgcHVsbCB0aGVtIGludG8gdGhlIGRlcGVuZGVuY2llcyxcbiAgICAgICAgICAgIC8vYnV0IG9ubHkgaWYgdGhlcmUgYXJlIGZ1bmN0aW9uIGFyZ3MuXG4gICAgICAgICAgICBpZiAoY2FsbGJhY2subGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2tcbiAgICAgICAgICAgICAgICAgICAgLnRvU3RyaW5nKClcbiAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoY29tbWVudFJlZ0V4cCwgJycpXG4gICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKGNqc1JlcXVpcmVSZWdFeHAsIGZ1bmN0aW9uIChtYXRjaCwgZGVwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZXBzLnB1c2goZGVwKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICAvL01heSBiZSBhIENvbW1vbkpTIHRoaW5nIGV2ZW4gd2l0aG91dCByZXF1aXJlIGNhbGxzLCBidXQgc3RpbGxcbiAgICAgICAgICAgICAgICAvL2NvdWxkIHVzZSBleHBvcnRzLCBhbmQgbW9kdWxlLiBBdm9pZCBkb2luZyBleHBvcnRzIGFuZCBtb2R1bGVcbiAgICAgICAgICAgICAgICAvL3dvcmsgdGhvdWdoIGlmIGl0IGp1c3QgbmVlZHMgcmVxdWlyZS5cbiAgICAgICAgICAgICAgICAvL1JFUVVJUkVTIHRoZSBmdW5jdGlvbiB0byBleHBlY3QgdGhlIENvbW1vbkpTIHZhcmlhYmxlcyBpbiB0aGVcbiAgICAgICAgICAgICAgICAvL29yZGVyIGxpc3RlZCBiZWxvdy5cbiAgICAgICAgICAgICAgICBkZXBzID0gKGNhbGxiYWNrLmxlbmd0aCA9PT0gMSA/IFsncmVxdWlyZSddIDogWydyZXF1aXJlJywgJ2V4cG9ydHMnLCAnbW9kdWxlJ10pLmNvbmNhdChkZXBzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vSWYgaW4gSUUgNi04IGFuZCBoaXQgYW4gYW5vbnltb3VzIGRlZmluZSgpIGNhbGwsIGRvIHRoZSBpbnRlcmFjdGl2ZVxuICAgICAgICAvL3dvcmsuXG4gICAgICAgIGlmICh1c2VJbnRlcmFjdGl2ZSkge1xuICAgICAgICAgICAgbm9kZSA9IGN1cnJlbnRseUFkZGluZ1NjcmlwdCB8fCBnZXRJbnRlcmFjdGl2ZVNjcmlwdCgpO1xuICAgICAgICAgICAgaWYgKG5vZGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoIW5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZSA9IG5vZGUuZ2V0QXR0cmlidXRlKCdkYXRhLXJlcXVpcmVtb2R1bGUnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29udGV4dCA9IGNvbnRleHRzW25vZGUuZ2V0QXR0cmlidXRlKCdkYXRhLXJlcXVpcmVjb250ZXh0JyldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy9BbHdheXMgc2F2ZSBvZmYgZXZhbHVhdGluZyB0aGUgZGVmIGNhbGwgdW50aWwgdGhlIHNjcmlwdCBvbmxvYWQgaGFuZGxlci5cbiAgICAgICAgLy9UaGlzIGFsbG93cyBtdWx0aXBsZSBtb2R1bGVzIHRvIGJlIGluIGEgZmlsZSB3aXRob3V0IHByZW1hdHVyZWx5XG4gICAgICAgIC8vdHJhY2luZyBkZXBlbmRlbmNpZXMsIGFuZCBhbGxvd3MgZm9yIGFub255bW91cyBtb2R1bGUgc3VwcG9ydCxcbiAgICAgICAgLy93aGVyZSB0aGUgbW9kdWxlIG5hbWUgaXMgbm90IGtub3duIHVudGlsIHRoZSBzY3JpcHQgb25sb2FkIGV2ZW50XG4gICAgICAgIC8vb2NjdXJzLiBJZiBubyBjb250ZXh0LCB1c2UgdGhlIGdsb2JhbCBxdWV1ZSwgYW5kIGdldCBpdCBwcm9jZXNzZWRcbiAgICAgICAgLy9pbiB0aGUgb25zY3JpcHQgbG9hZCBjYWxsYmFjay5cbiAgICAgICAgaWYgKGNvbnRleHQpIHtcbiAgICAgICAgICAgIGNvbnRleHQuZGVmUXVldWUucHVzaChbbmFtZSwgZGVwcywgY2FsbGJhY2tdKTtcbiAgICAgICAgICAgIGNvbnRleHQuZGVmUXVldWVNYXBbbmFtZV0gPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZ2xvYmFsRGVmUXVldWUucHVzaChbbmFtZSwgZGVwcywgY2FsbGJhY2tdKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBkZWZpbmUuYW1kID0ge1xuICAgICAgICBqUXVlcnk6IHRydWVcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogRXhlY3V0ZXMgdGhlIHRleHQuIE5vcm1hbGx5IGp1c3QgdXNlcyBldmFsLCBidXQgY2FuIGJlIG1vZGlmaWVkXG4gICAgICogdG8gdXNlIGEgYmV0dGVyLCBlbnZpcm9ubWVudC1zcGVjaWZpYyBjYWxsLiBPbmx5IHVzZWQgZm9yIHRyYW5zcGlsaW5nXG4gICAgICogbG9hZGVyIHBsdWdpbnMsIG5vdCBmb3IgcGxhaW4gSlMgbW9kdWxlcy5cbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gdGV4dCB0aGUgdGV4dCB0byBleGVjdXRlL2V2YWx1YXRlLlxuICAgICAqL1xuICAgIHJlcS5leGVjID0gZnVuY3Rpb24gKHRleHQpIHtcbiAgICAgICAgLypqc2xpbnQgZXZpbDogdHJ1ZSAqL1xuICAgICAgICByZXR1cm4gZXZhbCh0ZXh0KTtcbiAgICB9O1xuXG4gICAgLy9TZXQgdXAgd2l0aCBjb25maWcgaW5mby5cbiAgICByZXEoY2ZnKTtcbn0odGhpcykpO1xuIl0sImZpbGUiOiJyZXF1aXJlLmpzIiwic291cmNlUm9vdCI6Ii9zb3VyY2UvIn0=

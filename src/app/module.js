define([
    'app/router',
], function (router) {
    'use strict';

    var app = angular.module('app', ['ui.router', 'ui.bootstrap']);

    app.config(router);
});

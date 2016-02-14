define([], function () {
    'use strict';

    function router($stateProvider, $urlRouterProvider, $locationProvider) {
        $stateProvider
            .state('home', {
                templateUrl: 'templates/home.html',
                url: '/'
            })
        ;

        $urlRouterProvider.otherwise('/');

        $locationProvider.html5Mode(true);
    }

    router.$inject = ['$stateProvider', '$urlRouterProvider', '$locationProvider'];

    return router;
});

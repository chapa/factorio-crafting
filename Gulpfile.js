(function () {
    'use strict';

    var gulp        = require('gulp-param')(require('gulp'), process.argv, 'cb');
    var bower       = require('gulp-bower');
    var fs          = require('fs');
    var gutil       = require('gulp-util');
    var path        = require('path');
    var sourcemaps  = require('gulp-sourcemaps');
    var merge       = require('merge-stream');
    var requirejs   = require('gulp-requirejs');
    var callback    = require('gulp-callback');
    var uglify      = require('gulp-uglify');
    var rename      = require('gulp-rename');
    var compass     = require('compass');
    var wrapper     = require('gulp-wrapper');
    var minifyHTML  = require('gulp-minify-html');
    var concat      = require('gulp-concat');
    var htmlReplace = require('gulp-html-replace');
    var replace     = require('gulp-replace');
    var del         = require('del');

    // Manage dependancies
    gulp.task('dependencies', bower);
    gulp.task('build-dependencies', ['dependencies'], buildDependenciesTask);

    // Concatenate and minify js
    gulp.task('requirejs', requirejsTask);
    gulp.task('uglify', ['requirejs'], uglifyTask);

    // Compile and copy css
    gulp.task('compass', compassTask);
    gulp.task('copy-css', ['compass'], copyCssTask);

    // Build web application
    gulp.task('copy-img', copyImgTask);
    gulp.task('build-templates', buildTemplateTask);
    gulp.task('build-index', ['build-templates'], buildIndexTask);
    gulp.task('build', ['build-dependencies', 'uglify', 'copy-css', 'copy-img', 'build-index'], buildTask);

    // Dev tools
    gulp.task('clean', cleanTask);

    // Build web application by default
    gulp.task('default', ['build']);

    /**
     * Copy used bower dependencies to dist/lib
     */
    function buildDependenciesTask () {
        // Retreive html content from the index.html file
        var htmlContent = fs.readFileSync('src/index.html').toString(),
            regex = /(?:src|href)="(bower_components\/(?:(?!(?:css"|js")).)+\.(?:css|js))"/g;
        
        // Build an array containing files which are located in the bower_components folder and used in the index.html file
        var match, files = [];
        while ((match = regex.exec(htmlContent)) !== null) {
            if (files.indexOf(match[1]) > -1) {
                gutil.log(gutil.colors.yellow('La dépendance "' + match[1] + '" existe déjà'))
            } else {
                files.push(match[1]);
            }
        }

        // Copy those files (and add sourcemaps) into the dist/lib folder (used by the dist/index.html file)
        var streams = [];
        for (var i = 0; i < files.length; i++) {
            streams.push(gulp.src(path.join('src', files[i]))
                .pipe(sourcemaps.init({ loadMaps: true }))
                .pipe(sourcemaps.write())
                .pipe(gulp.dest('dist/lib'))
            );
        }

        return merge(streams);
    }

    /**
     * Compile js app into dist/app.js file
     */
    function requirejsTask (disableHTML5Urls, cb) {
        return requirejs({ baseUrl: 'src', name: 'app', out: 'app.js' })
            .pipe(replace(/\$locationProvider\.html5Mode\(true\);/g, '$locationProvider.html5Mode(' + (disableHTML5Urls ? 'false' : 'true') + ');'))
            .pipe(gulp.dest('dist'))
            .pipe(callback(function () {
                cb();
            }))
        ;
    }

    /**
     * Minify dist/app.js into dist/app.min.js
     */
    function uglifyTask () {
        return gulp.src('dist/app.js')
            .pipe(uglify())
            .pipe(rename('app.min.js'))
            .pipe(gulp.dest('dist'))
        ;
    }

    /**
     * Compile sass files into src/css folder (see config.rb for more details)
     */
    function compassTask (cb) {
        compass.compile(function(err, stdout, stderr) {
            cb(err);
        });
    }

    /**
     * Copy the generated src/css/app.css file into dist folder
     */
    function copyCssTask () {
        return gulp.src('src/css/app.css')
            .pipe(rename('app.min.css'))
            .pipe(gulp.dest('dist'))
        ;
    }

    /**
     * Copy src/img folder into dist folder
     */
    function copyImgTask () {
        return gulp.src('src/img/**/*')
            .pipe(gulp.dest('dist/img'))
        ;
    }

    /**
     * Wrap templates files inside script tags and concatenate them into a single dist/templates.html file
     */
    function buildTemplateTask () {
        return gulp.src('src/templates/*')
            .pipe(wrapper({
                header: '<script type="text/ng-template" id="templates/${filename}">',
                footer: '</script>'
            }))
            .pipe(minifyHTML())
            .pipe(concat('templates.html'))
            .pipe(gulp.dest('dist'))
        ;
    }

    /**
     * Build dist/index.html file from src/index.html
     */
    function buildIndexTask (disableHTML5Urls, disableFMOG, FMOGUrl) {
        return gulp.src('src/index.html')
            .pipe(htmlReplace({
                urlBase: disableHTML5Urls ? '' : '<base href="/">',
                FMOG: disableFMOG ? '' : '<a href="' + (FMOGUrl ? FMOGUrl : 'https://github.com/chapa/factorio-crafting') + '"><img style="position: absolute; top: 0; right: 0; border: 0; z-index: 10000;" src="https://camo.githubusercontent.com/38ef81f8aca64bb9a64448d0d70f1308ef5341ab/68747470733a2f2f73332e616d617a6f6e6177732e636f6d2f6769746875622f726962626f6e732f666f726b6d655f72696768745f6461726b626c75655f3132313632312e706e67" alt="Fork me on GitHub" data-canonical-src="https://s3.amazonaws.com/github/ribbons/forkme_right_darkblue_121621.png"></a>',
                templates: fs.readFileSync(
                    'dist/templates.html'
                ).toString(),
                bootstrap: '<script type="text/javascript" src="lib/require.js"></script><script type="text/javascript" src="app.min.js"></script>'
            }))
            .pipe(replace(/css\/app\.css/g, 'app.min.css'))
            .pipe(replace(/bower_components\/((?!css"|js").)+\//g, 'lib/'))
            .pipe(gulp.dest('dist'))
        ;
    }

    /**
     * Remove temporary files
     */
    function buildTask () {
        return del(['dist/app.js', 'dist/templates.html']);
    }

    /**
     * Remove all generated files
     */
    function cleanTask () {
        return del('dist');
    }

})();

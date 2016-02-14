# Factorio Crafting

A set of tools related to crafting in [factorio](http://www.factorio.com).

## Installation

#### Install global dependencies

```
$ npm install -g bower
$ gem install compass
$ npm install -g gulp
```

#### Install node dependencies

```
$ npm install
```

#### Build application

```
$ gulp [build] [--disableHTML5Urls] [--disableFMOG] [--FMOGUrl="https://github.com/chapa/factorio-crafting"]
```

Options :
* **disableHTML5Urls** : build the application without HTML5 mode for routes (= use hash part of urls as routes)
* **disableFMOG** : build the application without the "Fork me on Github" ribbon
* **FMOGUrl** : change the target link of the "Fork me on Github" ribbon

The result is built in the dist folder

#### Configure your web server

You can use any web server you want, it just has to serve the index.html file at the virtual host's root, even if the requested resource doesn't exist. Here is an example of configuration with nginx :

```
server {
    listen      80;
    server_name my-wonderful-domain-name.com;

    root ABSOLUTE_REPOSITORY_PATH/dist;

    location / {
        try_files $uri /index.html; # serve the requested resource, and if it doesn't exist serve index.html
    }
}
```

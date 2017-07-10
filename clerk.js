// Clerk pseudo-static blog engine
// Build e6/2016 v. 1.0.0

var express = require('express');
var bodyParser = require('body-parser');
var compress = require('compression');
var http = require('http');
var fs = require('fs');
var qfs = require('q-io/fs');
var sugar = require('sugar');
var Typograf = require('typograf'),
    tp = new Typograf({lang: 'ru'});
var _ = require('underscore');
var markdownit = require('markdown-it')({
    html: true,
    xhtmlOut: true
}).use(require('markdown-it-footnote'));
var Rss = require('rss');
var Handlebars = require('handlebars');

var app = express();
app.use(compress());
app.use(express.static('assets'));
var server = http.createServer(app);


const utils = require('./utils')

var postsRoot = './posts/';
var templateRoot = './templates/';
var metadataMarker = '@@';
var maxCacheSize = 50;
var postsPerPage = 10;
var postRegex = /^(.\/)?posts\/(?!index|404)(\w|-|_\+)*\.txt?$/;
var footnoteAnchorRegex = /[#"]fn\d+/g;
var footnoteIdRegex = /fnref\d+/g;
var cacheResetTimeInMillis = 900000;
var articleTemplateStart = '<article class="article">'
var articleTemplateEnd = '</article>'

var renderedPosts = {};
var renderedRss = {};
var renderedAlternateRss = {};
var allPostsSortedGrouped = {};
var headerSource;
var footerSource = null;
var postHeaderTemplate = null;
var siteMetadata = {};
var context = {};

function normalizedFileName(file) {
    var retVal = file;
    if (file.startsWith('posts')) {
        retVal = './' + file;
    }

    retVal = retVal.replace('.txt', '');

    return retVal;
}

function fetchFromCache(file) {
    return renderedPosts[normalizedFileName(file)] || null;
}

function addRenderedPostToCache(file, postData) {
    renderedPosts[normalizedFileName(file)] = _.extend({ file: normalizedFileName(file), date: new Date() }, postData);

    if (_.size(renderedPosts) > maxCacheSize) {
        var sorted = _.sortBy(renderedPosts, function (post) { return post.date; });
        delete renderedPosts[sorted.first().file];
    }
}

// separate the metadata from the body
function getLinesFrotxtata(data) {
    data = data.replace(/\r/g, '');
    var lines = data.lines();
    var metadataEnds = _.findIndex(lines, function (line) {
         return line.trim().length === 0;
    });
    metadataEnds = metadataEnds === -1 ? lines.length : metadataEnds;

    return {
        metadata: lines.slice(0, metadataEnds),
        body: tp.execute(lines.slice(metadataEnds).join('\n'))
    };
}

function getLinesFromPost(file) {
    file = file.endsWith('.txt') ? file : file + '.txt';
    var data = fs.readFileSync(file, {encoding: 'UTF8'});

    return getLinesFrotxtata(data);
}

// parse the metadata in the file
function parseMetadata(lines) {
    var retVal = {};

    lines.each(function (line) {
        if (line.has(metadataMarker) && line.has('=')) {
            line = line.replace(metadataMarker, '');
            line = line.compact();
            var firstIndex = line.indexOf('=');
            retVal[line.first(firstIndex)] = line.from(firstIndex + 1);
        } else if (line.has(':')) {
            line = line.compact();
            var firstIndex = line.indexOf(':');
            retVal[line.first(firstIndex)] = line.from(firstIndex + 2);
        }
    });

    if (Object.has(retVal, "Description")) {
        retVal["Description"] = retVal["Description"].replace(/"/g, '&quot;')
    }

    Object.merge(retVal, siteMetadata, false, function (key, targetVal, sourceVal) {
        return targetVal;
    });

    return retVal;
}

// get the external link for this file.
function externalFilenameForFile(file, request) {
    var hostname = typeof(request) !== 'undefined' ? request.headers.host : '';

    var retVal = hostname.length ? ('http://' + hostname) : '';
    retVal += file.at(0) === '/' && hostname.length > 0 ? '' : '/';
    retVal += file.replace('.txt', '').replace(postsRoot, '').replace(postsRoot.replace('./', ''), '');
    return retVal;
}

function performMetadataReplacements(replacements, haystack) {
    _.keys(replacements).each(function (key) {
        haystack = haystack.replace(new RegExp(metadataMarker + key + metadataMarker, 'g'), replacements[key]);
    });

    return haystack;
}

function generateHtmlAndMetadataForLines(lines, file) {
    var metadata = parseMetadata(lines.metadata);
    if (typeof(file) !== 'undefined') {
        metadata.relativeLink = externalFilenameForFile(file);
        if (postRegex.test(file)) {
            metadata.BodyClass = 'post';
        }
    }

    return {
        metadata: metadata,
        header: performMetadataReplacements(metadata, headerSource),
        footer: performMetadataReplacements(metadata, footerSource),
        postHeader:  performMetadataReplacements(metadata, postHeaderTemplate(metadata)),
        unwrappedBody: performMetadataReplacements(metadata, markdownit.render(lines.body)),
        html: function () {
            return this.header +
                '<article class="article">' +
                this.postHeader +
                this.unwrappedBody +
                '</article>' +
                this.footer;
        }
    };
}

function generateHtmlAndMetadataForFile(file) {
    var retVal = fetchFromCache(file);
    if (typeof(retVal) !== 'undefined') {
        var lines = getLinesFromPost(file);
        addRenderedPostToCache(file, generateHtmlAndMetadataForLines(lines, file));
    }

    return fetchFromCache(file);
}

function allPostsSortedAndGrouped(completion) {
    if (Object.size(allPostsSortedGrouped) !== 0) {
        completion(allPostsSortedGrouped);
    } else {
        qfs.listTree(postsRoot, function (name, stat) {
            return postRegex.test(name);
        }).then(function (files) {
            var groupedFiles = _.groupBy(files, function (file) {
                var parts = file.split('/');
                return new Date(parts[1], parts[2] - 1, parts[3]);
            });

            var retVal = [];
            var sortedKeys = _.sortBy(_.keys(groupedFiles), function (date) {
                return new Date(date);
            }).reverse();

            _.each(sortedKeys, function (key) {
                if (new Date(key) > new Date()) {
                  return;
                }

                var articleFiles = groupedFiles[key];
                var articles = [];
                _.each(articleFiles, function (file) {
                    if (!file.endsWith('redirect')) {
                        articles.push(generateHtmlAndMetadataForFile(file));
                    }
                });

                articles = _.sortBy(articles, function (article) {
                    return Date.create(article.metadata.Date);
                }).reverse();
                if (articles.length > 0) {
                    retVal.push({date: key, articles: articles});
                }
            });

            allPostsSortedGrouped = retVal;
            completion(retVal);
        });
    }
}

function loadHeaderFooter(file, completion) {
    fs.exists(templateRoot + file, function(exists) {
        if (exists) {
            fs.readFile(templateRoot + file, {encoding: 'UTF8'}, function (error, data) {
                if (!error) {
                    completion(data);
                }
            });
        }
    });
}

function emptyCache() {
    renderedPosts = {};
    renderedRss = {};
    allPostsSortedGrouped = {};
}

function init() {
    loadHeaderFooter('defaultTags.html', function (data) {
        siteMetadata = parseMetadata(data.split('\n'));
        loadHeaderFooter('header.html', function (data) {
            headerSource = data;
        });
    });
    loadHeaderFooter('footer.html', function (data) { footerSource = data; });
        loadHeaderFooter('postHeader.html', function (data) {
                Handlebars.registerHelper('formatPostDate', function (date) {
                        if (date !== undefined) {
                        return new Handlebars.SafeString(new Date(date).format('{dd}.{MM}.{yyyy}'));
                    }
                        else return '';
                });
        Handlebars.registerHelper('formatPostDate', function (date) {
            if (date !== undefined) {
            return new Handlebars.SafeString(new Date(date).format('{dd}.{MM}.{yyyy}'));
          }
            else return '';
        });
        postHeaderTemplate = Handlebars.compile(data);
    });

    // ↓↓↓ kill the cache ↓↓↓
    emptyCache();
    watchPostsUpdate();
}

function generateHtmlForFile(file) {
    var fileData = generateHtmlAndMetadataForFile(file);
    return fileData.html();
}

function allPostsPaginated(completion) {
    allPostsSortedAndGrouped(function (postsByDay) {
        var pages = [];
        var thisPageDays = [];
        var count = 0;
        postsByDay.each(function (day) {
            count += day.articles.length;
            thisPageDays.push(day);
            if (count >= postsPerPage) {
                pages.push({ page: pages.length + 1, days: thisPageDays });
                thisPageDays = [];
                count = 0;
            }
        });

        if (thisPageDays.length > 0) {
            pages.push({ page: pages.length + 1, days: thisPageDays});
        }

        completion(pages);
    });
}

// route helpers

function send404(response, file) {
    console.log('404: ' + file);
    response.status(404).send(generateHtmlForFile('posts/404.txt'));
}


function watchPostsUpdate() {
  fs.watch('posts', (event, filename) => {
      if (filename) {
        console.log(`File changed: ${filename}`);
      };
      emptyCache();
  });
}

function loadAndSendMarkdownFile(file, response) {
    if (file.endsWith('.txt')) {
        console.log('Sending source file: ' + file);
        fs.exists(file, function (exists) {
            if (exists) {
                fs.readFile(file, {encoding: 'UTF8'}, function (error, data) {
                    if (error) {
                        response.status(500).send({error: error});
                        return;
                    }
                    response.type('text/x-markdown; charset=UTF-8');
                    response.status(200).send(data);
                    return;
                });
            } else {
                response.status(400).send({error: 'Markdown file not found.'});
            }
        });
    } else if (fetchFromCache(file) !== null) {
        console.log('Sending cached: ' + file);
        response.status(200).send(fetchFromCache(file).html());
    } else {
        var found = false;
        if (fs.existsSync(file + '.txt')) {
            found = true;
            console.log('Sending file: ' + file);
            var html = generateHtmlForFile(file);
            response.status(200).send(html);
        } else if (fs.existsSync(file + '.redirect')) {
            var data = fs.readFileSync(file + '.redirect', {encoding: 'UTF8'});
            if (data.length > 0) {
                var parts = data.split('\n');
                if (parts.length >= 2) {
                    found = true;
                    console.log('Redirecting to: ' + parts[1]);
                    response.redirect(parseInt(parts[0], 10), parts[1]);
                }
            }
        }

        if (!found) {
            send404(response, file);
            return;
        }
    }
}

function baseRouteHandler(file, sender, generator) {
    if (fetchFromCache(file) === null) {
        console.log('Not in cache: ' + file);
        generator(function (postData) {
            addRenderedPostToCache(file, {body: postData});
            sender({body: postData});
        });
    } else {
        console.log('In cache: ' + file);
        sender(fetchFromCache(file));
    }
}

function generateRss(request, feedUrl, linkGenerator, completion) {
    var feed = new Rss({
        title: siteMetadata.SiteTitle,
        description: 'Posts to ' + siteMetadata.SiteTitle,
        feed_url: siteMetadata.SiteRoot + feedUrl,
        site_url: siteMetadata.SiteRoot,
        image_url: siteMetadata.SiteRoot + '/images/favicon.png',
        author: 'VK Like Abuser',
        copyright: new Date().getFullYear() + ' VK Like Abuser',
        language: 'ru',
        pubDate: new Date().toString(),
        ttl: '60'
    });

    var max = 10;
    var i = 0;
    allPostsSortedAndGrouped(function (postsByDay) {
        postsByDay.forEach(function (day) {
            day.articles.forEach(function (article) {
                if (i < max) {
                    i += 1;
                    feed.item({
                        title: article.metadata.Title,
                        date: article.metadata.Date,
                        url: linkGenerator(article),
                        guid: externalFilenameForFile(article.file, request),
                        description: article.unwrappedBody.replace(/<script[\s\S]*?<\/script>/gm, "")
                    });
                }
            });
        });

        completion({
            date: new Date(),
            rss: feed.xml()
        });
    });
}

function homepageBuilder(page, completion, redirect) {
    var indexInfo = generateHtmlAndMetadataForFile(postsRoot + 'index.txt');
    var footnoteIndex = 0;

    Handlebars.registerPartial('article', indexInfo.metadata.ArticlePartial);
    var dayTemplate = Handlebars.compile(indexInfo.metadata.DayTemplate);
    var footerTemplate = Handlebars.compile(indexInfo.metadata.FooterTemplate);

    var bodyHtml = '';
    allPostsPaginated(function (pages) {
        if (page < 0 || page > pages.length) {
            redirect(pages.length > 1 ? '/page/' + pages.length : '/');
            return;
        }
        var days = pages[page - 1].days;
        days.forEach(function (day) {
            bodyHtml += dayTemplate(day);
        });

        var footerData = {};
        if (page > 1) {
            footerData.prevPage = page - 1;
        }
        if (pages.length > page) {
            footerData.nextPage = page + 1;
        }

        var fileData = generateHtmlAndMetadataForFile(postsRoot + 'index.txt');
        var metadata = fileData.metadata;
        var header = fileData.header;
        var titleBegin = header.indexOf('<title>') + "<title>".length;
        var titleEnd = header.indexOf('</title>');
        header = header.substring(0, titleBegin) + metadata.SiteTitle + header.substring(titleEnd);
        bodyHtml = performMetadataReplacements(metadata, bodyHtml);
        var fullHtml = header + bodyHtml + footerTemplate(footerData) + footerSource;
        completion(fullHtml);
    });
}

// время заполночь
// и мне осталось три пути

// первая дорога: сидеть, ждать смирно
app.get('/', function (request, response) {
    var page = 1;
    if (typeof(request.query.p) !== 'undefined') {
        page = Number(request.query.p);
        if (isNaN(page)) {
            response.redirect('/');
            return;
        } else {
            response.redirect('/page/' + page);
            return;
        }
    }

    baseRouteHandler('/page/1', function (cachedData) {
        response.status(200).send(cachedData.body);
    }, function (completion) {
        homepageBuilder(page, completion, function (destination) {
            response.redirect(destination);
        });
    });
});

app.get('/rss', function (request, response) {
    if ('user-agent' in request.headers && request.headers['user-agent'].has('subscriber')) {
        console.log('RSS: ' + request.headers['user-agent']);
    }
    response.type('application/rss+xml');

    if (typeof(renderedRss.date) === 'undefined' || new Date().getTime() - renderedRss.date.getTime() > 3600000) {
        generateRss(request, '/rss', function (article) {
            if (typeof(article.metadata.Link) !== 'undefined') {
                return article.metadata.Link;
            }
            return externalFilenameForFile(article.file, request);
        }, function (rss) {
            renderedRss = rss;
            response.status(200).send(renderedRss.rss);
        });
    } else {
        response.status(200).send(renderedRss.rss);
    }
});

// второй выбор мне: стряхнуть пыль, сорваться
app.get('/flush', function (request, response) {
    emptyCache();
    console.log('Emptied the cache.');
    response.redirect('/');
});

// а про третий путь не скажу ни слова
app.get('/drafts/:slug', function (request, response) {
        var file = postsRoot + '/drafts/' + request.params.slug;
        loadAndSendMarkdownFile(file, response);
});

// он у каждого свой: раз — и готово
app.get('/:slug', function (request, response) {
    if (isNaN(request.params.slug)) {
            var file = postsRoot + request.params.slug;
            loadAndSendMarkdownFile(file, response);
    } else if (request.params.slug >= 2000) {
        sendYearListing(request, response);
    } else {
            send404(response, request.params.slug);
    }
});


app.get('/api/latest', function (request, response) {
    console.log(`${__dirname}/posts/`)
    utils.readFiles(`${__dirname}/posts/`, function (data) {
        const posts = Object.values(data)
        let post = posts[posts.length - 1]
        post = post.split('\n')[0].replace('Title:', '')
        console.log(post.split('\n')[0])
        response.send(post)
    })
})


// HERE COMES DAT BOI
init();
var port = Number(process.env.PORT || 5000);
server.listen(port, function () {
   console.log('HERE ON PORT %s COMES DAT BOI', server.address().port);
});

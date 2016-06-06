# Clerk
![Клерк](http://i.imgur.com/PCb721V.png)
  
Clerk is a pseudo-static blog engine on Node.js. It uses plain text.

Easy to configure. Supports npm plugins.
  
# Install
1. Clone: `git clone https://github.com/vanya-klimenko/clerk`.
2. Install dependencies: `npm install`.
4. Install nginx on your machine.
3. Configure a nginx tunnel to localhost: `cd /etc/nginx`, `nano sites-available/clerk.conf`. Configuration file should look like this:
```
server {
    listen 80;
    server_name IP or domain;

    location / {
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   Host      $http_host;
        proxy_pass         http://127.0.0.1:5000;
    }
}
```
4. Turn on the server: `cp sites-available/blog.conf sites-enabled/clerk.conf`, `service nginx restart`.
5. Edit templates/defaultTags.html.

# Customise
Handlebars-based header, footer and post header are inside the templates folder. Styles, scripts and everything else is in the assets folder.

# Write and Publish
To create a note, just put a txt file in posts folder. To preview before posting, move it to posts/drafts. File's name is the note's address, so only Latin alphabet, numbers and hyphens are allowed.

You should add theese tags in the beginning of each note.
```
Title: Заголовок заметки
Date: 18 Feb 2016
Link: http://ya.ru

А тут у меня текст заметки.
```
Link tag is not required and turn a note into a linked post, Gruber-style.
   
Cache should automatically rebuild itself. If not, clean the cache: /flush.
  
# Fun Things
1. You can make a symbolic link between posts folder and your Dropbox. Cloud blogging!
2. All pages are being typograped.
3. You can edit 404 and index pages. They're located inside the posts folder, too, don't delete them.
4. RSS works.
5. Try to add `.txt` after this page's url.
  
# Not-fun-at-all Things
1. Pagination is probably broken.
2. No built-in search (you can use Google's).
3. No tags (there won't be any).
If you find a not-fun-at-all thing #4, feel free to drop me a line: v@vanyaklimenko.ru.

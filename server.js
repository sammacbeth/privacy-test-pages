const express = require('express');
const ws = require('ws');
const app = express();
const port = process.env.PORT || 3000;
const url = require('url');
const cmd = require('node-cmd');
const crypto = require('crypto');
const fs = require('fs');

function fullUrl(req) {
  return url.format({
    // note: if server is behind a proxy, and it probably is, you may see 'http' here even if request was 'https'
    protocol: req.protocol,
    host: req.get('host'),
    pathname: req.originalUrl
  });
}

// start server
const listener = app.listen(port, () => {
  console.log(`Server listening at port ${listener.address().port}`)
});

app.use(express.json());

// serve all static files
app.use(express.static('.', {
    setHeaders: (res, path) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Timing-Allow-Origin', '*');
        res.set('Server-Timing', 'loaded');

        // send CSP header when fetching request blocking test site
        if (path.endsWith('privacy-protections/request-blocking/index.html')) {
            res.set('Content-Security-Policy-Report-Only', 'img-src http: https:; report-uri https://bad.third-party.site/block-me/csp');
        }

        // send Referrer-policy header when fetching referrer trimming test site
        if (path.endsWith('privacy-protections/referrer-trimming/index.html')) {
            res.set('Referrer-Policy', 'unsafe-url');
        }
    }
}));

// endpoint for updating the app (https://support.glitch.com/t/tutorial-how-to-auto-update-your-project-with-github/8124)
app.post('/git', (req, res) => {
    const hmac = crypto.createHmac('sha1', process.env.SECRET);
    const sig  = 'sha1=' + hmac.update(JSON.stringify(req.body)).digest('hex');

    if (req.headers['x-github-event'] === 'push' && crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(req.headers['x-hub-signature'], 'utf8'))) { 
        fs.chmodSync('git.sh', '777'); /* :/ Fix no perms after updating */
        cmd.get('./git.sh', (err, data) => {  // Run our script
          if (data) console.log(data);
          if (err) console.log(err);
        });
        cmd.run('refresh');  // Refresh project
      
        console.log('> [GIT] Updated with origin/gh-pages');

        return res.sendStatus(200);
    } else {
        return res.sendStatus(403);
    }
});

// dummy websocket server
const wss = new ws.Server({server: listener, path: '/block-me/web-socket'});

wss.on('connection', (ws) => {
    ws.send('It works 👍');
    ws.close();
});

// dummy server sent events
app.get('/block-me/server-sent-events', (req, res) => {
    res.set({
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream',
        'Access-Control-Allow-Origin': '*',
        'Timing-Allow-Origin': '*'
    });
    res.flushHeaders();

    res.write(`data: It works 👍\n\n`);
  
    setTimeout(() => {
      res.end();
    }, 1000);
});

// dummy CSP report endopoint
app.post('/block-me/csp', (req, res) => {
    res.set('Timing-Allow-Origin', '*');
    res.set('Server-Timing', 'loaded');
    return res.sendStatus(200);
});

// reflects request headers and request url back
app.get('/reflect-headers', (req, res) => {
    res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Timing-Allow-Origin', '*');

    return res.json({url: fullUrl(req), headers: req.headers});
});

// sets a cookie with provided value
app.get('/set-cookie', (req, res) => {
    res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Timing-Allow-Origin', '*');

    const expires = new Date((Date.now() + (7 * 24 * 60 * 60 * 1000)));
    
    if (!req.query['value']) {
        return res.sendStatus(401);
    }
    return res.cookie('headerdata', req.query['value'], {expires, httpOnly: true, sameSite: 'none', secure: true}).sendStatus(200);
});

// returns a random number and sets caching for a year
app.get('/cached-random-number', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31556926, immutable');

    const random = (Math.round(Math.random() * 1000)).toString();

    res.end(random);
});

// returns referrer found in the header and in js back to the test page
app.get('/come-back', (req, res) => {
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
    <title>Redirecting</title>
</head>
<body>
<script>
    const jsReferrer = document.referrer;
    document.body.innerHTML += '<p>header: <strong>${req.headers.referer || ''}</strong></p><p>js: <strong>' + jsReferrer + '</strong></p>';
    setTimeout(() => {
        location.href = 'https://privacy-test-pages.glitch.me/privacy-protections/referrer-trimming/?run&header=${req.headers.referer || ''}&js=' + jsReferrer;
    }, 1000);
</script>
</body>
</html>`);
});
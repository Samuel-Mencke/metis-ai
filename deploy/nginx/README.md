# Nginx deployment

The application listens on `127.0.0.1:3100`; Nginx proxies requests to the
application.

First replace `YOUR_DOMAIN` and `YOUR_PORT` in
`deploy/nginx/metis-ai.conf.template`, then create the DNS record:

```text
YOUR_DOMAIN  A  <server IPv4 address>
```

Then run these commands manually on the server from the repository root:

```sh
sudo install -m 0644 deploy/nginx/metis-ai.conf \
  /etc/nginx/sites-available/metis-ai
sudo ln -sfn /etc/nginx/sites-available/metis-ai \
  /etc/nginx/sites-enabled/metis-ai
sudo nginx -t
sudo systemctl reload nginx
```

Only after the HTTP configuration passes validation, issue the TLS
certificate:

```sh
sudo certbot --nginx -d YOUR_DOMAIN
sudo nginx -t
sudo systemctl reload nginx
```

Do not replace or delete configurations for other domains. The Nginx config
uses the existing application on `127.0.0.1:3100`.

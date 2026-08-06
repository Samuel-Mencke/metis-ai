# Nginx deployment for metis-ai.f1shy312.com

The application listens on `127.0.0.1:3100`; Nginx proxies requests to the
application.

First create the DNS record:

```text
metis-ai.f1shy312.com  A  <server IPv4 address>
```

Then run these commands manually on the server from the repository root:

```sh
sudo install -m 0644 deploy/nginx/metis-ai.f1shy312.com.conf \
  /etc/nginx/sites-available/metis-ai.f1shy312.com
sudo ln -sfn /etc/nginx/sites-available/metis-ai.f1shy312.com \
  /etc/nginx/sites-enabled/metis-ai.f1shy312.com
sudo nginx -t
sudo systemctl reload nginx
```

Only after the HTTP configuration passes validation, issue the TLS
certificate:

```sh
sudo certbot --nginx -d metis-ai.f1shy312.com
sudo nginx -t
sudo systemctl reload nginx
```

Do not replace or delete configurations for other domains. The Nginx config
uses the existing application on `127.0.0.1:3100`.

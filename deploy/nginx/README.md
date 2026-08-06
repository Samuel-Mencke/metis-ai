# Nginx deployment for metis-ai.f1shy312.com

The application listens on `127.0.0.1:3100`. The installer files are served
from `/var/www/metis-ai-installer/`, while all other requests are proxied to
the application.

First create the DNS record:

```text
metis-ai.f1shy312.com  A  <server IPv4 address>
```

Then run these commands manually on the server from the repository root:

```sh
sudo install -d -m 0755 /var/www/metis-ai-installer
sudo install -m 0644 deploy/installer/linux /var/www/metis-ai-installer/linux
sudo install -m 0644 deploy/installer/macos /var/www/metis-ai-installer/macos
sudo install -m 0644 deploy/installer/windows /var/www/metis-ai-installer/windows
sudo install -m 0644 scripts/install.sh /var/www/metis-ai-installer/install.sh
sudo install -m 0644 scripts/install.ps1 /var/www/metis-ai-installer/install.ps1
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
uses the existing application on `127.0.0.1:3100`; configure the app service
and worker separately with the installer.

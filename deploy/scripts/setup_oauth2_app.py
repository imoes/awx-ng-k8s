#!/usr/bin/env python3
"""
awx-ng OAuth2-Setup für CentralStation
========================================
Erstellt eine OAuth2-Application in AWX für CentralStation und gibt
Client-ID + Secret aus, die in CentralStation konfiguriert werden müssen.

Aufruf:
  python3 setup_oauth2_app.py \
    --url  http://awx-ng.example.com:8052 \
    --user admin \
    --pass <admin-pw> \
    --redirect-uri https://centralstation.example.com/auth/awx/callback

Das Script ist idempotent — existiert die App bereits (by name), wird sie
ausgegeben statt neu angelegt.
"""

import argparse
import json
import sys
import urllib.request
import urllib.error
import base64

APP_NAME = 'centralstation'


def _api(base_url: str, token: str, method: str, path: str, body=None):
    url = f'{base_url.rstrip("/")}/api/v2{path}'
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        print(f'HTTP {exc.code} {method} {path}: {body}', file=sys.stderr)
        raise


def _get_token(base_url: str, username: str, password: str) -> str:
    """Holt einen Bearer-Token via Basic-Auth (Personal Access Token)."""
    credentials = base64.b64encode(f'{username}:{password}'.encode()).decode()
    url = f'{base_url.rstrip("/")}/api/v2/users/me/personal_tokens/'
    req = urllib.request.Request(
        url,
        data=json.dumps({'description': 'setup_oauth2_app.py', 'application': None, 'scope': 'write'}).encode(),
        method='POST',
        headers={
            'Authorization': f'Basic {credentials}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    return data['token']


def main():
    parser = argparse.ArgumentParser(description='awx-ng OAuth2-App für CentralStation anlegen')
    parser.add_argument('--url', default='http://localhost:8052', help='AWX-Basis-URL')
    parser.add_argument('--user', default='admin', help='AWX-Admin-User')
    parser.add_argument('--pass', dest='password', required=True, help='AWX-Admin-Passwort')
    parser.add_argument('--redirect-uri', required=True, help='OAuth2 Redirect URI für CentralStation')
    parser.add_argument('--org-id', type=int, default=1, help='AWX Organisation-ID (Standard: 1)')
    args = parser.parse_args()

    print(f'Verbinde mit {args.url} als {args.user}...')
    token = _get_token(args.url, args.user, args.password)

    # Prüfen ob App bereits vorhanden
    apps = _api(args.url, token, 'GET', f'/applications/?name={APP_NAME}')
    if apps['count'] > 0:
        app = apps['results'][0]
        print(f'\nOAuth2-Application "{APP_NAME}" existiert bereits (id={app["id"]})')
        print(f'  Client-ID:     {app["client_id"]}')
        print('  Client-Secret: <nicht mehr abrufbar — bei Bedarf neu anlegen>')
        print(f'\nKonfiguriere CentralStation mit:')
        print(f'  AWX_URL:       {args.url}')
        print(f'  CLIENT_ID:     {app["client_id"]}')
        print(f'  CLIENT_SECRET: <aus Erstanlage>')
        return

    # App anlegen
    app = _api(args.url, token, 'POST', '/applications/', {
        'name': APP_NAME,
        'description': 'CentralStation AWX-Integration (awx-ng)',
        'client_type': 'confidential',
        'authorization_grant_type': 'authorization-code',
        'redirect_uris': args.redirect_uri,
        'organization': args.org_id,
        'skip_authorization': False,
    })

    print(f'\nOAuth2-Application angelegt (id={app["id"]}):')
    print(f'  Client-ID:     {app["client_id"]}')
    print(f'  Client-Secret: {app["client_secret"]}')
    print()
    print('Konfiguriere CentralStation mit:')
    print(f'  AWX_URL:               {args.url}')
    print(f'  AWX_CLIENT_ID:         {app["client_id"]}')
    print(f'  AWX_CLIENT_SECRET:     {app["client_secret"]}')
    print(f'  AWX_REDIRECT_URI:      {args.redirect_uri}')
    print(f'  AWX_AUTHORIZE_URL:     {args.url}/o/authorize/')
    print(f'  AWX_TOKEN_URL:         {args.url}/o/token/')
    print(f'  AWX_API_BASE:          {args.url}/api/v2/')
    print()
    print('HINWEIS: Das Client-Secret wird nur einmal angezeigt — jetzt sichern!')

    # Temporären Token wieder löschen
    tokens = _api(args.url, token, 'GET', '/tokens/?description=setup_oauth2_app.py')
    for t in tokens.get('results', []):
        _api(args.url, token, 'DELETE', f'/tokens/{t["id"]}/')


if __name__ == '__main__':
    main()

# awx-ng Custom Settings — mounted as /etc/tower/settings.py
# AWX production.py lädt diese Datei als primäre Konfiguration.

import os

# ── Secret Key ────────────────────────────────────────────────────────────────
# AWX liest SECRET_KEY aus /etc/tower/SECRET_KEY (defaults.py).
# Wir mounten das Docker Secret direkt dorthin — kein Code nötig hier.
# Fallback: SECRET_KEY_FILE env var (falls abweichend gemountet)
_sk_file = os.environ.get('SECRET_KEY_FILE', '/run/secrets/secret_key')
if os.path.exists(_sk_file):
    SECRET_KEY = open(_sk_file).read().strip()

# ── Database ──────────────────────────────────────────────────────────────────
_pg_pw_file = os.environ.get('DATABASE_PASSWORD_FILE', '')
_pg_password = open(_pg_pw_file).read().strip() if _pg_pw_file and os.path.exists(_pg_pw_file) else os.environ.get('DATABASE_PASSWORD', '')

DATABASES = {
    'default': {
        'ATOMIC_REQUESTS': True,
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('DATABASE_NAME', 'awx'),
        'USER': os.environ.get('DATABASE_USER', 'awx'),
        'PASSWORD': _pg_password,
        'HOST': os.environ.get('DATABASE_HOST', 'postgres'),
        'PORT': int(os.environ.get('DATABASE_PORT', 5432)),
    }
}

# ── Cache / Redis ─────────────────────────────────────────────────────────────
_redis_host = os.environ.get('REDIS_HOST', 'redis')
_redis_port = os.environ.get('REDIS_PORT', '6379')
_redis_url = f'redis://{_redis_host}:{_redis_port}'

# AWX nutzt seinen eigenen Cache-Backend (Django built-in RedisCache-Subklasse)
CACHES = {
    'default': {
        'BACKEND': 'awx.main.cache.AWXRedisCache',
        'LOCATION': f'{_redis_url}/1',
        'TIMEOUT': None,
    }
}
DJANGO_REDIS_IGNORE_EXCEPTIONS = True

# Celery/Dispatcherd Broker-URL (TCP statt Unix-Socket)
BROKER_URL = f'{_redis_url}/0'

# ── Channel Layers (websocket) ────────────────────────────────────────────────
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [f'{_redis_url}/2'],
            'capacity': 10000,
        }
    }
}

# ── Projects / Ansible repo ───────────────────────────────────────────────────
PROJECTS_ROOT = '/var/lib/awx/projects/'
# Path where ansible03 is mounted (for custom variable extraction)
AWX_NG_ANSIBLE03_PATH = '/var/lib/awx/ansible03'


# ── Facts (ansible_facts) ─────────────────────────────────────────────────────
# AWX does NOT store host facts globally, but per Job Template: the template must
# have "Enable Fact Storage" (use_fact_cache=True) AND the playbook must gather
# facts (gather_facts: true / setup module). Only then does a host's Facts tab
# fill up. No global setting is needed here — the fact-cache artifacts land under
# artifacts/<job_id>/fact_cache/ and are imported into Host.ansible_facts.
# See AGENT.md → "Facts füllen". (No override here — default AWX behaviour is fine.)

# ── Custom app registration ───────────────────────────────────────────────────
# awx.customvars: Rollen-Variablen, Locations/Subnets, Proxy-Site-Zuordnung
INSTALLED_APPS = INSTALLED_APPS + ['awx.customvars']

# ── NetBox-Integration (Reconcile) ───────────────────────────────────────────
# Gesetzt via docker-compose environment: NETBOX_URL, NETBOX_TOKEN
NETBOX_URL = os.environ.get('NETBOX_URL', '')
NETBOX_TOKEN = os.environ.get('NETBOX_TOKEN', '')

# ── SSO / Generic OIDC ───────────────────────────────────────────────────────
# Wird in AWX über /api/v2/settings/oidc/ gesetzt; hier als Startup-Default.
# Env-Vars: OIDC_KEY, OIDC_SECRET, OIDC_ENDPOINT
_oidc_key = os.environ.get('OIDC_KEY', '')
_oidc_secret = os.environ.get('OIDC_SECRET', '')
_oidc_endpoint = os.environ.get('OIDC_ENDPOINT', '')

if _oidc_key and _oidc_secret and _oidc_endpoint:
    SOCIAL_AUTH_OIDC_KEY = _oidc_key
    SOCIAL_AUTH_OIDC_SECRET = _oidc_secret
    SOCIAL_AUTH_OIDC_OIDC_ENDPOINT = _oidc_endpoint
    SOCIAL_AUTH_OIDC_VERIFY_SSL = os.environ.get('OIDC_VERIFY_SSL', 'true').lower() != 'false'

# ── Logging ───────────────────────────────────────────────────────────────────
LOGGING['handlers']['console']['level'] = 'INFO'

# ── Execution Environment / Container Runtime ─────────────────────────────────
# In docker-compose: awx_ee IS der EE — kein nested Container via podman/docker nötig.
# Deaktiviert das Starten eines EE-Containers in ansible-runner (läuft direkt im awx_ee).
AWX_DISABLE_CONTAINER_ISOLATION = True

# ── Security ─────────────────────────────────────────────────────────────────
ALLOWED_HOSTS = ['*']
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

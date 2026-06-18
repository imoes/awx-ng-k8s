# awx-ng Custom Settings — mounted into /etc/tower/conf.d/custom.py
# This file is picked up by AWX's production settings loader.

import os

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
CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': f'redis://{_redis_host}:{_redis_port}/1',
        'OPTIONS': {'CLIENT_CLASS': 'django_redis.client.DefaultClient'},
        'TIMEOUT': None,
    }
}

# ── Channel Layers (websocket) ────────────────────────────────────────────────
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [(f'redis://{_redis_host}:{_redis_port}/2')],
            'capacity': 10000,
        }
    }
}

# ── Projects / Ansible repo ───────────────────────────────────────────────────
PROJECTS_ROOT = '/var/lib/awx/projects/'
# Path where ansible03 is mounted (for custom variable extraction)
AWX_NG_ANSIBLE03_PATH = '/var/lib/awx/ansible03'

# ── Custom app registration (added in Phase 0) ───────────────────────────────
# INSTALLED_APPS is extended, not replaced, by appending here.
# This will be uncommented once awx.customvars app is built.
# INSTALLED_APPS = INSTALLED_APPS + ['awx.customvars']

# ── Logging ───────────────────────────────────────────────────────────────────
LOGGING['handlers']['console']['level'] = 'INFO'

# ── Security ─────────────────────────────────────────────────────────────────
ALLOWED_HOSTS = ['*']
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

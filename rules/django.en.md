## Django
- When a model changes, create the migration with `python manage.py makemigrations` and commit it together. {{judge}}
- Never edit a committed migration; add a new one. {{!hook:migration-edit}}
- Ask the user before changing production settings (prod settings, DEBUG, ALLOWED_HOSTS, where SECRET_KEY is read). {{judge}}
- In templates, do not use `|safe`, `mark_safe` or `{% autoescape off %}` on user values. Build HTML with `format_html`. {{judge}}
- Put `{% csrf_token %}` in POST forms, and ask before using `@csrf_exempt`. {{judge}}
- If there are background tasks (Celery etc.), pass ids, not personal data, as task arguments, and make tasks safe to run twice (idempotent). {{judge}}

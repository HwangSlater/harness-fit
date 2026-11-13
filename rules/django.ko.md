## Django
- 모델을 바꾸면 `python manage.py makemigrations` 로 마이그레이션을 만들고 함께 커밋한다. {{judge}}
- 이미 커밋한 마이그레이션은 고치지 않고 새 마이그레이션을 만든다. {{!hook:migration-edit}}
- 운영 설정(settings 의 prod·DEBUG·ALLOWED_HOSTS·SECRET_KEY 읽는 곳)은 사용자에게 묻고 바꾼다. {{judge}}
- 템플릿에서 사용자 값에 `|safe`·`mark_safe`·`{% autoescape off %}` 를 쓰지 않는다. HTML 을 만들 때는 `format_html`. {{judge}}
- POST 폼에는 `{% csrf_token %}` 을 넣고, `@csrf_exempt` 는 쓰기 전에 묻는다. {{judge}}
- 비동기 작업(Celery 등)이 있으면 작업 인자에 개인정보 대신 id 를 넘기고, 다시 돌아도 같은 결과가 되게(멱등) 만든다. {{judge}}

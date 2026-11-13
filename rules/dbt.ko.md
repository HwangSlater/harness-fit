## dbt
- 모델을 바꾸면 `dbt build --select <모델>+`(또는 `dbt test --select <모델>+`)로 하위(downstream) 모델까지 테스트를 돌려 결과를 확인한다. {{judge}}
- `--target prod`·`--full-refresh` 명령은 실행 전에 묻는다. {{judge}}
- schema.yml 의 테스트를 지우거나 약하게 하지 않고, 열 이름을 바꾸면 그 모델을 쓰는 곳을 사용자에게 알린다. {{judge}}
- 새 모델·열에는 schema.yml 에 설명(description)과 테스트를 함께 단다. {{judge}}
- seeds·snapshots 의 기존 행은 고치지 않는다(바꿀 일이면 묻는다). {{judge}}
- `profiles.yml`(접속 정보)은 저장소에 만들지 않는다. {{judge}}

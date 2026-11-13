## 인프라 코드
- 반영 전에 `terraform plan`(Kubernetes 는 `kubectl diff`·`helm template`, Ansible 은 `--check --diff`)을 돌리고, 지워지거나 교체(-/+)되는 자원을 자원마다 이유와 함께 PR 설명에 요약한다. {{judge}}
- `.tf` 를 고쳤으면 `terraform fmt`·`terraform validate`·`tflint` 를 돌린다. {{judge}}
- 차트를 고쳤으면 `helm lint`·`helm template` 을 환경마다의 values 파일(dev·prod)로 모두 돌린다. {{judge}} {{kind:helm}}
- apply·destroy·클러스터 반영은 사용자가 하라고 할 때만 실행한다. {{judge}}
- DB·버킷·볼륨처럼 상태가 있는 자원의 `prevent_destroy`·`deletion_protection` 은 지우거나 끄지 않고, `skip_final_snapshot` 은 `false` 로 둔다. {{judge}}
- `0.0.0.0/0`·`::/0` 인바운드(공개 ALB 의 443 은 빼고), 공개 버킷·`publicly_accessible = true` 는 사용자가 이유를 밝혔을 때만 넣는다. {{judge}}
- state·plan 파일·`*.tfvars`·kubeconfig 는 커밋하지 않고, 비밀값은 변수·시크릿 저장소에서 읽는다. {{judge}}
- provider·모듈·차트 버전은 고정한다(`required_providers` 의 `version`, 모듈 `?ref=`). {{judge}}

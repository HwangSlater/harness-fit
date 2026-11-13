## Infrastructure as code
- Before applying, run `terraform plan` (`kubectl diff` or `helm template` for Kubernetes, `--check --diff` for Ansible) and summarise in the PR description each resource that is destroyed or replaced (-/+) and why. {{judge}}
- After changing `.tf` files, run `terraform fmt`, `terraform validate` and `tflint`. {{judge}}
- After changing a chart, run `helm lint` and `helm template` with every environment's values file (dev and prod). {{judge}} {{kind:helm}}
- Run apply, destroy or cluster changes only when the user asks for it. {{judge}}
- Never remove or disable `prevent_destroy` or `deletion_protection` on stateful resources such as databases, buckets and volumes, and keep `skip_final_snapshot` at `false`. {{judge}}
- Add `0.0.0.0/0` or `::/0` ingress (except 443 on a public ALB), public buckets or `publicly_accessible = true` only when the user has given a reason. {{judge}}
- Never commit state or plan files, `*.tfvars` or kubeconfig; read secrets from variables or a secret store. {{judge}}
- Pin provider, module and chart versions (`version` in `required_providers`, `?ref=` on modules). {{judge}}
